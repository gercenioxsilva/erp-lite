import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Rotas de Folha de Pagamento são finas — mockamos o service inteiro (já
// testado isoladamente em payrollService.test.ts). O gate duplo
// (requireModule('hr') + requirePermission('payroll', ...)) já foi provado
// em employeesRoute.test.ts com o mesmo mecanismo — aqui o foco é o
// contrato HTTP específico de cada rota de folha.

vi.mock('../services/hr/payrollService', () => ({
  listPayrollRuns: vi.fn(), getPayrollRun: vi.fn(), createPayrollRun: vi.fn(),
  updatePayrollEntryAdjustments: vi.fn(), closePayrollRun: vi.fn(), getPayslip: vi.fn(),
  PayrollDomainError: class PayrollDomainError extends Error {
    code: string; payload?: Record<string, unknown>;
    constructor(code: string, payload?: Record<string, unknown>) { super(code); this.code = code; this.payload = payload; }
  },
}));

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RUN_ID    = '22222222-2222-2222-2222-222222222222';
const ENTRY_ID  = '33333333-3333-3333-3333-333333333333';

function selectOnce(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

function ownerToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'owner-1', role: 'owner' });
}

function mockGates() {
  mockDb.select
    .mockReturnValueOnce(selectOnce([{ enabled: true }])) // requireModule('hr')
}

describe('rotas de /v1/payroll', () => {
  let app: FastifyInstance;
  let svc: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    svc = await import('../services/hr/payrollService') as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('POST /payroll 400 sem reference_month', async () => {
    mockGates();
    const res = await app.inject({
      method: 'POST', url: '/v1/payroll',
      headers: { authorization: `Bearer ${ownerToken(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(svc.createPayrollRun).not.toHaveBeenCalled();
  });

  it('POST /payroll 201 quando reference_month é informado', async () => {
    mockGates();
    svc.createPayrollRun.mockResolvedValue({ id: RUN_ID, status: 'draft' });
    const res = await app.inject({
      method: 'POST', url: '/v1/payroll',
      headers: { authorization: `Bearer ${ownerToken(app)}` }, payload: { reference_month: '2026-07-01' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('POST /payroll 422 quando o mês já foi gerado', async () => {
    mockGates();
    const { PayrollDomainError } = await import('../services/hr/payrollService');
    svc.createPayrollRun.mockRejectedValue(new (PayrollDomainError as any)('payroll_run_already_exists'));
    const res = await app.inject({
      method: 'POST', url: '/v1/payroll',
      headers: { authorization: `Bearer ${ownerToken(app)}` }, payload: { reference_month: '2026-07-01' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('POST /payroll/:id/close 200 e repassa userId', async () => {
    mockGates();
    svc.closePayrollRun.mockResolvedValue({ id: RUN_ID, status: 'closed' });
    const res = await app.inject({
      method: 'POST', url: `/v1/payroll/${RUN_ID}/close`,
      headers: { authorization: `Bearer ${ownerToken(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('closed');
  });

  it('POST /payroll/:id/close 422 quando a folha já está fechada', async () => {
    mockGates();
    const { PayrollDomainError } = await import('../services/hr/payrollService');
    svc.closePayrollRun.mockRejectedValue(new (PayrollDomainError as any)('payroll_run_not_draft'));
    const res = await app.inject({
      method: 'POST', url: `/v1/payroll/${RUN_ID}/close`,
      headers: { authorization: `Bearer ${ownerToken(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it('GET /payroll/entries/:id/print 200 com o holerite', async () => {
    mockGates();
    svc.getPayslip.mockResolvedValue({ entry: { id: ENTRY_ID, employee_name: 'Fulano' }, referenceMonth: '2026-07-01' });
    const res = await app.inject({
      method: 'GET', url: `/v1/payroll/entries/${ENTRY_ID}/print`,
      headers: { authorization: `Bearer ${ownerToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().entry.employee_name).toBe('Fulano');
  });

  it('PATCH /payroll/entries/:id 422 quando a folha já está fechada', async () => {
    mockGates();
    const { PayrollDomainError } = await import('../services/hr/payrollService');
    svc.updatePayrollEntryAdjustments.mockRejectedValue(new (PayrollDomainError as any)('payroll_run_closed'));
    const res = await app.inject({
      method: 'PATCH', url: `/v1/payroll/entries/${ENTRY_ID}`,
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { extra_earnings: [{ description: 'Hora extra', amount: 100 }] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/payroll' });
    expect(res.statusCode).toBe(401);
  });
});
