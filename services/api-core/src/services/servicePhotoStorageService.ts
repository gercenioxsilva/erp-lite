// Armazenamento de fotos/assinatura da visita técnica no S3.
//
// Decisões de segurança e custo (ver README, regra do módulo de Visita Técnica):
//  - Upload é DIRETO do navegador para o S3 via presigned POST com policy
//    (content-length-range + content-type) — o binário nunca passa pelo Fastify/
//    ECS, o que também mantém CPF/assinatura fora de qualquer log de aplicação.
//  - presigned POST (não PUT) porque só POST aceita policy conditions —
//    PUT assinado não impõe limite de tamanho/tipo no lado do servidor.
//  - Bucket é privado (Block Public Access) — leitura só via presigned GET de
//    vida curta, nunca ACL pública.
//  - Chave inclui tenant_id e service_visit_id — isolamento por tenant E por
//    visita individualizada.
//
// Esta camada NÃO verifica se o técnico tem permissão sobre a visita — isso é
// responsabilidade de serviceVisitService (autorização de identidade), chamada
// antes desta pelo route handler. Aqui só mexe com S3 + a tabela de fotos.

import { randomUUID } from 'crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { db as _db } from '../db';
import { serviceVisitPhotos, serviceVisits } from '../db/schema';
import { sql, eq, and } from 'drizzle-orm';
import { getS3Client } from '../lib/s3Client';

export type DrizzleDB = typeof _db;

const MAX_PHOTO_BYTES     = 2 * 1024 * 1024;   // 2 MB — cliente já comprime antes de subir
const MAX_SIGNATURE_BYTES = 300 * 1024;        // 300 KB — PNG de assinatura é pequeno
const PRESIGN_EXPIRES_SECONDS   = 300;         // 5 min para subir
const READ_URL_EXPIRES_SECONDS  = 900;         // 15 min para visualizar no backoffice

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

export class PhotoStorageError extends Error {
  constructor(public code: string) { super(code); this.name = 'PhotoStorageError'; }
}

function bucketName(): string {
  const bucket = process.env.SERVICE_VISIT_PHOTOS_BUCKET;
  if (!bucket) throw new PhotoStorageError('service_visit_photos_bucket_not_configured');
  return bucket;
}

// ── Upload de foto ────────────────────────────────────────────────────────────

export interface PresignPhotoArgs {
  tenantId:    string;
  visitId:     string;
  contentType: string;
}

export async function createPresignedPhotoUpload(args: PresignPhotoArgs) {
  const ext = ALLOWED_CONTENT_TYPES[args.contentType];
  if (!ext) throw new PhotoStorageError('unsupported_content_type');

  const key = `${args.tenantId}/${args.visitId}/${randomUUID()}.${ext}`;

  const { url, fields } = await createPresignedPost(getS3Client(), {
    Bucket: bucketName(),
    Key:    key,
    Conditions: [
      ['content-length-range', 1, MAX_PHOTO_BYTES],
      ['eq', '$Content-Type', args.contentType],
    ],
    Fields: { 'Content-Type': args.contentType },
    Expires: PRESIGN_EXPIRES_SECONDS,
  });

  return { url, fields, key, expiresIn: PRESIGN_EXPIRES_SECONDS };
}

export interface ConfirmPhotoArgs {
  tenantId:        string;
  visitId:         string;
  s3Key:           string;
  contentType:     string;
  fileSizeBytes:   number;
  idempotencyKey:  string;
  caption?:        string | null;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === '23505';
}

/** Idempotente por (tenant_id, idempotency_key) — retry de rede não duplica a linha. */
export async function confirmPhotoUpload(args: ConfirmPhotoArgs, db: DrizzleDB = _db) {
  // A chave devolvida pelo presign já contém tenant_id/visit_id — nunca confiar
  // em s3Key vindo só do cliente sem essa checagem de prefixo.
  const expectedPrefix = `${args.tenantId}/${args.visitId}/`;
  if (!args.s3Key.startsWith(expectedPrefix)) {
    throw new PhotoStorageError('s3_key_prefix_mismatch');
  }

  try {
    const [inserted] = await db.insert(serviceVisitPhotos).values({
      tenant_id:        args.tenantId,
      service_visit_id: args.visitId,
      s3_key:            args.s3Key,
      content_type:      args.contentType,
      file_size_bytes:   args.fileSizeBytes,
      caption:            args.caption ?? null,
      idempotency_key:    args.idempotencyKey,
    }).returning();
    return inserted;
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      const [existing] = await db.select().from(serviceVisitPhotos)
        .where(and(eq(serviceVisitPhotos.tenant_id, args.tenantId), eq(serviceVisitPhotos.idempotency_key, args.idempotencyKey)));
      return existing;
    }
    throw err;
  }
}

// ── Assinatura do cliente ─────────────────────────────────────────────────────
// Artefato 1:1 com a visita (não é uma "foto" da galeria) — chave fixa por
// visita, sobrescrever em novo envio é o comportamento desejado.

export interface PresignSignatureArgs {
  tenantId: string;
  visitId:  string;
}

export async function createPresignedSignatureUpload(args: PresignSignatureArgs) {
  const key = `${args.tenantId}/${args.visitId}/signature.png`;

  const { url, fields } = await createPresignedPost(getS3Client(), {
    Bucket: bucketName(),
    Key:    key,
    Conditions: [
      ['content-length-range', 1, MAX_SIGNATURE_BYTES],
      ['eq', '$Content-Type', 'image/png'],
    ],
    Fields: { 'Content-Type': 'image/png' },
    Expires: PRESIGN_EXPIRES_SECONDS,
  });

  return { url, fields, key, expiresIn: PRESIGN_EXPIRES_SECONDS };
}

export interface ConfirmSignatureArgs {
  tenantId:     string;
  visitId:      string;
  s3Key:        string;
  signedByName: string;
}

export async function confirmSignature(args: ConfirmSignatureArgs, db: DrizzleDB = _db) {
  const expectedKey = `${args.tenantId}/${args.visitId}/signature.png`;
  if (args.s3Key !== expectedKey) throw new PhotoStorageError('s3_key_prefix_mismatch');
  if (!args.signedByName.trim()) throw new PhotoStorageError('signed_by_name_required');

  await db.update(serviceVisits).set({
    signature_s3_key: args.s3Key,
    signed_by_name:   args.signedByName.trim(),
    signed_at:        sql`now()`,
  }).where(and(eq(serviceVisits.id, args.visitId), eq(serviceVisits.tenant_id, args.tenantId)));
}

// ── Leitura (backoffice) ──────────────────────────────────────────────────────
// URL de leitura sempre gerada sob demanda, nunca um link fixo/permanente.

export async function getPresignedReadUrl(s3Key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucketName(), Key: s3Key });
  return getSignedUrl(getS3Client(), command, { expiresIn: READ_URL_EXPIRES_SECONDS });
}
