import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// POST /v1/service-orders/:id/billing — a rota é só um adapter fino: recebe
// o body HTTP, delega ao service (billServiceOrder, já testado
// isoladamente em serviceOrderBillingService.test.ts) e traduz erro de
// domínio pra 422. Aqui testamos o contrato HTTP, não a regra de negócio.

vi.mock('../services/serviceOrderBillingService', () => ({
  billServiceOrder: vi.fn(),
  ServiceOrderBillingDomainError: class ServiceOrderBillingDomainError extends Error {
    code: string; payload?: Record<string, unknown>;
    constructor(code: string, payload?: Record<string, unknown>) { super(code); this.code = code; this.payload = payload; }
  },
}));

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

function selectOnce(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SO_ID     = '22222222-2222-2222-2222-222222222222';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('POST /v1/service-orders/:id/billing', () => {
  let app: FastifyInstance;
  let billServiceOrder: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // requireModule('service_orders') sempre precisa do módulo habilitado
    // pra chegar na rota — mesmo padrão de marketplaceIntegration.test.ts.
    mockDb.select.mockReturnValue(selectOnce([{ enabled: true }]));
    billServiceOrder = (await import('../services/serviceOrderBillingService')).billServiceOrder as any;
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('retorna 401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/service-orders/${SO_ID}/billing`, payload: {} });
    expect(res.statusCode).toBe(401);
    expect(billServiceOrder).not.toHaveBeenCalled();
  });

  it('403 quando o módulo service_orders não está habilitado para o tenant', async () => {
    mockDb.select.mockReturnValue(selectOnce([])); // isModuleEnabled → false
    const res = await app.inject({
      method: 'POST', url: `/v1/service-orders/${SO_ID}/billing`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(billServiceOrder).not.toHaveBeenCalled();
  });

  it('201 e repassa due_date/emit_nfse/company_id ao service', async () => {
    billServiceOrder.mockResolvedValue({ receivable_id: 'rec-1', nfse_id: 'nfse-1', nfse_status: 'processing' });

    const res = await app.inject({
      method: 'POST', url: `/v1/service-orders/${SO_ID}/billing`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { due_date: '2026-08-01', emit_nfse: true, company_id: 'company-1' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ receivable_id: 'rec-1', nfse_id: 'nfse-1', nfse_status: 'processing' });
    expect(billServiceOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID, serviceOrderId: SO_ID,
        dueDate: '2026-08-01', emitNfse: true, companyId: 'company-1',
      }),
      expect.anything(),
    );
  });

  it('traduz ServiceOrderBillingDomainError em 422 com o código do erro', async () => {
    const { ServiceOrderBillingDomainError } = await import('../services/serviceOrderBillingService');
    billServiceOrder.mockRejectedValue(new (ServiceOrderBillingDomainError as any)('service_order_already_billed'));

    const res = await app.inject({
      method: 'POST', url: `/v1/service-orders/${SO_ID}/billing`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: {},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('service_order_already_billed');
  });

  it('emit_nfse ausente no body vira false (não trava a rota exigindo o campo)', async () => {
    billServiceOrder.mockResolvedValue({ receivable_id: 'rec-1', nfse_id: null, nfse_status: null });

    const res = await app.inject({
      method: 'POST', url: `/v1/service-orders/${SO_ID}/billing`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: {},
    });

    expect(res.statusCode).toBe(201);
    expect(billServiceOrder).toHaveBeenCalledWith(
      expect.objectContaining({ emitNfse: false }),
      expect.anything(),
    );
  });
});
