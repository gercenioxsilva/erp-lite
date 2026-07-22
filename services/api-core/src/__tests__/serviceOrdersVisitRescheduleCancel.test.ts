import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// PATCH /v1/service-orders/:id/visits/:visitId (reagendar) e
// POST /v1/service-orders/:id/visits/:visitId/cancel (cancelar) — extensão
// da Agenda do Técnico (regra 78). Service inteiro mockado (já coberto em
// serviceVisitService.test.ts) — aqui só o contrato HTTP.

vi.mock('../services/serviceVisitService', () => ({
  scheduleVisit:          vi.fn(),
  rescheduleVisit:        vi.fn(),
  cancelVisit:             vi.fn(),
  buildVisitLink:          vi.fn(() => 'https://example.com/link'),
  ServiceVisitDomainError: class ServiceVisitDomainError extends Error {
    code: string; payload?: Record<string, unknown>;
    constructor(code: string, payload?: Record<string, unknown>) { super(code); this.code = code; this.payload = payload; }
  },
}));

vi.mock('../services/serviceVisitFieldService', () => ({
  getFieldValuesForVisit: vi.fn().mockResolvedValue([]),
}));

const mockDb = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  mockDb.select.mockImplementation(() => ({
    from: (table: unknown) => ({ where: () => Promise.resolve(table === (actual as any).tenantModules ? [{ enabled: true }] : []) }),
  }));
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SO_ID     = '22222222-2222-2222-2222-222222222222';
const VISIT_ID  = '33333333-3333-3333-3333-333333333333';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('PATCH /v1/service-orders/:id/visits/:visitId — reagendar', () => {
  let app: FastifyInstance;
  let rescheduleVisit: ReturnType<typeof vi.fn>;
  let ServiceVisitDomainError: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../services/serviceVisitService');
    rescheduleVisit = mod.rescheduleVisit as any;
    ServiceVisitDomainError = mod.ServiceVisitDomainError;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('200 quando reagendado com sucesso', async () => {
    rescheduleVisit.mockResolvedValue({ id: VISIT_ID, scheduled_at: '2026-08-01T13:00:00.000Z', duration_minutes: 60 });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/service-orders/${SO_ID}/visits/${VISIT_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { scheduled_at: '2026-08-01T13:00:00.000Z' },
    });

    expect(res.statusCode).toBe(200);
    expect(rescheduleVisit).toHaveBeenCalledWith(
      expect.objectContaining({ visitId: VISIT_ID, tenantId: TENANT_ID }),
    );
  });

  it('400 quando scheduled_at não é informado', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/service-orders/${SO_ID}/visits/${VISIT_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(rescheduleVisit).not.toHaveBeenCalled();
  });

  it('422 visit_conflict quando o novo horário colide com outra visita', async () => {
    rescheduleVisit.mockRejectedValue(new ServiceVisitDomainError('visit_conflict', { conflicting: { visit_id: 'other' } }));

    const res = await app.inject({
      method: 'PATCH', url: `/v1/service-orders/${SO_ID}/visits/${VISIT_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { scheduled_at: '2026-08-01T13:00:00.000Z' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('visit_conflict');
  });

  it('404 quando a visita não existe', async () => {
    rescheduleVisit.mockRejectedValue(new ServiceVisitDomainError('visit_not_found'));

    const res = await app.inject({
      method: 'PATCH', url: `/v1/service-orders/${SO_ID}/visits/${VISIT_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { scheduled_at: '2026-08-01T13:00:00.000Z' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/service-orders/${SO_ID}/visits/${VISIT_ID}`,
      payload: { scheduled_at: '2026-08-01T13:00:00.000Z' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/service-orders/:id/visits/:visitId/cancel — cancelar', () => {
  let app: FastifyInstance;
  let cancelVisit: ReturnType<typeof vi.fn>;
  let ServiceVisitDomainError: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../services/serviceVisitService');
    cancelVisit = mod.cancelVisit as any;
    ServiceVisitDomainError = mod.ServiceVisitDomainError;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('200 quando cancelado com sucesso', async () => {
    cancelVisit.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST', url: `/v1/service-orders/${SO_ID}/visits/${VISIT_ID}/cancel`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'cancelled' });
    expect(cancelVisit).toHaveBeenCalledWith({ visitId: VISIT_ID, tenantId: TENANT_ID });
  });

  it('422 visit_cannot_cancel quando a visita já está num estado terminal', async () => {
    cancelVisit.mockRejectedValue(new ServiceVisitDomainError('visit_cannot_cancel', { status: 'completed' }));

    const res = await app.inject({
      method: 'POST', url: `/v1/service-orders/${SO_ID}/visits/${VISIT_ID}/cancel`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('visit_cannot_cancel');
  });

  it('404 quando a visita não existe', async () => {
    cancelVisit.mockRejectedValue(new ServiceVisitDomainError('visit_not_found'));

    const res = await app.inject({
      method: 'POST', url: `/v1/service-orders/${SO_ID}/visits/${VISIT_ID}/cancel`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/service-orders/${SO_ID}/visits/${VISIT_ID}/cancel` });
    expect(res.statusCode).toBe(401);
  });
});
