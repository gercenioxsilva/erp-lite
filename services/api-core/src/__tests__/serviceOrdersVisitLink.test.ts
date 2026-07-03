import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// GET /v1/service-orders/:id — o link de roteamento do técnico (regra 38) deve
// vir pronto para uso (visit_link) e com link_valid calculado (status + expiração),
// para o backoffice poder reenviar manualmente por WhatsApp.

const mockDb = vi.hoisted(() => ({
  select:  vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  mockDb.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => Promise.resolve(table === actual.tenantModules ? [{ enabled: true }] : []),
    }),
  }));
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SO_ID     = '22222222-2222-2222-2222-222222222222';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('GET /v1/service-orders/:id — link do técnico', () => {
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

  it('retorna visit_link pronto e link_valid=true para visita agendada com token não expirado', async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/FROM service_orders so/i.test(text)) return { rows: [{ id: SO_ID, number: '00001', title: 'OS Teste', status: 'scheduled' }] };
      if (/FROM service_order_items/i.test(text)) return { rows: [] };
      if (/FROM service_visits sv/i.test(text)) {
        return { rows: [{ id: 'visit-1', status: 'scheduled', scheduled_at: future, routing_token: 'abc123', token_expires_at: future }] };
      }
      return { rows: [] };
    });

    const res = await app.inject({
      method: 'GET', url: `/v1/service-orders/${SO_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.visits[0].visit_link).toContain('/tecnico/entrar?redirect=/tecnico/visitas/visit-1&rt=abc123');
    expect(body.visits[0].link_valid).toBe(true);
    expect(body.visits[0].routing_token).toBeUndefined(); // token bruto nunca vaza no payload
  });

  it('retorna link_valid=false para visita já concluída, mesmo com token não expirado', async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/FROM service_orders so/i.test(text)) return { rows: [{ id: SO_ID, number: '00001', title: 'OS Teste', status: 'completed' }] };
      if (/FROM service_order_items/i.test(text)) return { rows: [] };
      if (/FROM service_visits sv/i.test(text)) {
        return { rows: [{ id: 'visit-1', status: 'completed', scheduled_at: future, routing_token: 'abc123', token_expires_at: future }] };
      }
      return { rows: [] };
    });

    const res = await app.inject({
      method: 'GET', url: `/v1/service-orders/${SO_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().visits[0].link_valid).toBe(false);
  });
});
