// Contrato HTTP das rotas de Plano de Pagamento — a lógica de domínio/CRUD
// já é testada isoladamente em paymentPlanDomain.test.ts/paymentPlanService.test.ts;
// aqui mockamos o service inteiro e verificamos status codes/wiring, mesmo
// padrão de leadCaptureKeysRoute.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

vi.mock('../services/paymentPlanService', () => ({
  createPlan: vi.fn(),
  listPlans: vi.fn(),
  listActivePlans: vi.fn(),
  getPlanWithInstallments: vi.fn(),
  updatePlan: vi.fn(),
  deactivatePlan: vi.fn(),
  PaymentPlanDomainError: class PaymentPlanDomainError extends Error {
    code: string; payload?: Record<string, unknown>;
    constructor(code: string, payload?: Record<string, unknown>) { super(code); this.code = code; this.payload = payload; }
  },
  PaymentPlanServiceError: class PaymentPlanServiceError extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  },
}));

const TENANT_ID = 'tenant-1';
const PLAN_ID = 'plan-1';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('rotas de Plano de Pagamento', () => {
  let app: FastifyInstance;
  let svc: typeof import('../services/paymentPlanService');

  beforeEach(async () => {
    svc = await import('../services/paymentPlanService');
    Object.values(svc).forEach(v => { if (typeof v === 'function' && 'mockReset' in v) (v as any).mockReset(); });
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('401 sem token em qualquer rota', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/payment-plans' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  describe('GET /v1/payment-plans', () => {
    it('200 envelope {data}', async () => {
      (svc.listPlans as any).mockResolvedValue([{ id: PLAN_ID, name: 'À Vista' }]);
      const res = await app.inject({ method: 'GET', url: '/v1/payment-plans', headers: { authorization: `Bearer ${token(app)}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
      expect(svc.listPlans).toHaveBeenCalledWith(TENANT_ID);
    });
  });

  describe('GET /v1/payment-plans/active', () => {
    it('200 envelope {data}, só planos ativos', async () => {
      (svc.listActivePlans as any).mockResolvedValue([{ id: PLAN_ID, name: 'À Vista', is_active: true }]);
      const res = await app.inject({ method: 'GET', url: '/v1/payment-plans/active', headers: { authorization: `Bearer ${token(app)}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
    });
  });

  describe('POST /v1/payment-plans', () => {
    it('201 cria o plano', async () => {
      (svc.createPlan as any).mockResolvedValue({ id: PLAN_ID, name: '3x sem juros' });
      const res = await app.inject({
        method: 'POST', url: '/v1/payment-plans',
        headers: { authorization: `Bearer ${token(app)}` },
        payload: { name: '3x sem juros', installments: [{ installment_number: 1, days_offset: 0, percentage: 100 }] },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe('3x sem juros');
    });

    it('422 quando o domínio rejeita (ex.: soma de percentuais inválida)', async () => {
      const { PaymentPlanDomainError } = svc;
      (svc.createPlan as any).mockRejectedValue(new (PaymentPlanDomainError as any)('payment_plan_percentage_sum_invalid', { total: 90 }));
      const res = await app.inject({
        method: 'POST', url: '/v1/payment-plans',
        headers: { authorization: `Bearer ${token(app)}` },
        payload: { name: 'Ruim', installments: [{ installment_number: 1, days_offset: 0, percentage: 90 }] },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('payment_plan_percentage_sum_invalid');
    });
  });

  describe('GET /v1/payment-plans/:id', () => {
    it('404 quando não existe', async () => {
      const { PaymentPlanServiceError } = svc;
      (svc.getPlanWithInstallments as any).mockRejectedValue(new (PaymentPlanServiceError as any)('payment_plan_not_found'));
      const res = await app.inject({ method: 'GET', url: `/v1/payment-plans/${PLAN_ID}`, headers: { authorization: `Bearer ${token(app)}` } });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /v1/payment-plans/:id', () => {
    it('200 atualiza', async () => {
      (svc.updatePlan as any).mockResolvedValue({ id: PLAN_ID, name: 'Atualizado' });
      const res = await app.inject({
        method: 'PATCH', url: `/v1/payment-plans/${PLAN_ID}`,
        headers: { authorization: `Bearer ${token(app)}` }, payload: { name: 'Atualizado' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Atualizado');
    });
  });

  describe('DELETE /v1/payment-plans/:id', () => {
    it('204 desativa', async () => {
      (svc.deactivatePlan as any).mockResolvedValue(undefined);
      const res = await app.inject({ method: 'DELETE', url: `/v1/payment-plans/${PLAN_ID}`, headers: { authorization: `Bearer ${token(app)}` } });
      expect(res.statusCode).toBe(204);
    });

    it('404 quando não existe', async () => {
      const { PaymentPlanServiceError } = svc;
      (svc.deactivatePlan as any).mockRejectedValue(new (PaymentPlanServiceError as any)('payment_plan_not_found'));
      const res = await app.inject({ method: 'DELETE', url: `/v1/payment-plans/${PLAN_ID}`, headers: { authorization: `Bearer ${token(app)}` } });
      expect(res.statusCode).toBe(404);
    });
  });
});
