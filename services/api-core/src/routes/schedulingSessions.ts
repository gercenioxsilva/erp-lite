// Rotas de Sessões do módulo de Agendamento: CRUD + transições (aprovar/
// recusar/concluir/cancelar), engine de slots e dashboard (badge de
// pendências). Recursos de configuração vivem em routes/scheduling.ts.
//
// Recorte de agenda (decisão nº 7): quem não tem scheduling:manage_all opera
// e ENXERGA apenas o profissional vinculado ao próprio user_id — aplicado em
// leituras e escritas, sempre no backend.

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';
import { resolveAgendaScope } from '../services/schedulingProfessionalService';
import {
  listSessions, getSessionOrThrow, createSession, updateSession,
  approveSession, declineSession, completeSession, markNoShow, cancelSession, deleteSession,
  getAvailableSlots, getDashboard,
} from '../services/schedulingSessionService';
import { handleSchedulingDomainError } from './scheduling';
import { syncSessionEvent, SyncAction } from '../services/googleCalendarService';

// Sincroniza a sessão com o Google Calendar sem derrubar o fluxo principal
// (fire-and-forget, mesmo padrão de sendSystemNotification). No-op silencioso
// quando o profissional não tem agenda Google conectada.
function syncGcal(sessionId: string, action: SyncAction) {
  syncSessionEvent(sessionId, action).catch(() => { /* efeito colateral não bloqueia */ });
}

const HM_PATTERN = '^([01][0-9]|2[0-3]):[0-5][0-9]$';
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

