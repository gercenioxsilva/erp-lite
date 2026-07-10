import { FastifyPluginAsync } from 'fastify';
import { listEnabledModules, setModuleEnabled, MODULE_KEYS, type ModuleKey } from '../services/tenantModuleService';
import { requirePermission } from '../lib/requirePermission';

export const tenantModulesRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate] };
  // Ligar/desligar um módulo é uma mutação sensível de "Minha Empresa" — a
  // primeira rota existente a usar requirePermission() de fato (RBAC), além
  // dos gates users:* já aplicados a routes/users.ts.

  // ── GET /v1/tenant/modules ──────────────────────────────────────────────
  // Somente autenticado (sem permissão): o menu do frontend precisa dessa lista
  // para todos os papéis. O gate real está no PATCH e no requireModule por rota.
  fastify.get('/tenant/modules', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const enabled = await listEnabledModules(tenantId);
    return { available: MODULE_KEYS, enabled };
  });

  // ── PATCH /v1/tenant/modules/:key ───────────────────────────────────────
  fastify.patch('/tenant/modules/:key', { ...auth, preHandler: [requirePermission('tenant_modules:manage')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { key }  = request.params as { key: string };
    const { enabled } = request.body as { enabled: boolean };

    if (!MODULE_KEYS.includes(key as ModuleKey)) return reply.badRequest('Módulo desconhecido');
    if (typeof enabled !== 'boolean') return reply.badRequest('enabled deve ser boolean');

    await setModuleEnabled(tenantId, key as ModuleKey, enabled, userId ?? null);
    return { ok: true };
  });
};
