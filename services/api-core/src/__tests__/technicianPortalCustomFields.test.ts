import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { CustomFieldDomainError } from '../domain/customFields/customFieldDomain';

// Portal do Técnico — custom_fields do formulário técnico dinâmico
// (migration 0088), repassados em POST .../complete e devolvidos em
// GET .../:id (fieldDefinitions/fieldValues). Service inteiro mockado (já
// coberto em serviceVisitService.test.ts) — aqui só o contrato HTTP.

vi.mock('../services/serviceVisitService', () => ({
  getVisitForTechnician:  vi.fn(),
  listVisitsForTechnician: vi.fn(),
  checkInVisit:            vi.fn(),
  completeVisit:           vi.fn(),
  assertTechnicianOwnsVisit: vi.fn(),
  ServiceVisitDomainError: class ServiceVisitDomainError extends Error {
    code: string; payload?: Record<string, unknown>;
    constructor(code: string, payload?: Record<string, unknown>) { super(code); this.code = code; this.payload = payload; }
  },
}));

vi.mock('../services/servicePhotoStorageService', () => ({
  createPresignedPhotoUpload:     vi.fn(),
  confirmPhotoUpload:              vi.fn(),
  createPresignedSignatureUpload: vi.fn(),
  confirmSignature:                vi.fn(),
  PhotoStorageError: class PhotoStorageError extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  },
}));

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  mockDb.select.mockImplementation(() => ({
    from: (table: unknown) => ({ where: () => Promise.resolve(table === (actual as any).tenantModules ? [{ enabled: true }] : []) }),
  }));
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const VISIT_ID  = 'visit-1';

function technicianToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'technician' });
}

describe('GET /v1/technician/visits/:id — formulário técnico dinâmico', () => {
  let app: FastifyInstance;
  let getVisitForTechnician: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    getVisitForTechnician = (await import('../services/serviceVisitService')).getVisitForTechnician as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('devolve fieldDefinitions e fieldValues junto com visit/order/client', async () => {
    getVisitForTechnician.mockResolvedValue({
      visit: { id: VISIT_ID, status: 'in_progress' },
      order: { id: 'order-1', title: 'Reparo' },
      client: { id: 'client-1' },
      fieldDefinitions: [{ id: 'def-1', label: 'Tem internet no local?', field_type: 'boolean', required: true }],
      fieldValues: [],
    });

    const res = await app.inject({
      method: 'GET', url: `/v1/technician/visits/${VISIT_ID}`,
      headers: { authorization: `Bearer ${technicianToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fieldDefinitions).toHaveLength(1);
    expect(body.fieldDefinitions[0].label).toBe('Tem internet no local?');
    expect(body.fieldValues).toEqual([]);
  });
});

describe('POST /v1/technician/visits/:id/complete — custom_fields', () => {
  let app: FastifyInstance;
  let completeVisit: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    completeVisit = (await import('../services/serviceVisitService')).completeVisit as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('repassa custom_fields do body pro service junto com report_notes', async () => {
    completeVisit.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST', url: `/v1/technician/visits/${VISIT_ID}/complete`,
      headers: { authorization: `Bearer ${technicianToken(app)}` },
      payload: {
        report_notes: 'Tudo certo',
        custom_fields: [{ field_definition_id: 'def-1', value: 'true' }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(completeVisit).toHaveBeenCalledWith(
      expect.objectContaining({
        visitId: VISIT_ID, reportNotes: 'Tudo certo',
        customFields: [{ field_definition_id: 'def-1', value: 'true' }],
      }),
      expect.anything(),
    );
  });

  it('422 field_value_required quando um campo obrigatório do formulário técnico fica sem resposta', async () => {
    completeVisit.mockRejectedValue(new CustomFieldDomainError('field_value_required'));

    const res = await app.inject({
      method: 'POST', url: `/v1/technician/visits/${VISIT_ID}/complete`,
      headers: { authorization: `Bearer ${technicianToken(app)}` },
      payload: { custom_fields: [{ field_definition_id: 'def-1', value: '' }] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('field_value_required');
  });

  it('completa normalmente sem custom_fields (comportamento anterior à feature preservado)', async () => {
    completeVisit.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST', url: `/v1/technician/visits/${VISIT_ID}/complete`,
      headers: { authorization: `Bearer ${technicianToken(app)}` },
      payload: { report_notes: 'Sem campos extras' },
    });

    expect(res.statusCode).toBe(200);
    expect(completeVisit).toHaveBeenCalledWith(
      expect.objectContaining({ visitId: VISIT_ID, reportNotes: 'Sem campos extras', customFields: undefined }),
      expect.anything(),
    );
  });
});
