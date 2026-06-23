import { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, tenants } from '../db';

const MAX_LOGO_BYTES = 300 * 1024; // 300 KB base64 string limit
const ALLOWED_LOGO_PREFIXES = [
  'data:image/jpeg;base64,',
  'data:image/jpg;base64,',
  'data:image/png;base64,',
  'data:image/webp;base64,',
  'data:image/gif;base64,',
];

export const tenantRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/tenant ─────────────────────────────────────────────────────── */
  fastify.get('/tenant', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const tenantId = request.user.tenantId;

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) return reply.notFound('Empresa não encontrada');

    return tenant;
  });

  /* ── PATCH /v1/tenant ───────────────────────────────────────────────────── */
  fastify.patch('/tenant', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const body     = request.body as any;

    const allowed = [
      'company_name', 'trade_name', 'phone', 'website',
      'street', 'street_number', 'complement', 'neighborhood', 'city', 'state', 'postal_code',
      'purchasing_contact_name', 'purchasing_contact_phone', 'purchasing_contact_email',
      'maintenance_contact_name', 'maintenance_contact_phone', 'maintenance_contact_email',
      'fiscal_contact_name', 'fiscal_contact_phone', 'fiscal_contact_email',
    ];

    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key] || null;
    }

    if (Object.keys(patch).length === 0) return reply.badRequest('Nenhum campo para atualizar');

    await db.update(tenants).set(patch as any).where(eq(tenants.id, tenantId));
    return { ok: true };
  });

  /* ── PUT /v1/tenant/logo ────────────────────────────────────────────────── */
  fastify.put('/tenant/logo', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { logo_url } = request.body as any;

    if (!logo_url || typeof logo_url !== 'string')
      return reply.badRequest('logo_url é obrigatório');

    const isAllowed = ALLOWED_LOGO_PREFIXES.some(p => logo_url.startsWith(p));
    if (!isAllowed)
      return reply.badRequest('Formato inválido. Envie uma data URI base64 (jpeg, png, webp ou gif)');

    if (Buffer.byteLength(logo_url, 'utf8') > MAX_LOGO_BYTES)
      return reply.badRequest('Logo muito grande. Máximo permitido: 300 KB');

    await db.update(tenants).set({ logo_url }).where(eq(tenants.id, tenantId));
    return { ok: true };
  });

  /* ── DELETE /v1/tenant/logo ─────────────────────────────────────────────── */
  fastify.delete('/tenant/logo', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const tenantId = request.user.tenantId;

    await db.update(tenants).set({ logo_url: null }).where(eq(tenants.id, tenantId));
    return { ok: true };
  });
};
