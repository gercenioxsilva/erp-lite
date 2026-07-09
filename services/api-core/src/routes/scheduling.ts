// Rotas do módulo de Agendamento — recursos de configuração (settings, áreas,
// profissionais, disponibilidade, modelos e pacotes) + provisionamento de
// logins (profissional e portal do cliente). Sessões/slots/dashboard vivem em
// routes/schedulingSessions.ts; o portal do cliente em routes/schedulingPortal.ts.
//
// Todas as rotas: authenticate + requireModule('scheduling') + requirePermission
// por ação. O recorte "só a própria agenda" do papel professional
// (resolveAgendaScope) é aplicado nas rotas de disponibilidade — quem não tem
// scheduling:manage_all só mexe no próprio cadastro.

import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq, and } from 'drizzle-orm';
import { db, users, clients } from '../db';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { sendSystemNotification } from '../lib/notificationsClient';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';
import { getOrCreateSettings, updateSettings } from '../services/schedulingSettingsService';
import { listAreas, createArea, updateArea, deleteArea } from '../services/schedulingAreaService';
import {
  listProfessionals, getProfessionalOrThrow, getProfessionalByUserId, createProfessional,
  updateProfessional, setProfessionalAreas, provisionProfessionalUser, resolveAgendaScope,
} from '../services/schedulingProfessionalService';
import {
  getAvailability, replaceWeeklyGrid, addException, removeException, getExceptionProfessionalId,
} from '../services/schedulingAvailabilityService';
import {
  listTemplates, createTemplate, updateTemplate, deactivateTemplate,
  grantPackage, listClientPackages, getPackageOrThrow, updatePackageNotes,
  setPaymentStatus, cancelPackage, listMovements,
} from '../services/schedulingPackageService';
import { remainingSessions } from '../domain/scheduling/packageDomain';

const HM_PATTERN = '^([01][0-9]|2[0-3]):[0-5][0-9]$';
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

export function handleSchedulingDomainError(err: unknown, reply: any) {
  if (err instanceof SchedulingDomainError) {
    if (err.code.endsWith('_not_found')) return reply.notFound(err.code);
    if (err.code === 'area_in_use' || err.code === 'email_already_in_use' ||
        err.code === 'professional_already_has_user') {
      return reply.code(409).send({ error: err.code, ...err.payload });
    }
    if (err.code === 'not_own_agenda') {
      return reply.code(403).send({ error: err.code, message: 'Você só pode operar a própria agenda.' });
    }
    return reply.code(422).send({ error: err.code, ...err.payload });
  }
  throw err;
}

