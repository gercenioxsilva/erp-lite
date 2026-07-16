// Application Service — NFS-e avulsa (emissão direta de serviço, fora do
// fluxo de faturamento de Ordem de Serviço, regra 47, e de Contrato de
// Serviço). Mesma UX de "nota fiscal de venda avulsa" (createInvoice em
// routes/invoices.ts POST /invoices): cria o rascunho aqui; a emissão em
// si (enfileirar pro Focus) continua sendo POST /nfse/:id/emit, já
// existente, reaproveitado sem duplicar.

import { sql } from 'drizzle-orm';
import { db as _db, nfseInvoices } from '../db';
import { validateNfseCreate, calcIssValue, NfseDomainError } from '../domain/nfse/nfseDomain';
import { resolveCompanyId } from './companyService';

export type DrizzleDB = typeof _db;
export { NfseDomainError };

export interface CreateStandaloneNfseArgs {
  tenantId:     string;
  clientId:     string;
  description:  string;
  amount:       number;
  serviceCode?: string | null;
  issRate?:     number | null;
  periodStart?: string | null;
  periodEnd?:   string | null;
  companyId?:   string | null;
}

export async function createStandaloneNfse(args: CreateStandaloneNfseArgs, db: DrizzleDB = _db) {
  const { rows: [client] } = await db.execute<{ id: string }>(sql`
    SELECT id FROM clients WHERE id = ${args.clientId} AND tenant_id = ${args.tenantId}
  `);
  if (!client) throw new NfseDomainError('nfse_client_not_found', { clientId: args.clientId });

  // resolveCompanyId lança CompanyDomainError, propositalmente não capturado
  // aqui — a rota já sabe traduzir esse erro (companyResolutionErrorMessage),
  // mesmo caminho usado por POST /nfse/:id/emit.
  const cfg = await resolveCompanyId(args.tenantId, args.companyId ?? null, db, 'nfse');
  if (!cfg.inscricao_municipal) {
    throw new NfseDomainError('nfse_missing_inscricao_municipal');
  }

  const serviceCode = args.serviceCode?.trim() || cfg.codigo_servico_padrao || '';
  const issRate      = args.issRate ?? Number(cfg.aliquota_iss_padrao ?? 0);

  validateNfseCreate({
    clientId: args.clientId, description: args.description, amount: args.amount,
    serviceCode, issRate,
  });

  const issValue = calcIssValue(args.amount, issRate);

  const [nfse] = await db.insert(nfseInvoices).values({
    tenant_id:    args.tenantId,
    client_id:    args.clientId,
    company_id:   cfg.id,
    description:  args.description.trim(),
    amount:       String(args.amount),
    iss_rate:     String(issRate),
    iss_value:    String(issValue),
    service_code: serviceCode,
    period_start: args.periodStart || null,
    period_end:   args.periodEnd   || null,
    nfse_status:  null,
  }).returning();

  return nfse;
}
