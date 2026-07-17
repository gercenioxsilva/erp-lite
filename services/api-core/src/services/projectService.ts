// Application Service — Projetos (módulo opcional). Orquestra I/O +
// persistência, chama o domínio (projectDomain.ts) pra qualquer regra de
// negócio. Mesmo padrão de purchaseOrderService.ts/serviceOrderService.ts.

import { and, eq, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { projects, projectProfessionals, orders, serviceOrders } from '../db/schema';
import {
  assertProjectTransition,
  assertProjectEditable,
  validateProjectCreate,
  validateProfessionalAllocation,
  calcProjectReport,
  ProjectDomainError,
  type ProjectStatus,
  type ProfessionalType,
} from '../domain/project/projectDomain';

export type DrizzleDB = typeof _db;
export { ProjectDomainError };

export interface ProjectCreate {
  tenantId:      string;
  createdBy?:    string | null;
  name:          string;
  description?:  string | null;
  totalValue:    number;
  clientId?:     string | null;
  costCenterId?: string | null;
  startDate?:    string | null;
  endDate?:      string | null;
}

export type ProjectUpdate = Omit<ProjectCreate, 'tenantId' | 'createdBy'>;

export async function createProject(args: ProjectCreate, db: DrizzleDB = _db) {
  validateProjectCreate({ name: args.name, total_value: args.totalValue });

  return db.transaction(async (tx) => {
    const { rows: [seq] } = await tx.execute<{ n: string }>(sql`
      SELECT COALESCE(MAX(CASE WHEN number ~ '^[0-9]+$' THEN number::INT END), 0) + 1 AS n
      FROM projects WHERE tenant_id = ${args.tenantId}
    `);
    const number = String(seq.n).padStart(5, '0');

    const [project] = await tx.insert(projects).values({
      tenant_id:      args.tenantId,
      client_id:      args.clientId      || null,
      cost_center_id: args.costCenterId  || null,
      number,
      name:           args.name.trim(),
      description:    args.description   || null,
      total_value:    String(args.totalValue),
      status:         'draft',
      start_date:     args.startDate || null,
      end_date:       args.endDate   || null,
      created_by:     args.createdBy || null,
    }).returning();
    return project;
  });
}

export async function updateProject(
  id: string, tenantId: string, args: ProjectUpdate, db: DrizzleDB = _db,
) {
  validateProjectCreate({ name: args.name, total_value: args.totalValue });

  return db.transaction(async (tx) => {
    const { rows: [existing] } = await tx.execute<{ status: string }>(
      sql`SELECT status FROM projects WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
    if (!existing) throw new ProjectDomainError('project_not_found', { id });
    assertProjectEditable(existing.status as ProjectStatus);

    const [project] = await tx.update(projects).set({
      client_id:      args.clientId      || null,
      cost_center_id: args.costCenterId  || null,
      name:           args.name.trim(),
      description:    args.description   || null,
      total_value:    String(args.totalValue),
      start_date:     args.startDate || null,
      end_date:       args.endDate   || null,
      updated_at:     new Date(),
    }).where(and(eq(projects.id, id), eq(projects.tenant_id, tenantId))).returning();
    return project;
  });
}

export async function transitionProject(
  id: string, tenantId: string, to: ProjectStatus, db: DrizzleDB = _db,
): Promise<void> {
  const { rows: [project] } = await db.execute<{ status: string }>(
    sql`SELECT status FROM projects WHERE id = ${id} AND tenant_id = ${tenantId}`,
  );
  if (!project) throw new ProjectDomainError('project_not_found', { id });

  assertProjectTransition(project.status as ProjectStatus, to);

  await db.execute(sql`
    UPDATE projects SET status = ${to}, updated_at = now() WHERE id = ${id} AND tenant_id = ${tenantId}
  `);
}

export interface ProjectListFilters {
  status?: string;
  search?: string;
  page?:   number;
  perPage?: number;
}

export async function listProjects(tenantId: string, filters: ProjectListFilters, db: DrizzleDB = _db) {
  const limit  = Math.min(filters.perPage || 20, 100);
  const offset = (Math.max(filters.page || 1, 1) - 1) * limit;
  const statusFilter = filters.status ? sql`AND p.status = ${filters.status}` : sql``;
  const searchFilter = filters.search
    ? sql`AND (p.number ILIKE ${'%' + filters.search + '%'} OR p.name ILIKE ${'%' + filters.search + '%'})`
    : sql``;

  const [{ rows }, { rows: [cnt] }] = await Promise.all([
    db.execute<any>(sql`
      SELECT p.id, p.number, p.name, p.total_value, p.status, p.created_at,
             COALESCE(c.company_name, c.full_name) AS client_name,
             COALESCE((SELECT SUM(o.total) FROM orders o WHERE o.project_id = p.id AND o.status != 'cancelled'), 0)
               + COALESCE((SELECT SUM(so.total) FROM service_orders so WHERE so.project_id = p.id AND so.status != 'cancelled'), 0)
               AS consumed_value
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.tenant_id = ${tenantId} ${statusFilter} ${searchFilter}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count FROM projects p
      WHERE p.tenant_id = ${tenantId} ${statusFilter} ${searchFilter}
    `),
  ]);

  return { data: rows, total: Number(cnt.count), page: filters.page || 1, per_page: limit };
}

// Traz o relatório de acompanhamento embutido — mesmo padrão de GET
// /service-orders/:id já dobrar billing/nfse na mesma resposta.
export async function getProject(id: string, tenantId: string, db: DrizzleDB = _db) {
  const { rows: [project] } = await db.execute<any>(sql`
    SELECT p.*, COALESCE(c.company_name, c.full_name) AS client_name
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.id = ${id} AND p.tenant_id = ${tenantId}
  `);
  if (!project) return null;

  const [{ rows: professionals }, { rows: linkedOrders }, { rows: linkedServiceOrders }] = await Promise.all([
    db.execute<any>(sql`
      SELECT pp.id, pp.professional_type, pp.technician_id, pp.seller_id, pp.commission_pct,
             COALESCE(t.name, s.name) AS professional_name
      FROM project_professionals pp
      LEFT JOIN technicians t ON t.id = pp.technician_id
      LEFT JOIN sellers     s ON s.id = pp.seller_id
      WHERE pp.project_id = ${id}
      ORDER BY pp.created_at
    `),
    db.execute<any>(sql`
      SELECT o.id, o.number, o.status, o.total, COALESCE(c.company_name, c.full_name) AS client_name
      FROM orders o
      LEFT JOIN clients c ON c.id = o.client_id
      WHERE o.project_id = ${id}
      ORDER BY o.created_at DESC
    `),
    db.execute<any>(sql`
      SELECT so.id, so.number, so.title, so.status, so.total,
             COALESCE(c.company_name, c.full_name) AS client_name
      FROM service_orders so
      LEFT JOIN clients c ON c.id = so.client_id
      WHERE so.project_id = ${id}
      ORDER BY so.created_at DESC
    `),
  ]);

  const report = await buildProjectReport(id, Number(project.total_value), db);

  return { ...project, professionals, orders: linkedOrders, service_orders: linkedServiceOrders, report };
}

async function buildProjectReport(projectId: string, totalValue: number, db: DrizzleDB) {
  const { rows: [agg] } = await db.execute<{
    orders_total: string; orders_invoiced_total: string;
    service_orders_total: string; service_orders_billed_total: string;
  }>(sql`
    SELECT
      COALESCE((SELECT SUM(o.total) FROM orders o WHERE o.project_id = ${projectId} AND o.status != 'cancelled'), 0) AS orders_total,
      COALESCE((
        SELECT SUM(i.total) FROM invoices i
        WHERE i.order_id IN (SELECT id FROM orders WHERE project_id = ${projectId}) AND i.status != 'cancelled'
      ), 0) AS orders_invoiced_total,
      COALESCE((SELECT SUM(so.total) FROM service_orders so WHERE so.project_id = ${projectId} AND so.status != 'cancelled'), 0) AS service_orders_total,
      COALESCE((
        SELECT SUM(r.amount) FROM receivables r
        WHERE r.service_order_id IN (SELECT id FROM service_orders WHERE project_id = ${projectId})
      ), 0) AS service_orders_billed_total
  `);

  return calcProjectReport({
    total_value:              totalValue,
    ordersTotal:              Number(agg.orders_total),
    ordersInvoicedTotal:      Number(agg.orders_invoiced_total),
    serviceOrdersTotal:       Number(agg.service_orders_total),
    serviceOrdersBilledTotal: Number(agg.service_orders_billed_total),
  });
}

export interface AllocateProfessionalArgs {
  professionalType: ProfessionalType;
  technicianId?:    string | null;
  sellerId?:        string | null;
  commissionPct:    number;
}

export async function allocateProfessional(
  projectId: string, tenantId: string, args: AllocateProfessionalArgs, db: DrizzleDB = _db,
) {
  validateProfessionalAllocation({
    professional_type: args.professionalType,
    technician_id:      args.technicianId,
    seller_id:           args.sellerId,
    commission_pct:      args.commissionPct,
  });

  const { rows: [project] } = await db.execute<{ id: string }>(
    sql`SELECT id FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`,
  );
  if (!project) throw new ProjectDomainError('project_not_found', { id: projectId });

  try {
    const [row] = await db.insert(projectProfessionals).values({
      tenant_id:         tenantId,
      project_id:        projectId,
      professional_type: args.professionalType,
      technician_id:      args.technicianId || null,
      seller_id:           args.sellerId       || null,
      commission_pct:      String(args.commissionPct),
    }).returning();
    return row;
  } catch (err: any) {
    if (String(err?.message || '').includes('uq_project_professionals')) {
      throw new ProjectDomainError('project_professional_already_allocated');
    }
    throw err;
  }
}

export async function removeProfessional(
  projectId: string, tenantId: string, allocationId: string, db: DrizzleDB = _db,
): Promise<void> {
  const { rows } = await db.execute(sql`
    DELETE FROM project_professionals
    WHERE id = ${allocationId} AND project_id = ${projectId} AND tenant_id = ${tenantId}
    RETURNING id
  `);
  if (!rows.length) throw new ProjectDomainError('project_professional_not_found', { id: allocationId });
}

async function assertProjectBelongsToTenant(projectId: string, tenantId: string, db: DrizzleDB) {
  const { rows: [project] } = await db.execute<{ id: string }>(
    sql`SELECT id FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`,
  );
  if (!project) throw new ProjectDomainError('project_not_found', { id: projectId });
}

export async function linkOrder(projectId: string, tenantId: string, orderId: string, db: DrizzleDB = _db) {
  await assertProjectBelongsToTenant(projectId, tenantId, db);
  const [row] = await db.update(orders)
    .set({ project_id: projectId })
    .where(and(eq(orders.id, orderId), eq(orders.tenant_id, tenantId)))
    .returning({ id: orders.id });
  if (!row) throw new ProjectDomainError('order_not_found', { id: orderId });
  return row;
}

export async function unlinkOrder(projectId: string, tenantId: string, orderId: string, db: DrizzleDB = _db) {
  await assertProjectBelongsToTenant(projectId, tenantId, db);
  await db.update(orders)
    .set({ project_id: null })
    .where(and(eq(orders.id, orderId), eq(orders.tenant_id, tenantId), eq(orders.project_id, projectId)));
}

export async function linkServiceOrder(
  projectId: string, tenantId: string, serviceOrderId: string, db: DrizzleDB = _db,
) {
  await assertProjectBelongsToTenant(projectId, tenantId, db);
  const [row] = await db.update(serviceOrders)
    .set({ project_id: projectId })
    .where(and(eq(serviceOrders.id, serviceOrderId), eq(serviceOrders.tenant_id, tenantId)))
    .returning({ id: serviceOrders.id });
  if (!row) throw new ProjectDomainError('service_order_not_found', { id: serviceOrderId });
  return row;
}

export async function unlinkServiceOrder(
  projectId: string, tenantId: string, serviceOrderId: string, db: DrizzleDB = _db,
) {
  await assertProjectBelongsToTenant(projectId, tenantId, db);
  await db.update(serviceOrders)
    .set({ project_id: null })
    .where(and(
      eq(serviceOrders.id, serviceOrderId),
      eq(serviceOrders.tenant_id, tenantId),
      eq(serviceOrders.project_id, projectId),
    ));
}
