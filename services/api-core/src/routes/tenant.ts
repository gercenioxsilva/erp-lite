import { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, tenants } from '../db';
import { validateBankingData, isValidBillingProvider } from '../lib/banking';

const MAX_LOGO_BYTES = 300 * 1024; // 300 KB base64 string limit
const MAX_BANNER_BYTES = 2 * 1024 * 1024; // 2 MB — banner da proposta (imagem maior)
const ALLOWED_LOGO_PREFIXES = [
  'data:image/jpeg;base64,',
  'data:image/jpg;base64,',
  'data:image/png;base64,',
  'data:image/webp;base64,',
  'data:image/gif;base64,',
];

export const tenantRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/tenant ─────────────────────────────────────────────────────── */
  fastify.get('/tenant', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) return reply.notFound('Empresa não encontrada');

    return tenant;
  });

  /* ── PATCH /v1/tenant ───────────────────────────────────────────────────── */
  fastify.patch('/tenant', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const body     = request.body as any;

    const allowed = [
      'company_name', 'trade_name', 'phone', 'website', 'state_reg',
      'street', 'street_number', 'complement', 'neighborhood', 'city', 'state', 'postal_code',
      'purchasing_contact_name', 'purchasing_contact_phone', 'purchasing_contact_email',
      'maintenance_contact_name', 'maintenance_contact_phone', 'maintenance_contact_email',
      'fiscal_contact_name', 'fiscal_contact_phone', 'fiscal_contact_email',
      'bank_code', 'agency', 'account', 'account_digit',
      'billing_provider', 'billing_days_to_expire',
      'itau_client_id', 'itau_client_secret',
    ];

    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key] || null;
    }

    if (Object.keys(patch).length === 0) return reply.badRequest('Nenhum campo para atualizar');

    // Validate banking data if any banking field is provided
    if (patch.bank_code || patch.agency || patch.account || patch.account_digit) {
      try {
        validateBankingData({
          bank_code: (patch.bank_code as string | undefined) ?? body.bank_code,
          agency: (patch.agency as string | undefined) ?? body.agency,
          account: (patch.account as string | undefined) ?? body.account,
          account_digit: (patch.account_digit as string | undefined) ?? body.account_digit,
        });
        // If any banking field is set, mark banking_updated_at
        patch.banking_updated_at = new Date();
      } catch (err: any) {
        return reply.badRequest(err.message);
      }
    }

    // Validate billing_provider if provided
    if (patch.billing_provider && !isValidBillingProvider(patch.billing_provider as string)) {
      return reply.badRequest('billing_provider inválido. Valores válidos: brcode, itau, santander, bradesco');
    }

    // Validate billing_days_to_expire if provided
    if (patch.billing_days_to_expire) {
      const days = Number(patch.billing_days_to_expire);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return reply.badRequest('billing_days_to_expire deve ser um número inteiro entre 1 e 365');
      }
    }

    await db.update(tenants).set(patch as any).where(eq(tenants.id, tenantId));
    return { ok: true };
  });

  /* ── PUT /v1/tenant/logo ────────────────────────────────────────────────── */
  fastify.put('/tenant/logo', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
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
  fastify.delete('/tenant/logo', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;

    await db.update(tenants).set({ logo_url: null }).where(eq(tenants.id, tenantId));
    return { ok: true };
  });

  /* ── PUT /v1/tenant/proposal-banner ─────────────────────────────────────── */
  fastify.put('/tenant/proposal-banner', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { banner_url } = request.body as any;

    if (!banner_url || typeof banner_url !== 'string')
      return reply.badRequest('banner_url é obrigatório');

    const isAllowed = ALLOWED_LOGO_PREFIXES.some(p => banner_url.startsWith(p));
    if (!isAllowed)
      return reply.badRequest('Formato inválido. Envie uma data URI base64 (jpeg, png, webp ou gif)');

    if (Buffer.byteLength(banner_url, 'utf8') > MAX_BANNER_BYTES)
      return reply.badRequest('Banner muito grande. Máximo permitido: 2 MB');

    await db.update(tenants).set({ proposal_banner_url: banner_url }).where(eq(tenants.id, tenantId));
    return { ok: true };
  });

  /* ── DELETE /v1/tenant/proposal-banner ──────────────────────────────────── */
  fastify.delete('/tenant/proposal-banner', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;

    await db.update(tenants).set({ proposal_banner_url: null }).where(eq(tenants.id, tenantId));
    return { ok: true };
  });
};
