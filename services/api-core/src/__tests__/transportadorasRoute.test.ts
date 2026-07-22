import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Mesmo molde de sellers.test.ts (CRUD simples, sem service dedicado) —
// transportadoras.ts é rota fina que só chama o domínio puro
// (transportadoraDomain.ts, já testado isoladamente) e o banco.

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({}) }),
}));

const state: { rows: any[] } = { rows: [] };

function makeSelectChain(rows: any[]) {
  const chain: any = {
    from:    () => chain,
    where:   () => Promise.resolve(rows),
    orderBy: () => Promise.resolve(rows),
  };
  return chain;
}

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return {
    ...actual,
    db: {
      execute: vi.fn(async (query: any) => {
        const text = JSON.stringify(query?.queryChunks ?? query ?? '');
        if (/COUNT/i.test(text)) return { rows: [{ count: String(state.rows.length) }] };
        return { rows: state.rows };
      }),
      select: vi.fn(() => makeSelectChain(state.rows)),
      insert: vi.fn(() => ({ values: (v: Record<string, unknown>) => ({ returning: () => Promise.resolve([{ id: 'transp-1', ...v }]) }) })),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve({ rowCount: 1 }) }) })),
    },
    transportadoras: actual.transportadoras ?? {},
  };
});

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
}

describe('Transportadoras routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.rows = [];
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  describe('GET /v1/transportadoras', () => {
    it('devolve lista vazia com total=0 quando não há transportadoras', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/transportadoras', headers: { authorization: `Bearer ${token(app)}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ data: [], total: 0 });
    });

    it('401 sem token', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/transportadoras' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /v1/transportadoras/active', () => {
    it('devolve envelope {data:[...]}, mesmo padrão de todo endpoint /active', async () => {
      state.rows = [{ id: 'transp-1', name: 'Transportadora X', person_type: 'PJ' }];
      const res = await app.inject({ method: 'GET', url: '/v1/transportadoras/active', headers: { authorization: `Bearer ${token(app)}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: state.rows });
    });
  });

  describe('POST /v1/transportadoras', () => {
    it('201 com PJ + CNPJ válido', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/transportadoras',
        headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Transportadora Rápida', person_type: 'PJ', document: '11.444.777/0001-61' }),
      });
      expect(res.statusCode).toBe(201);
    });

    it('201 sem documento (opcional no cadastro)', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/transportadoras',
        headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Transportadora Sem Doc' }),
      });
      expect(res.statusCode).toBe(201);
    });

    it('422 quando o nome está vazio', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/transportadoras',
        headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ name: '' }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('transportadora_name_required');
    });

    it('422 quando o CNPJ é inválido pra PJ', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/transportadoras',
        headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'X', person_type: 'PJ', document: '00000000000000' }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('transportadora_document_invalid');
    });
  });

  describe('GET /v1/transportadoras/:id', () => {
    it('404 pra id inexistente', async () => {
      state.rows = [];
      const res = await app.inject({ method: 'GET', url: '/v1/transportadoras/nope', headers: { authorization: `Bearer ${token(app)}` } });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /v1/transportadoras/:id', () => {
    it('204 quando desativa com sucesso (soft delete)', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/v1/transportadoras/transp-1', headers: { authorization: `Bearer ${token(app)}` } });
      expect(res.statusCode).toBe(204);
    });
  });
});