export const schedulingSessionsRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const auth = { onRequest: [authenticate], preHandler: [requireModule('scheduling')] };
  const guarded = (permission: string) => ({
    ...auth, preHandler: [...auth.preHandler, requirePermission(permission)],
  });

  /** null = irrestrito; senão o id do profissional do ator. */
  async function agendaScope(request: any): Promise<string | null> {
    const { tenantId, userId, role } = request.user;
    return resolveAgendaScope(tenantId, userId, role);
  }

  async function assertSessionInScope(request: any, sessionProfessionalId: string) {
    const scope = await agendaScope(request);
    if (scope !== null && scope !== sessionProfessionalId) {
      throw new SchedulingDomainError('not_own_agenda');
    }
  }

  /* ── Listagem e leitura ─────────────────────────────────────────────── */

  fastify.get('/scheduling/sessions', guarded('scheduling:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as Record<string, string>;
    try {
      return await listSessions({
        tenantId,
        restrictToProfessionalId: await agendaScope(request),
        professionalId: q.professional_id,
        clientId:       q.client_id,
        areaId:         q.area_id,
        status:         q.status,
        from:           q.from,
        to:             q.to,
        page:           Number(q.page) || 1,
        perPage:        Number(q.per_page) || 20,
      });
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.get('/scheduling/sessions/:id', guarded('scheduling:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      const session = await getSessionOrThrow(id, tenantId);
      await assertSessionInScope(request, session.professional_id);
      return session;
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  /* ── Criação e edição ───────────────────────────────────────────────── */

  fastify.post('/scheduling/sessions', {
    ...guarded('scheduling:manage'),
    schema: {
      body: {
        type: 'object',
        required: ['professional_id', 'client_id', 'area_id', 'date', 'start_time'],
        properties: {
          professional_id: { type: 'string', format: 'uuid' },
          client_id:       { type: 'string', format: 'uuid' },
          area_id:         { type: 'string', format: 'uuid' },
          package_id:      { type: ['string', 'null'], format: 'uuid' },
          date:            { type: 'string', pattern: DATE_PATTERN },
          start_time:      { type: 'string', pattern: HM_PATTERN },
          end_time:        { type: ['string', 'null'], pattern: HM_PATTERN },
          notes:           { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as any;
    try {
      await assertSessionInScope(request, b.professional_id);
      const session = await createSession({
        tenantId,
        professionalId: b.professional_id,
        clientId:       b.client_id,
        areaId:         b.area_id,
        packageId:      b.package_id,
        date:           b.date,
        startTime:      b.start_time,
        endTime:        b.end_time,
        notes:          b.notes,
        createdBy:      userId,
      });
      syncGcal(session.id, 'upsert'); // sessão staff nasce confirmada → evento
      return reply.code(201).send(session);
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.patch('/scheduling/sessions/:id', {
    ...guarded('scheduling:manage'),
    schema: {
      body: {
        type: 'object',
        properties: {
          professional_id: { type: 'string', format: 'uuid' },
          area_id:         { type: 'string', format: 'uuid' },
          package_id:      { type: ['string', 'null'], format: 'uuid' },
          date:            { type: 'string', pattern: DATE_PATTERN },
          start_time:      { type: 'string', pattern: HM_PATTERN },
          end_time:        { type: 'string', pattern: HM_PATTERN },
          notes:           { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const b = request.body as any;
    try {
      const session = await getSessionOrThrow(id, tenantId);
      await assertSessionInScope(request, session.professional_id);
      // Mover para OUTRO profissional também precisa estar no escopo do ator.
      if (b.professional_id) await assertSessionInScope(request, b.professional_id);
      const updated = await updateSession(id, tenantId, {
        professionalId: b.professional_id,
        areaId:         b.area_id,
        packageId:      b.package_id,
        date:           b.date,
        startTime:      b.start_time,
        endTime:        b.end_time,
        notes:          b.notes,
      });
      syncGcal(updated.id, 'upsert'); // horário/área/profissional mudou → atualiza evento
      return updated;
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  /* ── Transições ─────────────────────────────────────────────────────── */

  fastify.post('/scheduling/sessions/:id/approve', guarded('scheduling:manage'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      const session = await getSessionOrThrow(id, tenantId);
      await assertSessionInScope(request, session.professional_id);
      const approved = await approveSession(id, tenantId);
      syncGcal(approved.id, 'upsert'); // pendente aprovada → cria o evento
      return approved;
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.post('/scheduling/sessions/:id/decline', {
    ...guarded('scheduling:manage'),
    schema: {
      body: {
        type: 'object',
        required: ['reason'],
        properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason: string };
    try {
      const session = await getSessionOrThrow(id, tenantId);
      await assertSessionInScope(request, session.professional_id);
      const declined = await declineSession(id, tenantId, reason);
      syncGcal(declined.id, 'delete'); // recusada → remove evento (se houver)
      return declined;
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.post('/scheduling/sessions/:id/complete', guarded('scheduling:complete'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      const session = await getSessionOrThrow(id, tenantId);
      await assertSessionInScope(request, session.professional_id);
      return await completeSession(id, tenantId, userId);
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  // 0083: falta do cliente — mesma permissão de concluir (é o mesmo ato de
  // "encerrar o atendimento", só que com desfecho negativo). Não debita pacote.
  fastify.post('/scheduling/sessions/:id/no-show', guarded('scheduling:complete'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      const session = await getSessionOrThrow(id, tenantId);
      await assertSessionInScope(request, session.professional_id);
      const marked = await markNoShow(id, tenantId, userId);
      syncGcal(marked.id, 'delete'); // faltou → remove o evento do Google
      return marked;
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.post('/scheduling/sessions/:id/cancel', {
    ...guarded('scheduling:manage'),
    schema: {
      body: {
        type: 'object',
        properties: { reason: { type: ['string', 'null'], maxLength: 500 } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const { reason } = (request.body ?? {}) as { reason?: string | null };
    try {
      const session = await getSessionOrThrow(id, tenantId);
      await assertSessionInScope(request, session.professional_id);
      const canceled = await cancelSession(id, tenantId, { byUserId: userId, reason });
      syncGcal(canceled.id, 'delete'); // cancelada → remove evento (libera o horário)
      return canceled;
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.delete('/scheduling/sessions/:id', guarded('scheduling:manage'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      const session = await getSessionOrThrow(id, tenantId);
      await assertSessionInScope(request, session.professional_id);
      // Hard delete: remove o evento ANTES da linha sumir (syncSessionEvent lê
      // o google_event_id da sessão; awaited pois nunca lança — swallow interno).
      await syncSessionEvent(id, 'delete').catch(() => { /* não bloqueia a exclusão */ });
      await deleteSession(id, tenantId);
      return reply.code(204).send();
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  /* ── Slots e dashboard ──────────────────────────────────────────────── */

  // Uso do form do admin: NÃO corta por antecedência mínima (o staff pode
  // agendar em cima da hora de propósito) — o portal usa /v1/portal/slots.
  fastify.get('/scheduling/slots', guarded('scheduling:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as Record<string, string>;
    if (!q.professional_id || !q.area_id || !q.date) {
      return reply.badRequest('professional_id, area_id e date são obrigatórios');
    }
    try {
      await assertSessionInScope(request, q.professional_id);
      const slots = await getAvailableSlots({
        tenantId,
        professionalId:    q.professional_id,
        areaId:            q.area_id,
        date:              q.date,
        enforceMinAdvance: false,
      });
      return { data: slots };
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.get('/scheduling/dashboard', guarded('scheduling:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    try {
      return await getDashboard(tenantId, await agendaScope(request));
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });
};
