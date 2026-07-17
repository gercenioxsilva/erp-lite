import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// GET /v1/projects/:id — traz o relatório de acompanhamento embutido no
// mesmo response (sem endpoint /report separado, mesmo padrão de GET
// /service-orders/:id dobrar billing/nfse). Cobre a origem dupla de
// faturamento: pedidos faturam via invoices.order_id, OS fatura via
// receivables.service_order_id (nunca invoices — regra 47/48).

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';

const mockDb = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function textOf(query: any): string {
  return JSON.stringify(query?.queryChunks ?? query ?? '');
}

describe('GET /v1/projects/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ enabled: true }]) }) });
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('calcula o relatório a partir de pedidos (invoices) e OS (receivables) vinculados', async () => {
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = textOf(query);
      if (/orders_invoiced_total/i.test(text)) {
        return {
          rows: [{
            orders_total: '3000.00', orders_invoiced_total: '2000.00',
            service_orders_total: '1000.00', service_orders_billed_total: '500.00',
          }],
        };
      }
      if (/FROM project_professionals/i.test(text)) {
        return { rows: [{ id: 'alloc-1', professional_type: 'seller', seller_id: 'seller-1', technician_id: null, commission_pct: '4.00', professional_name: 'Vendedor X' }] };
      }
      if (/FROM orders o\b/i.test(text)) {
        return { rows: [{ id: 'order-1', number: '00010', status: 'confirmed', total: '3000.00', client_name: 'ACME' }] };
      }
      if (/FROM service_orders so\b/i.test(text)) {
        return { rows: [{ id: 'so-1', number: '00005', title: 'Manutenção', status: 'completed', total: '1000.00', client_name: 'ACME' }] };
      }
      if (/FROM projects p\b/i.test(text)) {
        return { rows: [{ id: PROJECT_ID, number: '00001', name: 'Reforma Loja A', total_value: '10000.00', status: 'in_progress', client_name: 'ACME' }] };
      }
      return { rows: [] };
    });

    const res = await app.inject({
      method: 'GET', url: `/v1/projects/${PROJECT_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.report).toEqual({
      goodsServicesConsumed: 4000,
      goodsServicesInvoiced: 2500,
      budgetConsumedPct: 40,
      budgetInvoicedPct: 25,
    });
    expect(body.professionals).toHaveLength(1);
    expect(body.orders).toHaveLength(1);
    expect(body.service_orders).toHaveLength(1);
  });

  it('404 quando o projeto não existe', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });

    const res = await app.inject({
      method: 'GET', url: `/v1/projects/${PROJECT_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
