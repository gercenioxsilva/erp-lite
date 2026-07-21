import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// GET /v1/service-orders/visits — Agenda do Técnico (regra 78): leitura por
// período, opcionalmente filtrada por técnico, alimenta o calendário estilo
// Google Agenda do backoffice. Rota estática — nunca deve colidir com
// GET /v1/service-orders/:id mesmo compartilhando o mesmo prefixo.

const mockDb = vi.hoisted(() => ({
  select:  vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'owner' });
}

describe('GET /v1/service-orders/visits — agenda do técnico', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: async () => {
          const actual = await import('../db');
          return table === (actual as any).tenantModules ? [{ enabled: true }] : [];
        },
      }),
    }));
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('400 quando from/to não são informados', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/service-orders/visits',
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/service-orders/visits?from=2026-08-01&to=2026-08-07',
    });
    expect(res.statusCode).toBe(401);
  });

  it('200 devolve visitas do período com ends_at calculado, contrato { data: [...] }', async () => {
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/FROM service_visits sv/i.test(text)) {
        return {
          rows: [{
            id: 'visit-1', service_order_id: 'order-1', scheduled_at: '2026-08-03T13:00:00.000Z',
            duration_minutes: 90, status: 'scheduled', technician_id: 'tech-1', technician_name: 'João',
            service_order_number: '00001', service_order_title: 'Reparo', client_name: 'Cliente X',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await app.inject({
      method: 'GET', url: '/v1/service-orders/visits?from=2026-08-01&to=2026-08-07',
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: 'visit-1', technician_name: 'João', duration_minutes: 90,
      scheduled_at: '2026-08-03T13:00:00.000Z', ends_at: '2026-08-03T14:30:00.000Z',
    });
  });

  it('filtra por technician_id quando informado', async () => {
    let capturedQuery = '';
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/FROM service_visits sv/i.test(text)) { capturedQuery = text; return { rows: [] }; }
      return { rows: [] };
    });

    const res = await app.inject({
      method: 'GET', url: '/v1/service-orders/visits?from=2026-08-01&to=2026-08-07&technician_id=tech-1',
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(capturedQuery).toContain('tech-1');
  });

  it('não colide com GET /v1/service-orders/:id (rota estática tem prioridade)', async () => {
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      // Se a rota parametrizada tivesse capturado "visits" como :id, cairia
      // aqui — as tabelas de SELECT são completamente diferentes.
      if (/FROM service_orders so/i.test(text)) return { rows: [] };
      return { rows: [] };
    });

    const res = await app.inject({
      method: 'GET', url: '/v1/service-orders/visits?from=2026-08-01&to=2026-08-07',
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('data');
  });
});
