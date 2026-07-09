import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Rotas de Funcionários são finas — mockamos o service inteiro (já testado
// isoladamente em employeeService.test.ts) e verificamos o contrato HTTP:
// os DOIS gates (requireModule('hr') + requirePermission('employees', ...)),
// nessa ordem, e o mapeamento de erro de domínio.

vi.mock('../services/hr/employeeService', () => ({
  listEmployees: vi.fn(), createEmployee: vi.fn(), updateEmployee: vi.fn(),
  deactivateEmployee: vi.fn(), getEmployee: vi.fn(),
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

function selectOnce(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

function ownerToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'owner-1', role: 'owner' });
}

describe('rotas de /v1/employees', () => {
  let app: FastifyInstance;
  let svc: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    svc = await import('../services/hr/employeeService') as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('403 quando o módulo hr não está habilitado (requireModule roda antes de requirePermission)', async () => {
    mockDb.select.mockReturnValue(selectOnce([])); // isModuleEnabled → false
    const res = await app.inject({
      method: 'GET', url: '/v1/employees',
      headers: { authorization: `Bearer ${ownerToken(app)}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('ModuleNotEnabled');
    expect(svc.listEmployees).not.toHaveBeenCalled();
  });

  it('200 quando módulo habilitado e owner (bypass de permissão)', async () => {
    mockDb.select
      .mockReturnValueOnce(selectOnce([{ enabled: true }])) // isModuleEnabled
      .mockReturnValueOnce(selectOnce([{ role: 'owner', access_profile_id: null }])); // getEffectivePermissions
    svc.listEmployees.mockResolvedValue([{ id: 'emp-1', name: 'Fulano' }]);

    const res = await app.inject({
      method: 'GET', url: '/v1/employees',
      headers: { authorization: `Bearer ${ownerToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('POST /employees 422 quando o service lança erro de domínio', async () => {
    mockDb.select
      .mockReturnValueOnce(selectOnce([{ enabled: true }]))
      .mockReturnValueOnce(selectOnce([{ role: 'owner', access_profile_id: null }]));
    const { PayrollDomainError } = await import('../services/hr/employeeService');
    svc.createEmployee.mockRejectedValue(new (PayrollDomainError as any)('employee_cpf_invalid'));

    const res = await app.inject({
      method: 'POST', url: '/v1/employees',
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { name: 'Fulano', cpf: '123', regime: 'clt', base_salary: 3000, hire_date: '2026-01-01' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('employee_cpf_invalid');
  });

  it('POST /employees 201 quando tudo ok', async () => {
    mockDb.select
      .mockReturnValueOnce(selectOnce([{ enabled: true }]))
      .mockReturnValueOnce(selectOnce([{ role: 'owner', access_profile_id: null }]));
    svc.createEmployee.mockResolvedValue({ id: 'emp-1', name: 'Fulano' });

    const res = await app.inject({
      method: 'POST', url: '/v1/employees',
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { name: 'Fulano', cpf: '11144477735', regime: 'clt', base_salary: 3000, hire_date: '2026-01-01' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/employees' });
    expect(res.statusCode).toBe(401);
  });
});
