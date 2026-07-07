// Application Service — Faturamento de Ordem de Serviço (regra 47).
// Orquestra I/O + transação: lê a OS, valida via domínio, cria o receivable
// e, opcionalmente, a NFS-e vinculada — reaproveitando os mesmos helpers de
// resolução de empresa (regra 40) e o shape de emissão de NFS-e já usados em
// Contratos de Serviço (routes/serviceContracts.ts), sem duplicar lógica.
//
// A partir daqui, a cobrança em si (boleto/Pix) é o fluxo que já existe —
// POST /v1/receivables/:id/emit-boleto — sem nenhuma mudança.

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { eq, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { receivables, nfseInvoices } from '../db/schema';
import {
  assertCanBillServiceOrder,
  defaultBillingDueDate,
  ServiceOrderBillingDomainError,
} from '../domain/serviceOrderBilling/serviceOrderBillingDomain';
import { resolveCompanyId, CompanyDomainError } from './companyService';
import { getSqsClient } from '../lib/sqsClient';
import { buildNfseEmitMessage } from '../lib/nfse';

export type DrizzleDB = typeof _db;
export { ServiceOrderBillingDomainError };

export interface BillServiceOrderArgs {
  tenantId:       string;
  serviceOrderId: string;
  dueDate?:       string | null;
  emitNfse?:      boolean;
  companyId?:     string | null;
}

export interface BillServiceOrderResult {
  receivable_id: string;
  nfse_id:       string | null;
  nfse_status:   string | null;
}

export async function billServiceOrder(
  args: BillServiceOrderArgs, db: DrizzleDB = _db,
): Promise<BillServiceOrderResult> {
  const { rows: [so] } = await db.execute<{
    id: string; number: string; title: string; status: string; total: string; client_id: string | null;
  }>(sql`SELECT id, number, title, status, total, client_id FROM service_orders
         WHERE id = ${args.serviceOrderId} AND tenant_id = ${args.tenantId}`);
  if (!so) throw new ServiceOrderBillingDomainError('service_order_not_found', { id: args.serviceOrderId });

  const { rows: [existing] } = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM receivables WHERE service_order_id = ${so.id}`,
  );
  assertCanBillServiceOrder(so.status, Number(existing.count) > 0);

  if (!so.client_id) throw new ServiceOrderBillingDomainError('service_order_no_client', { id: so.id });

  const dueDate     = args.dueDate?.trim() || defaultBillingDueDate();
  const description = `OS #${so.number} — ${so.title}`;
  const amount      = Number(so.total);

  // NFS-e é opt-in por faturamento (não uma preferência persistida) — se
  // pedido, valida ANTES de abrir a transação, mesmo padrão de
  // routes/serviceContracts.ts (POST /:id/billings).
  let cfg: Awaited<ReturnType<typeof resolveCompanyId>> | null = null;
  let clientRow: Record<string, unknown> | null = null;
  let issRate = 0;
  let issValue = 0;
  let serviceCode: string | null = null;

  if (args.emitNfse) {
    try {
      cfg = await resolveCompanyId(args.tenantId, args.companyId ?? null, db);
    } catch (err) {
      if (err instanceof CompanyDomainError) {
        throw new ServiceOrderBillingDomainError('service_order_billing_no_company');
      }
      throw err;
    }
    if (!cfg.inscricao_municipal) {
      throw new ServiceOrderBillingDomainError('service_order_billing_missing_inscricao_municipal');
    }
    serviceCode = cfg.codigo_servico_padrao || null;
    if (!serviceCode) {
      throw new ServiceOrderBillingDomainError('service_order_billing_missing_service_code');
    }
    issRate  = Number(cfg.aliquota_iss_padrao ?? 0);
    issValue = Math.round(amount * issRate) / 100;

    const { rows: [client] } = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM clients WHERE id = ${so.client_id}`,
    );
    if (!client) throw new ServiceOrderBillingDomainError('service_order_billing_client_not_found');
    clientRow = client;
  }

  const { receivableId, nfseId } = await db.transaction(async (tx) => {
    const [rec] = await tx.insert(receivables).values({
      tenant_id:         args.tenantId,
      client_id:         so.client_id,
      service_order_id:  so.id,
      description,
      amount:            String(amount),
      due_date:          dueDate,
      status:            'pending',
      notes:             'Gerado a partir do faturamento da Ordem de Serviço',
    }).returning({ id: receivables.id });

    let nfseId: string | null = null;
    if (args.emitNfse) {
      const [nfse] = await tx.insert(nfseInvoices).values({
        tenant_id:     args.tenantId,
        receivable_id: rec.id,
        client_id:     so.client_id,
        company_id:    cfg!.id,
        description,
        amount:        String(amount),
        iss_rate:      String(issRate),
        iss_value:     String(issValue),
        service_code:  serviceCode!,
        nfse_status:   null,
      }).returning({ id: nfseInvoices.id });
      nfseId = nfse.id;
    }

    return { receivableId: rec.id, nfseId };
  });

  let nfseStatus: string | null = null;
  if (args.emitNfse && nfseId) {
    nfseStatus = await enqueueNfseEmission({
      nfseId, tenantId: args.tenantId, description, amount, issRate, issValue,
      serviceCode: serviceCode!, cfg: cfg!, client: clientRow!, db,
    });
  }

  return { receivable_id: receivableId, nfse_id: nfseId, nfse_status: nfseStatus };
}

async function enqueueNfseEmission(args: {
  nfseId: string; tenantId: string; description: string; amount: number;
  issRate: number; issValue: number; serviceCode: string;
  cfg: Awaited<ReturnType<typeof resolveCompanyId>>; client: Record<string, unknown>;
  db: DrizzleDB;
}): Promise<string | null> {
  const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
  // Sem fila configurada neste ambiente: o receivable já existe e segue
  // cobrável normalmente — a NFS-e só fica sem emitir (nfse_status null),
  // nunca bloqueia o faturamento em si (mesmo espírito de tolerância a falha
  // usado em toda integração fiscal assíncrona deste projeto).
  if (!queueUrl) return null;

  await args.db.update(nfseInvoices)
    .set({ nfse_status: 'pending', nfse_attempts: sql`nfse_attempts + 1` })
    .where(eq(nfseInvoices.id, args.nfseId));

  const message = buildNfseEmitMessage({
    nfse_id:      args.nfseId,
    tenant_id:    args.tenantId,
    description:  args.description,
    amount:       args.amount,
    iss_rate:     args.issRate,
    iss_value:    args.issValue,
    service_code: args.serviceCode,
    cfg:          args.cfg as any,
    client:       args.client as any,
  });

  try {
    await getSqsClient().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
    await args.db.update(nfseInvoices).set({ nfse_status: 'processing' }).where(eq(nfseInvoices.id, args.nfseId));
    return 'processing';
  } catch {
    await args.db.update(nfseInvoices).set({ nfse_status: null }).where(eq(nfseInvoices.id, args.nfseId));
    return null;
  }
}
