// Orquestração de I/O para o domínio de Empresa/CNPJ (multi-empresa, regra 40).
// nfe_configs é a entidade "Empresa": cada linha é um CNPJ do tenant. Este
// serviço é o único ponto de leitura/escrita — rotas nunca consultam
// nfeConfigs diretamente para resolver "qual empresa emite".

import { eq, and, ne } from 'drizzle-orm';
import { db as _db } from '../db';
import { nfeConfigs } from '../db/schema';
import {
  canDeactivate, validateNewCompanyCnpj, hasCapability, CompanyDomainError,
  type CompanyLike, type EmissionDocType,
} from '../domain/company/companyDomain';
import { normalizeCNPJ } from '../domain/cnpj/cnpjDomain';

export type { EmissionDocType };

export { CompanyDomainError };

export type DrizzleDB = typeof _db;
export type Company = typeof nfeConfigs.$inferSelect;

// Campos editáveis de uma empresa — mesma lista de campos que a rota legada
// PUT /v1/nfe-config já aceitava (retrocompatibilidade de contrato).
export interface CompanyInput {
  cnpj: string;
  razao_social: string;
  nome_fantasia?: string | null;
  regime_tributario?: number;
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  municipio?: string;
  uf?: string;
  cep: string;
  telefone?: string | null;
  email?: string | null;
  cfop_padrao?: string;
  cfop_interestadual?: string;
  natureza_operacao?: string;
  focus_ambiente?: number;
  focus_token_homologacao?: string | null;
  focus_token_producao?: string | null;
  inscricao_municipal?: string | null;
  codigo_municipio_ibge?: string;
  aliquota_iss_padrao?: number | string;
  codigo_servico_padrao?: string | null;
  emite_nfe?:  boolean;
  emite_nfse?: boolean;
}

function toValues(input: CompanyInput) {
  return {
    cnpj: normalizeCNPJ(input.cnpj),
    razao_social: input.razao_social,
    nome_fantasia: input.nome_fantasia ?? null,
    regime_tributario: input.regime_tributario ?? 1,
    logradouro: input.logradouro,
    numero: input.numero,
    complemento: input.complemento ?? null,
    bairro: input.bairro,
    municipio: input.municipio ?? 'SAO PAULO',
    uf: input.uf ?? 'SP',
    cep: String(input.cep).replace(/\D/g, ''),
    telefone: input.telefone ?? null,
    email: input.email ?? null,
    cfop_padrao: input.cfop_padrao ?? '5102',
    cfop_interestadual: input.cfop_interestadual ?? '6102',
    natureza_operacao: input.natureza_operacao ?? 'Venda de mercadoria',
    focus_ambiente: input.focus_ambiente ?? 2,
    inscricao_municipal: input.inscricao_municipal ?? null,
    codigo_municipio_ibge: input.codigo_municipio_ibge ?? '3550308',
    aliquota_iss_padrao: input.aliquota_iss_padrao != null ? String(input.aliquota_iss_padrao) : '5.00',
    codigo_servico_padrao: input.codigo_servico_padrao ?? null,
    emite_nfe:  input.emite_nfe  ?? true,
    emite_nfse: input.emite_nfse ?? true,
  };
}

/**
 * Traduz um CompanyDomainError vindo de resolveCompanyId() numa mensagem
 * acionável em pt-BR — ponto único de mensagem, reaproveitado por toda rota
 * de emissão (nfe.ts, nfse.ts, serviceContracts.ts, serviceOrders.ts,
 * simplesRemessa.ts) em vez de cada uma reescrever o mesmo switch.
 *
 * Só os 3 códigos novos da regra 53 (`company_missing_capability`,
 * `no_company_for_doc_type`, `company_selection_required`) ganham mensagem
 * própria — os demais (`company_not_found`, `no_default_company`, etc.) já
 * existiam antes desta regra e mantêm a MESMA mensagem genérica de sempre,
 * pra não quebrar nenhuma tela/teste que já depende desse texto.
 */
export function companyResolutionErrorMessage(err: CompanyDomainError, docLabel: string): string {
  switch (err.code) {
    case 'company_missing_capability':
      return `A empresa selecionada não está configurada para emitir ${docLabel}. Configure em Empresa → Fiscal.`;
    case 'no_company_for_doc_type':
      return `Nenhuma empresa está configurada para emitir ${docLabel}. Configure em Empresa → Fiscal.`;
    case 'company_selection_required':
      return `Mais de uma empresa pode emitir ${docLabel} — selecione qual empresa vai emitir.`;
    default:
      return 'Configure os dados fiscais em Empresa → Fiscal antes de emitir.';
  }
}

