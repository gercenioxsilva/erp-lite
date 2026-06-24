import { FastifyPluginAsync } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { db, materialImages } from '../db';

const MAX_IMAGE_BYTES  = 500 * 1024;         // 500 KB base64 string length
const MAX_IMAGES       = 5;
const ALLOWED_PREFIXES = [
  'data:image/jpeg;base64,',
  'data:image/jpg;base64,',
  'data:image/png;base64,',
  'data:image/webp;base64,',
];

const idParam = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const;

const imageParam = {
  type: 'object',
  properties: {
    id:      { type: 'string', format: 'uuid' },
    imageId: { type: 'string', format: 'uuid' },
  },
  required: ['id', 'imageId'],
} as const;

export const materialImagesRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/materials/:id/images ──────────────────────────────────────── */
  fastify.get('/materials/:id/images', {
    schema: { params: idParam },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await db.select().from(materialImages)
      .where(eq(materialImages.material_id, id))
      .orderBy(materialImages.position, materialImages.created_at);
    return rows;
  });

  /* ── POST /v1/materials/:id/images ─────────────────────────────────────── */
  fastify.post('/materials/:id/images', {
    schema: {
      params: idParam,
      body: {
        type: 'object',
        required: ['tenant_id', 'image_data'],
        properties: {
          tenant_id:  { type: 'string', format: 'uuid' },
          image_data: { type: 'string', minLength: 10 },
          filename:   { type: 'string', maxLength: 255 },
          alt:        { type: 'string', maxLength: 500 },
          is_cover:   { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { id: materialId } = request.params as { id: string };
    const { tenant_id, image_data, filename, alt, is_cover } =
      request.body as { tenant_id: string; image_data: string; filename?: string; alt?: string; is_cover?: boolean };

    // Validate format
    if (!ALLOWED_PREFIXES.some(p => image_data.startsWith(p)))
      return reply.badRequest('Formato não suportado. Use JPEG, PNG ou WebP (data URI base64).');

    // Validate size (base64 string length ≈ actual byte size)
    if (Buffer.byteLength(image_data, 'utf8') > MAX_IMAGE_BYTES)
      return reply.badRequest(`Imagem muito grande. Máximo: ${MAX_IMAGE_BYTES / 1024} KB.`);

    // Enforce max images per material
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(materialImages)
      .where(eq(materialImages.material_id, materialId));

    if (count >= MAX_IMAGES)
      return reply.badRequest(`Máximo de ${MAX_IMAGES} imagens por material.`);

    const setCover = is_cover === true || count === 0; // first image is always cover

    const [image] = await db.transaction(async (tx) => {
      if (setCover) {
        // Clear cover flag from all existing images for this material
        await tx.update(materialImages)
          .set({ is_cover: false })
          .where(eq(materialImages.material_id, materialId));
      }

      return tx.insert(materialImages).values({
        tenant_id,
        material_id: materialId,
        image_data,
        filename:   filename  ?? null,
        alt:        alt       ?? null,
        position:   count,       // append at end
        is_cover:   setCover,
      }).returning();
    });

    return reply.code(201).send(image);
  });

  /* ── PATCH /v1/materials/:id/images/:imageId ────────────────────────────── */
  fastify.patch('/materials/:id/images/:imageId', {
    schema: {
      params: imageParam,
      body: {
        type: 'object',
        properties: {
          alt:      { type: 'string', maxLength: 500 },
          position: { type: 'integer', minimum: 0 },
          is_cover: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { id: materialId, imageId } = request.params as { id: string; imageId: string };
    const body = request.body as { alt?: string; position?: number; is_cover?: boolean };

    const [existing] = await db.select({ id: materialImages.id })
      .from(materialImages)
      .where(and(eq(materialImages.id, imageId), eq(materialImages.material_id, materialId)));
    if (!existing) return reply.notFound('Imagem não encontrada');

    const [updated] = await db.transaction(async (tx) => {
      if (body.is_cover === true) {
        await tx.update(materialImages)
          .set({ is_cover: false })
          .where(eq(materialImages.material_id, materialId));
      }
      return tx.update(materialImages)
        .set({
          ...(body.alt      !== undefined && { alt:      body.alt }),
          ...(body.position !== undefined && { position: body.position }),
          ...(body.is_cover !== undefined && { is_cover: body.is_cover }),
        })
        .where(eq(materialImages.id, imageId))
        .returning();
    });

    return updated;
  });

  /* ── DELETE /v1/materials/:id/images/:imageId ───────────────────────────── */
  fastify.delete('/materials/:id/images/:imageId', {
    schema: { params: imageParam },
  }, async (request, reply) => {
    const { id: materialId, imageId } = request.params as { id: string; imageId: string };

    const [deleted] = await db.delete(materialImages)
      .where(and(eq(materialImages.id, imageId), eq(materialImages.material_id, materialId)))
      .returning({ id: materialImages.id, is_cover: materialImages.is_cover, material_id: materialImages.material_id });

    if (!deleted) return reply.notFound('Imagem não encontrada');

    // If the deleted image was the cover, promote the first remaining image
    if (deleted.is_cover) {
      const [next] = await db.select({ id: materialImages.id })
        .from(materialImages)
        .where(eq(materialImages.material_id, materialId))
        .orderBy(materialImages.position, materialImages.created_at)
        .limit(1);

      if (next) {
        await db.update(materialImages)
          .set({ is_cover: true })
          .where(eq(materialImages.id, next.id));
      }
    }

    return reply.code(204).send();
  });
};
