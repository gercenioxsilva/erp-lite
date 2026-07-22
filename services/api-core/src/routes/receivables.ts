import { FastifyPluginAsync } from 'fastify';
import { eq, and, or, ilike, sql, desc, gte, lte } from 'drizzle-orm';
import { db, receivables, receivablePayments, clients } from '../db';
import { requirePermission } from '../lib/requirePermission';
import { notifyPaymentConfirmed } from '../services/whatsappAutomationService';
import { registerReceivablePayment, ReceivablePaymentError } from '../services/receivableService';
import { reverseEntry } from '../services/accountingService';
import { isValidISODate } from '../lib/dateValidation';

const VALID_STATUSES  = ['pending', 'partial', 'paid', 'overdue', 'cancelled'] as const;
const VALID_METHODS   = ['pix', 'bank_transfer', 'cash', 'credit_card', 'debit_card', 'boleto', 'check', 'other'] as const;

export const receivablesRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/receivables ────────────────────────────────────────────────── */
  fastify.get('/receivables', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('receivables:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
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
               r.invoice_id, r.notes, r.created_at, r.cost_center_id,
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
  fastify.post('/receivables', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('receivables:create')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { client_id, invoice_id, description, amount, due_date, notes, cost_center_id } = request.body as any;

    if (!description || typeof description !== 'string' || !description.trim())
      return reply.badRequest('description é obrigatório');
    if (!amount || Number(amount) <= 0)
      return reply.badRequest('amount deve ser maior que zero');
    if (!due_date)
      return reply.badRequest('due_date é obrigatório');

    try {
      const [row] = await db.insert(receivables).values({
        tenant_id:   tenantId,
        client_id:   client_id  || null,
        invoice_id:  invoice_id || null,
        description: description.trim(),
        amount:      String(Number(amount).toFixed(2)),
        due_date,
        status:         'pending',
        notes:          notes || null,
        cost_center_id: cost_center_id || null,
        created_by:     userId,
      }).returning();

      return reply.code(201).send(row);
    } catch (err: any) {
      // UNIQUE parcial em receivables.invoice_id (migration 0065, regra 60) —
      // essa nota já tem uma conta a receber (provavelmente gerada
      // automaticamente na autorização da NF-e).
      if (err.code === '23505' && invoice_id) {
        return reply.conflict('Esta nota fiscal já tem uma conta a receber vinculada.');
      }
      throw err;
    }
  });

  /* ── GET /v1/receivables/:id ────────────────────────────────────────────── */
  fastify.get('/receivables/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('receivables:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
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
  fastify.patch('/receivables/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('receivables:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const body     = request.body as any;

    const [existing] = await db.select({ id: receivables.id, status: receivables.status, boleto_id: receivables.boleto_id })
      .from(receivables)
      .where(and(eq(receivables.id, id), eq(receivables.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Conta a receber não encontrada');
    if (existing.status === 'cancelled') return reply.badRequest('Não é possível editar uma conta cancelada');

    // Alterar o vencimento (regra 82) tem duas travas próprias, além do
    // guard geral de 'cancelled' acima: nunca numa conta já quitada (não faz
    // sentido reagendar o que já foi pago) e nunca com boleto emitido (o
    // vencimento registrado no banco ficaria dessincronizado do daqui —
    // sem um fluxo de "alterar boleto já emitido", expirar o boleto primeiro
    // é o caminho, mesmo racional de emit-boleto bloquear reemissão).
    if (body.due_date !== undefined) {
      if (existing.status === 'paid') return reply.badRequest('Não é possível alterar o vencimento de uma conta já paga');
      if (existing.boleto_id) return reply.badRequest('Não é possível alterar o vencimento: já existe um boleto emitido para esta conta. Expire o boleto antes de alterar a data.');
      if (typeof body.due_date !== 'string' || !isValidISODate(body.due_date)) return reply.badRequest('due_date inválida (formato esperado: YYYY-MM-DD)');
    }

    const patch: Record<string, unknown> = {};
    if (body.description !== undefined) patch.description = body.description;
    if (body.amount      !== undefined) patch.amount      = String(Number(body.amount).toFixed(2));
    if (body.due_date    !== undefined) patch.due_date    = body.due_date;
    if (body.notes       !== undefined) patch.notes       = body.notes;
    if (body.client_id      !== undefined) patch.client_id      = body.client_id || null;
    if (body.cost_center_id !== undefined) patch.cost_center_id = body.cost_center_id || null;

    if (Object.keys(patch).length === 0) return reply.badRequest('Nenhum campo para atualizar');

    await db.update(receivables).set(patch as any)
      .where(and(eq(receivables.id, id), eq(receivables.tenant_id, tenantId)));

    return { ok: true };
  });

  /* ── POST /v1/receivables/:id/cancel ───────────────────────────────────── */
  fastify.post('/receivables/:id/cancel', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('receivables:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
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
  // Lógica extraída para receivableService.registerReceivablePayment (0072):
  // compartilhada com o motor de conciliação; replies preservados 1:1.
  fastify.post('/receivables/:id/payments', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('receivables:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params as { id: string };
    const { payment_date, amount, payment_method = 'other', reference, notes } = request.body as any;

    try {
      const { payment, newStatus, newPaidAmount } = await registerReceivablePayment({
        tenantId, receivableId: id, paymentDate: payment_date, amount,
        paymentMethod: payment_method, reference, notes, createdBy: userId,
      });
      return reply.code(201).send({ ...payment, new_status: newStatus, new_paid_amount: newPaidAmount });
    } catch (err) {
      if (err instanceof ReceivablePaymentError) {
        switch (err.code) {
          case 'payment_date_required':  return reply.badRequest('payment_date é obrigatório');
          case 'invalid_amount':         return reply.badRequest('amount deve ser maior que zero');
          case 'invalid_method':         return reply.badRequest(`payment_method inválido. Valores aceitos: ${VALID_METHODS.join(', ')}`);
          case 'receivable_not_found':   return reply.notFound('Conta a receber não encontrada');
          case 'receivable_cancelled':   return reply.badRequest('Não é possível registrar pagamento em conta cancelada');
        }
      }
      throw err;
    }
  });

  /* ── DELETE /v1/receivables/:id/payments/:paymentId ────────────────────── */
  fastify.delete('/receivables/:id/payments/:paymentId', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('receivables:edit')] }, async (request, reply) => {
    const tenantId      = (request as any).user.tenantId;
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

    // Estorno contábil (fire-and-forget): reverte o recebimento excluído.
    void reverseEntry(tenantId, { sourceType: 'receivable_payment', sourceId: paymentId, reason: 'pagamento excluído' }, null)
      .catch((err) => console.error(JSON.stringify({ event: 'accounting_reverse_error', source: 'receivable_payment', id: paymentId, error: String(err) })));

    return { ok: true, new_status: newStatus, new_paid_amount: newPaidAmt };
  });
};