/** Todas as empresas ativas do tenant, empresa padrão primeiro. */
export async function listCompanies(tenantId: string, db: DrizzleDB = _db): Promise<Company[]> {
  const rows = await db.select().from(nfeConfigs)
    .where(and(eq(nfeConfigs.tenant_id, tenantId), eq(nfeConfigs.is_active, true)));
  return rows.sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
}

/** Todas as empresas do tenant, incluindo inativas — usado para os invariantes de domínio. */
async function listAllCompanies(tenantId: string, db: DrizzleDB): Promise<Company[]> {
  return db.select().from(nfeConfigs).where(eq(nfeConfigs.tenant_id, tenantId));
}

export async function getDefaultCompany(tenantId: string, db: DrizzleDB = _db): Promise<Company | null> {
  const [row] = await db.select().from(nfeConfigs)
    .where(and(eq(nfeConfigs.tenant_id, tenantId), eq(nfeConfigs.is_default, true)));
  return row ?? null;
}

/**
 * Resolve qual empresa deve ser usada: se companyId for informado, valida que
 * pertence ao tenant e está ativa; caso contrário, devolve a empresa padrão.
 * Ponto único de resolução usado por todo fluxo de emissão fiscal (regra 40).
 *
 * `docType` é opcional e retrocompatível por design (regra 53) — omitido,
 * o comportamento é idêntico ao de antes desta regra existir (usado hoje por
 * tax.ts/bankAccountService.ts/marketplaceConnectionService.ts, que resolvem
 * "uma" empresa sem relação com tipo de documento fiscal). Quando informado,
 * a resolução também respeita `emite_nfe`/`emite_nfse`:
 *   - companyId explícito sem a capacidade → `company_missing_capability`.
 *   - companyId omitido: empresa padrão tem a capacidade → usa ela; senão,
 *     exatamente 1 outra empresa ativa tem → resolve sozinho (sem
 *     ambiguidade real); nenhuma tem → `no_company_for_doc_type`; mais de
 *     uma tem e nenhuma é a padrão → `company_selection_required` (nunca
 *     escolhe arbitrariamente por trás do usuário).
 */
export async function resolveCompanyId(
  tenantId: string, companyId: string | null | undefined, db: DrizzleDB = _db,
  docType?: EmissionDocType,
): Promise<Company> {
  if (companyId) {
    const [row] = await db.select().from(nfeConfigs)
      .where(and(eq(nfeConfigs.id, companyId), eq(nfeConfigs.tenant_id, tenantId)));

    if (!row || !row.is_active) throw new CompanyDomainError('company_not_found', { companyId });
    if (docType && !hasCapability(row, docType)) {
      throw new CompanyDomainError('company_missing_capability', { companyId, docType });
    }
    return row;
  }

  if (!docType) {
    const def = await getDefaultCompany(tenantId, db);
    if (!def) throw new CompanyDomainError('no_default_company', { tenantId });
    return def;
  }

  const active = await listCompanies(tenantId, db); // empresa padrão primeiro
  const defaultCompany = active.find(c => c.is_default);
  if (defaultCompany && hasCapability(defaultCompany, docType)) return defaultCompany;

  const candidates = active.filter(c => hasCapability(c, docType));
  if (candidates.length === 0) throw new CompanyDomainError('no_company_for_doc_type', { docType });
  if (candidates.length === 1) return candidates[0];
  throw new CompanyDomainError('company_selection_required', { docType });
}

export async function createCompany(tenantId: string, input: CompanyInput, db: DrizzleDB = _db): Promise<Company> {
  const existing = await listAllCompanies(tenantId, db);
  const validation = validateNewCompanyCnpj(existing.map(c => c.cnpj), input.cnpj);
  if (!validation.ok) throw new CompanyDomainError(validation.error!, { cnpj: input.cnpj });

  const [row] = await db.insert(nfeConfigs).values({
    tenant_id: tenantId,
    is_default: existing.length === 0, // primeira empresa do tenant (não deveria acontecer via esta rota, mas defensivo)
    is_active: true,
    ...toValues(input),
  }).returning();

  return row;
}

/**
 * Cria ou atualiza a empresa padrão do tenant — usado apenas pela rota legada
 * PUT /v1/nfe-config, que precisa continuar funcionando exatamente como antes
 * para clientes (web antigo, mobile) que ainda não sabem de multi-empresa.
 */
