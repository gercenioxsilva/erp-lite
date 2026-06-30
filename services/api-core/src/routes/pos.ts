import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import {
  openSession, addCashMovement, closeSession,
} from '../services/pos/posSessionService';
import {
  createSale, addItem, updateItem, removeItem, setCustomer,
  addPayment, removePayment, finalizeSale, cancelSale, reemitirFiscal,
} from '../services/pos/posSaleService';
import { consultarNFCe } from '../services/fiscal/focusNfe';

export const posRoutes: FastifyPluginAsync = async (fastify) => {

  // ── TERMINALS ─────────────────────────────────────────────────────────────

  // GET /v1/pos/terminals
  fastify.get('/pos/terminals', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const rows = await db.execute(
      sql`SELECT id, code, name, cost_center_id, nfce_series, is_active, created_at, updated_at
          FROM pos_terminals WHERE tenant_id = ${tenantId} ORDER BY code`
    );
    return rows.rows;
  });

  // POST /v1/pos/terminals
  fastify.post('/pos/terminals', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const b = request.body as Record<string, unknown>;
    if (!b.code || !b.name) return reply.badRequest('code and name are required');

    const rows = await db.execute(
      sql`INSERT INTO pos_terminals (tenant_id, code, name, cost_center_id, nfce_series)
          VALUES (${tenantId}, ${String(b.code)}, ${String(b.name)},
                  ${(b.cost_center_id as string) ?? null}, ${Number(b.nfce_series ?? 1)})
          RETURNING *`
    );
    return reply.status(201).send(rows.rows[0]);
  });

  // GET /v1/pos/terminals/:id
  fastify.get('/pos/terminals/:id', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    const rows = await db.execute(
      sql`SELECT * FROM pos_terminals WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1`
    );
    if (!rows.rows.length) return reply.notFound('Terminal not found');
    return rows.rows[0];
  });

  // PATCH /v1/pos/terminals/:id
  fastify.patch('/pos/terminals/:id', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    const b = request.body as Record<string, unknown>;
    const rows = await db.execute(
      sql`UPDATE pos_terminals SET
            name           = COALESCE(${(b.name as string) ?? null},     name),
            cost_center_id = COALESCE(${(b.cost_center_id as string) ?? null}, cost_center_id),
            nfce_series    = COALESCE(${(b.nfce_series as number) ?? null}, nfce_series),
            is_active      = COALESCE(${(b.is_active as boolean) ?? null},  is_active),
            updated_at     = NOW()
          WHERE id = ${id} AND tenant_id = ${tenantId}
          RETURNING *`
    );
    if (!rows.rows.length) return reply.notFound('Terminal not found');
    return rows.rows[0];
  });

  // ── SESSIONS ──────────────────────────────────────────────────────────────

  // GET /v1/pos/sessions — list sessions (paginated)
  fastify.get('/pos/sessions', async (request) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const q = request.query as Record<string, string>;
    const page    = Math.max(1, Number(q.page    ?? 1));
    const perPage = Math.min(100, Math.max(1, Number(q.per_page ?? 20)));
    const offset  = (page - 1) * perPage;
    const status  = q.status ?? null;

    const rows = await db.execute(
      sql`SELECT
            s.id, s.status, s.terminal_id, s.operator_id,
            s.opening_amount, s.opened_at, s.closed_at,
            s.closing_counted, s.closing_expected, s.difference,
            t.code AS terminal_code, t.name AS terminal_name,
            (COUNT(*) OVER ())::int AS _total,
            COALESCE(agg.total_sales,   0)::int  AS total_sales,
            COALESCE(agg.total_revenue, '0.00')  AS total_revenue
          FROM pos_sessions s
          LEFT JOIN pos_terminals t ON t.id = s.terminal_id
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS total_sales, COALESCE(SUM(total), 0)::text AS total_revenue
            FROM pos_sales
            WHERE session_id = s.id AND tenant_id = ${tenantId} AND status = 'finalized'
          ) agg ON true
          WHERE s.tenant_id = ${tenantId}
            ${status ? sql`AND s.status = ${status}` : sql``}
          ORDER BY s.opened_at DESC
          LIMIT ${perPage} OFFSET ${offset}`
    );

    const total = rows.rows.length > 0
      ? (rows.rows[0] as Record<string, unknown>)._total as number
      : 0;

    return {
      data:     rows.rows.map(r => { const { _total: _, ...rest } = r as Record<string, unknown>; return rest; }),
      total,
      page,
      per_page: perPage,
    };
  });

  // POST /v1/pos/sessions — open session
  fastify.post('/pos/sessions', async (request, reply) => {
    await request.jwtVerify();
    const tenantId  = (request.user as { tenantId: string }).tenantId;
    const operatorId = (request.user as { userId: string }).userId;
    const b = request.body as Record<string, unknown>;
    if (!b.terminal_id) return reply.badRequest('terminal_id is required');
    try {
      const result = await openSession({
        tenantId, terminalId: String(b.terminal_id), operatorId,
        openingAmount: Number(b.opening_amount ?? 0),
      });
      return reply.status(201).send(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // GET /v1/pos/sessions/:id — get session with aggregated totals
  fastify.get('/pos/sessions/:id', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };

    const sessionRows = await db.execute(
      sql`SELECT s.id, s.status, s.terminal_id, s.operator_id,
                 s.opening_amount, s.opened_at, s.closed_at,
                 s.closing_counted, s.closing_expected, s.difference
          FROM pos_sessions s
          WHERE s.id = ${id} AND s.tenant_id = ${tenantId}
          LIMIT 1`
    );
    if (!sessionRows.rows.length) return reply.notFound('Session not found');
    const session = sessionRows.rows[0] as Record<string, unknown>;

    const salesAgg = await db.execute(
      sql`SELECT COUNT(*)::int AS total_sales,
                 COALESCE(SUM(total), 0)::text AS total_revenue
          FROM pos_sales
          WHERE session_id = ${id} AND tenant_id = ${tenantId} AND status = 'finalized'`
    );
    const cashAgg = await db.execute(
      sql`SELECT COALESCE(SUM(sp.amount), 0)::text AS total_cash
          FROM pos_sale_payments sp
          JOIN pos_sales s ON s.id = sp.sale_id
          WHERE s.session_id = ${id} AND s.tenant_id = ${tenantId}
            AND s.status = 'finalized' AND sp.method = 'cash'`
    );

    const agg  = salesAgg.rows[0] as { total_sales: number; total_revenue: string };
    const cash = cashAgg.rows[0]  as { total_cash: string };

    return {
      ...session,
      total_sales:   agg.total_sales   ?? 0,
      total_revenue: agg.total_revenue  ?? '0.00',
      total_cash:    cash.total_cash    ?? '0.00',
    };
  });

  // POST /v1/pos/sessions/:id/close — close session
  fastify.post('/pos/sessions/:id/close', async (request, reply) => {
    await request.jwtVerify();
    const tenantId  = (request.user as { tenantId: string }).tenantId;
    const operatorId = (request.user as { userId: string }).userId;
    const { id } = request.params as { id: string };
    const b = request.body as Record<string, unknown>;
    try {
      const result = await closeSession({
        tenantId, sessionId: id, operatorId,
        countedAmount: Number(b.closing_counted ?? 0),
      });
      return result;
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // GET /v1/pos/sessions/:id/cash-movements — list movements
  fastify.get('/pos/sessions/:id/cash-movements', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    const rows = await db.execute(
      sql`SELECT * FROM pos_cash_movements
          WHERE session_id = ${id} AND tenant_id = ${tenantId}
          ORDER BY created_at`
    );
    return rows.rows;
  });

  // POST /v1/pos/sessions/:id/cash-movements — sangria / suprimento
  fastify.post('/pos/sessions/:id/cash-movements', async (request, reply) => {
    await request.jwtVerify();
    const tenantId  = (request.user as { tenantId: string }).tenantId;
    const operatorId = (request.user as { userId: string }).userId;
    const { id } = request.params as { id: string };
    const b = request.body as Record<string, unknown>;
    if (!b.type || !b.amount) return reply.badRequest('type and amount are required');
    try {
      const result = await addCashMovement({
        tenantId, sessionId: id, operatorId,
        type: String(b.type) as 'suprimento' | 'sangria',
        amount: Number(b.amount),
        reason: (b.reason as string) ?? undefined,
      });
      return reply.status(201).send(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // ── SALES ─────────────────────────────────────────────────────────────────

  // POST /v1/pos/sales — create sale
  fastify.post('/pos/sales', async (request, reply) => {
    await request.jwtVerify();
    const tenantId  = (request.user as { tenantId: string }).tenantId;
    const operatorId = (request.user as { userId: string }).userId;
    const b = request.body as Record<string, unknown>;
    if (!b.session_id) return reply.badRequest('session_id is required');
    try {
      const result = await createSale({
        tenantId, sessionId: String(b.session_id), operatorId,
      });
      return reply.status(201).send(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // GET /v1/pos/sales — list sales (history)
  fastify.get('/pos/sales', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const q = request.query as Record<string, string>;
    const page    = Math.max(1, Number(q.page ?? 1));
    const perPage = Math.min(100, Number(q.per_page ?? 20));
    const offset  = (page - 1) * perPage;

    const rows = await db.execute(
      sql`SELECT s.*,
                 COALESCE(json_agg(si ORDER BY si.created_at) FILTER (WHERE si.id IS NOT NULL), '[]') AS items,
                 COALESCE(json_agg(sp ORDER BY sp.created_at) FILTER (WHERE sp.id IS NOT NULL), '[]') AS payments
          FROM pos_sales s
          LEFT JOIN pos_sale_items    si ON si.sale_id = s.id
          LEFT JOIN pos_sale_payments sp ON sp.sale_id = s.id
          WHERE s.tenant_id = ${tenantId}
            ${q.session_id ? sql`AND s.session_id = ${q.session_id}` : sql``}
            ${q.status     ? sql`AND s.status = ${q.status}`         : sql``}
            ${q.from       ? sql`AND s.created_at >= ${q.from}`      : sql``}
            ${q.to         ? sql`AND s.created_at <= ${q.to}`        : sql``}
          GROUP BY s.id
          ORDER BY s.created_at DESC
          LIMIT ${perPage} OFFSET ${offset}`
    );

    const countRows = await db.execute(
      sql`SELECT COUNT(*)::int AS total FROM pos_sales WHERE tenant_id = ${tenantId}
          ${q.session_id ? sql`AND session_id = ${q.session_id}` : sql``}
          ${q.status     ? sql`AND status = ${q.status}`         : sql``}`
    );

    return {
      data: rows.rows,
      meta: { total: (countRows.rows[0] as { total: number }).total, page, per_page: perPage },
    };
  });

  // GET /v1/pos/sales/:id — get sale detail
  fastify.get('/pos/sales/:id', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };

    const rows = await db.execute(
      sql`SELECT s.*,
                 COALESCE(json_agg(si ORDER BY si.created_at) FILTER (WHERE si.id IS NOT NULL), '[]') AS items,
                 COALESCE(json_agg(sp ORDER BY sp.created_at) FILTER (WHERE sp.id IS NOT NULL), '[]') AS payments
          FROM pos_sales s
          LEFT JOIN pos_sale_items    si ON si.sale_id = s.id
          LEFT JOIN pos_sale_payments sp ON sp.sale_id = s.id
          WHERE s.id = ${id} AND s.tenant_id = ${tenantId}
          GROUP BY s.id`
    );
    if (!rows.rows.length) return reply.notFound('Sale not found');
    return rows.rows[0];
  });

  // POST /v1/pos/sales/:id/items
  fastify.post('/pos/sales/:id/items', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    const b = request.body as Record<string, unknown>;
    if (!b.product_id || !b.quantity) return reply.badRequest('product_id and quantity are required');
    try {
      const result = await addItem({
        tenantId, saleId: id, productId: String(b.product_id),
        quantity: Number(b.quantity), discountAmount: Number(b.discount_amount ?? 0),
      });
      return reply.status(201).send(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // PATCH /v1/pos/sales/:id/items/:itemId
  fastify.patch('/pos/sales/:id/items/:itemId', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id, itemId } = request.params as { id: string; itemId: string };
    const b = request.body as Record<string, unknown>;
    try {
      await updateItem({
        tenantId, saleId: id, itemId,
        quantity:       b.quantity       !== undefined ? Number(b.quantity)       : undefined,
        discountAmount: b.discount_amount !== undefined ? Number(b.discount_amount) : undefined,
      });
      return { ok: true };
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // DELETE /v1/pos/sales/:id/items/:itemId
  fastify.delete('/pos/sales/:id/items/:itemId', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id, itemId } = request.params as { id: string; itemId: string };
    try {
      await removeItem({ tenantId, saleId: id, itemId });
      return reply.status(204).send();
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // POST /v1/pos/sales/:id/customer
  fastify.post('/pos/sales/:id/customer', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    const b = request.body as Record<string, unknown>;
    try {
      await setCustomer({
        tenantId, saleId: id,
        doc:  (b.doc  as string) ?? undefined,
        name: (b.name as string) ?? undefined,
      });
      return { ok: true };
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // POST /v1/pos/sales/:id/payments
  fastify.post('/pos/sales/:id/payments', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    const b = request.body as Record<string, unknown>;
    if (!b.method || !b.amount) return reply.badRequest('method and amount are required');
    try {
      const result = await addPayment({
        tenantId, saleId: id,
        method: String(b.method) as 'cash' | 'debit' | 'credit' | 'pix' | 'voucher' | 'store_credit',
        amount: Number(b.amount),
        installments:      (b.installments       as number)  ?? undefined,
        authorizationCode: (b.authorization_code as string)  ?? undefined,
      });
      return reply.status(201).send(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // DELETE /v1/pos/sales/:id/payments/:paymentId
  fastify.delete('/pos/sales/:id/payments/:paymentId', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id, paymentId } = request.params as { id: string; paymentId: string };
    try {
      await removePayment({ tenantId, saleId: id, paymentId });
      return reply.status(204).send();
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // POST /v1/pos/sales/:id/finalize
  fastify.post('/pos/sales/:id/finalize', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    const b = request.body as Record<string, unknown>;
    if (!b.idempotency_key) return reply.badRequest('idempotency_key is required');
    try {
      const result = await finalizeSale({
        tenantId, saleId: id, idempotencyKey: String(b.idempotency_key),
      });
      return result;
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // POST /v1/pos/sales/:id/cancel
  fastify.post('/pos/sales/:id/cancel', async (request, reply) => {
    await request.jwtVerify();
    const tenantId  = (request.user as { tenantId: string }).tenantId;
    const operatorId = (request.user as { userId: string }).userId;
    const { id } = request.params as { id: string };
    const b = request.body as Record<string, unknown>;
    try {
      await cancelSale({
        tenantId, saleId: id, operatorId,
        reason: (b.reason as string) ?? 'Cancelamento operador',
      });
      return { ok: true };
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // POST /v1/pos/sales/:id/reissue-fiscal — reemitir NFC-e
  fastify.post('/pos/sales/:id/reissue-fiscal', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    try {
      await reemitirFiscal({ tenantId, saleId: id });
      return { ok: true, message: 'NFC-e reissue requested' };
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  });

  // ── PRODUCTS SEARCH ───────────────────────────────────────────────────────

  // GET /v1/pos/products?q=...
  fastify.get('/pos/products', async (request, reply) => {
    await request.jwtVerify();
    const tenantId = (request.user as { tenantId: string }).tenantId;
    const q = request.query as Record<string, string>;
    const search = (q.q ?? '').trim();
    const limit  = Math.min(50, Number(q.limit ?? 20));

    const rows = await db.execute(
      sql`SELECT id, name, sale_price, ncm_code, cfop, cst_csosn, unit, gtin
          FROM materials
          WHERE tenant_id = ${tenantId}
            AND is_active = true
            ${search ? sql`AND (name ILIKE ${'%' + search + '%'} OR gtin = ${search})` : sql``}
          ORDER BY name
          LIMIT ${limit}`
    );
    return rows.rows;
  });

  // ── FOCUS NF-e WEBHOOK ────────────────────────────────────────────────────

  // POST /v1/pos/webhook/focus-nfe — called by Focus NF-e when status changes
  // No JWT — Focus NF-e calls this with the ref in body
  fastify.post('/pos/webhook/focus-nfe', async (request, reply) => {
    const b = request.body as Record<string, unknown>;
    const ref = String(b.ref ?? b.chave_nfe ?? '');
    if (!ref) return reply.status(400).send({ message: 'ref missing' });

    try {
      // Look up sale by focus_ref (UUID = sale id)
      const saleRows = await db.execute(
        sql`SELECT id, tenant_id FROM pos_sales WHERE focus_ref = ${ref} LIMIT 1`
      );
      if (!saleRows.rows.length) return reply.status(200).send({ ok: true }); // idempotent

      const sale = saleRows.rows[0] as { id: string; tenant_id: string };

      // Consult Focus for latest status
      const result = await consultarNFCe(ref);

      await db.execute(
        sql`UPDATE pos_sales SET
              fiscal_status    = ${result.fiscal_status},
              fiscal_chave     = ${result.fiscal_chave},
              fiscal_protocol  = ${result.fiscal_protocol},
              fiscal_number    = ${result.fiscal_number},
              fiscal_series    = ${result.fiscal_series},
              fiscal_qrcode    = ${result.fiscal_qrcode},
              fiscal_url_danfe = ${result.fiscal_url_danfe},
              fiscal_url_xml   = ${result.fiscal_url_xml},
              fiscal_message   = ${result.fiscal_message},
              updated_at       = NOW()
            WHERE id = ${sale.id}`
      );

      return { ok: true };
    } catch (err: unknown) {
      console.error('[Focus Webhook] Error processing NFC-e callback:', err);
      return reply.status(200).send({ ok: true }); // always 200 to Focus
    }
  });
};
