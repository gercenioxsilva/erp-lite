import { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, tenants } from '../db';
import { getDefaultBankAccount, upsertDefaultBankAccount, BankAccountDomainError } from '../services/bankAccountService';
import { requirePermission } from '../lib/requirePermission';
import { isValidSegmentKey, HEX_COLOR_RE } from '../lib/segments';

const BANKING_FIELDS = [
  'bank_code', 'agency', 'account', 'account_digit',
  'billing_provider', 'billing_days_to_expire',
  'itau_client_id', 'itau_client_secret', // @deprecated — ver credentials
  'credentials', // genérico por provedor (migration 0064) — {client_id,
  // client_secret} pro Itaú, {client_id, client_secret, cert, key} pro C6
] as const;

const MAX_LOGO_BYTES = 300 * 1024; // 300 KB base64 string limit
// 7 MB, not 5 — this checks the base64 STRING (banner_url), and base64 inflates
// raw bytes by ~4/3. A genuine 5 MB file (the limit shown to users, checked
// against File.size in CompanyPage.tsx) becomes ~6.67 MB once encoded, so the
// byte threshold here has to be higher than the user-facing "5 MB" figure.
const MAX_BANNER_BYTES = 7 * 1024 * 1024;
const ALLOWED_LOGO_PREFIXES = [
  'data:image/jpeg;base64,',
  'data:image/jpg;base64,',
  'data:image/png;base64,',
  'data:image/webp;base64,',
  'data:image/gif;base64,',
];

export const tenantRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/tenant ─────────────────────────────────────────────────────── */
  // Campos bancários (regra 41): lidos da conta padrão da empresa padrão via
  // bankAccountService, não mais das colunas de tenants — retrocompatível no
  // shape da resposta, mas agora o segredo do Itaú vem mascarado (correção de
  // uma inconsistência: nfe_configs já mascarava tokens, tenants nunca mascarou).
  fastify.get('/tenant', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('company:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) return reply.notFound('Empresa não encontrada');

    const account = await getDefaultBankAccount(tenantId);
    const mask = (t: string | null | undefined) => (t ? '****' + t.slice(-4) : null);
    const credentials = account?.credentials as Record<string, string> | null | undefined;
    const maskedCredentials = credentials
      ? Object.fromEntries(Object.entries(credentials).map(([k, v]) => [k, /secret|key|cert/i.test(k) ? mask(v) : v]))
      : null;

    return {
      ...tenant,
      bank_code:              account?.bank_code              ?? null,
      agency:                 account?.agency                 ?? null,
      account:                account?.account                ?? null,
      account_digit:          account?.account_digit           ?? null,
      billing_provider:       account?.billing_provider        ?? 'brcode',
      billing_days_to_expire: account?.billing_days_to_expire  ?? 30,
      itau_client_id:         account?.itau_client_id          ?? null,
      itau_client_secret:     mask(account?.itau_client_secret),
      credentials:            maskedCredentials,
    };
  });

  /* ── PATCH /v1/tenant ───────────────────────────────────────────────────── */
  fastify.patch('/tenant', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('company:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const body     = request.body as any;

    const allowed = [
      'company_name', 'trade_name', 'phone', 'website', 'state_reg',
      'street', 'street_number', 'complement', 'neighborhood', 'city', 'state', 'postal_code',
      'purchasing_contact_name', 'purchasing_contact_phone', 'purchasing_contact_email',
      'maintenance_contact_name', 'maintenance_contact_phone', 'maintenance_contact_email',
      'fiscal_contact_name', 'fiscal_contact_phone', 'fiscal_contact_email',
      'simples_rbt12',
      // Branding (migration 0065) — segmento + override manual de cores.
      'segment_key', 'brand_primary', 'brand_accent',
    ];

    // Validação do branding antes de montar o patch (a paleta/labels reais
    // vivem no catálogo do frontend; aqui só garantimos chave/cor válidas).
    if (body.segment_key !== undefined && body.segment_key !== null && !isValidSegmentKey(body.segment_key)) {
      return reply.badRequest('segment_key inválido');
    }
    for (const colorKey of ['brand_primary', 'brand_accent']) {
      const v = body[colorKey];
      if (v !== undefined && v !== null && v !== '' && !HEX_COLOR_RE.test(v)) {
        return reply.badRequest(`${colorKey} deve ser uma cor hexadecimal '#RRGGBB'`);
      }
    }

    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key] || null;
    }

    // Campos bancários (regra 41): não vão mais para tenants — delegados para a
    // conta padrão da empresa padrão via bankAccountService, mesmo contrato de
    // request/response de sempre (retrocompatibilidade).
    const bankingPatch: Record<string, unknown> = {};
    for (const key of BANKING_FIELDS) {
      if (body[key] !== undefined) bankingPatch[key] = body[key] || null;
    }
    const hasBankingUpdate = Object.keys(bankingPatch).length > 0;

    if (Object.keys(patch).length === 0 && !hasBankingUpdate) {
      return reply.badRequest('Nenhum campo para atualizar');
    }

    if (hasBankingUpdate) {
      try {
        await upsertDefaultBankAccount(tenantId, bankingPatch as any);
      } catch (err) {
        if (err instanceof BankAccountDomainError) {
          if (err.code === 'invalid_banking_data') return reply.badRequest((err.payload as any)?.message ?? err.code);
          if (err.code === 'invalid_billing_provider') return reply.badRequest('billing_provider inválido. Valores válidos: brcode, itau, c6, santander, bradesco');
          if (err.code === 'invalid_credentials') return reply.badRequest(`Credenciais incompletas para ${(err.payload as any)?.provider}. Faltando: ${((err.payload as any)?.missing ?? []).join(', ')}`);
          if (err.code === 'invalid_billing_days_to_expire') return reply.badRequest('billing_days_to_expire deve ser um número inteiro entre 1 e 365');
          return reply.badRequest(err.code);
        }
        throw err;
      }
      patch.banking_updated_at = new Date();
    }

    if (Object.keys(patch).length > 0) {
      await db.update(tenants).set(patch as any).where(eq(tenants.id, tenantId));
    }
    return { ok: true };
  });

  /* ── PUT /v1/tenant/logo ────────────────────────────────────────────────── */
  fastify.put('/tenant/logo', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('company:edit')] }, async (request, reply) => {
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
  fastify.delete('/tenant/logo', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('company:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;

    await db.update(tenants).set({ logo_url: null }).where(eq(tenants.id, tenantId));
    return { ok: true };
  });

  /* ── PUT /v1/tenant/proposal-banner ─────────────────────────────────────── */
  fastify.put('/tenant/proposal-banner', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('company:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { banner_url } = request.body as any;

    if (!banner_url || typeof banner_url !== 'string')
      return reply.badRequest('banner_url é obrigatório');

    const isAllowed = ALLOWED_LOGO_PREFIXES.some(p => banner_url.startsWith(p));
    if (!isAllowed)
      return reply.badRequest('Formato inválido. Envie uma data URI base64 (jpeg, png, webp ou gif)');

    if (Buffer.byteLength(banner_url, 'utf8') > MAX_BANNER_BYTES)
      return reply.badRequest('Banner muito grande. Máximo permitido: 5 MB');

    await db.update(tenants).set({ proposal_banner_url: banner_url }).where(eq(tenants.id, tenantId));
    return { ok: true };
  });

  /* ── DELETE /v1/tenant/proposal-banner ──────────────────────────────────── */
  fastify.delete('/tenant/proposal-banner', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('company:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;

    await db.update(tenants).set({ proposal_banner_url: null }).where(eq(tenants.id, tenantId));
    return { ok: true };
  });
};