export async function upsertDefaultCompany(tenantId: string, input: CompanyInput, db: DrizzleDB = _db): Promise<Company> {
  const existingDefault = await getDefaultCompany(tenantId, db);

  if (!existingDefault) {
    const [row] = await db.insert(nfeConfigs).values({
      tenant_id: tenantId, is_default: true, is_active: true, ...toValues(input),
    }).returning();
    return row;
  }

  const values = toValues(input);
  // Tokens: só sobrescreve quando um novo valor em texto puro foi enviado (mesmo
  // comportamento da rota legada — valores mascarados '****...' nunca chegam aqui).
  //
  // Bug real de produção: trocar o CNPJ da empresa (ex.: corrigir um erro de
  // digitação) SEM informar um token novo mantinha o token antigo — que foi
  // emitido pelo emissor fiscal pra outro CNPJ. Toda emissão seguinte era
  // rejeitada ("CNPJ do emitente não autorizado"), sem nenhum aviso na hora
  // da troca. CNPJ mudou → todo o estado de integração fiscal amarrado ao
  // CNPJ antigo (tokens manuais + registro automatizado, regra 70) é
  // descartado, nunca carregado adiante silenciosamente.
  const cnpjChanged = Boolean(input.cnpj) && normalizeCNPJ(input.cnpj!) !== existingDefault.cnpj;

  const [row] = await db.update(nfeConfigs).set({
    ...values,
    focus_token_homologacao: input.focus_token_homologacao ?? (cnpjChanged ? null : existingDefault.focus_token_homologacao),
    focus_token_producao:    input.focus_token_producao    ?? (cnpjChanged ? null : existingDefault.focus_token_producao),
    ...(cnpjChanged ? {
      fiscal_integration_ref:     null,
      fiscal_registration_status: null,
      fiscal_registration_error:  null,
      certificado_cnpj:           null,
      certificado_valido_de:      null,
      certificado_valido_ate:     null,
    } : {}),
    updated_at: new Date(),
  }).where(eq(nfeConfigs.id, existingDefault.id)).returning();

  return row;
}

export async function updateCompany(
  tenantId: string, companyId: string, input: Partial<CompanyInput>, db: DrizzleDB = _db,
): Promise<Company> {
  const current = await resolveCompanyId(tenantId, companyId, db);

  const cnpjChanged = Boolean(input.cnpj) && normalizeCNPJ(input.cnpj!) !== current.cnpj;

  if (cnpjChanged) {
    const existing = await listAllCompanies(tenantId, db);
    const validation = validateNewCompanyCnpj(
      existing.filter(c => c.id !== companyId).map(c => c.cnpj), input.cnpj!,
    );
    if (!validation.ok) throw new CompanyDomainError(validation.error!, { cnpj: input.cnpj });
  }

  const values = toValues({ ...current, ...input } as CompanyInput);
  // Bug real de produção: trocar o CNPJ da empresa SEM informar um token
  // novo mantinha o token antigo — emitido pelo emissor fiscal pra outro
  // CNPJ. Toda emissão seguinte era rejeitada ("CNPJ do emitente não
  // autorizado"), sem nenhum aviso na hora da troca. CNPJ mudou → todo o
  // estado de integração fiscal amarrado ao CNPJ antigo (tokens manuais +
  // registro automatizado, regra 70) é descartado, nunca carregado adiante
  // silenciosamente.
  const [row] = await db.update(nfeConfigs).set({
    ...values,
    focus_token_homologacao: input.focus_token_homologacao ?? (cnpjChanged ? null : current.focus_token_homologacao),
    focus_token_producao:    input.focus_token_producao    ?? (cnpjChanged ? null : current.focus_token_producao),
    ...(cnpjChanged ? {
      fiscal_integration_ref:     null,
      fiscal_registration_status: null,
      fiscal_registration_error:  null,
      certificado_cnpj:           null,
      certificado_valido_de:      null,
      certificado_valido_ate:     null,
    } : {}),
    updated_at: new Date(),
  }).where(eq(nfeConfigs.id, companyId)).returning();

  return row;
}

export async function deactivateCompany(tenantId: string, companyId: string, db: DrizzleDB = _db): Promise<void> {
  const all = await listAllCompanies(tenantId, db);
  const target = all.find(c => c.id === companyId);
  if (!target) throw new CompanyDomainError('company_not_found', { companyId });

  if (!canDeactivate(all as unknown as CompanyLike[], companyId)) {
    throw new CompanyDomainError('cannot_deactivate_company', { companyId });
  }

  await db.update(nfeConfigs).set({ is_active: false, updated_at: new Date() }).where(eq(nfeConfigs.id, companyId));
}

/** Troca a empresa padrão do tenant — desliga a antiga, liga a nova, em transação. */
export async function setDefaultCompany(tenantId: string, companyId: string, db: DrizzleDB = _db): Promise<Company> {
  const target = await resolveCompanyId(tenantId, companyId, db);
  if (target.is_default) return target;

  return db.transaction(async (tx: any) => {
    await tx.update(nfeConfigs).set({ is_default: false, updated_at: new Date() })
      .where(and(eq(nfeConfigs.tenant_id, tenantId), ne(nfeConfigs.id, companyId)));
    const [row] = await tx.update(nfeConfigs).set({ is_default: true, updated_at: new Date() })
      .where(eq(nfeConfigs.id, companyId)).returning();
    return row;
  });
}
