// Compressão client-side + upload direto ao S3 via presigned POST.
// O binário nunca passa pela api-core — controla custo (Fargate não paga
// CPU/tempo proxiando foto) e mantém CPF/assinatura fora de log de aplicação.

const MAX_DIMENSION = 1600; // maior lado, em px
const JPEG_QUALITY   = 0.8;

/** Redimensiona/comprime uma foto de câmera para um JPEG leve antes do upload. */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale  = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width  * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file; // fallback — navegador sem suporte a canvas 2D
  ctx.drawImage(bitmap, 0, 0, w, h);

  return new Promise<Blob>((resolve) => {
    canvas.toBlob(blob => resolve(blob ?? file), 'image/jpeg', JPEG_QUALITY);
  });
}

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  key: string;
}

/** Envia um blob para o S3 usando os campos de um presigned POST. */
export async function uploadToPresignedPost(presigned: PresignedUpload, blob: Blob, filename: string): Promise<void> {
  const form = new FormData();
  Object.entries(presigned.fields).forEach(([k, v]) => form.append(k, v));
  form.append('file', blob, filename);

  const res = await fetch(presigned.url, { method: 'POST', body: form });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Falha no upload (HTTP ${res.status})`);
  }
}

/** Converte o conteúdo de um <canvas> de assinatura em PNG (Blob). */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('canvas_to_blob_failed')), 'image/png');
  });
}
