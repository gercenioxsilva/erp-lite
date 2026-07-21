// Gestão de Planos de Pagamento (migration 0086, regra 75) — catálogo por
// tenant ("À Vista", "3x sem juros", "30/60/90 dias corridos"). Rota fina:
// toda regra de negócio vive em paymentPlanDomain.ts/paymentPlanService.ts.

import { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../lib/requirePermission';
import {
  createPlan, listPlans, listActivePlans, getPlanWithInstallments, updatePlan, deactivatePlan,
  PaymentPlanDomainError, PaymentPlanServiceError,
} from '../services/paymentPlanService';

export const paymentPlansRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/payment-plans ─────────────────────────────────────────── */
  fastify.get('/payment-plans', {
    onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('payment_plans:view')],
  }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const data = await listPlans(tenantId);
    return { data };
  });

  /* ── GET /v1/payment-plans/active ──────────────────────────────────── */
  // Lista leve pro <select> do pedido/nota — mesmo padrão de /cost-centers/active.
  fastify.get('/payment-plans/active', {
    onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('payment_plans:view')],
  }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const data = await listActivePlans(tenantId);
    return { data };
  });

  /* ── POST /v1/payment-plans ────────────────────────────────────────── */
  fastify.post('/payment-plans', {
    onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('payment_plans:create')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const b = (request.body ?? {}) as Record<string, unknown>;
    try {
      const plan = await createPlan(tenantId, {
        name:         String(b.name ?? ''),
        description:  b.description != null ? String(b.description) : null,
        is_default:   Boolean(b.is_default),
        installments: Array.isArray(b.installments) ? b.installments as any : [],
      });
      return reply.code(201).send(plan);
    } catch (err) {
      if (err instanceof PaymentPlanDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  /* ── GET /v1/payment-plans/:id ─────────────────────────────────────── */
  fastify.get<{ Params: { id: string } }>('/payment-plans/:id', {
    onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('payment_plans:view')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    try {
      return await getPlanWithInstallments(tenantId, request.params.id);
    } catch (err) {
      if (err instanceof PaymentPlanServiceError) return reply.notFound('Plano de pagamento não encontrado');
      throw err;
    }
  });

  /* ── PATCH /v1/payment-plans/:id ───────────────────────────────────── */
  fastify.patch<{ Params: { id: string } }>('/payment-plans/:id', {
    onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('payment_plans:edit')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const b = (request.body ?? {}) as Record<string, unknown>;
    try {
      const plan = await updatePlan(tenantId, request.params.id, {
        name:         b.name != null ? String(b.name) : undefined,
        description:  b.description !== undefined ? (b.description != null ? String(b.description) : null) : undefined,
        is_default:   b.is_default !== undefined ? Boolean(b.is_default) : undefined,
        installments: Array.isArray(b.installments) ? b.installments as any : undefined,
      });
      return plan;
    } catch (err) {
      if (err instanceof PaymentPlanServiceError) return reply.notFound('Plano de pagamento não encontrado');
      if (err instanceof PaymentPlanDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  /* ── DELETE /v1/payment-plans/:id ──────────────────────────────────── */
  // Soft-delete (regra 8) — nunca some dos pedidos/notas que já usaram este plano.
  fastify.delete<{ Params: { id: string } }>('/payment-plans/:id', {
    onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('payment_plans:delete')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    try {
      await deactivatePlan(tenantId, request.params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof PaymentPlanServiceError) return reply.notFound('Plano de pagamento não encontrado');
      throw err;
    }
  });
};
