import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// PATCH /v1/technicians/:id e POST /v1/technicians/:id/resend-invite — cobre
// o contrato HTTP (status codes, mapeamento de erro de domínio); a lógica em
// si já é testada isoladamente em technicianService.test.ts.

vi.mock('../services/technicianService', () => ({
  createTechnician:        vi.fn(),
  listTechnicians:         vi.fn(),
  setTechnicianActive:     vi.fn(),
  updateTechnician:        vi.fn(),
  resendTechnicianInvite:  vi.fn(),
  TechnicianServiceError: class TechnicianServiceError extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  },
}));

const mockDb = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn() }));
vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TECH_ID   = '22222222-2222-2222-2222-222222222222';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function selectOnce(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

describe('PATCH /v1/technicians/:id', () => {
  let app: FastifyInstance;
  let updateTechnician: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectOnce([{ enabled: true }])); // requireModule('service_orders')
    updateTechnician = (await import('../services/technicianService')).updateTechnician as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('200 quando a edição é bem-sucedida', async () => {
    updateTechnician.mockResolvedValue({ id: TECH_ID, name: 'Novo Nome' });
    const res = await app.inject({
      method: 'PATCH', url: `/v1/technicians/${TECH_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { name: 'Novo Nome' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Novo Nome');
  });

  it('404 quando o técnico não existe', async () => {
    const { TechnicianServiceError } = await import('../services/technicianService');
    updateTechnician.mockRejectedValue(new (TechnicianServiceError as any)('technician_not_found'));
    const res = await app.inject({
      method: 'PATCH', url: `/v1/technicians/${TECH_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { name: 'Novo Nome' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('409 quando o e-mail já pertence a outra conta', async () => {
    const { TechnicianServiceError } = await import('../services/technicianService');
    updateTechnician.mockRejectedValue(new (TechnicianServiceError as any)('email_already_registered'));
    const res = await app.inject({
      method: 'PATCH', url: `/v1/technicians/${TECH_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { email: 'outro@example.com' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/v1/technicians/${TECH_ID}`, payload: { name: 'X' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/technicians/:id/resend-invite', () => {
  let app: FastifyInstance;
  let resendTechnicianInvite: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectOnce([{ enabled: true }]));
    resendTechnicianInvite = (await import('../services/technicianService')).resendTechnicianInvite as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('200 quando o convite é reenviado', async () => {
    resendTechnicianInvite.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'POST', url: `/v1/technicians/${TECH_ID}/resend-invite`,
      headers: { authorization: `Bearer ${token(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('404 quando o técnico não existe', async () => {
    const { TechnicianServiceError } = await import('../services/technicianService');
    resendTechnicianInvite.mockRejectedValue(new (TechnicianServiceError as any)('technician_not_found'));
    const res = await app.inject({
      method: 'POST', url: `/v1/technicians/${TECH_ID}/resend-invite`,
      headers: { authorization: `Bearer ${token(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
