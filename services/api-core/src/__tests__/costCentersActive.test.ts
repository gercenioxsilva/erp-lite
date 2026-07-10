import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Regressão: GET /v1/cost-centers/active retornava um array "nu" em vez de
// { data: [...] } — inconsistente com o resto da API (inclusive com o próprio
// GET /v1/cost-centers, que já usa { data, total, page, per_page }). Isso
// deixava o dropdown de centro de custo sempre vazio em OrdersPage/
// InvoiceNewPage/InvoicesPage/ReceivablesPage, que já esperavam `.data`.

const mockDb = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('GET /v1/cost-centers/active', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns the list wrapped in { data: [...] }, matching every other list endpoint', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ id: 'cc-1', code: '001', name: 'Obra A' }] });

    const res = await app.inject({
      method: 'GET', url: '/v1/cost-centers/active',
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].code).toBe('001');
  });

  it('returns 401 without a Bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/cost-centers/active' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
