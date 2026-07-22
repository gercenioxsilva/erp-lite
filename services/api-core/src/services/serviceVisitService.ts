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
  visitTimeRange,
  findVisitConflict,
  DEFAULT_VISIT_DURATION_MINUTES,
  ServiceVisitDomainError,
  type ServiceVisitStatus,
  type VisitTimeRange,
} from '../domain/serviceVisit/serviceVisitDomain';
import { canCompleteServiceOrder } from '../domain/serviceOrder/serviceOrderDomain';
import { sendSystemNotification } from '../lib/notificationsClient';
import {
  listVisitFieldDefinitions, getFieldValuesForVisit, setFieldValuesForVisit,
  type VisitFieldValueInput,
} from './serviceVisitFieldService';

export type DrizzleDB = typeof _db;
export { ServiceVisitDomainError };

const ROUTING_TOKEN_VALID_DAYS = 7;

function generateRoutingToken(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

/**
 * Monta o link de ROTEAMENTO enviado ao técnico por e-mail (`service_visit_assigned`)
 * e também exibido no backoffice para reenvio manual (ex.: WhatsApp) — mesmo link,
 * uma única função, para nunca divergir entre os dois pontos de uso. O link em si
 * nunca concede acesso (regra 38): exige login do técnico + technician_id da visita
 * batendo com o técnico logado.
 */
export function buildVisitLink(visitId: string, routingToken: string): string {
  const appUrl = process.env.APP_URL || 'https://orquestraerp.com.br';
  return `${appUrl}/tecnico/entrar?redirect=/tecnico/visitas/${visitId}&rt=${routingToken}`;
}

// ── Agendamento (lado do backoffice) ─────────────────────────────────────────
//
// CONCORRÊNCIA (agenda do técnico, regra 78): a checagem de conflito de
// horário é atômica com a gravação, mesmo desenho de createSession em
// schedulingSessionService.ts — pg_advisory_xact_lock com chave
// (`service_visit:${technicianId}`) dentro da transação serializa dois
// agendamentos concorrentes do mesmo técnico; o segundo enxerga o primeiro e
// falha com 'visit_conflict'. Seed do hash (43) é diferente da usada pelo
// Agendamento (42, mesmo arquivo de referência) só para nunca colidir no
// mesmo espaço de chaves de advisory lock por coincidência de hash.
// SELECT ... FOR UPDATE não serve aqui pelo mesmo motivo do Agendamento:
// numa agenda vazia não há linha para travar (phantom read).
//
// Diferente do Agendamento, NÃO há um `EXCLUDE USING gist` físico como
// backstop (migration 0087 explica o porquê: service_visits já é uma tabela
// existente com dado real possível, e validar essa constraint contra
// histórico já gravado arriscaria falhar o deploy — risco que este projeto
// nunca aceita numa migration). `scheduleVisit()` é o único ponto de escrita
// de agendamento de `service_visits` — o advisory lock é suficiente aqui.

interface VisitBlocker {
  id:           string;
  technicianId: string;
  range:        VisitTimeRange;
  status:       ServiceVisitStatus;
}

async function lockTechnicianAgenda(tx: DrizzleDB, technicianId: string): Promise<void> {
  const key = `service_visit:${technicianId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 43))`);
}

/** Visitas que seguram horário (scheduled/in_progress) do técnico. */
async function loadTechnicianBlockers(tx: DrizzleDB, tenantId: string, technicianId: string): Promise<VisitBlocker[]> {
  const rows = await tx.select({
    id:               serviceVisits.id,
    scheduled_at:     serviceVisits.scheduled_at,
    duration_minutes: serviceVisits.duration_minutes,
    status:           serviceVisits.status,
  }).from(serviceVisits)
    .where(and(
      eq(serviceVisits.tenant_id, tenantId),
      eq(serviceVisits.technician_id, technicianId),
      sql`${serviceVisits.status} IN ('scheduled', 'in_progress')`,
    ));

  return rows.map(r => ({
    id:           r.id,
    technicianId,
    range:        visitTimeRange(new Date(r.scheduled_at), r.duration_minutes),
    status:       r.status as ServiceVisitStatus,
  }));
}

