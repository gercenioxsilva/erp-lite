// Orquestração de I/O para o domínio de Empresa/CNPJ (multi-empresa, regra 40).
// nfe_configs é a entidade "Empresa": cada linha é um CNPJ do tenant. Este
// serviço é o único ponto de leitura/escrita — rotas nunca consultam
// nfeConfigs diretamente para resolver "qual empresa emite".

import { eq, and, ne } from 'drizzle-orm';
import { db as _db } from '../db';
import { nfeConfigs } from '../db/schema';
import { canDeactivate, validateNewCompanyCnpj, CompanyDomainError, type CompanyLike } from '../domain/company/companyDomain';
import { normalizeCNPJ } from '../domain/cnpj/cnpjDomain';

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
  };
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
 */
export async function resolveCompanyId(
  tenantId: string, companyId: string | null | undefined, db: DrizzleDB = _db,
): Promise<Company> {
  if (!companyId) {
    const def = await getDefaultCompany(tenantId, db);
    if (!def) throw new CompanyDomainError('no_default_company', { tenantId });
    return def;
  }

  const [row] = await db.select().from(nfeConfigs)
    .where(and(eq(nfeConfigs.id, companyId), eq(nfeConfigs.tenant_id, tenantId)));

  if (!row || !row.is_active) throw new CompanyDomainError('company_not_found', { companyId });
  return row;
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
  const [row] = await db.update(nfeConfigs).set({
    ...values,
    focus_token_homologacao: input.focus_token_homologacao ?? existingDefault.focus_token_homologacao,
    focus_token_producao:    input.focus_token_producao    ?? existingDefault.focus_token_producao,
    updated_at: new Date(),
  }).where(eq(nfeConfigs.id, existingDefault.id)).returning();

  return row;
}

export async function updateCompany(
  tenantId: string, companyId: string, input: Partial<CompanyInput>, db: DrizzleDB = _db,
): Promise<Company> {
  const current = await resolveCompanyId(tenantId, companyId, db);

  if (input.cnpj && normalizeCNPJ(input.cnpj) !== current.cnpj) {
    const existing = await listAllCompanies(tenantId, db);
    const validation = validateNewCompanyCnpj(
      existing.filter(c => c.id !== companyId).map(c => c.cnpj), input.cnpj,
    );
    if (!validation.ok) throw new CompanyDomainError(validation.error!, { cnpj: input.cnpj });
  }

  const values = toValues({ ...current, ...input } as CompanyInput);
  const [row] = await db.update(nfeConfigs).set({
    ...values,
    focus_token_homologacao: input.focus_token_homologacao ?? current.focus_token_homologacao,
    focus_token_producao:    input.focus_token_producao    ?? current.focus_token_producao,
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
