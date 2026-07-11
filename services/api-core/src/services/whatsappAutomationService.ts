// Ponte entre eventos de domínio já existentes (autorização de NF-e, pagamento
// registrado, proposta enviada, proximidade de vencimento) e o envio de
// WhatsApp — mesmo desacoplamento que sendNotificationIfEnabled já dá pro
// e-mail. Nunca lança: falha aqui é sempre fire-and-forget (log + segue),
// mesma filosofia de sendNotificationIfEnabled/sendSystemNotification — o
// fluxo financeiro/fiscal principal nunca pode quebrar por causa do WhatsApp.

import { eq, and } from 'drizzle-orm';
import { db as _db, db } from '../db';
import { whatsappAutomations, whatsappMessages } from '../db/schema';
import { sendTemplateMessage } from './whatsappMessageService';
import { TEMPLATE_KEYS, isTemplateKey, assertValidAutomationConfig, WhatsAppDomainError, type TemplateKey } from '../domain/whatsapp/whatsappDomain';

export { WhatsAppDomainError };
export type DrizzleDB = typeof _db;
export type WhatsAppAutomation = typeof whatsappAutomations.$inferSelect;

const BRL = (v: number | string) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateBR = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');

async function isAutomationEnabled(tenantId: string, templateKey: TemplateKey): Promise<boolean> {
  const [row] = await db.select({ enabled: whatsappAutomations.enabled }).from(whatsappAutomations)
    .where(and(eq(whatsappAutomations.tenant_id, tenantId), eq(whatsappAutomations.template_key, templateKey)));
  return row?.enabled ?? false;
}

/** As 5 automações, mescladas com a config do tenant (default: desligada,
 * config vazia) — mesmo padrão de listTemplates(). */
export async function listAutomations(tenantId: string, dbc: DrizzleDB = _db): Promise<WhatsAppAutomation[]> {
  const rows = await dbc.select().from(whatsappAutomations).where(eq(whatsappAutomations.tenant_id, tenantId));
  const byKey = new Map(rows.map(r => [r.template_key, r]));
  const now = new Date();
  return TEMPLATE_KEYS.map(key => byKey.get(key) ?? {
    id: '', tenant_id: tenantId, template_key: key, enabled: false, config: {},
    created_at: now, updated_at: now,
  } as WhatsAppAutomation);
}

/** Liga/desliga uma automação e grava sua config — upsert por (tenant, key). */
export async function upsertAutomation(
  tenantId: string, templateKey: string, enabled: boolean, config: Record<string, unknown>, dbc: DrizzleDB = _db,
): Promise<WhatsAppAutomation> {
  if (!isTemplateKey(templateKey)) throw new WhatsAppDomainError('invalid_template_key', { templateKey });
  if (enabled) assertValidAutomationConfig(templateKey, config);

  const [existing] = await dbc.select().from(whatsappAutomations)
    .where(and(eq(whatsappAutomations.tenant_id, tenantId), eq(whatsappAutomations.template_key, templateKey)));

  if (existing) {
    const [row] = await dbc.update(whatsappAutomations)
      .set({ enabled, config, updated_at: new Date() })
      .where(eq(whatsappAutomations.id, existing.id)).returning();
    return row;
  }

  const [row] = await dbc.insert(whatsappAutomations).values({
    tenant_id: tenantId, template_key: templateKey, enabled, config,
  }).returning();
  return row;
}

/**
 * Idempotência via a própria whatsapp_messages (nenhuma coluna nova) — já
 * existe uma mensagem deste template pra este documento de origem, mesmo
 * padrão de reaproveitar a tabela de auditoria como ledger de idempotência
 * (mesmo espírito de accrueCommission usar idempotency_key). 'failed' não
 * conta como "já enviado" — permite reenvio no próximo ciclo do worker.
 */
async function alreadyDispatched(
  tenantId: string, templateKey: TemplateKey,
  refs: { receivableId?: string; invoiceId?: string; proposalId?: string },
): Promise<boolean> {
  const refCondition = refs.receivableId ? eq(whatsappMessages.receivable_id, refs.receivableId)
    : refs.invoiceId  ? eq(whatsappMessages.invoice_id, refs.invoiceId)
    : refs.proposalId ? eq(whatsappMessages.proposal_id, refs.proposalId)
    : null;
  if (!refCondition) return false;

  const [existing] = await db.select({ id: whatsappMessages.id }).from(whatsappMessages).where(and(
    eq(whatsappMessages.tenant_id, tenantId), eq(whatsappMessages.template_key, templateKey), refCondition,
  ));
  return Boolean(existing);
}

async function dispatch(
  tenantId: string, templateKey: TemplateKey, clientId: string,
  variables: Record<string, string>,
  refs: { receivableId?: string; invoiceId?: string; proposalId?: string } = {},
): Promise<void> {
  try {
    if (!(await isAutomationEnabled(tenantId, templateKey))) return;
    if (await alreadyDispatched(tenantId, templateKey, refs)) return;
    await sendTemplateMessage({
      tenantId, clientId, templateKey, variables,
      receivableId: refs.receivableId ?? null,
      invoiceId:    refs.invoiceId ?? null,
      proposalId:   refs.proposalId ?? null,
    });
  } catch (err) {
    // Elegibilidade não atendida (conta não conectada, template não aprovado,
    // cliente sem opt-in, telefone inválido) é esperado e comum — nunca deve
    // subir como erro pro chamador (nfeResultsWorker, rota de pagamento etc.).
    console.warn(JSON.stringify({ event: 'whatsapp_automation_skip', tenant_id: tenantId, template_key: templateKey, error: String(err) }));
  }
}

export async function notifyInvoiceDueSoon(tenantId: string, rec: {
  id: string; client_id: string | null; description: string; amount: string; due_date: string;
}): Promise<void> {
  if (!rec.client_id) return;
  await dispatch(tenantId, 'invoice_due_soon', rec.client_id, {
    client_name: '', invoice_number: rec.description, amount: BRL(rec.amount), due_date: dateBR(rec.due_date),
  }, { receivableId: rec.id });
}

export async function notifyInvoiceOverdue(tenantId: string, rec: {
  id: string; client_id: string | null; description: string; amount: string; due_date: string;
}): Promise<void> {
  if (!rec.client_id) return;
  await dispatch(tenantId, 'invoice_overdue', rec.client_id, {
    client_name: '', invoice_number: rec.description, amount: BRL(rec.amount), due_date: dateBR(rec.due_date),
  }, { receivableId: rec.id });
}

export async function notifyPaymentConfirmed(tenantId: string, rec: {
  id: string; client_id: string | null; description: string; amount: string;
}): Promise<void> {
  if (!rec.client_id) return;
  await dispatch(tenantId, 'payment_confirmed', rec.client_id, {
    invoice_number: rec.description, amount: BRL(rec.amount),
  }, { receivableId: rec.id });
}

export async function notifyFiscalDocumentAuthorized(tenantId: string, inv: {
  id: string; client_id: string | null; number: string | null; total: string;
}): Promise<void> {
  if (!inv.client_id) return;
  await dispatch(tenantId, 'fiscal_document_authorized', inv.client_id, {
    invoice_number: inv.number ?? '', amount: BRL(inv.total),
  }, { invoiceId: inv.id });
}

export async function notifyProposalSent(tenantId: string, prop: {
  id: string; client_id: string | null; number: string | null;
}): Promise<void> {
  if (!prop.client_id) return;
  await dispatch(tenantId, 'proposal_sent', prop.client_id, {
    proposal_number: prop.number ?? '',
  }, { proposalId: prop.id });
}
