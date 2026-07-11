// Importação multi-fonte (0071) — camada de serviço.
// Fluxo: upload → checksum sha256 → original no S3 (FISCAL_IMPORTS_BUCKET;
// sem env = pula upload, padrão feature-flag por env-unset) → import_batches
// (idempotente por checksum) → parse/normalize puros → INSERT-catch-23505
// contando inserted/duplicate/error (erro em 1 linha NUNCA derruba as outras)
// → contadores no batch + auditoria fiscal_events.
// MVP processa inline (arquivos de extrato são pequenos); processBatch() é
// isolado para um worker SQS assumir na fase de escala sem mudar nada aqui.

import { createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { db as _db } from '../db';
import { importBatches, importSourceTemplates, importedTransactions } from '../db/schema';
import { getS3Client } from '../lib/s3Client';
import { resolveCompanyId } from './companyService';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import { toDecimalString } from '../lib/money';
import {
  getImporter, detectSourceKind, ImportDomainError,
  ImportTemplate, NormalizedTransaction,
} from '../domain/import';

export type DrizzleDB = typeof _db;
export type ImportBatch = typeof importBatches.$inferSelect;

const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export interface UploadArgs {
  filename:    string;
  buffer:      Buffer;
  contentType: string | null;
  templateId?: string | null;
}

async function uploadOriginalToS3(tenantId: string, batchId: string, filename: string, buf: Buffer, contentType: string | null): Promise<string | null> {
  const bucket = process.env.FISCAL_IMPORTS_BUCKET;
  if (!bucket) return null; // dev local sem S3: batch guarda o checksum mesmo assim
  const key = `${tenantId}/imports/${batchId}/${filename}`;
  await getS3Client().send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: buf,
    ContentType: contentType ?? 'application/octet-stream',
    ServerSideEncryption: 'AES256',
  }));
  return key;
}

async function loadTemplate(tenantId: string, templateId: string | null | undefined, db: DrizzleDB): Promise<ImportTemplate | null> {
  if (!templateId) return null;
  const [row] = await db.select().from(importSourceTemplates)
    .where(and(eq(importSourceTemplates.id, templateId), eq(importSourceTemplates.tenant_id, tenantId)));
  if (!row || !row.is_active) throw new ImportDomainError('template_not_found', { templateId });
  return {
    column_map: row.column_map as Record<string, string>,
    delimiter: row.delimiter, encoding: row.encoding as 'utf8' | 'win1252',
    date_format: row.date_format, decimal_separator: row.decimal_separator,
    has_header: row.has_header, skip_rows: row.skip_rows,
    dedup_strategy: row.dedup_strategy as 'auto' | 'nsu' | 'line_hash',
  };
}

function toRow(tenantId: string, companyId: string, batchId: string, sourceKind: string, tx: NormalizedTransaction, dedupKey: string) {
  return {
    tenant_id: tenantId, company_id: companyId, batch_id: batchId,
    source: tx.source, source_kind: sourceKind, dedup_key: dedupKey,
    occurred_at: tx.occurredAt ?? null,
    nsu: tx.nsu ?? null, authorization_code: tx.authorizationCode ?? null,
    acquirer: tx.acquirer ?? null, card_brand: tx.cardBrand ?? null,
    customer_name: tx.customerName ?? null, customer_document: tx.customerDocument ?? null,
    gross_amount: tx.grossAmount != null ? toDecimalString(tx.grossAmount) : null,
    fee_amount: tx.feeAmount != null ? toDecimalString(tx.feeAmount) : null,
    net_amount: tx.netAmount != null ? toDecimalString(tx.netAmount) : null,
    installments: tx.installments ?? null, payment_method: tx.paymentMethod ?? null,
    establishment: tx.establishment ?? null, terminal_serial: tx.terminalSerial ?? null,
    bank_account_ref: tx.bankAccountRef ?? null, fitid: tx.fitid ?? null,
    memo: tx.memo ?? null, trn_type: tx.trnType ?? null,
    amount: tx.amount != null ? toDecimalString(tx.amount) : null,
    raw: tx.raw,
  };
}

