import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import {
  createPurchaseOrder,
  updatePurchaseOrder,
  transitionPurchaseOrder,
  PurchaseOrderDomainError,
} from '../services/purchaseOrderService';
import { requirePermission } from '../lib/requirePermission';

export const purchaseOrdersRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/purchase-orders ──────────────────────────────────────────────── */
  fastify.get('/purchase-orders', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('purchase_orders:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { status, search, supplier_id, page = '1', per_page = '20' } =
      request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const statusFilter   = status      ? sql`AND po.status = ${status}` : sql``;
    const supplierFilter = supplier_id ? sql`AND po.supplier_id = ${supplier_id}::uuid` : sql``;
    const searchFilter   = search
      ? sql`AND (po.number ILIKE ${'%' + search + '%'} OR COALESCE(po.supplier_name, '') ILIKE ${'%' + search + '%'})`
      : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT po.id, po.number, po.status, po.supplier_id, po.supplier_name,
               po.subtotal, po.total, po.expected_date, po.cost_center_id, po.approved_at,
               po.created_at, s.company_name AS supplier_company_name
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.tenant_id = ${tenantId}
          ${statusFilter} ${supplierFilter} ${searchFilter}
        ORDER BY po.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM purchase_orders po
        WHERE po.tenant_id = ${tenantId}
          ${statusFilter} ${supplierFilter} ${searchFilter}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── POST /v1/purchase-orders ─────────────────────────────────────────────── */
  fastify.post('/purchase-orders', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('purchase_orders:create')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const b = request.body as any;

    if (!b.items?.length) return reply.badRequest('Ao menos um item é obrigatório');

    try {
      const po = await createPurchaseOrder({ ...b, tenantId, createdBy: userId }, db);
      return reply.code(201).send(po);
    } catch (err) {
      if (err instanceof PurchaseOrderDomainError) return reply.code(422).send({ error: err.code });
      throw err;
    }
  });

  /* ── GET /v1/purchase-orders/:id ──────────────────────────────────────────── */
  fastify.get('/purchase-orders/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('purchase_orders:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const [{ rows: [po] }, { rows: items }] = await Promise.all([
      db.execute<any>(sql`
        SELECT po.*, s.company_name AS supplier_company_name,
               creator.name AS created_by_name, approver.name AS approved_by_name
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        LEFT JOIN users creator  ON creator.id  = po.created_by
        LEFT JOIN users approver ON approver.id = po.approved_by
        WHERE po.id = ${id} AND po.tenant_id = ${tenantId}
      `),
      db.execute<any>(sql`
        SELECT poi.*, m.name AS material_name, m.sku AS material_sku
        FROM purchase_order_items poi
        LEFT JOIN materials m ON m.id = poi.material_id
        WHERE poi.purchase_order_id = ${id}
        ORDER BY poi.created_at
      `),
    ]);

    if (!po) return reply.notFound('Pedido de compra não encontrado');
    return { ...po, items };
  });

  /* ── PATCH /v1/purchase-orders/:id ───────────────────────────────────────── */
  // Reaproveita o mesmo padrão de updateSupplierInvoice(): substitui
  // header + itens por completo (delete + reinsert), só permitido em
  // 'draft'. Antes desta versão, o PATCH montava UPDATE via sql.raw() com
  // interpolação direta de string — vulnerável a SQL injection em
  // qualquer campo de texto (ex.: notes/supplier_name); corrigido usando
  // o Drizzle parametrizado (mesmo caminho de createPurchaseOrder).
  fastify.patch('/purchase-orders/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('purchase_orders:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const b        = request.body as any;

    if (!b.items?.length) return reply.badRequest('Ao menos um item é obrigatório');

    try {
      const po = await updatePurchaseOrder(id, tenantId, {
        supplierId:    b.supplier_id,
        supplierName:  b.supplier_name,
        expectedDate:  b.expected_date,
        discount:      b.discount,
        shipping:      b.shipping,
        notes:         b.notes,
        costCenterId:  b.cost_center_id,
        items: (b.items as any[]).map(it => ({
          materialId: it.material_id,
          name:       it.name,
          sku:        it.sku,
          unit:       it.unit,
          quantity:   it.quantity,
          unit_price: it.unit_price,
          notes:      it.notes,
        })),
      }, db);
      return po;
    } catch (err) {
      if (err instanceof PurchaseOrderDomainError) {
        return reply.code(err.code === 'po_not_found' ? 404 : 422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── POST /v1/purchase-orders/:id/approve ─────────────────────────────────── */
  fastify.post('/purchase-orders/:id/approve', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('purchase_orders:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params as { id: string };
    try {
      await transitionPurchaseOrder(id, tenantId, 'approved', userId, db);
      return { ok: true, status: 'approved' };
    } catch (err) {
      if (err instanceof PurchaseOrderDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  /* ── POST /v1/purchase-orders/:id/cancel ──────────────────────────────────── */
  fastify.post('/purchase-orders/:id/cancel', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('purchase_orders:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    try {
      await transitionPurchaseOrder(id, tenantId, 'cancelled', null, db);
      return { ok: true, status: 'cancelled' };
    } catch (err) {
      if (err instanceof PurchaseOrderDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });
};
