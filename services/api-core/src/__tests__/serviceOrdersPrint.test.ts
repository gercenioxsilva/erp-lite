import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// GET /v1/service-orders/:id/print — "espelho do técnico": mesmos dados que
// o técnico vê no portal dele (cliente completo, visitas com foto/assinatura),
// deliberadamente sem a tabela de itens (o técnico também não vê itens).

vi.mock('../services/servicePhotoStorageService', () => ({
  getPresignedReadUrl: vi.fn(async (key: string) => `https://s3.example.com/${key}?signed=1`),
}));

const mockDb = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SO_ID     = '22222222-2222-2222-2222-222222222222';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('GET /v1/service-orders/:id/print', () => {
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

  it('devolve dados completos do cliente + visitas com foto e assinatura, sem a tabela de itens', async () => {
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/FROM service_orders so/i.test(text)) {
        return {
          rows: [{
            id: SO_ID, number: '00001', title: 'Manutenção preventiva', description: 'Trocar filtro',
            type: 'maintenance', status: 'completed', created_at: '2026-01-01T00:00:00Z',
            client_name: 'Cliente Teste', client_phone: '1140028922', client_mobile: '11999998888',
            client_email: 'cliente@example.com', client_street: 'Rua A', client_street_number: '100',
            client_complement: null, client_neighborhood: 'Centro', client_city: 'SAO PAULO', client_state: 'SP',
            client_zip_code: '01000000',
          }],
        };
      }
      if (/FROM service_visits sv/i.test(text)) {
        return {
          rows: [{
            id: 'visit-1', status: 'completed', scheduled_at: '2026-01-02T13:00:00Z',
            checked_in_at: '2026-01-02T13:05:00Z', checked_out_at: '2026-01-02T14:00:00Z',
            report_notes: 'Filtro trocado com sucesso', signed_by_name: 'Cliente Teste',
            signed_at: '2026-01-02T14:00:00Z', signature_s3_key: 'tenant/visit-1/signature.png',
            technician_name: 'João Silva',
          }],
        };
      }
      if (/FROM service_visit_photos/i.test(text)) {
        return { rows: [{ id: 'photo-1', caption: 'Antes', created_at: '2026-01-02T13:10:00Z', s3_key: 'tenant/visit-1/photo1.jpg' }] };
      }
      return { rows: [] };
    });

    const res = await app.inject({
      method: 'GET', url: `/v1/service-orders/${SO_ID}/print`,
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toBeUndefined(); // espelho do técnico nunca traz itens
    expect(body.client_name).toBe('Cliente Teste');
    expect(body.client_street).toBe('Rua A');
    expect(body.client_phone).toBe('1140028922');
    expect(body.visits).toHaveLength(1);
    expect(body.visits[0].signature_url).toBe('https://s3.example.com/tenant/visit-1/signature.png?signed=1');
    expect(body.visits[0].signature_s3_key).toBeUndefined(); // chave crua nunca vaza no payload
    expect(body.visits[0].photos).toHaveLength(1);
    expect(body.visits[0].photos[0].url).toBe('https://s3.example.com/tenant/visit-1/photo1.jpg?signed=1');
  });

  it('404 quando a OS não existe', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });

    const res = await app.inject({
      method: 'GET', url: `/v1/service-orders/${SO_ID}/print`,
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/service-orders/${SO_ID}/print` });
    expect(res.statusCode).toBe(401);
  });
});