export async function ingestUpload(
  tenantId: string, companyId: string | null | undefined, args: UploadArgs,
  actorUserId: string | null, db: DrizzleDB = _db,
): Promise<ImportBatch> {
  if (args.buffer.length === 0) throw new ImportDomainError('file_empty');
  if (args.buffer.length > MAX_IMPORT_BYTES) throw new ImportDomainError('file_too_large', { max: MAX_IMPORT_BYTES });

  const company = await resolveCompanyId(tenantId, companyId, db);
  const sourceKind = detectSourceKind(args.buffer, args.filename);
  const checksum = createHash('sha256').update(args.buffer).digest('hex');

  let batch: ImportBatch;
  try {
    [batch] = await db.insert(importBatches).values({
      tenant_id: tenantId, company_id: company.id, source_kind: sourceKind,
      source_template_id: args.templateId ?? null,
      original_filename: args.filename, checksum_sha256: checksum,
      byte_size: args.buffer.length, content_type: args.contentType,
      uploaded_by: actorUserId,
    }).returning();
  } catch (err) {
    if (isUniqueConstraintViolation(err)) throw new ImportDomainError('duplicate_file', { checksum });
    throw err;
  }

  const s3Key = await uploadOriginalToS3(tenantId, batch.id, args.filename, args.buffer, args.contentType);
  if (s3Key) await db.update(importBatches).set({ s3_key: s3Key }).where(eq(importBatches.id, batch.id));

  await recordFiscalEvent({
    tenantId, companyId: company.id, aggregateType: 'import_batch', aggregateId: batch.id,
    eventType: 'batch_received', actorUserId, sourceFileS3Key: s3Key, payloadHash: checksum,
    requestPayload: { filename: args.filename, source_kind: sourceKind, byte_size: args.buffer.length },
  }, db);

  return processBatch(batch.id, args.buffer, db);
}

/** Parse+persistência de um batch. Recebe o buffer (upload inline) ou baixa do S3 (reprocesso). */
export async function processBatch(batchId: string, buffer: Buffer | null, db: DrizzleDB = _db): Promise<ImportBatch> {
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId));
  if (!batch) throw new ImportDomainError('batch_not_found', { batchId });

  let buf = buffer;
  if (!buf) {
    const bucket = process.env.FISCAL_IMPORTS_BUCKET;
    if (!bucket || !batch.s3_key) throw new ImportDomainError('original_file_unavailable');
    const obj = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: batch.s3_key }));
    buf = Buffer.from(await (obj.Body as any).transformToByteArray());
  }

  await db.update(importBatches).set({ status: 'parsing' }).where(eq(importBatches.id, batchId));

  try {
    const importer = getImporter(batch.source_kind);
    const template = await loadTemplate(batch.tenant_id, batch.source_template_id, db);
    const { rows, warnings } = await importer.parse(buf, template);

    let inserted = 0, duplicate = 0, error = 0;
    for (const tx of rows) {
      try {
        await db.insert(importedTransactions)
          .values(toRow(batch.tenant_id, batch.company_id, batch.id, batch.source_kind, tx, importer.dedupKey(tx)));
        inserted++;
      } catch (err) {
        if (isUniqueConstraintViolation(err)) duplicate++;
        else { error++; } // erro em 1 linha nunca interrompe as demais
      }
    }

    const status = error > 0 ? 'partially_failed' : 'parsed';
    const [updated] = await db.update(importBatches).set({
      status, total_rows: rows.length, inserted_rows: inserted,
      duplicate_rows: duplicate, error_rows: error,
      error_message: warnings.length ? warnings.slice(0, 10).join('; ') : null,
      processed_at: new Date(),
    }).where(eq(importBatches.id, batchId)).returning();

    await recordFiscalEvent({
      tenantId: batch.tenant_id, companyId: batch.company_id,
      aggregateType: 'import_batch', aggregateId: batch.id, eventType: 'batch_processed',
      responsePayload: { status, total: rows.length, inserted, duplicate, error, warnings: warnings.length },
      idempotencyKey: `batch_processed:${batch.id}:${inserted}:${duplicate}:${error}`,
    }, db);
    return updated;
  } catch (err) {
    const message = err instanceof ImportDomainError ? err.code : (err instanceof Error ? err.message : String(err));
    const [failed] = await db.update(importBatches)
      .set({ status: 'failed', error_message: message, processed_at: new Date() })
      .where(eq(importBatches.id, batchId)).returning();
    await recordFiscalEvent({
      tenantId: batch.tenant_id, companyId: batch.company_id,
      aggregateType: 'import_batch', aggregateId: batch.id, eventType: 'batch_failed',
      responsePayload: { error: message },
    }, db);
    if (err instanceof ImportDomainError) throw err;
    return failed;
  }
}

export async function listBatches(tenantId: string, db: DrizzleDB = _db) {
  return db.select().from(importBatches).where(eq(importBatches.tenant_id, tenantId));
}

export async function getBatch(tenantId: string, id: string, db: DrizzleDB = _db) {
  const [row] = await db.select().from(importBatches)
    .where(and(eq(importBatches.id, id), eq(importBatches.tenant_id, tenantId)));
  if (!row) throw new ImportDomainError('batch_not_found', { batchId: id });
  return row;
}
