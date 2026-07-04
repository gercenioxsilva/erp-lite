// Ingestão de webhook do Mercado Livre (regra 42) — o payload NUNCA é fonte de
// verdade, só um gatilho: aqui só validamos a forma, gravamos para auditoria/
// idempotência e enfileiramos a busca do recurso real (Fase 2/Lambda faz o
// GET autenticado). Sempre responde rápido — erro de negócio nunca deve
// travar o ACK ao Mercado Livre (webhook mal-comportado gera menos reenvio).

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { eq } from 'drizzle-orm';
import { db as _db } from '../db';
import { marketplaceWebhookEvents } from '../db/schema';
import { getSqsClient } from '../lib/sqsClient';
import { findConnectionByMlUserId } from './marketplaceConnectionService';
import { MarketplaceDomainError } from '../domain/marketplace/marketplaceDomain';
import type { MarketplaceSyncRequestMessage } from '../lib/marketplace-types';

export { MarketplaceDomainError };

export type DrizzleDB = typeof _db;

export interface WebhookPayload {
  topic?: string;
  resource?: string;
  user_id?: string | number;
  application_id?: string | number;
  attempts?: number;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  if (err instanceof Error) {
    const pgErr = err as Error & { code?: string };
    if (pgErr.code === '23505') return true;
    if (err.message.includes('unique') || err.message.includes('duplicate') || err.message.includes('23505')) return true;
  }
  return false;
}

export interface IngestResult {
  ok: true;
  duplicate?: boolean;
  enqueued?: boolean;
}

/**
 * Valida a forma do payload, grava em marketplace_webhook_events (idempotente
 * por topic+resource — reenvio do mesmo evento não duplica a linha) e
 * enfileira a busca do recurso real, se a fila estiver configurada (Fase 2).
 */
export async function ingestWebhook(payload: WebhookPayload, db: DrizzleDB = _db): Promise<IngestResult> {
  if (!payload?.topic || !payload?.resource) {
    throw new MarketplaceDomainError('malformed_webhook_payload');
  }

  const mlUserId = payload.user_id != null ? String(payload.user_id) : null;
  const idempotencyKey = `mercadolivre:${payload.topic}:${payload.resource}`;

  let eventId: string;
  try {
    const [row] = await db.insert(marketplaceWebhookEvents).values({
      provider: 'mercadolivre',
      ml_user_id: mlUserId,
      topic: payload.topic,
      resource: payload.resource,
      application_id: payload.application_id != null ? String(payload.application_id) : null,
      idempotency_key: idempotencyKey,
      status: 'received',
    }).returning({ id: marketplaceWebhookEvents.id });
    eventId = row.id;
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return { ok: true, duplicate: true };
    throw err;
  }

  const connection = mlUserId ? await findConnectionByMlUserId(mlUserId, db) : null;
  if (!connection) {
    await db.update(marketplaceWebhookEvents).set({
      status: 'error', error_message: 'connection_not_found', processed_at: new Date(),
    }).where(eq(marketplaceWebhookEvents.id, eventId));
    return { ok: true, enqueued: false };
  }

  const queueUrl = process.env.MARKETPLACE_SYNC_REQUESTS_QUEUE_URL;
  if (!queueUrl) {
    console.info('MARKETPLACE_SYNC_REQUESTS_QUEUE_URL not set — webhook recebido mas não enfileirado (Fase 2 ainda não configurada)');
    await db.update(marketplaceWebhookEvents).set({ processed_at: new Date() }).where(eq(marketplaceWebhookEvents.id, eventId));
    return { ok: true, enqueued: false };
  }

  const message: MarketplaceSyncRequestMessage = {
    type: 'fetch_resource',
    tenant_id: connection.tenant_id,
    connection_id: connection.id,
    connection: {
      access_token: connection.access_token,
      refresh_token: connection.refresh_token,
      token_expires_at: connection.token_expires_at ? connection.token_expires_at.toISOString() : null,
    },
    topic: payload.topic,
    resource: payload.resource,
  };

  await getSqsClient().send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message),
  }));

  await db.update(marketplaceWebhookEvents).set({ status: 'enqueued', processed_at: new Date() })
    .where(eq(marketplaceWebhookEvents.id, eventId));

  return { ok: true, enqueued: true };
}
