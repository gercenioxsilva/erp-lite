// Integrações por tenant — /v1/tenant/integrations/* (0087).
//
// Gating: LEITURA da lista exige só autenticação (a tela é de configuração, mas
// as telas de feature também consultam o estado para decidir entre renderizar a
// feature ou o aviso de "aguardando configuração"). MUTAÇÃO (salvar, ligar,
// ping) exige tenant_modules:manage — a mesma permissão que liga/desliga
// módulo, porque é a mesma classe de ato administrativo.
//
// A API NUNCA devolve valor de credencial — só `filled: boolean` por campo.

import { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../lib/requirePermission';
import {
  CATALOG, isEnvironment, isProviderKey, supportsEnvironment,
  type IntegrationEnvironment, type ProviderKey,
} from '../services/integrations/catalog';
import {
  listProviders, saveCredentials, saveServices, setEnabled, credentialsForPing, savePingResult,
} from '../services/integrations/integrationService';
import { ping } from '../services/integrations/integrationPing';
import { list as listLogs, record as recordLog } from '../services/integrations/integrationLogService';

interface ProviderParams { key: string; environment: string }

export const tenantIntegrationsRoutes: FastifyPluginAsync = async (fastify) => {
  const auth   = { onRequest: [(fastify as any).authenticate] };
  const manage = { ...auth, preHandler: [requirePermission('tenant_modules:manage')] };

  /**
   * Valida os parâmetros de rota. Devolve null e já responde 400 quando o par
   * (provider, ambiente) não existe no catálogo — Google não tem sandbox, e
   * aceitar isso criaria uma linha que nenhuma tela mostra.
   */
  function parseParams(request: any, reply: any): { key: ProviderKey; environment: IntegrationEnvironment } | null {
    const { key, environment } = request.params as ProviderParams;
    if (!isProviderKey(key)) { reply.badRequest('Integração desconhecida'); return null; }
    if (!isEnvironment(environment)) { reply.badRequest('Ambiente inválido'); return null; }
    if (!supportsEnvironment(key, environment)) {
      reply.badRequest(`${CATALOG[key].label} não possui o ambiente ${environment}`);
      return null;
    }
    return { key, environment };
  }

  // ── GET /v1/tenant/integrations ─────────────────────────────────────────
  fastify.get('/tenant/integrations', auth, async (request) => {
    const { tenantId } = (request as any).user;
    return { data: await listProviders(tenantId) };
  });

  // ── PUT /v1/tenant/integrations/:key/:environment ───────────────────────
  // Campo ausente/vazio mantém o valor atual; null limpa (ver mergeCredentials).
  fastify.put('/tenant/integrations/:key/:environment', manage, async (request, reply) => {
    const parsed = parseParams(request, reply);
    if (!parsed) return;
    const { tenantId, userId } = (request as any).user;
    const body = (request.body ?? {}) as {
      credentials?: Record<string, unknown>;
      services?: unknown;
    };
    if (typeof body.credentials !== 'object' || body.credentials === null) {
      return reply.badRequest('credentials deve ser um objeto');
    }
    await saveCredentials(tenantId, parsed.key, parsed.environment, body.credentials, userId ?? null);

    // `services` é opcional: quem não manda não mexe na configuração atual
    // (importa para clientes de API que só querem trocar a chave). Quando vem,
    // é a lista COMPLETA do que fica ligado — [] desliga tudo, de propósito.
    if (body.services !== undefined) {
      if (!Array.isArray(body.services) || body.services.some(s => typeof s !== 'string')) {
        return reply.badRequest('services deve ser uma lista de strings');
      }
      await saveServices(tenantId, parsed.key, parsed.environment, body.services as string[], userId ?? null);
    }
    return { data: await listProviders(tenantId) };
  });

  // ── PATCH /v1/tenant/integrations/:key/:environment ─────────────────────
  fastify.patch('/tenant/integrations/:key/:environment', manage, async (request, reply) => {
    const parsed = parseParams(request, reply);
    if (!parsed) return;
    const { tenantId, userId } = (request as any).user;
    const { enabled } = (request.body ?? {}) as { enabled?: unknown };
    if (typeof enabled !== 'boolean') return reply.badRequest('enabled deve ser boolean');

    // Ligar sem o conjunto obrigatório completo deixaria resolveCredentials()
    // devolvendo null com o toggle verde na tela — recusa explícita é melhor.
    if (enabled) {
      const values = await credentialsForPing(tenantId, parsed.key, parsed.environment);
      if (!values) return reply.badRequest('Preencha as credenciais obrigatórias antes de ativar');
    }
    await setEnabled(tenantId, parsed.key, parsed.environment, enabled, userId ?? null);
    return { data: await listProviders(tenantId) };
  });

  // ── POST /v1/tenant/integrations/:key/:environment/ping ─────────────────
  // Sempre 200: o resultado do teste é DADO, não erro de transporte HTTP. Um
  // ping que falha devolvendo 502 faria o interceptor genérico do frontend
  // mostrar "erro no sistema" — exatamente o que queremos evitar.
  fastify.post('/tenant/integrations/:key/:environment/ping', manage, async (request, reply) => {
    const parsed = parseParams(request, reply);
    if (!parsed) return;
    const { tenantId } = (request as any).user;
    const { key, environment } = parsed;

    const values = await credentialsForPing(tenantId, key, environment);
    if (!values) {
      const result = {
        ok: false, message: 'Preencha as credenciais obrigatórias para testar a conexão.',
        httpStatus: null, latencyMs: 0, errorCode: 'missing_credentials',
      };
      await recordLog({
        tenantId, providerKey: key, environment, service: 'ping',
        status: 'error', errorCode: result.errorCode, latencyMs: 0,
      });
      return { data: result };
    }

    const result = await ping(key, values, environment);
    await savePingResult(tenantId, key, environment, result.ok, result.message);
    await recordLog({
      tenantId, providerKey: key, environment, service: 'ping',
      status: result.ok ? 'success' : 'error',
      httpStatus: result.httpStatus, latencyMs: result.latencyMs,
      errorCode: result.errorCode,
      // request/response viram os blocos REQUEST e RESPONSE no detalhe do log.
      // Só entram quando existem — chave ausente faz a UI não desenhar o bloco,
      // melhor que um bloco vazio dizendo "null".
      detail: {
        message: result.message,
        ...(result.request  !== undefined ? { request:  result.request  } : {}),
        ...(result.response !== undefined ? { response: result.response } : {}),
      },
    });
    return { data: result };
  });

  // ── GET /v1/tenant/integrations/logs ────────────────────────────────────
  fastify.get('/tenant/integrations/logs', manage, async (request) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { provider?: string; status?: string; page?: string; pageSize?: string };
    const providerKey = q.provider && isProviderKey(q.provider) ? q.provider : null;
    const status = q.status === 'success' || q.status === 'error' ? q.status : null;
    return {
      data: await listLogs(tenantId, {
        providerKey, status,
        page: q.page ? Number(q.page) : 1,
        pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      }),
    };
  });
};
