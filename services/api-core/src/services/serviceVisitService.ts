// Application Service — Visita Técnica.
//
// Modelo de autorização (ver README): o routing_token da URL só decide QUAL
// visita mostrar depois do login — nunca concede acesso por si só. Toda ação
// aqui exige technicianUserId (extraído do JWT autenticado pela rota) E
// confere que technician_id da visita bate com o técnico logado. Isso é
// verificado nesta camada, não deixado para o domínio puro (que não tem
// acesso a dados) nem para a rota (que não deveria conter regra de negócio).

import crypto from 'crypto';
import { eq, and, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { serviceVisits, serviceOrders, technicians, clients } from '../db/schema';
import {
  assertServiceVisitTransition,
  canCheckIn,
  canComplete,
  isRoutingTokenValid,
  validateServiceVisitCreate,
  ServiceVisitDomainError,
  type ServiceVisitStatus,
} from '../domain/serviceVisit/serviceVisitDomain';
import { canCompleteServiceOrder } from '../domain/serviceOrder/serviceOrderDomain';
import { sendSystemNotification } from '../lib/notificationsClient';

export type DrizzleDB = typeof _db;
export { ServiceVisitDomainError };

const ROUTING_TOKEN_VALID_DAYS = 7;

function generateRoutingToken(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

// ── Agendamento (lado do backoffice) ─────────────────────────────────────────

export interface ScheduleVisitArgs {
  tenantId:       string;
  serviceOrderId: string;
  technicianId:   string;
  scheduledAt:    Date;
}

export async function scheduleVisit(args: ScheduleVisitArgs, db: DrizzleDB = _db) {
  validateServiceVisitCreate({ scheduledAt: args.scheduledAt });

  const [order] = await db.select().from(serviceOrders)
    .where(and(eq(serviceOrders.id, args.serviceOrderId), eq(serviceOrders.tenant_id, args.tenantId)));
  if (!order) throw new ServiceVisitDomainError('service_order_not_found');

  const [technician] = await db.select().from(technicians)
    .where(and(eq(technicians.id, args.technicianId), eq(technicians.tenant_id, args.tenantId), eq(technicians.is_active, true)));
  if (!technician) throw new ServiceVisitDomainError('technician_not_found_or_inactive');

  const routingToken = generateRoutingToken();
  const tokenExpiresAt = new Date(args.scheduledAt.getTime() + ROUTING_TOKEN_VALID_DAYS * 24 * 60 * 60 * 1000);

  const [visit] = await db.insert(serviceVisits).values({
    tenant_id:        args.tenantId,
    service_order_id: args.serviceOrderId,
    technician_id:    args.technicianId,
    scheduled_at:      args.scheduledAt,
    status:             'scheduled',
    routing_token:      routingToken,
    token_expires_at:   tokenExpiresAt,
  }).returning();

  // draft → scheduled na OS, se ainda não estava agendada/em andamento
  if (order.status === 'draft') {
    await db.update(serviceOrders).set({ status: 'scheduled' }).where(eq(serviceOrders.id, order.id));
  }

  const appUrl = process.env.APP_URL || 'https://orquestraerp.com.br';
  sendSystemNotification({
    tenant_id: args.tenantId,
    type:      'service_visit_assigned',
    recipient: { email: technician.email, name: technician.name },
    data: {
      technician_name:   technician.name,
      order_title:        order.title,
      scheduled_at:        args.scheduledAt.toISOString(),
      // Link de ROTEAMENTO — exige login (role='technician') para ver qualquer
      // dado; routing_token só decide para qual visita navegar após autenticar.
      visit_link: `${appUrl}/tecnico/entrar?redirect=/tecnico/visitas/${visit.id}&rt=${routingToken}`,
    },
  }).catch(() => { /* falha de e-mail nunca derruba o agendamento */ });

  return visit;
}

// ── Autorização — técnico logado só enxerga as próprias visitas ─────────────

async function assertTechnicianOwnsVisit(visitId: string, technicianUserId: string, tenantId: string, db: DrizzleDB) {
  const [technician] = await db.select().from(technicians)
    .where(and(eq(technicians.user_id, technicianUserId), eq(technicians.tenant_id, tenantId)));
  if (!technician) throw new ServiceVisitDomainError('visit_not_found'); // vago de propósito — evita enumeração

  const [visit] = await db.select().from(serviceVisits)
    .where(and(eq(serviceVisits.id, visitId), eq(serviceVisits.tenant_id, tenantId)));
  if (!visit || visit.technician_id !== technician.id) throw new ServiceVisitDomainError('visit_not_found');

  return { visit, technician };
}

export async function getVisitForTechnician(visitId: string, technicianUserId: string, tenantId: string, db: DrizzleDB = _db) {
  const { visit } = await assertTechnicianOwnsVisit(visitId, technicianUserId, tenantId, db);

  const [order] = await db.select().from(serviceOrders).where(eq(serviceOrders.id, visit.service_order_id));
  const client = order?.client_id
    ? (await db.select().from(clients).where(eq(clients.id, order.client_id)))[0]
    : null;

  return { visit, order, client };
}

export async function listVisitsForTechnician(technicianUserId: string, tenantId: string, db: DrizzleDB = _db) {
  const [technician] = await db.select().from(technicians)
    .where(and(eq(technicians.user_id, technicianUserId), eq(technicians.tenant_id, tenantId)));
  if (!technician) return [];

  return db.select({
    id: serviceVisits.id, status: serviceVisits.status, scheduled_at: serviceVisits.scheduled_at,
    service_order_id: serviceVisits.service_order_id,
    order_title: serviceOrders.title, order_number: serviceOrders.number,
  }).from(serviceVisits)
    .innerJoin(serviceOrders, eq(serviceOrders.id, serviceVisits.service_order_id))
    .where(and(eq(serviceVisits.technician_id, technician.id), eq(serviceVisits.tenant_id, tenantId)))
    .orderBy(sql`${serviceVisits.scheduled_at} DESC`);
}

// ── Check-in ──────────────────────────────────────────────────────────────────

export async function checkInVisit(visitId: string, technicianUserId: string, tenantId: string, db: DrizzleDB = _db) {
  const { visit, technician } = await assertTechnicianOwnsVisit(visitId, technicianUserId, tenantId, db);

  if (!isRoutingTokenValid(visit.token_expires_at, visit.status as ServiceVisitStatus)) {
    throw new ServiceVisitDomainError('visit_link_expired');
  }
  if (!canCheckIn(visit.status as ServiceVisitStatus)) {
    throw new ServiceVisitDomainError('visit_cannot_check_in', { status: visit.status });
  }
  assertServiceVisitTransition(visit.status as ServiceVisitStatus, 'in_progress');

  await db.update(serviceVisits).set({
    status:           'in_progress',
    checked_in_at:    sql`now()`,
    technician_name:  technician.name,   // snapshot — íntegro mesmo se o cadastro mudar depois
    technician_cpf:   technician.cpf,
  }).where(eq(serviceVisits.id, visitId));

  const [order] = await db.select().from(serviceOrders).where(eq(serviceOrders.id, visit.service_order_id));
  if (order && order.status === 'scheduled') {
    await db.update(serviceOrders).set({ status: 'in_progress' }).where(eq(serviceOrders.id, order.id));
  }
}

// ── Finalização ───────────────────────────────────────────────────────────────

export interface CompleteVisitArgs {
  visitId:           string;
  technicianUserId:  string;
  tenantId:          string;
  reportNotes?:      string | null;
}

export async function completeVisit(args: CompleteVisitArgs, db: DrizzleDB = _db) {
  const { visit } = await assertTechnicianOwnsVisit(args.visitId, args.technicianUserId, args.tenantId, db);

  if (!canComplete(visit.status as ServiceVisitStatus, !!visit.checked_in_at)) {
    throw new ServiceVisitDomainError('visit_cannot_complete', { status: visit.status });
  }
  assertServiceVisitTransition(visit.status as ServiceVisitStatus, 'completed');

  await db.update(serviceVisits).set({
    status:          'completed',
    checked_out_at:  sql`now()`,
    report_notes:    args.reportNotes ?? null,
  }).where(eq(serviceVisits.id, args.visitId));

  // Fecha a OS automaticamente quando todas as visitas estiverem terminais.
  const siblingVisits = await db.select({ status: serviceVisits.status }).from(serviceVisits)
    .where(eq(serviceVisits.service_order_id, visit.service_order_id));
  const statuses = siblingVisits.map(v => (v.status === visit.status ? 'completed' : v.status));

  if (canCompleteServiceOrder(statuses)) {
    await db.update(serviceOrders).set({ status: 'completed' })
      .where(and(eq(serviceOrders.id, visit.service_order_id), eq(serviceOrders.status, 'in_progress')));
  }
}

// Exportado para os handlers de foto/assinatura reaproveitarem a mesma
// checagem de posse sem duplicar a query.
export { assertTechnicianOwnsVisit };
