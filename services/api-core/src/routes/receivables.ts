import { FastifyPluginAsync } from 'fastify';
import { eq, and, or, ilike, sql, desc, gte, lte } from 'drizzle-orm';
import { db, receivables, receivablePayments, clients } from '../db';

const VALID_STATUSES  = ['pending', 'partial', 'paid', 'overdue', 'cancelled'] as const;
const VALID_METHODS   = ['pix', 'bank_transfer', 'cash', 'credit_card', 'debit_card', 'boleto', 'check', 'other'] as const;

export const receivablesRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/receivables ────────────────────────────────────────────────── */
  fastify.get('/receivables', { onRequest: [fastify.authenticate] }, async (request) => {
    const tenantId = request.user.tenantId;
    const { status, client_id, due_date_from, due_date_to, search,
            page = '1', per_page = '20' } = request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const statusFilter    = status && status !== 'all' ? sql`AND r.status = ${status}` : sql``;
    const clientFilter    = client_id  ? sql`AND r.client_id = ${client_id}::uuid` : sql``;
    const dateFromFilter  = due_date_from ? sql`AND r.due_date >= ${due_date_from}::date` : sql``;
    const dateToFilter    = due_date_to   ? sql`AND r.due_date <= ${due_date_to}::date`   : sql``;
    const searchFilter    = search
      ? sql`AND (r.description ILIKE ${'%' + search + '%'} OR COALESCE(c.company_name, c.full_name) ILIKE ${'%' + search + '%'})`
      : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT r.id, r.description, r.amount, r.paid_amount, r.due_date, r.status,
               r.invoice_id, r.notes, r.created_at,
               COALESCE(c.company_name, c.full_name) AS client_name, c.id AS client_id
        FROM receivables r
        LEFT JOIN clients c ON c.id = r.client_id
        WHERE r.tenant_id = ${tenantId}
          ${statusFilter} ${clientFilter} ${dateFromFilter} ${dateToFilter} ${searchFilter}
        ORDER BY r.due_date ASC, r.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count
        FROM receivables r
        LEFT JOIN clients c ON c.id = r.client_id
        WHERE r.tenant_id = ${tenantId}
          ${statusFilter} ${clientFilter} ${dateFromFilter} ${dateToFilter} ${searchFilter}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── POST /v1/receivables ───────────────────────────────────────────────── */
  fastify.post('/receivables', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const userId   = request.user.userId;
    const { client_id, invoice_id, description, amount, due_date, notes } = request.body as any;

    if (!description || typeof description !== 'string' || !description.trim())
      return reply.badRequest('description é obrigatório');
    if (!amount || Number(amount) <= 0)
      return reply.badRequest('amount deve ser maior que zero');
    if (!due_date)
      return reply.badRequest('due_date é obrigatório');

    const [row] = await db.insert(receivables).values({
      tenant_id:   tenantId,
      client_id:   client_id  || null,
      invoice_id:  invoice_id || null,
      description: description.trim(),
      amount:      String(Number(amount).toFixed(2)),
      due_date,
      status:      'pending',
      notes:       notes || null,
      created_by:  userId,
    }).returning();

    return reply.code(201).send(row);
  });

  /* ── GET /v1/receivables/:id ────────────────────────────────────────────── */
  fastify.get('/receivables/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { id }   = request.params as { id: string };

    const [{ rows: [rec] }, { rows: payments }] = await Promise.all([
      db.execute<any>(sql`
        SELECT r.*, COALESCE(c.company_name, c.full_name) AS client_name
        FROM receivables r
        LEFT JOIN clients c ON c.id = r.client_id
        WHERE r.id = ${id} AND r.tenant_id = ${tenantId}
      `),
      db.execute<any>(sql`
        SELECT * FROM receivable_payments
        WHERE receivable_id = ${id} AND tenant_id = ${tenantId}
        ORDER BY payment_date DESC, created_at DESC
      `),
    ]);

    if (!rec) return reply.notFound('Conta a receber não encontrada');
    return { ...rec, payments };
  });

  /* ── PATCH /v1/receivables/:id ──────────────────────────────────────────── */
  fastify.patch('/receivables/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { id }   = request.params as { id: string };
    const body     = request.body as any;

    const [existing] = await db.select({ id: receivables.id, status: receivables.status })
      .from(receivables)
      .where(and(eq(receivables.id, id), eq(receivables.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Conta a receber não encontrada');
    if (existing.status === 'cancelled') return reply.badRequest('Não é possível editar uma conta cancelada');

    const patch: Record<string, unknown> = {};
    if (body.description !== undefined) patch.description = body.description;
    if (body.amount      !== undefined) patch.amount      = String(Number(body.amount).toFixed(2));
    if (body.due_date    !== undefined) patch.due_date    = body.due_date;
    if (body.notes       !== undefined) patch.notes       = body.notes;
    if (body.client_id   !== undefined) patch.client_id   = body.client_id || null;

    if (Object.keys(patch).length === 0) return reply.badRequest('Nenhum campo para atualizar');

    await db.update(receivables).set(patch as any)
      .where(and(eq(receivables.id, id), eq(receivables.tenant_id, tenantId)));

    return { ok: true };
  });

  /* ── POST /v1/receivables/:id/cancel ───────────────────────────────────── */
  fastify.post('/receivables/:id/cancel', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { id }   = request.params as { id: string };

    const [existing] = await db.select({ id: receivables.id, status: receivables.status })
      .from(receivables)
      .where(and(eq(receivables.id, id), eq(receivables.tenant_id, tenantId)));
    if (!existing)                       return reply.notFound('Conta a receber não encontrada');
    if (existing.status === 'cancelled') return reply.badRequest('Conta já está cancelada');
    if (existing.status === 'paid')      return reply.badRequest('Não é possível cancelar uma conta já paga');

    await db.update(receivables).set({ status: 'cancelled' })
      .where(and(eq(receivables.id, id), eq(receivables.tenant_id, tenantId)));

    return { ok: true, status: 'cancelled' };
  });

  /* ── POST /v1/receivables/:id/payments ─────────────────────────────────── */
  fastify.post('/receivables/:id/payments', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const userId   = request.user.userId;
    const { id }   = request.params as { id: string };
    const { payment_date, amount, payment_method = 'other', reference, notes } = request.body as any;

    if (!payment_date) return reply.badRequest('payment_date é obrigatório');
    if (!amount || Number(amount) <= 0) return reply.badRequest('amount deve ser maior que zero');
    if (!VALID_METHODS.includes(payment_method))
      return reply.badRequest(`payment_method inválido. Valores aceitos: ${VALID_METHODS.join(', ')}`);

    const [rec] = await db.select({
      id: receivables.id, status: receivables.status,
      amount: receivables.amount, paid_amount: receivables.paid_amount,
    }).from(receivables).where(and(eq(receivables.id, id), eq(receivables.tenant_id, tenantId)));

    if (!rec) return reply.notFound('Conta a receber não encontrada');
    if (rec.status === 'cancelled') return reply.badRequest('Não é possível registrar pagamento em conta cancelada');

    const payAmt       = Number(amount);
    const newPaidAmt   = Math.round((Number(rec.paid_amount) + payAmt) * 100) / 100;
    const totalAmt     = Number(rec.amount);
    const newStatus    = newPaidAmt >= totalAmt ? 'paid' : 'partial';

    const payment = await db.transaction(async (tx) => {
      const [pay] = await tx.insert(receivablePayments).values({
        tenant_id: tenantId, receivable_id: id,
        payment_date, amount: String(payAmt.toFixed(2)),
        payment_method, reference: reference || null, notes: notes || null,
        created_by: userId,
      }).returning();

      await tx.update(receivables).set({ paid_amount: String(newPaidAmt.toFixed(2)), status: newStatus })
        .where(eq(receivables.id, id));

      return pay;
    });

    return reply.code(201).send({ ...payment, new_status: newStatus, new_paid_amount: newPaidAmt });
  });

  /* ── DELETE /v1/receivables/:id/payments/:paymentId ────────────────────── */
  fastify.delete('/receivables/:id/payments/:paymentId', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const tenantId      = request.user.tenantId;
    const { id, paymentId } = request.params as { id: string; paymentId: string };

    const [rec] = await db.select({ id: receivables.id, status: receivables.status, paid_amount: receivables.paid_amount })
      .from(receivables).where(and(eq(receivables.id, id), eq(receivables.tenant_id, tenantId)));
    if (!rec) return reply.notFound('Conta a receber não encontrada');

    const [pay] = await db.select({ id: receivablePayments.id, amount: receivablePayments.amount })
      .from(receivablePayments)
      .where(and(eq(receivablePayments.id, paymentId), eq(receivablePayments.receivable_id, id), eq(receivablePayments.tenant_id, tenantId)));
    if (!pay) return reply.notFound('Pagamento não encontrado');

    const newPaidAmt = Math.max(0, Math.round((Number(rec.paid_amount) - Number(pay.amount)) * 100) / 100);
    const newStatus  = newPaidAmt <= 0 ? 'pending' : 'partial';

    await db.transaction(async (tx) => {
      await tx.delete(receivablePayments).where(eq(receivablePayments.id, paymentId));
      await tx.update(receivables).set({ paid_amount: String(newPaidAmt.toFixed(2)), status: newStatus })
        .where(eq(receivables.id, id));
    });

    return { ok: true, new_status: newStatus, new_paid_amount: newPaidAmt };
  });
};
