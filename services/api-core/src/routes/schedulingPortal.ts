// Portal do Cliente (/v1/portal/*) — molde do technicianPortal, com JWT comum.
//
// Modelo de segurança em três camadas:
// 1. clientRoleGuard (global): JWT role='client' só alcança /v1/portal/*.
// 2. requirePermission('scheduling_portal:access'): só papéis com o grant
//    (por padrão, apenas 'client') usam estas rotas.
// 3. currentClientId(): o client_id vem SEMPRE da linha de users do banco
//    (nunca do token nem do payload) e toda query é escopada por
//    tenant_id + client_id — o cliente só enxerga os próprios dados.

import { FastifyPluginAsync } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db, users, clients } from '../db';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';
import { getOrCreateSettings } from '../services/schedulingSettingsService';
import { listAreas, getAreaOrThrow } from '../services/schedulingAreaService';
import { listProfessionals } from '../services/schedulingProfessionalService';
import { listClientPackages, getPackageOrThrow } from '../services/schedulingPackageService';
import {
  listSessions, requestSessionAsClient, cancelOwnPendingSession, getAvailableSlots,
} from '../services/schedulingSessionService';
import { handleSchedulingDomainError } from './scheduling';

const HM_PATTERN = '^([01][0-9]|2[0-3]):[0-5][0-9]$';
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

