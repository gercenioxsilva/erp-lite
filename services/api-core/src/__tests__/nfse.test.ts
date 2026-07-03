import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { db } from '../db';

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({}),
  }),
}));

// In-memory state the mocked db reads from
const state: { nfseRows: any[] } = { nfseRows: [] };

function makeSelectChain(rows: any[]) {
  // db.select().from().where() resolves to `rows`
  const chain: any = {
    from: () => chain,
    where: () => Promise.resolve(rows),
    orderBy: () => Promise.resolve(rows),
  };
  return chain;
}

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return {
    ...actual,
    db: {
      // GET /v1/nfse and detail use db.execute for the JOIN queries.
      // COUNT(*) queries must return a single { total } row.
      execute: vi.fn(async (query: any) => {
        const text = JSON.stringify(query?.queryChunks ?? query ?? '');
        if (/COUNT/i.test(text)) return { rows: [{ total: state.nfseRows.length }] };
        return { rows: state.nfseRows };
      }),
      select: vi.fn(() => makeSelectChain(state.nfseRows)),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
      insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'nfse-1' }]) }) })),
      transaction: vi.fn(),
    },
  };
});

describe('NFS-e routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.nfseRows = [];
    process.env.NFE_REQUESTS_QUEUE_URL = 'http://localhost/queue/nfe-requests';
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.NFE_REQUESTS_QUEUE_URL;
  });

  describe('GET /v1/nfse', () => {
    it('returns empty array initially', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/nfse?tenant_id=tenant-1' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('requires tenant_id', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/nfse' });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /v1/nfse/:id/emit', () => {
    it('returns 404 for unknown id', async () => {
      state.nfseRows = []; // select(nfse) returns []
      const res = await app.inject({
        method: 'POST',
        url: '/v1/nfse/unknown/emit?tenant_id=tenant-1',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when already processing', async () => {
      state.nfseRows = [{
        id: 'nfse-1', tenant_id: 'tenant-1', nfse_status: 'processing',
        client_id: 'client-1', description: 'svc', amount: '100.00',
        iss_rate: '5.00', iss_value: '5.00', service_code: '14.01',
        period_start: null, period_end: null,
      }];
      const res = await app.inject({
        method: 'POST',
        url: '/v1/nfse/nfse-1/emit?tenant_id=tenant-1',
      });
      expect(res.statusCode).toBe(400);
    });

    it('requires tenant_id', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/nfse/nfse-1/emit' });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('[multi-empresa] resolves via nfse.company_id — usa a Inscrição Municipal daquela empresa, não de uma outra qualquer (regra 40)', async () => {
      state.nfseRows = [{
        id: 'nfse-1', tenant_id: 'tenant-1', nfse_status: null,
        client_id: 'client-1', description: 'svc', amount: '100.00',
        iss_rate: '5.00', iss_value: '5.00', service_code: '14.01',
        period_start: null, period_end: null, company_id: 'company-filial',
      }];
      // resolveCompanyId (companyService) faz a próxima chamada de db.select —
      // simula uma empresa SEM inscrição municipal configurada.
      (db.select as any).mockReturnValueOnce({
        from: () => ({ where: () => Promise.resolve([{ id: 'company-filial', is_active: true, inscricao_municipal: null }]) }),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/nfse/nfse-1/emit?tenant_id=tenant-1',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/Inscrição Municipal/);
    });
  });
});
