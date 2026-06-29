import { FastifyPluginAsync } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { db, payables, payablePayments, suppliers } from '../db';

const VALID_CATEGORIES = ['rent', 'utilities', 'payroll', 'supplies', 'services', 'taxes', 'other'] as const;
const VALID_METHODS    = ['pix', 'bank_transfer', 'cash', 'credit_card', 'debit_card', 'boleto', 'check', 'other'] as const;

export const payablesRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/payables ───────────────────────────────────────────────────── */
  fastify.get('/payables', { onRequest: [(fastify as any).authenticate] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { status, category, due_date_from, due_date_to, search,
            page = '1', per_page = '20' } = request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const statusFilter   = status && status !== 'all' ? sql`AND status = ${status}` : sql``;
    const categoryFilter = category && category !== 'all' ? sql`AND category = ${category}` : sql``;
    const dateFromFilter = due_date_from ? sql`AND due_date >= ${due_date_from}::date` : sql``;
    const dateToFilter   = due_date_to   ? sql`AND due_date <= ${due_date_to}::date`   : sql``;
    const searchFilter   = search
      ? sql`AND (description ILIKE ${'%' + search + '%'} OR COALESCE(supplier_name,'') ILIKE ${'%' + search + '%'})`
      : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT p.id, p.description, p.supplier_id,
               COALESCE(s.company_name, s.full_name, p.supplier_name) AS supplier_name,
               p.category, p.document_number,
               p.amount, p.paid_amount, p.due_date, p.status, p.notes, p.created_at,
               p.cost_center_id
        FROM payables p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.tenant_id = ${tenantId}
          ${statusFilter} ${categoryFilter} ${dateFromFilter} ${dateToFilter} ${searchFilter}
        ORDER BY p.due_date ASC, p.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM payables p
        WHERE p.tenant_id = ${tenantId}
          ${statusFilter} ${categoryFilter} ${dateFromFilter} ${dateToFilter} ${searchFilter}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── POST /v1/payables ──────────────────────────────────────────────────── */
  fastify.post('/payables', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { supplier_name, supplier_id, category = 'other', description, document_number,
            amount, due_date, notes,
            recurrence = 'none', recurrence_day, recurrence_end_date,
            cost_center_id } = request.body as any;

    if (!description || typeof description !== 'string' || !description.trim())
      return reply.badRequest('description é obrigatório');
    if (!amount || Number(amount) <= 0)
      return reply.badRequest('amount deve ser maior que zero');
    if (!due_date)
      return reply.badRequest('due_date é obrigatório');
    if (!VALID_CATEGORIES.includes(category))
      return reply.badRequest(`category inválida. Valores aceitos: ${VALID_CATEGORIES.join(', ')}`);

    const VALID_RECURRENCES = ['none', 'weekly', 'monthly', 'quarterly', 'yearly'];
    if (!VALID_RECURRENCES.includes(recurrence))
      return reply.badRequest(`recurrence inválido. Valores: ${VALID_RECURRENCES.join(', ')}`);

    // If supplier_id provided, resolve supplier name
    let resolvedSupplierName: string | null = supplier_name || null;
    let resolvedSupplierId: string | null = supplier_id || null;
    if (supplier_id) {
      const [sup] = await db.select().from(suppliers)
        .where(and(eq(suppliers.id, supplier_id), eq(suppliers.tenant_id, tenantId)));
      if (!sup) return reply.badRequest('supplier_id não encontrado');
      if (!resolvedSupplierName) resolvedSupplierName = sup.company_name || sup.full_name || null;
    }

    const [row] = await db.insert(payables).values({
      tenant_id:       tenantId,
      supplier_id:     resolvedSupplierId,
      supplier_name:   resolvedSupplierName,
      category,
      description:     description.trim(),
      document_number: document_number || null,
      amount:          String(Number(amount).toFixed(2)),
      due_date,
      status:          'pending',
      notes:           notes || null,
      recurrence:      recurrence || 'none',
      recurrence_day:  recurrence_day ? Number(recurrence_day) : null,
      recurrence_end_date: recurrence_end_date || null,
      cost_center_id:  cost_center_id || null,
      created_by:      userId,
    }).returning();

    return reply.code(201).send(row);
  });

  /* ── GET /v1/payables/:id ───────────────────────────────────────────────── */
  fastify.get('/payables/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const [{ rows: [pay] }, { rows: payments }] = await Promise.all([
      db.execute<any>(sql`
        SELECT p.*,
               COALESCE(s.company_name, s.full_name) AS supplier_display_name,
               s.email AS supplier_email, s.phone AS supplier_phone,
               p.cost_center_id
        FROM payables p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.id = ${id} AND p.tenant_id = ${tenantId}
      `),
      db.execute<any>(sql`
        SELECT * FROM payable_payments
        WHERE payable_id = ${id} AND tenant_id = ${tenantId}
        ORDER BY payment_date DESC, created_at DESC
      `),
    ]);

    if (!pay) return reply.notFound('Conta a pagar não encontrada');
    return { ...pay, payments };
  });

  /* ── PATCH /v1/payables/:id ─────────────────────────────────────────────── */
  fastify.patch('/payables/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const body     = request.body as any;

    const [existing] = await db.select({ id: payables.id, status: payables.status })
      .from(payables)
      .where(and(eq(payables.id, id), eq(payables.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Conta a pagar não encontrada');
    if (existing.status === 'cancelled') return reply.badRequest('Não é possível editar uma conta cancelada');

    const patch: Record<string, unknown> = {};
    if (body.description          !== undefined) patch.description          = body.description;
    if (body.supplier_name        !== undefined) patch.supplier_name        = body.supplier_name || null;
    if (body.supplier_id          !== undefined) patch.supplier_id          = body.supplier_id   || null;
    if (body.category             !== undefined) patch.category             = body.category;
    if (body.document_number      !== undefined) patch.document_number      = body.document_number || null;
    if (body.amount               !== undefined) patch.amount               = String(Number(body.amount).toFixed(2));
    if (body.due_date             !== undefined) patch.due_date             = body.due_date;
    if (body.notes                !== undefined) patch.notes                = body.notes;
    if (body.recurrence           !== undefined) patch.recurrence           = body.recurrence || 'none';
    if (body.recurrence_day       !== undefined) patch.recurrence_day       = body.recurrence_day ? Number(body.recurrence_day) : null;
    if (body.recurrence_end_date  !== undefined) patch.recurrence_end_date  = body.recurrence_end_date || null;
    if (body.cost_center_id       !== undefined) patch.cost_center_id       = body.cost_center_id || null;

    if (Object.keys(patch).length === 0) return reply.badRequest('Nenhum campo para atualizar');

    await db.update(payables).set(patch as any)
      .where(and(eq(payables.id, id), eq(payables.tenant_id, tenantId)));

    return { ok: true };
  });

  /* ── POST /v1/payables/:id/cancel ──────────────────────────────────────── */
  fastify.post('/payables/:id/cancel', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const [existing] = await db.select({ id: payables.id, status: payables.status })
      .from(payables)
      .where(and(eq(payables.id, id), eq(payables.tenant_id, tenantId)));
    if (!existing)                       return reply.notFound('Conta a pagar não encontrada');
    if (existing.status === 'cancelled') return reply.badRequest('Conta já está cancelada');
    if (existing.status === 'paid')      return reply.badRequest('Não é possível cancelar uma conta já paga');

    await db.update(payables).set({ status: 'cancelled' })
      .where(and(eq(payables.id, id), eq(payables.tenant_id, tenantId)));

    return { ok: true, status: 'cancelled' };
  });

  /* ── POST /v1/payables/:id/payments ────────────────────────────────────── */
  fastify.post('/payables/:id/payments', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params as { id: string };
    const { payment_date, amount, payment_method = 'other', reference, notes } = request.body as any;

    if (!payment_date) return reply.badRequest('payment_date é obrigatório');
    if (!amount || Number(amount) <= 0) return reply.badRequest('amount deve ser maior que zero');
    if (!VALID_METHODS.includes(payment_method))
      return reply.badRequest(`payment_method inválido. Valores aceitos: ${VALID_METHODS.join(', ')}`);

    const [pay] = await db.select({
      id: payables.id, status: payables.status,
      amount: payables.amount, paid_amount: payables.paid_amount,
    }).from(payables).where(and(eq(payables.id, id), eq(payables.tenant_id, tenantId)));

    if (!pay) return reply.notFound('Conta a pagar não encontrada');
    if (pay.status === 'cancelled') return reply.badRequest('Não é possível registrar pagamento em conta cancelada');

    const payAmt     = Number(amount);
    const newPaidAmt = Math.round((Number(pay.paid_amount) + payAmt) * 100) / 100;
    const totalAmt   = Number(pay.amount);
    const newStatus  = newPaidAmt >= totalAmt ? 'paid' : 'partial';

    const payment = await db.transaction(async (tx) => {
      const [p] = await tx.insert(payablePayments).values({
        tenant_id: tenantId, payable_id: id,
        payment_date, amount: String(payAmt.toFixed(2)),
        payment_method, reference: reference || null, notes: notes || null,
        created_by: userId,
      }).returning();

      await tx.update(payables).set({ paid_amount: String(newPaidAmt.toFixed(2)), status: newStatus })
        .where(eq(payables.id, id));

      return p;
    });

    return reply.code(201).send({ ...payment, new_status: newStatus, new_paid_amount: newPaidAmt });
  });

  /* ── DELETE /v1/payables/:id/payments/:paymentId ───────────────────────── */
  fastify.delete('/payables/:id/payments/:paymentId', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId          = (request as any).user.tenantId;
    const { id, paymentId } = request.params as { id: string; paymentId: string };

    const [pay] = await db.select({ id: payables.id, status: payables.status, paid_amount: payables.paid_amount })
      .from(payables).where(and(eq(payables.id, id), eq(payables.tenant_id, tenantId)));
    if (!pay) return reply.notFound('Conta a pagar não encontrada');

    const [p] = await db.select({ id: payablePayments.id, amount: payablePayments.amount })
      .from(payablePayments)
      .where(and(eq(payablePayments.id, paymentId), eq(payablePayments.payable_id, id), eq(payablePayments.tenant_id, tenantId)));
    if (!p) return reply.notFound('Pagamento não encontrado');

    const newPaidAmt = Math.max(0, Math.round((Number(pay.paid_amount) - Number(p.amount)) * 100) / 100);
    const newStatus  = newPaidAmt <= 0 ? 'pending' : 'partial';

    await db.transaction(async (tx) => {
      await tx.delete(payablePayments).where(eq(payablePayments.id, paymentId));
      await tx.update(payables).set({ paid_amount: String(newPaidAmt.toFixed(2)), status: newStatus })
        .where(eq(payables.id, id));
    });

    return { ok: true, new_status: newStatus, new_paid_amount: newPaidAmt };
  });
};