export const schedulingPortalRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const guard = {
    onRequest:  [authenticate],
    preHandler: [requireModule('scheduling'), requirePermission('scheduling_portal:access')],
  };

  /** client_id resolvido por request da linha de users — imune a token velho
   *  após revínculo. Login sem vínculo é erro de provisionamento ⇒ 403. */
  async function currentClientId(request: any): Promise<string> {
    const { tenantId, userId } = request.user;
    const [row] = await db.select({ client_id: users.client_id }).from(users)
      .where(and(eq(users.id, userId), eq(users.tenant_id, tenantId)));
    if (!row?.client_id) throw new SchedulingDomainError('client_not_linked');
    return row.client_id;
  }

  function handlePortalError(err: unknown, reply: any) {
    if (err instanceof SchedulingDomainError && err.code === 'client_not_linked') {
      return reply.code(403).send({
        error: err.code,
        message: 'Sua conta não está vinculada a um cadastro de cliente. Fale com o profissional.',
      });
    }
    return handleSchedulingDomainError(err, reply);
  }

  /* ── Perfil e contexto ──────────────────────────────────────────────── */

  fastify.get('/portal/me', guard, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    try {
      const clientId = await currentClientId(request);
      const [[client], [user], settings] = await Promise.all([
        db.select({
          id: clients.id, full_name: clients.full_name, company_name: clients.company_name,
          email: clients.email, phone: clients.phone,
        }).from(clients).where(and(eq(clients.id, clientId), eq(clients.tenant_id, tenantId))),
        db.select({ email: users.email, name: users.name }).from(users)
          .where(eq(users.id, userId)),
        getOrCreateSettings(tenantId),
      ]);
      return {
        client,
        user,
        business: {
          business_name:       settings.business_name,
          business_type:       settings.business_type,
          allow_self_booking:  settings.allow_self_booking,
          min_advance_hours:   settings.min_advance_hours,
          cancel_window_hours: settings.cancel_window_hours,
        },
      };
    } catch (err) { return handlePortalError(err, reply); }
  });

  /* ── Minhas sessões ─────────────────────────────────────────────────── */

  fastify.get('/portal/sessions', guard, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as Record<string, string>;
    try {
      const clientId = await currentClientId(request);
      return await listSessions({
        tenantId,
        clientId, // escopo duro: só as próprias sessões
        status:  q.status,
        from:    q.from,
        to:      q.to,
        page:    Number(q.page) || 1,
        perPage: Number(q.per_page) || 20,
      });
    } catch (err) { return handlePortalError(err, reply); }
  });

  fastify.post('/portal/sessions/:id/cancel', guard, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      const clientId = await currentClientId(request);
      return await cancelOwnPendingSession(id, tenantId, clientId, userId);
    } catch (err) { return handlePortalError(err, reply); }
  });

  /* ── Meus pacotes (read-only, com saldo derivado) ───────────────────── */

  fastify.get('/portal/packages', guard, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as Record<string, string>;
    try {
      const clientId = await currentClientId(request);
      return await listClientPackages({
        tenantId, clientId,
        status:  q.status,
        page:    Number(q.page) || 1,
        perPage: Number(q.per_page) || 50,
      });
    } catch (err) { return handlePortalError(err, reply); }
  });

  /* ── Wizard de solicitação: área → profissional → dia/slot ─────────── */

  // Áreas ofertadas: a do pacote escolhido, ou todas as ativas quando o
  // pacote é "qualquer área" / o agendamento é avulso (decisões nº 4 e 8).
  fastify.get('/portal/areas', guard, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { package_id } = request.query as { package_id?: string };
    try {
      const clientId = await currentClientId(request);
      if (package_id) {
        const pkg = await getPackageOrThrow(package_id, tenantId);
        if (pkg.client_id !== clientId) throw new SchedulingDomainError('package_not_found', { id: package_id });
        if (pkg.area_id) {
          const area = await getAreaOrThrow(pkg.area_id, tenantId);
          return { data: area.is_active ? [area] : [] };
        }
      }
      return { data: await listAreas({ tenantId }) };
    } catch (err) { return handlePortalError(err, reply); }
  });

  fastify.get('/portal/professionals', guard, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { area_id } = request.query as { area_id?: string };
    if (!area_id) return reply.badRequest('area_id é obrigatório');
    try {
      await currentClientId(request);
      const profs = await listProfessionals({ tenantId, areaId: area_id });
      // Sem expor contato/vínculo interno — o aluno escolhe por nome/bio.
      return { data: profs.map(p => ({ id: p.id, name: p.name, bio: p.bio })) };
    } catch (err) { return handlePortalError(err, reply); }
  });

  fastify.get('/portal/slots', guard, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as Record<string, string>;
    if (!q.professional_id || !q.area_id || !q.date) {
      return reply.badRequest('professional_id, area_id e date são obrigatórios');
    }
    try {
      await currentClientId(request);
      const settings = await getOrCreateSettings(tenantId);
      if (!settings.allow_self_booking) throw new SchedulingDomainError('self_booking_disabled');
      const slots = await getAvailableSlots({
        tenantId,
        professionalId:    q.professional_id,
        areaId:            q.area_id,
        date:              q.date,
        enforceMinAdvance: true, // portal SEMPRE respeita a antecedência
      });
      return { data: slots };
    } catch (err) { return handlePortalError(err, reply); }
  });

  fastify.post('/portal/sessions', {
    ...guard,
    schema: {
      body: {
        type: 'object',
        required: ['professional_id', 'area_id', 'date', 'start_time'],
        properties: {
          professional_id: { type: 'string', format: 'uuid' },
          area_id:         { type: 'string', format: 'uuid' },
          package_id:      { type: ['string', 'null'], format: 'uuid' },
          date:            { type: 'string', pattern: DATE_PATTERN },
          start_time:      { type: 'string', pattern: HM_PATTERN },
          notes:           { type: ['string', 'null'], maxLength: 500 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as any;
    try {
      const clientId = await currentClientId(request);
      const session = await requestSessionAsClient({
        tenantId,
        clientId,
        clientUserId:   userId,
        professionalId: b.professional_id,
        areaId:         b.area_id,
        packageId:      b.package_id,
        date:           b.date,
        startTime:      b.start_time,
        notes:          b.notes,
      });
      return reply.code(201).send(session);
    } catch (err) { return handlePortalError(err, reply); }
  });
};