export const schedulingRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const auth = { onRequest: [authenticate], preHandler: [requireModule('scheduling')] };
  const guarded = (permission: string) => ({
    ...auth, preHandler: [...auth.preHandler, requirePermission(permission)],
  });

  /** Recorte de agenda: lança not_own_agenda quando o ator (sem manage_all)
   *  tenta operar um profissional que não é o seu. */
  async function assertAgendaScope(request: any, professionalId: string) {
    const { tenantId, userId, role } = request.user;
    const scope = await resolveAgendaScope(tenantId, userId, role);
    if (scope !== null && scope !== professionalId) {
      throw new SchedulingDomainError('not_own_agenda');
    }
  }

  /* ── Configurações ──────────────────────────────────────────────────── */

  fastify.get('/scheduling/settings', guarded('scheduling:view'), async (request) => {
    const { tenantId } = (request as any).user;
    return getOrCreateSettings(tenantId);
  });

  fastify.patch('/scheduling/settings', {
    ...guarded('scheduling:settings'),
    schema: {
      body: {
        type: 'object',
        properties: {
          business_name:       { type: ['string', 'null'], maxLength: 255 },
          business_type:       { type: ['string', 'null'], maxLength: 120 },
          allow_self_booking:  { type: 'boolean' },
          min_advance_hours:   { type: 'integer', minimum: 0, maximum: 720 },
          cancel_window_hours: { type: 'integer', minimum: 0, maximum: 720 },
          timezone:            { type: 'string', maxLength: 64 },
          onboarding_complete: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const b = request.body as any;
    try {
      return await updateSettings(tenantId, {
        businessName:       b.business_name,
        businessType:       b.business_type,
        allowSelfBooking:   b.allow_self_booking,
        minAdvanceHours:    b.min_advance_hours,
        cancelWindowHours:  b.cancel_window_hours,
        timezone:           b.timezone,
        onboardingComplete: b.onboarding_complete,
      });
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  /* ── Áreas de atuação ───────────────────────────────────────────────── */

  fastify.get('/scheduling/areas', guarded('scheduling_areas:view'), async (request) => {
    const { tenantId } = (request as any).user;
    const { include_inactive } = request.query as { include_inactive?: string };
    return { data: await listAreas({ tenantId, includeInactive: include_inactive === 'true' }) };
  });

  fastify.post('/scheduling/areas', {
    ...guarded('scheduling_areas:create'),
    schema: {
      body: {
        type: 'object',
        required: ['name', 'default_duration_minutes'],
        properties: {
          name:                     { type: 'string', minLength: 1, maxLength: 120 },
          description:              { type: ['string', 'null'] },
          default_duration_minutes: { type: 'integer', minimum: 1, maximum: 1439 },
          default_price:            { type: 'number', minimum: 0 },
          rules_text:               { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as any;
    try {
      const area = await createArea({
        tenantId, name: b.name, description: b.description,
        defaultDurationMinutes: b.default_duration_minutes,
        defaultPrice: b.default_price, rulesText: b.rules_text, createdBy: userId,
      });
      return reply.code(201).send(area);
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.patch('/scheduling/areas/:id', {
    ...guarded('scheduling_areas:edit'),
    schema: {
      body: {
        type: 'object',
        properties: {
          name:                     { type: 'string', minLength: 1, maxLength: 120 },
          description:              { type: ['string', 'null'] },
          default_duration_minutes: { type: 'integer', minimum: 1, maximum: 1439 },
          default_price:            { type: 'number', minimum: 0 },
          rules_text:               { type: ['string', 'null'] },
          is_active:                { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const b = request.body as any;
    try {
      return await updateArea(id, tenantId, {
        name: b.name, description: b.description,
        defaultDurationMinutes: b.default_duration_minutes,
        defaultPrice: b.default_price, rulesText: b.rules_text, isActive: b.is_active,
      });
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.delete('/scheduling/areas/:id', guarded('scheduling_areas:delete'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      await deleteArea(id, tenantId);
      return reply.code(204).send();
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  /* ── Profissionais ──────────────────────────────────────────────────── */

  fastify.get('/scheduling/professionals', guarded('scheduling_professionals:view'), async (request) => {
    const { tenantId } = (request as any).user;
    const { area_id, include_inactive } = request.query as { area_id?: string; include_inactive?: string };
    return { data: await listProfessionals({ tenantId, areaId: area_id, includeInactive: include_inactive === 'true' }) };
  });

  // Perfil do profissional logado (papel 'professional') — 404 sem vínculo.
  fastify.get('/scheduling/professionals/me', guarded('scheduling:view'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const prof = await getProfessionalByUserId(userId, tenantId);
    if (!prof) return reply.notFound('professional_not_found');
    return prof;
  });

  fastify.post('/scheduling/professionals', {
    ...guarded('scheduling_professionals:create'),
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:     { type: 'string', minLength: 1, maxLength: 255 },
          email:    { type: ['string', 'null'], maxLength: 255 },
          phone:    { type: ['string', 'null'], maxLength: 20 },
          bio:      { type: ['string', 'null'] },
          area_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 100 },
          // true = vincula ao próprio usuário logado (dono se cadastrando no onboarding solo)
          link_self: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as any;
    try {
      const prof = await createProfessional({
        tenantId, name: b.name, email: b.email, phone: b.phone, bio: b.bio,
        areaIds: b.area_ids, userId: b.link_self ? userId : null, createdBy: userId,
      });
      return reply.code(201).send(prof);
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.patch('/scheduling/professionals/:id', {
    ...guarded('scheduling_professionals:edit'),
    schema: {
      body: {
        type: 'object',
        properties: {
          name:      { type: 'string', minLength: 1, maxLength: 255 },
          email:     { type: ['string', 'null'], maxLength: 255 },
          phone:     { type: ['string', 'null'], maxLength: 20 },
          bio:       { type: ['string', 'null'] },
          is_active: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const b = request.body as any;
    try {
      return await updateProfessional(id, tenantId, {
        name: b.name, email: b.email, phone: b.phone, bio: b.bio, isActive: b.is_active,
      });
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.put('/scheduling/professionals/:id/areas', {
    ...guarded('scheduling_professionals:edit'),
    schema: {
      body: {
        type: 'object',
        required: ['area_ids'],
        properties: {
          area_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 100 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const { area_ids } = request.body as { area_ids: string[] };
    try {
      return { area_ids: await setProfessionalAreas(id, tenantId, area_ids) };
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  // Login do profissional: papel 'professional' hard-coded no service — por
  // isso o guard é users:create (quem pode criar usuários pode provisionar).
  fastify.post('/scheduling/professionals/:id/user', {
    ...guarded('users:create'),
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const { email, password } = request.body as { email: string; password: string };
    try {
      const user = await provisionProfessionalUser({ professionalId: id, tenantId, email, password });
      return reply.code(201).send(user);
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  /* ── Disponibilidade (com recorte de agenda) ────────────────────────── */

  fastify.get('/scheduling/professionals/:id/availability', guarded('scheduling:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      return await getAvailability(id, tenantId);
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.put('/scheduling/professionals/:id/availability/weekly', {
    ...guarded('scheduling:manage'),
    schema: {
      body: {
        type: 'object',
        required: ['rules'],
        properties: {
          rules: {
            type: 'array',
            maxItems: 50,
            items: {
              type: 'object',
              required: ['weekday', 'start_time', 'end_time'],
              properties: {
                weekday:    { type: 'integer', minimum: 0, maximum: 6 },
                start_time: { type: 'string', pattern: HM_PATTERN },
                end_time:   { type: 'string', pattern: HM_PATTERN },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const { rules } = request.body as { rules: Array<{ weekday: number; start_time: string; end_time: string }> };
    try {
      await assertAgendaScope(request, id);
      const saved = await replaceWeeklyGrid(id, tenantId,
        rules.map(r => ({ weekday: r.weekday, startTime: r.start_time, endTime: r.end_time })));
      return { data: saved };
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.post('/scheduling/professionals/:id/availability/exceptions', {
    ...guarded('scheduling:manage'),
    schema: {
      body: {
        type: 'object',
        required: ['date', 'kind'],
        properties: {
          date:       { type: 'string', pattern: DATE_PATTERN },
          kind:       { type: 'string', enum: ['block', 'open'] },
          start_time: { type: ['string', 'null'], pattern: HM_PATTERN },
          end_time:   { type: ['string', 'null'], pattern: HM_PATTERN },
          note:       { type: ['string', 'null'], maxLength: 255 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const b = request.body as any;
    try {
      await assertAgendaScope(request, id);
      const row = await addException({
        professionalId: id, tenantId, date: b.date, kind: b.kind,
        startTime: b.start_time, endTime: b.end_time, note: b.note,
      });
      return reply.code(201).send(row);
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.delete('/scheduling/availability/exceptions/:id', guarded('scheduling:manage'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      const professionalId = await getExceptionProfessionalId(id, tenantId);
      await assertAgendaScope(request, professionalId);
      await removeException(id, tenantId);
      return reply.code(204).send();
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  /* ── Modelos de pacote ──────────────────────────────────────────────── */

  fastify.get('/scheduling/package-templates', guarded('scheduling_packages:view'), async (request) => {
    const { tenantId } = (request as any).user;
    const { include_inactive } = request.query as { include_inactive?: string };
    return { data: await listTemplates(tenantId, include_inactive === 'true') };
  });

  const templateBodySchema = {
    type: 'object',
    properties: {
      name:          { type: 'string', minLength: 1, maxLength: 120 },
      area_id:       { type: ['string', 'null'], format: 'uuid' },
      session_count: { type: 'integer', minimum: 1, maximum: 1000 },
      price:         { type: 'number', minimum: 0 },
      validity_days: { type: ['integer', 'null'], minimum: 1, maximum: 3650 },
      is_active:     { type: 'boolean' },
    },
    additionalProperties: false,
  };

  fastify.post('/scheduling/package-templates', {
    ...guarded('scheduling_packages:manage'),
    schema: { body: { ...templateBodySchema, required: ['name', 'session_count'] } },
  }, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as any;
    try {
      const tpl = await createTemplate(tenantId, {
        name: b.name, areaId: b.area_id, sessionCount: b.session_count,
        price: b.price, validityDays: b.validity_days,
      }, userId);
      return reply.code(201).send(tpl);
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.patch('/scheduling/package-templates/:id', {
    ...guarded('scheduling_packages:manage'),
    schema: { body: templateBodySchema },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const b = request.body as any;
    try {
      return await updateTemplate(id, tenantId, {
        name: b.name, areaId: b.area_id, sessionCount: b.session_count,
        price: b.price, validityDays: b.validity_days, isActive: b.is_active,
      });
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.delete('/scheduling/package-templates/:id', guarded('scheduling_packages:manage'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      await deactivateTemplate(id, tenantId); // soft — concessões mantêm snapshot
      return reply.code(204).send();
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  /* ── Pacotes do cliente ─────────────────────────────────────────────── */

  fastify.get('/scheduling/client-packages', guarded('scheduling_packages:view'), async (request) => {
    const { tenantId } = (request as any).user;
    const q = request.query as Record<string, string>;
    return listClientPackages({
      tenantId,
      clientId: q.client_id,
      status:   q.status,
      page:     Number(q.page) || 1,
      perPage:  Number(q.per_page) || 20,
    });
  });

  fastify.post('/scheduling/client-packages', {
    ...guarded('scheduling_packages:grant'),
    schema: {
      body: {
        type: 'object',
        required: ['client_id'],
        properties: {
          client_id:        { type: 'string', format: 'uuid' },
          template_id:      { type: ['string', 'null'], format: 'uuid' },
          name:             { type: 'string', minLength: 1, maxLength: 120 },
          area_id:          { type: ['string', 'null'], format: 'uuid' },
          total_sessions:   { type: 'integer', minimum: 1, maximum: 1000 },
          price:            { type: 'number', minimum: 0 },
          validity_days:    { type: ['integer', 'null'], minimum: 1, maximum: 3650 },
          payment_status:   { type: 'string', enum: ['pending', 'partial', 'paid'] },
          notes:            { type: ['string', 'null'] },
          save_as_template: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as any;
    try {
      const pkg = await grantPackage({
        tenantId, clientId: b.client_id, templateId: b.template_id,
        name: b.name, areaId: b.area_id, totalSessions: b.total_sessions,
        price: b.price, validityDays: b.validity_days,
        paymentStatus: b.payment_status, notes: b.notes,
        saveAsTemplate: b.save_as_template, createdBy: userId,
      });
      return reply.code(201).send(pkg);
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.get('/scheduling/client-packages/:id', guarded('scheduling_packages:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      const pkg = await getPackageOrThrow(id, tenantId);
      return {
        ...pkg,
        remaining_sessions: remainingSessions({ totalSessions: pkg.total_sessions, usedSessions: pkg.used_sessions }),
      };
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.patch('/scheduling/client-packages/:id', {
    ...guarded('scheduling_packages:manage'),
    schema: {
      body: {
        type: 'object',
        properties: { notes: { type: ['string', 'null'] } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const { notes } = request.body as { notes: string | null };
    try {
      return await updatePackageNotes(id, tenantId, notes ?? null);
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.post('/scheduling/client-packages/:id/payment-status', {
    ...guarded('scheduling_packages:payment'),
    schema: {
      body: {
        type: 'object',
        required: ['payment_status'],
        properties: { payment_status: { type: 'string', enum: ['pending', 'partial', 'paid'] } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const { payment_status } = request.body as { payment_status: 'pending' | 'partial' | 'paid' };
    try {
      return await setPaymentStatus(id, tenantId, payment_status);
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.post('/scheduling/client-packages/:id/cancel', guarded('scheduling_packages:manage'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      return await cancelPackage(id, tenantId);
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  fastify.get('/scheduling/client-packages/:id/movements', guarded('scheduling_packages:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      return { data: await listMovements(id, tenantId) };
    } catch (err) { return handleSchedulingDomainError(err, reply); }
  });

  /* ── Acesso do cliente ao portal ────────────────────────────────────── */
  // Papel 'client' hard-coded + client_id do path — por isso clients:edit
  // basta como guard (profissional provisiona sem precisar de users:create).
  // Vive aqui (não em clients.ts) para não tocar o módulo core de clientes.

  fastify.post('/clients/:id/portal-user', {
    ...guarded('clients:edit'),
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          name:     { type: 'string', maxLength: 255 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const { email, password, name } = request.body as { email: string; password: string; name?: string };

    const [client] = await db.select({
      id: clients.id, company_name: clients.company_name, full_name: clients.full_name,
    }).from(clients).where(and(eq(clients.id, id), eq(clients.tenant_id, tenantId)));
    if (!client) return reply.notFound('client_not_found');

    const displayName = name?.trim() || client.company_name || client.full_name || email.split('@')[0];
    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const [user] = await db.insert(users).values({
        tenant_id:     tenantId,
        email,
        name:          displayName,
        password_hash: passwordHash,
        role:          'client',
        client_id:     id,
        status:        'active',
      }).returning({ id: users.id, email: users.email, name: users.name, role: users.role });

      sendSystemNotification({
        tenant_id: tenantId,
        type:      'user_welcome',
        recipient: { email, name: displayName },
        data: {
          name:      displayName,
          email,
          password,
          login_url: process.env.APP_URL ?? 'https://orquestraerp.com.br',
        },
      }).catch(() => { /* falha de e-mail não pode derrubar a criação */ });

      return reply.code(201).send(user);
    } catch (err: any) {
      if (err.code === '23505') return reply.conflict('E-mail já cadastrado neste tenant');
      throw err;
    }
  });
};
