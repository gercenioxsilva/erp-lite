// Emissão avulsa de NFS-e (E7): cria a nfse_invoice + receivable e enfileira
// a emissão, atravessando os MESMOS gates das outras emissões (readiness,
// competência aberta, empresa emite_nfse). É o endpoint determinístico que a
// UI chama quando o usuário ACEITA o rascunho proposto pelo assistente IA —
// o modelo nunca chega aqui. Espelha o miolo de emitDraft/serviceOrderBilling
// sem duplicar o transporte (reusa enqueueAbrasfEmission e buildNfseEmitMessage).

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { eq, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { receivables, nfseInvoices, nfeConfigs, clients } from '../db/schema';
import { resolveCompanyId, CompanyDomainError } from './companyService';
import { getOrCreateConfig, getEmissionReadiness } from './fiscalCompanyConfigService';
import { enqueueAbrasfEmission } from './nfseProviderService';
import { assertCompetenciaAberta } from './fiscalPeriodLockGuard';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import { getSqsClient } from '../lib/sqsClient';
import { buildNfseEmitMessage } from '../lib/nfse';

export type DrizzleDB = typeof _db;

const currentCompetencia = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

export class NfseCreateError extends Error {
  constructor(
    public code:
      | 'client_not_found' | 'client_no_document'
      | 'invalid_amount' | 'service_code_missing' | 'emission_not_ready',
    public payload: Record<string, unknown> = {},
  ) { super(code); this.name = 'NfseCreateError'; }
}

export interface CreateNfseArgs {
  clientId:      string;
  amount:        number;
  description:   string;
  serviceCode?:  string | null;
  issRate?:      number | null;
  issRetido?:    boolean;
  companyId?:    string | null;
  dueDate?:      string | null;
  idempotencyKey?: string | null;
}

export interface CreateNfseResult {
  nfse_id: string;
  receivable_id: string | null;
  nfse_status: string | null;
  enqueued: boolean;
  duplicate: boolean;
}

/** Defaults da última NFS-e do cliente — base do "como fiz da última vez". */
export async function lastEmissionDefaults(tenantId: string, clientId: string, db: DrizzleDB = _db) {
  const { rows } = await db.execute<any>(sql`
    SELECT service_code, iss_rate, iss_retido, description, amount
    FROM nfse_invoices
    WHERE tenant_id = ${tenantId} AND client_id = ${clientId} AND nfse_status = 'authorized'
    ORDER BY created_at DESC LIMIT 1`);
  const r = rows[0];
  return r ? {
    service_code: r.service_code as string | null,
    iss_rate: r.iss_rate != null ? Number(r.iss_rate) : null,
    iss_retido: Boolean(r.iss_retido),
    description: r.description as string | null,
    last_amount: r.amount != null ? Number(r.amount) : null,
  } : null;
}

export async function createAndEmitNfse(
  tenantId: string, args: CreateNfseArgs, actorUserId: string | null, db: DrizzleDB = _db,
): Promise<CreateNfseResult> {
  if (!(args.amount > 0)) throw new NfseCreateError('invalid_amount', { amount: args.amount });

  // Cliente PRECISA pertencer ao tenant — guarda anti-injeção (o id pode ter
  // vindo de um tool_result do assistente; revalidamos server-side).
  const [client] = await db.select().from(clients)
    .where(sql`${clients.id} = ${args.clientId} AND ${clients.tenant_id} = ${tenantId}`);
  if (!client) throw new NfseCreateError('client_not_found', { clientId: args.clientId });

  // Empresa emitente (regra 40/53) — restrito a quem tem emite_nfse=true.
  const cfg = await resolveCompanyId(tenantId, args.companyId ?? null, db, 'nfse');

  const competencia = currentCompetencia();
  await assertCompetenciaAberta(tenantId, cfg.id, competencia, db);

  const readiness = await getEmissionReadiness(tenantId, cfg.id, db);
  if (!readiness.ready) throw new NfseCreateError('emission_not_ready', { reasons: readiness.reasons });

  // service_code/iss: argumento explícito → defaults da última emissão →
  // padrão do cadastro. Sem nenhum resolvível, recusa.
  const defaults = await lastEmissionDefaults(tenantId, args.clientId, db);
  const serviceCode = args.serviceCode || defaults?.service_code || cfg.codigo_servico_padrao || null;
  if (!serviceCode) throw new NfseCreateError('service_code_missing');
  const issRate = args.issRate ?? defaults?.iss_rate ?? Number(cfg.aliquota_iss_padrao ?? 0);
  const issRetido = args.issRetido ?? defaults?.iss_retido ?? false;
  const issValue = Math.round(args.amount * issRate) / 100;
  const dueDate = args.dueDate?.trim() || today();

  // Idempotência: duplo-clique com a mesma chave devolve a nota já criada.
  if (args.idempotencyKey) {
    const [existing] = await db.select({ id: nfseInvoices.id, status: nfseInvoices.nfse_status })
      .from(nfseInvoices)
      .where(sql`${nfseInvoices.tenant_id} = ${tenantId} AND ${nfseInvoices.idempotency_key} = ${args.idempotencyKey}`);
    if (existing) return { nfse_id: existing.id, receivable_id: null, nfse_status: existing.status, enqueued: false, duplicate: true };
  }

  let nfseId: string;
  let receivableId: string;
  try {
    const created = await db.transaction(async (tx) => {
      const [rec] = await tx.insert(receivables).values({
        tenant_id: tenantId, client_id: args.clientId,
        description: args.description, amount: String(args.amount),
        due_date: dueDate, status: 'pending',
        notes: 'Gerado pela emissão avulsa de NFS-e',
      }).returning({ id: receivables.id });

      const [nfse] = await tx.insert(nfseInvoices).values({
        tenant_id: tenantId, company_id: cfg.id, client_id: args.clientId, receivable_id: rec.id,
        description: args.description, amount: String(args.amount),
        iss_rate: String(issRate), iss_value: String(issValue),
        service_code: serviceCode, iss_retido: issRetido,
        idempotency_key: args.idempotencyKey ?? null,
        nfse_status: null,
      }).returning({ id: nfseInvoices.id });

      return { receivableId: rec.id, nfseId: nfse.id };
    });
    nfseId = created.nfseId;
    receivableId = created.receivableId;
  } catch (err) {
    // Corrida de duplo-clique perdendo o UNIQUE(tenant, idempotency_key).
    if (args.idempotencyKey && isUniqueConstraintViolation(err)) {
      const [existing] = await db.select({ id: nfseInvoices.id, status: nfseInvoices.nfse_status })
        .from(nfseInvoices)
        .where(sql`${nfseInvoices.tenant_id} = ${tenantId} AND ${nfseInvoices.idempotency_key} = ${args.idempotencyKey}`);
      if (existing) return { nfse_id: existing.id, receivable_id: null, nfse_status: existing.status, enqueued: false, duplicate: true };
    }
    throw err;
  }

  void recordFiscalEvent({
    tenantId, companyId: cfg.id, aggregateType: 'nfse', aggregateId: nfseId,
    eventType: 'nfse_created', actorUserId,
    requestPayload: { amount: args.amount, service_code: serviceCode, source: 'avulsa' },
    idempotencyKey: `nfse_created:${nfseId}`,
  }, db).catch(() => { /* auditoria fire-and-forget */ });

  // Provider próprio (ABRASF) assina no api-core; Focus é o fallback.
  const fiscalConfig = await getOrCreateConfig(tenantId, cfg.id, db);
  let nfseStatus: string | null = null;
  let enqueued = false;

  if (fiscalConfig.nfse_provider === 'abrasf') {
    const res = await enqueueAbrasfEmission(tenantId, nfseId, db);
    enqueued = res.enqueued;
    nfseStatus = res.enqueued ? 'processing' : 'pending';
  } else {
    const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
    if (queueUrl) {
      const message = buildNfseEmitMessage({
        nfse_id: nfseId, tenant_id: tenantId, description: args.description,
        amount: args.amount, iss_rate: issRate, iss_value: issValue, service_code: serviceCode,
        cfg: cfg as any, client: client as any,
      });
      await db.update(nfseInvoices).set({ nfse_status: 'pending', nfse_attempts: sql`nfse_attempts + 1` }).where(eq(nfseInvoices.id, nfseId));
      await getSqsClient().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ ...message, action: 'emit' }) }));
      await db.update(nfseInvoices).set({ nfse_status: 'processing' }).where(eq(nfseInvoices.id, nfseId));
      nfseStatus = 'processing';
      enqueued = true;
    }
  }

  return { nfse_id: nfseId, receivable_id: receivableId, nfse_status: nfseStatus, enqueued, duplicate: false };
}
