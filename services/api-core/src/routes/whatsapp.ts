import { FastifyPluginAsync } from 'fastify';
import {
  getWhatsAppAccount, upsertWhatsAppAccount, disconnectWhatsAppAccount, testWhatsAppConnection, WhatsAppDomainError,
} from '../services/whatsappAccountService';
import { listTemplates, upsertTemplateRegistration } from '../services/whatsappTemplateService';
import { listAutomations, upsertAutomation } from '../services/whatsappAutomationService';
import { listMessages } from '../services/whatsappMessageService';
import { requirePermission } from '../lib/requirePermission';
import { requireModule } from '../lib/requireModule';

export const whatsappRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate], preHandler: [requireModule('whatsapp')] };

  // Mesmo padrão de mascaramento de bank-accounts.ts (regra 41) — qualquer
  // chave de `credentials` que pareça sensível, nunca enumerada por provedor.
  const mask = (t: string | null | undefined) => (t ? '****' + t.slice(-4) : null);
  const SENSITIVE_CREDENTIAL_KEYS = /secret|token/i;
  const maskCredentials = (credentials: Record<string, string> | null | undefined) => {
    if (!credentials) return null;
    return Object.fromEntries(
      Object.entries(credentials).map(([k, v]) => [k, SENSITIVE_CREDENTIAL_KEYS.test(k) ? mask(v) : v]),
    );
  };
  const maskAccount = (a: any) => ({ ...a, credentials: maskCredentials(a.credentials) });

  const handleDomainError = (err: unknown, reply: any) => {
    if (err instanceof WhatsAppDomainError) return reply.badRequest(err.code);
    throw err;
  };

  /* ── GET /v1/whatsapp/account ────────────────────────────────────────── */
  fastify.get('/whatsapp/account', { ...auth, preHandler: [...auth.preHandler, requirePermission('whatsapp:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const account = await getWhatsAppAccount(tenantId);
    return account ? maskAccount(account) : null;
  });

  /* ── PATCH /v1/whatsapp/account ──────────────────────────────────────── */
  // Conecta ou atualiza a conta — mesmo verbo/semântica de PATCH /tenant
  // (upsert), nunca exige POST separado pro primeiro cadastro.
  fastify.patch('/whatsapp/account', { ...auth, preHandler: [...auth.preHandler, requirePermission('whatsapp:manage')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const body = request.body as {
      provider?: string; whatsapp_number?: string; display_name?: string;
      account_sid?: string; auth_token?: string;
    };
    try {
      const account = await upsertWhatsAppAccount(tenantId, {
        provider:        body.provider,
        whatsapp_number: body.whatsapp_number,
        display_name:    body.display_name,
        credentials: (body.account_sid || body.auth_token) ? {
          account_sid: body.account_sid ?? '', auth_token: body.auth_token ?? '',
        } : undefined,
      });
      return maskAccount(account);
    } catch (err) {
      return handleDomainError(err, reply);
    }
  });

  /* ── POST /v1/whatsapp/account/test ──────────────────────────────────── */
  // Teste SÍNCRONO de conexão — confirma que account_sid/auth_token
  // realmente autenticam no Twilio, sem enviar mensagem (nunca lança erro
  // HTTP pra falha de conectividade, mesmo padrão de
  // POST /companies/:id/fiscal-integration/test).
  fastify.post('/whatsapp/account/test', { ...auth, preHandler: [...auth.preHandler, requirePermission('whatsapp:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    try {
      return await testWhatsAppConnection(tenantId);
    } catch (err) {
      return handleDomainError(err, reply);
    }
  });

  /* ── DELETE /v1/whatsapp/account ─────────────────────────────────────── */
  fastify.delete('/whatsapp/account', { ...auth, preHandler: [...auth.preHandler, requirePermission('whatsapp:manage')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    await disconnectWhatsAppAccount(tenantId);
    return { ok: true };
  });

  /* ── GET /v1/whatsapp/templates ──────────────────────────────────────── */
  fastify.get('/whatsapp/templates', { ...auth, preHandler: [...auth.preHandler, requirePermission('whatsapp:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    return { data: await listTemplates(tenantId) };
  });

  /* ── PATCH /v1/whatsapp/templates/:key ───────────────────────────────── */
  // Registra o Content SID já aprovado pelo provedor — passo operacional
  // (registro/aprovação em si é manual, fora do escopo de código).
  fastify.patch('/whatsapp/templates/:key', { ...auth, preHandler: [...auth.preHandler, requirePermission('whatsapp:manage')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { key } = request.params as { key: string };
    const { provider_template_id } = request.body as { provider_template_id: string };
    try {
      const row = await upsertTemplateRegistration(tenantId, key, provider_template_id);
      return row;
    } catch (err) {
      return handleDomainError(err, reply);
    }
  });

  /* ── GET /v1/whatsapp/automations ────────────────────────────────────── */
  fastify.get('/whatsapp/automations', { ...auth, preHandler: [...auth.preHandler, requirePermission('whatsapp:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    return { data: await listAutomations(tenantId) };
  });

  /* ── PATCH /v1/whatsapp/automations/:key ─────────────────────────────── */
  fastify.patch('/whatsapp/automations/:key', { ...auth, preHandler: [...auth.preHandler, requirePermission('whatsapp:manage')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { key } = request.params as { key: string };
    const { enabled, config } = request.body as { enabled: boolean; config?: Record<string, unknown> };
    try {
      const row = await upsertAutomation(tenantId, key, Boolean(enabled), config ?? {});
      return row;
    } catch (err) {
      return handleDomainError(err, reply);
    }
  });

  /* ── GET /v1/whatsapp/messages ────────────────────────────────────────── */
  fastify.get('/whatsapp/messages', { ...auth, preHandler: [...auth.preHandler, requirePermission('whatsapp:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { client_id, status, page, per_page } = request.query as Record<string, string>;
    return listMessages(tenantId, { client_id, status, page: Number(page), per_page: Number(per_page) });
  });
};
