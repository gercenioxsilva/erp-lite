import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listEmployees, createEmployee, updateEmployee, deactivateEmployee, getEmployee } from '../services/hr/employeeService';
import type { DrizzleDB } from '../services/hr/employeeService';

const TENANT_ID   = 'tenant-1';
const EMPLOYEE_ID = 'employee-1';
const VALID_CPF   = '111.444.777-35';

function baseEmployeeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EMPLOYEE_ID, tenant_id: TENANT_ID, name: 'Fulano', cpf: '11144477735',
    regime: 'clt', base_salary: '3000.00', is_active: true, ...overrides,
  };
}

function chain(rows: unknown[]): any {
  const p: any = Promise.resolve(rows);
  p.orderBy = () => p;
  return p;
}

function makeMockDb(opts: { selectRows?: unknown[]; insertError?: { code: string } }) {
  const insertedValues: Record<string, unknown>[] = [];
  const updatedValues: Record<string, unknown>[] = [];

  const db: any = {
    select: vi.fn(() => ({ from: () => ({ where: () => chain(opts.selectRows ?? []) }) })),
    insert: vi.fn(() => ({
      values: (data: Record<string, unknown>) => {
        insertedValues.push(data);
        if (opts.insertError) return { returning: () => Promise.reject(opts.insertError) };
        return { returning: () => Promise.resolve([{ ...baseEmployeeRow(), ...data }]) };
      },
    })),
    update: vi.fn(() => ({
      set: (data: Record<string, unknown>) => {
        updatedValues.push(data);
        return { where: () => ({ returning: () => Promise.resolve([{ ...baseEmployeeRow(), ...data }]) }) };
      },
    })),
  };

  return { db: db as DrizzleDB, insertedValues, updatedValues };
}

describe('listEmployees', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve os funcionários do tenant', async () => {
    const { db } = makeMockDb({ selectRows: [baseEmployeeRow()] });
    const rows = await listEmployees({ tenantId: TENANT_ID }, db);
    expect(rows).toHaveLength(1);
  });
});

describe('createEmployee', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cria um funcionário CLT válido', async () => {
    const { db, insertedValues } = makeMockDb({});
    const employee = await createEmployee({
      tenantId: TENANT_ID, name: 'Fulano', cpf: VALID_CPF, regime: 'clt', baseSalary: 3000, hireDate: '2026-01-01',
    }, db);
    expect(employee).toMatchObject({ name: 'Fulano' });
    expect(insertedValues[0]).toMatchObject({ cpf: '11144477735', regime: 'clt' });
  });

  it('rejeita CPF inválido antes de tocar o banco', async () => {
    const { db, insertedValues } = makeMockDb({});
    await expect(createEmployee({
      tenantId: TENANT_ID, name: 'Fulano', cpf: '11111111111', regime: 'clt', baseSalary: 3000, hireDate: '2026-01-01',
    }, db)).rejects.toMatchObject({ code: 'employee_cpf_invalid' });
    expect(insertedValues).toHaveLength(0);
  });

  it('rejeita salário negativo', async () => {
    const { db } = makeMockDb({});
    await expect(createEmployee({
      tenantId: TENANT_ID, name: 'Fulano', cpf: VALID_CPF, regime: 'clt', baseSalary: -1, hireDate: '2026-01-01',
    }, db)).rejects.toMatchObject({ code: 'base_salary_invalid' });
  });

  it('traduz violação de UNIQUE (tenant_id, cpf) em erro de domínio', async () => {
    const { db } = makeMockDb({ insertError: { code: '23505' } });
    await expect(createEmployee({
      tenantId: TENANT_ID, name: 'Fulano', cpf: VALID_CPF, regime: 'clt', baseSalary: 3000, hireDate: '2026-01-01',
    }, db)).rejects.toMatchObject({ code: 'employee_cpf_duplicate' });
  });
});

describe('updateEmployee / deactivateEmployee / getEmployee', () => {
  beforeEach(() => vi.clearAllMocks());

  it('atualiza campos informados', async () => {
    const { db, updatedValues } = makeMockDb({ selectRows: [baseEmployeeRow()] });
    await updateEmployee(EMPLOYEE_ID, TENANT_ID, { baseSalary: 3500 }, db);
    expect(updatedValues[0]).toMatchObject({ base_salary: '3500' });
  });

  it('lança employee_not_found quando o funcionário não existe no tenant', async () => {
    const { db } = makeMockDb({ selectRows: [] });
    await expect(getEmployee('ghost', TENANT_ID, db)).rejects.toMatchObject({ code: 'employee_not_found' });
  });

  it('desativa via soft-delete (is_active=false), nunca apaga a linha', async () => {
    const { db, updatedValues } = makeMockDb({ selectRows: [baseEmployeeRow()] });
    await deactivateEmployee(EMPLOYEE_ID, TENANT_ID, db);
    expect(updatedValues[0]).toMatchObject({ is_active: false });
  });
});
