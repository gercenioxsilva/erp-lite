import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import {
  createSupplierInvoice,
  confirmSupplierInvoice,
  cancelSupplierInvoice,
  SupplierInvoiceDomainError,
} from '../services/supplierInvoiceService';

export const supplierInvoicesRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/supplier-invoices ────────────────────────────────────────────── */
  fastify.get('/supplier-invoices', { onRequest: [(fastify as any).authenticate] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { status, supplier_id, search, page = '1', per_page = '20' } =
      request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const statusFilter   = status      ? sql`AND si.status = ${status}` : sql``;
    const supplierFilter = supplier_id ? sql`AND si.supplier_id = ${supplier_id}::uuid` : sql``;
    const searchFilter   = search
      ? sql`AND (si.nfe_number ILIKE ${'%' + search + '%'} OR COALESCE(si.supplier_name,'') ILIKE ${'%' + search + '%'} OR COALESCE(si.nfe_key,'') ILIKE ${'%' + search + '%'})`
      : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT si.id, si.nfe_number, si.nfe_series, si.nfe_key, si.status,
               si.supplier_id, si.supplier_name, si.issue_date, si.due_date,
               si.total, si.purchase_order_id, si.payable_id, si.created_at
        FROM supplier_invoices si
        WHERE si.tenant_id = ${tenantId}
          ${statusFilter} ${supplierFilter} ${searchFilter}
        ORDER BY si.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM supplier_invoices si
        WHERE si.tenant_id = ${tenantId}
          ${statusFilter} ${supplierFilter} ${searchFilter}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── POST /v1/supplier-invoices ───────────────────────────────────────────── */
  fastify.post('/supplier-invoices', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const b = request.body as any;

    if (!b.items?.length) return reply.badRequest('Ao menos um item é obrigatório');
    if (!b.total && b.total !== 0) return reply.badRequest('total é obrigatório');

    try {
      const si = await createSupplierInvoice({ ...b, tenantId, createdBy: userId }, db);
      return reply.code(201).send(si);
    } catch (err) {
      if (err instanceof SupplierInvoiceDomainError) return reply.code(422).send({ error: err.code });
      throw err;
    }
  });

  /* ── GET /v1/supplier-invoices/:id ───────────────────────────────────────── */
  fastify.get('/supplier-invoices/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const [{ rows: [si] }, { rows: items }] = await Promise.all([
      db.execute<any>(sql`
        SELECT si.*, s.company_name AS supplier_company_name,
               po.number AS purchase_order_number
        FROM supplier_invoices si
        LEFT JOIN suppliers s ON s.id = si.supplier_id
        LEFT JOIN purchase_orders po ON po.id = si.purchase_order_id
        WHERE si.id = ${id} AND si.tenant_id = ${tenantId}
      `),
      db.execute<any>(sql`
        SELECT sii.*, m.name AS material_name, m.sku AS material_sku
        FROM supplier_invoice_items sii
        LEFT JOIN materials m ON m.id = sii.material_id
        WHERE sii.supplier_invoice_id = ${id}
        ORDER BY sii.created_at
      `),
    ]);

    if (!si) return reply.notFound('NF-e de entrada não encontrada');
    return { ...si, items };
  });

  /* ── POST /v1/supplier-invoices/:id/confirm ───────────────────────────────── */
  fastify.post('/supplier-invoices/:id/confirm', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params as { id: string };

    try {
      const result = await confirmSupplierInvoice(id, tenantId, userId, db);
      const msg = result.status === 'divergence'
        ? 'NF-e confirmada com divergências em relação ao Pedido de Compra. Verifique os itens.'
        : 'NF-e confirmada. Payable gerado e estoque atualizado.';
      return { ok: true, ...result, message: msg };
    } catch (err) {
      if (err instanceof SupplierInvoiceDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  /* ── POST /v1/supplier-invoices/:id/cancel ────────────────────────────────── */
  fastify.post('/supplier-invoices/:id/cancel', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    try {
      await cancelSupplierInvoice(id, tenantId, db);
      return { ok: true, status: 'cancelled' };
    } catch (err) {
      if (err instanceof SupplierInvoiceDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });
};
