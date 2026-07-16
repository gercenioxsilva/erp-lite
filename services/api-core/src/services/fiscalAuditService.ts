// Porta ÚNICA de escrita em fiscal_events (índice unificado de auditoria do
// módulo Fiscal, migration 0068). Os subdomínios fiscais (importação,
// conciliação, consolidação, NFS-e, apuração) registram tudo por aqui —
// nunca INSERT direto — para garantir duas invariantes:
//   1. nenhum segredo (senha/token/certificado) chega ao payload persistido;
//   2. reprocessos (SQS at-least-once, retry de job) não duplicam evento
//      (UNIQUE parcial tenant+idempotency_key + catch 23505).

import { db as _db } from '../db';
import { fiscalEvents } from '../db/schema';
import { isUniqueConstraintViolation } from '../lib/pgErrors';

export type DrizzleDB = typeof _db;
export type FiscalEvent = typeof fiscalEvents.$inferSelect;

export interface RecordFiscalEventArgs {
  tenantId:        string;
  companyId?:      string | null;
  aggregateType:   string;         // 'import_batch' | 'reconciliation' | 'draft' | 'nfse' | 'apuracao' | 'company_config' | …
  aggregateId?:    string | null;
  eventType:       string;         // 'batch_received' | 'match_confirmed' | 'emission_failed' | …
  /** NULL/omitido = sistema (worker/job agendado). */
  actorUserId?:    string | null;
  sourceFileS3Key?: string | null;
  xmlS3Key?:       string | null;
  pdfS3Key?:       string | null;
  payloadHash?:    string | null;
  requestPayload?:  unknown;
  responsePayload?: unknown;
  attempt?:        number | null;
  /** Presente ⇒ evento idempotente: repetir a chave nunca duplica a linha. */
  idempotencyKey?: string | null;
}

export interface RecordFiscalEventResult {
  duplicate: boolean;
  event: FiscalEvent | null; // null somente quando duplicate=true
}

// consumer_key NÃO casa com 'secret'/'token' (consumer_secret casa via 'secret');
// incluído explicitamente. NÃO usar um /key/ cru — mascararia idempotency_key,
// dedupe_key e afins que são payload legítimo.
const SECRET_KEY_PATTERN = /senha|password|token|secret|credential|pfx|private_key|client_secret|consumer_key/i;
const MAX_PAYLOAD_DEPTH = 6;

/**
 * Remove valores de chaves sensíveis de um payload antes de persistir —
 * fiscal_events é trilha de auditoria de longa retenção; segredo nunca entra.
 * Retorna uma CÓPIA (nunca muta o objeto original).
 */
export function sanitizePayload(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_PAYLOAD_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => sanitizePayload(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? '****' : sanitizePayload(v, depth + 1);
    }
    return out;
  }
  return value;
}

export async function record(
  args: RecordFiscalEventArgs, db: DrizzleDB = _db,
): Promise<RecordFiscalEventResult> {
  try {
    const [inserted] = await db.insert(fiscalEvents).values({
      tenant_id:          args.tenantId,
      company_id:         args.companyId ?? null,
      aggregate_type:     args.aggregateType,
      aggregate_id:       args.aggregateId ?? null,
      event_type:         args.eventType,
      actor_user_id:      args.actorUserId ?? null,
      source_file_s3_key: args.sourceFileS3Key ?? null,
      xml_s3_key:         args.xmlS3Key ?? null,
      pdf_s3_key:         args.pdfS3Key ?? null,
      payload_hash:       args.payloadHash ?? null,
      request_payload:    args.requestPayload !== undefined ? sanitizePayload(args.requestPayload) : null,
      response_payload:   args.responsePayload !== undefined ? sanitizePayload(args.responsePayload) : null,
      attempt:            args.attempt ?? null,
      idempotency_key:    args.idempotencyKey ?? null,
    }).returning();
    return { duplicate: false, event: inserted };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return { duplicate: true, event: null };
    throw err;
  }
}
