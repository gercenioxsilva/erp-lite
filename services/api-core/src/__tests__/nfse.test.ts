import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { db, nfeConfigs } from '../db';

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({}),
  }),
}));

// In-memory state the mocked db reads from
const state: { nfseRows: any[]; companyRows: any[]; clientRows: any[] } = { nfseRows: [], companyRows: [], clientRows: [] };

function makeSelectChain() {
  // db.select().from(table).where() resolves por tabela — discriminar por
  // tabela (não por ordem de chamada) evita acoplamento frágil quando mais
  // de um db.select() acontece na mesma requisição (ex.: nfse row + empresa).
  return {
    from: (table: unknown) => ({
      where: () => Promise.resolve(table === nfeConfigs ? state.companyRows : state.nfseRows),
      orderBy: () => Promise.resolve(table === nfeConfigs ? state.companyRows : state.nfseRows),
    }),
  };
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
        if (/COUNT/i.test(text))          return { rows: [{ total: state.nfseRows.length }] };
        if (/FROM clients/i.test(text))  return { rows: state.clientRows };
        return { rows: state.nfseRows };
      }),
      select: vi.fn(() => makeSelectChain()),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
      insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'nfse-1' }]) }) })),
      transaction: vi.fn(),
    },
  };
});

describe('NFS-e routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    state.nfseRows = [];
    state.companyRows = [];
    state.clientRows = [];
    process.env.NFE_REQUESTS_QUEUE_URL = 'http://localhost/queue/nfe-requests';
    app = await buildApp();
    // Sign a fake JWT so authenticate passes — tenantId matches the value the
    // mocked data/queries below expect ('tenant-1').
    token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
  });

  afterEach(async () => {
    await app.close();
    delete process.env.NFE_REQUESTS_QUEUE_URL;
  });

  describe('GET /v1/nfse', () => {
    it('returns empty array initially', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/nfse?tenant_id=tenant-1',
        headers: { Authorization: `Bearer ${token}` },
      });
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
        headers: { Authorization: `Bearer ${token}` },
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
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('requires tenant_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/nfse/nfse-1/emit',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('[multi-empresa] resolves via nfse.company_id — usa a Inscrição Municipal daquela empresa, não de uma outra qualquer (regra 40)', async () => {
      state.nfseRows = [{
        id: 'nfse-1', tenant_id: 'tenant-1', nfse_status: null,
        client_id: 'client-1', description: 'svc', amount: '100.00',
        iss_rate: '5.00', iss_value: '5.00', service_code: '14.01',
        period_start: null, period_end: null, company_id: 'company-filial',
      }];
      // resolveCompanyId (companyService) lê nfe_configs — simula uma empresa
      // responsável por NFS-e mas SEM inscrição municipal configurada.
      state.companyRows = [{ id: 'company-filial', is_active: true, emite_nfse: true, inscricao_municipal: null }];

      const res = await app.inject({
        method: 'POST',
        url: '/v1/nfse/nfse-1/emit?tenant_id=tenant-1',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/Inscrição Municipal/);
    });

    it('[regressão — "permissao_negada: CNPJ do emitente não autorizado"] bloqueia em produção sem token de produção, antes de enfileirar', async () => {
      state.nfseRows = [{
        id: 'nfse-1', tenant_id: 'tenant-1', nfse_status: null,
        client_id: 'client-1', description: 'svc', amount: '100.00',
        iss_rate: '5.00', iss_value: '5.00', service_code: '14.01',
        period_start: null, period_end: null, company_id: 'company-1',
      }];
      state.companyRows = [{
        id: 'company-1', is_active: true, emite_nfse: true, inscricao_municipal: '12345',
        focus_ambiente: 1, focus_token_producao: null,
      }];

      const sqsMock = (await import('../lib/sqsClient')).getSqsClient();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/nfse/nfse-1/emit?tenant_id=tenant-1',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/token de Produção/);
      expect(sqsMock.send).not.toHaveBeenCalled();
    });
  });

  // NFS-e avulsa — mesma UX de "nota fiscal de venda avulsa" (POST /v1/invoices):
  // cria o rascunho aqui, a emissão em si continua sendo POST /:id/emit acima.
  describe('POST /v1/nfse', () => {
    const BASE_PAYLOAD = {
      client_id: 'client-1', description: 'Consultoria avulsa', amount: 500,
    };

    it('400 sem client_id', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/nfse',
        headers: { Authorization: `Bearer ${token}` },
        payload: { description: 'svc', amount: 100 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400 sem amount > 0', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/nfse',
        headers: { Authorization: `Bearer ${token}` },
        payload: { client_id: 'client-1', description: 'svc', amount: 0 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400 quando o cliente não pertence ao tenant', async () => {
      state.clientRows = [];
      const res = await app.inject({
        method: 'POST', url: '/v1/nfse',
        headers: { Authorization: `Bearer ${token}` },
        payload: BASE_PAYLOAD,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/Cliente/);
    });

    it('400 quando a empresa resolvida não tem Inscrição Municipal configurada', async () => {
      state.clientRows = [{ id: 'client-1' }];
      state.companyRows = [{ id: 'company-1', is_active: true, is_default: true, emite_nfse: true, inscricao_municipal: null }];
      const res = await app.inject({
        method: 'POST', url: '/v1/nfse',
        headers: { Authorization: `Bearer ${token}` },
        payload: BASE_PAYLOAD,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/Inscrição Municipal/);
    });

    it('201 e calcula iss_value a partir da alíquota padrão da empresa quando iss_rate não é informado', async () => {
      state.clientRows = [{ id: 'client-1' }];
      state.companyRows = [{
        id: 'company-1', is_active: true, is_default: true, emite_nfse: true,
        inscricao_municipal: '12345', codigo_servico_padrao: '14.01', aliquota_iss_padrao: '5.00',
      }];
      const res = await app.inject({
        method: 'POST', url: '/v1/nfse',
        headers: { Authorization: `Bearer ${token}` },
        payload: BASE_PAYLOAD,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toBe('nfse-1');
    });

    it('400 quando não há service_code (nem no body, nem configurado na empresa)', async () => {
      state.clientRows = [{ id: 'client-1' }];
      state.companyRows = [{
        id: 'company-1', is_active: true, is_default: true, emite_nfse: true,
        inscricao_municipal: '12345', codigo_servico_padrao: null, aliquota_iss_padrao: '5.00',
      }];
      const res = await app.inject({
        method: 'POST', url: '/v1/nfse',
        headers: { Authorization: `Bearer ${token}` },
        payload: BASE_PAYLOAD,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/Código de serviço/);
    });

    it('401 sem token de autenticação', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/nfse', payload: BASE_PAYLOAD });
      expect(res.statusCode).toBe(401);
    });
  });
});