/** Erro citando o horário conflitante — vira a mensagem da UI. */
function throwVisitConflict(hit: VisitBlocker, technicianName: string): never {
  throw new ServiceVisitDomainError('visit_conflict', {
    conflicting: {
      visit_id:         hit.id,
      technician_name:  technicianName,
      scheduled_at:     hit.range.start.toISOString(),
      ends_at:          hit.range.end.toISOString(),
      status:           hit.status,
    },
  });
}

export interface ScheduleVisitArgs {
  tenantId:         string;
  serviceOrderId:   string;
  technicianId:     string;
  scheduledAt:      Date;
  durationMinutes?: number;
}

export async function scheduleVisit(args: ScheduleVisitArgs, db: DrizzleDB = _db) {
  validateServiceVisitCreate({ scheduledAt: args.scheduledAt });
  const durationMinutes = args.durationMinutes ?? DEFAULT_VISIT_DURATION_MINUTES;

  const [order] = await db.select().from(serviceOrders)
    .where(and(eq(serviceOrders.id, args.serviceOrderId), eq(serviceOrders.tenant_id, args.tenantId)));
  if (!order) throw new ServiceVisitDomainError('service_order_not_found');

  const [technician] = await db.select().from(technicians)
    .where(and(eq(technicians.id, args.technicianId), eq(technicians.tenant_id, args.tenantId), eq(technicians.is_active, true)));
  if (!technician) throw new ServiceVisitDomainError('technician_not_found_or_inactive');

  const routingToken = generateRoutingToken();
  const tokenExpiresAt = new Date(args.scheduledAt.getTime() + ROUTING_TOKEN_VALID_DAYS * 24 * 60 * 60 * 1000);
  const candidateRange = visitTimeRange(args.scheduledAt, durationMinutes);

  const visit = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DrizzleDB;
    await lockTechnicianAgenda(txDb, args.technicianId);

    const blockers = await loadTechnicianBlockers(txDb, args.tenantId, args.technicianId);
    const hit = findVisitConflict({ technicianId: args.technicianId, range: candidateRange }, blockers);
    if (hit) throwVisitConflict(hit, technician.name);

    const [v] = await txDb.insert(serviceVisits).values({
      tenant_id:         args.tenantId,
      service_order_id:  args.serviceOrderId,
      technician_id:     args.technicianId,
      scheduled_at:       args.scheduledAt,
      duration_minutes:   durationMinutes,
      status:              'scheduled',
      routing_token:       routingToken,
      token_expires_at:    tokenExpiresAt,
    }).returning();
    return v;
  });

  // draft → scheduled na OS, se ainda não estava agendada/em andamento
  if (order.status === 'draft') {
    await db.update(serviceOrders).set({ status: 'scheduled' }).where(eq(serviceOrders.id, order.id));
  }

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
      visit_link: buildVisitLink(visit.id, routingToken),
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

  // Campos personalizados de visita (regra a documentar): o portal precisa
  // da lista COMPLETA de definições ativas (pra renderizar o formulário,
  // mesmo campo sem resposta ainda) cruzada com os valores já salvos (se o
  // técnico está reabrindo a visita depois de já ter respondido algo).
  const [fieldDefinitions, fieldValues] = await Promise.all([
    listVisitFieldDefinitions(tenantId, db),
    getFieldValuesForVisit(visitId, tenantId, db),
  ]);

  return { visit, order, client, fieldDefinitions, fieldValues };
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
  customFields?:     VisitFieldValueInput[];
}

export async function completeVisit(args: CompleteVisitArgs, db: DrizzleDB = _db) {
  const { visit } = await assertTechnicianOwnsVisit(args.visitId, args.technicianUserId, args.tenantId, db);

  if (!canComplete(visit.status as ServiceVisitStatus, !!visit.checked_in_at)) {
    throw new ServiceVisitDomainError('visit_cannot_complete', { status: visit.status });
  }
  assertServiceVisitTransition(visit.status as ServiceVisitStatus, 'completed');

  // Campos personalizados são validados/salvos ANTES de tocar o status —
  // um campo obrigatório sem resposta lança CustomFieldDomainError
  // ('field_value_required') e a visita nunca chega a ficar "completed" sem
  // as respostas exigidas pelo tenant.
  if (args.customFields?.length) {
    await setFieldValuesForVisit(args.visitId, args.tenantId, args.customFields, db);
  }

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
