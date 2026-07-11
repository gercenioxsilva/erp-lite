// Ingestão de webhook do Twilio (status callback de entrega + mensagem
// recebida) — mesmo racional de marketplaceWebhookService.ts: o payload
// nunca é fonte de verdade sobre o QUE aconteceu além do status/opt-out,
// grava pra idempotência/auditoria e sempre responde rápido.

import { eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { whatsappWebhookEvents, whatsappMessages, whatsappMessageEvents, clients } from '../db/schema';
import { findAccountByWhatsAppNumber } from './whatsappAccountService';
import { verifyTwilioSignature, isOptOutReply, WhatsAppDomainError } from '../domain/whatsapp/whatsappDomain';

export { WhatsAppDomainError };
export type DrizzleDB = typeof _db;

function isUniqueConstraintViolation(err: unknown): boolean {
  if (err instanceof Error) {
    const pgErr = err as Error & { code?: string };
    if (pgErr.code === '23505') return true;
    if (err.message.includes('unique') || err.message.includes('duplicate')) return true;
  }
  return false;
}

/** Twilio manda números WhatsApp como "whatsapp:+55119...", nunca cru. */
function stripWhatsAppPrefix(value: string | undefined): string {
  return (value ?? '').replace(/^whatsapp:/, '');
}

export interface WebhookParams {
  MessageSid?: string;
  MessageStatus?: string; // presente em status callback: queued|sent|delivered|read|failed|undelivered
  Body?: string;          // presente em mensagem recebida
  From?: string;
  To?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}

export interface WebhookValidationResult {
  authTokenToVerify: string | null; // null = conta não encontrada, webhook é descartado sem validar
}

/** Resolve QUAL tenant este webhook pertence (pelo nosso próprio número WhatsApp,
 * nunca confiável vindo do payload sem cruzar com o banco) — precisa rodar
 * ANTES da validação de assinatura, porque o auth_token pra validar é POR
 * TENANT (regra 59, mesmo racional de credenciais nunca compartilhadas). */
export async function resolveWebhookAccount(params: WebhookParams, db: DrizzleDB = _db) {
  const ourNumber = params.MessageStatus ? stripWhatsAppPrefix(params.From) : stripWhatsAppPrefix(params.To);
  if (!ourNumber) return null;
  return findAccountByWhatsAppNumber(ourNumber, db);
}

export function validateSignature(
  requestUrl: string, params: Record<string, string>, signatureHeader: string | undefined, authToken: string,
): boolean {
  return verifyTwilioSignature(requestUrl, params, signatureHeader, authToken);
}

/**
 * Grava em whatsapp_webhook_events (idempotente por idempotency_key — reenvio
 * do mesmo evento nunca duplica) e processa: status callback atualiza
 * whatsapp_messages + grava whatsapp_message_events; mensagem recebida com
 * "SAIR" revoga o opt-in do cliente (regra correspondente no README).
 */
export async function ingestWebhook(tenantId: string, params: WebhookParams, db: DrizzleDB = _db): Promise<{ ok: true; duplicate?: boolean }> {
  const isStatusCallback = Boolean(params.MessageStatus);
  const idempotencyKey = `twilio:${params.MessageSid}:${isStatusCallback ? params.MessageStatus : 'inbound'}`;

  try {
    await db.insert(whatsappWebhookEvents).values({ provider: 'twilio', idempotency_key: idempotencyKey, status: 'received' });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return { ok: true, duplicate: true };
    throw err;
  }

  if (isStatusCallback) {
    await processStatusCallback(tenantId, params, db);
  } else if (params.Body) {
    await processInboundMessage(tenantId, params, db);
  }

  await db.update(whatsappWebhookEvents)
    .set({ status: 'processed', processed_at: new Date() })
    .where(eq(whatsappWebhookEvents.idempotency_key, idempotencyKey));

  return { ok: true };
}

const STATUS_MAP: Record<string, string> = {
  queued: 'queued', sent: 'sent', delivered: 'delivered', read: 'read',
  failed: 'failed', undelivered: 'undelivered',
};

async function processStatusCallback(tenantId: string, params: WebhookParams, db: DrizzleDB): Promise<void> {
  const status = STATUS_MAP[params.MessageStatus ?? ''];
  if (!status || !params.MessageSid) return;

  const [message] = await db.select().from(whatsappMessages)
    .where(and(eq(whatsappMessages.tenant_id, tenantId), eq(whatsappMessages.provider_message_id, params.MessageSid)));
  if (!message) return; // mensagem de outro tenant ou já expirada — ignora, nunca erro

  const now = new Date();
  await db.update(whatsappMessages).set({
    status,
    status_reason: params.ErrorMessage ?? null,
    sent_at:       status === 'sent'      ? (message.sent_at      ?? now) : message.sent_at,
    delivered_at:  status === 'delivered' ? now : message.delivered_at,
    read_at:       status === 'read'      ? now : message.read_at,
  }).where(eq(whatsappMessages.id, message.id));

  await db.insert(whatsappMessageEvents).values({
    tenant_id: tenantId, whatsapp_message_id: message.id, event_type: status,
    payload: { error_code: params.ErrorCode, error_message: params.ErrorMessage },
  });
}

async function processInboundMessage(tenantId: string, params: WebhookParams, db: DrizzleDB): Promise<void> {
  if (!isOptOutReply(params.Body)) return;

  const fromPhone = stripWhatsAppPrefix(params.From);
  if (!fromPhone) return;

  // Compara contra mobile/phone gravados em E.164 (mesmo formato que
  // toE164BR produz, usado na hora de enviar) — cliente com telefone gravado
  // num formato diferente não terá o opt-out aplicado automaticamente aqui;
  // limitação documentada do MVP, mesmo espírito da regra 33/40 (gap
  // conhecido, não esquecimento).
  await db.update(clients)
    .set({ whatsapp_opt_in: false, whatsapp_opt_out_at: new Date() })
    .where(and(eq(clients.tenant_id, tenantId), eq(clients.mobile, fromPhone)));
}
