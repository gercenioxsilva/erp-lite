import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPayrollRun, updatePayrollEntryAdjustments, closePayrollRun, getPayslip, listPayrollRuns, getPayrollRun,
} from '../services/hr/payrollService';
import type { DrizzleDB } from '../services/hr/payrollService';

const TENANT_ID = 'tenant-1';
const RUN_ID    = 'run-1';
const ENTRY_ID  = 'entry-1';
const EMPLOYEE_ID = 'employee-1';

const INSS_ROWS = [
  { type: 'inss', min_value: '0',       max_value: '1621.00', rate: '0.0750', deduction_value: '0', valid_from: '2026-01-01' },
  { type: 'inss', min_value: '1621.01', max_value: '2902.84', rate: '0.0900', deduction_value: '0', valid_from: '2026-01-01' },
  { type: 'inss', min_value: '2902.85', max_value: '4354.27', rate: '0.1200', deduction_value: '0', valid_from: '2026-01-01' },
  { type: 'inss', min_value: '4354.28', max_value: '8475.55', rate: '0.1400', deduction_value: '0', valid_from: '2026-01-01' },
];
const IRRF_ROWS = [
  { type: 'irrf', min_value: '0',       max_value: '5000.00', rate: '0.0000', deduction_value: '0',      valid_from: '2026-01-01' },
  { type: 'irrf', min_value: '5000.01', max_value: '7000.00', rate: '0.1500', deduction_value: '750.00',  valid_from: '2026-01-01' },
  { type: 'irrf', min_value: '7000.01', max_value: null,      rate: '0.2750', deduction_value: '1362.50', valid_from: '2026-01-01' },
];

function resultChain(rows: unknown[]): any {
  const p: any = Promise.resolve(rows);
  p.where = () => resultChain(rows);
  p.innerJoin = () => resultChain(rows);
  p.orderBy = () => resultChain(rows);
  return p;
}

function baseEmployeeRow(overrides: Record<string, unknown> = {}) {
  return { id: EMPLOYEE_ID, tenant_id: TENANT_ID, name: 'Fulano', regime: 'clt', base_salary: '3000.00', cost_center_id: null, is_active: true, ...overrides };
}

function baseEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID, tenant_id: TENANT_ID, payroll_run_id: RUN_ID, employee_id: EMPLOYEE_ID, employee_name: 'Fulano',
    regime: 'clt', base_salary: '3000.00', extra_earnings: [], extra_deductions: [],
    inss_value: '330.00', irrf_value: '0', fgts_value: '240.00', ferias_provisao: '333.33', decimo_terceiro_provisao: '250.00',
    gross_total: '3000.00', deductions_total: '330.00', net_total: '2670.00', payable_id: null, ...overrides,
  };
}

function baseRunRow(overrides: Record<string, unknown> = {}) {
  return { id: RUN_ID, tenant_id: TENANT_ID, company_id: null, reference_month: '2026-07-01', status: 'draft', ...overrides };
}

/** selectQueue é consumida em ordem por CADA chamada db.select(), seja ela
 * encadeada com .where() direto ou .innerJoin().where() — mesmo padrão já
 * usado nos outros testes de serviço desta sessão. execute() é usado só
 * pelas faixas de imposto (payroll_tax_brackets). */
function setupDb(selectQueue: unknown[][]) {
  const insertedValues: Record<string, unknown>[] = [];
  const updatedValues: Record<string, unknown>[] = [];

  const db: any = {
    transaction: async (cb: any) => cb(db),
    execute: vi.fn(async () => ({ rows: [...INSS_ROWS, ...IRRF_ROWS] })),
    select: vi.fn(() => ({ from: () => resultChain(selectQueue.length ? selectQueue.shift()! : []) })),
    insert: vi.fn(() => ({
      values: (data: Record<string, unknown>) => {
        insertedValues.push(data);
        return { returning: () => Promise.resolve([{ id: `new-${insertedValues.length}`, ...data }]) };
      },
    })),
    update: vi.fn(() => ({
      set: (data: Record<string, unknown>) => {
        updatedValues.push(data);
        return { where: () => ({ returning: () => Promise.resolve([{ ...baseRunRow(), ...data }]) }) };
      },
    })),
  };

  return { db: db as DrizzleDB, insertedValues, updatedValues };
}

describe('createPayrollRun', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gera 1 payroll_entry por funcionário ativo e recalcula os totais da folha', async () => {
    const { db, insertedValues } = setupDb([
      [baseEmployeeRow()],        // employees ativos
      [baseEntryRow()],           // recalculateRunTotals: entries recém-inseridas
      [baseRunRow()],             // re-select final da folha atualizada
    ]);
    const run = await createPayrollRun({ tenantId: TENANT_ID, referenceMonth: '2026-07-01' }, db);

    const entryInserts = insertedValues.filter(v => 'employee_id' in v);
    expect(entryInserts).toHaveLength(1);
    expect(entryInserts[0]).toMatchObject({ employee_id: EMPLOYEE_ID, regime: 'clt' });
    expect(run).toMatchObject({ id: RUN_ID });
  });

  it('traduz violação de UNIQUE (mês já gerado) em erro de domínio', async () => {
    const { db } = setupDb([[baseEmployeeRow()]]);
    (db as any).insert = vi.fn(() => ({
      values: () => ({ returning: () => Promise.reject({ code: '23505' }) }),
    }));
    await expect(createPayrollRun({ tenantId: TENANT_ID, referenceMonth: '2026-07-01' }, db))
      .rejects.toMatchObject({ code: 'payroll_run_already_exists' });
  });
});

describe('updatePayrollEntryAdjustments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recalcula e persiste os ajustes enquanto a folha está draft', async () => {
    const { db, updatedValues } = setupDb([
      [{ entry: baseEntryRow(), runStatus: 'draft' }], // lookup entry+run
      [baseEntryRow()],                                 // recalculateRunTotals
    ]);
    await updatePayrollEntryAdjustments(ENTRY_ID, TENANT_ID, {
      extraEarnings: [{ description: 'Hora extra', amount: 100 }],
    }, db);

    const entryUpdate = updatedValues.find(v => 'extra_earnings' in v);
    expect(entryUpdate).toMatchObject({ extra_earnings: [{ description: 'Hora extra', amount: 100 }] });
  });

  it('bloqueia ajuste quando a folha já está fechada', async () => {
    const { db } = setupDb([[{ entry: baseEntryRow(), runStatus: 'closed' }]]);
    await expect(updatePayrollEntryAdjustments(ENTRY_ID, TENANT_ID, {}, db))
      .rejects.toMatchObject({ code: 'payroll_run_closed' });
  });

  it('lança payroll_entry_not_found quando a entry não existe no tenant', async () => {
    const { db } = setupDb([[]]);
    await expect(updatePayrollEntryAdjustments('ghost', TENANT_ID, {}, db))
      .rejects.toMatchObject({ code: 'payroll_entry_not_found' });
  });
});

describe('closePayrollRun', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gera exatamente 1 payable por entry e fecha a folha (irreversível)', async () => {
    const { db, insertedValues, updatedValues } = setupDb([
      [baseRunRow({ status: 'draft' })],                                          // getRunOrThrow
      [{ entry: baseEntryRow(), employeeCostCenterId: 'cc-1' }],                   // entries + employee join
      [{ id: 'dre-cat-pessoal' }],                                                 // getPayrollDreCategoryId
    ]);
    await closePayrollRun(RUN_ID, TENANT_ID, 'user-1', db);

    const payableInserts = insertedValues.filter(v => v.category === 'payroll');
    expect(payableInserts).toHaveLength(1);
    expect(payableInserts[0]).toMatchObject({ dre_category_id: 'dre-cat-pessoal', cost_center_id: 'cc-1' });

    const runClose = updatedValues.find(v => v.status === 'closed');
    expect(runClose).toMatchObject({ status: 'closed', closed_by: 'user-1' });
  });

  it('bloqueia fechar uma folha já fechada', async () => {
    const { db } = setupDb([[baseRunRow({ status: 'closed' })]]);
    await expect(closePayrollRun(RUN_ID, TENANT_ID, 'user-1', db))
      .rejects.toMatchObject({ code: 'payroll_run_not_draft' });
  });

  it('lança payroll_run_not_found quando a folha não existe no tenant', async () => {
    const { db } = setupDb([[]]);
    await expect(closePayrollRun('ghost', TENANT_ID, 'user-1', db))
      .rejects.toMatchObject({ code: 'payroll_run_not_found' });
  });
});

describe('getPayslip / listPayrollRuns / getPayrollRun', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve o holerite calculado', async () => {
    const { db } = setupDb([[{ entry: baseEntryRow(), referenceMonth: '2026-07-01', runStatus: 'draft' }]]);
    const payslip = await getPayslip(ENTRY_ID, TENANT_ID, db);
    expect(payslip.entry).toMatchObject({ employee_name: 'Fulano' });
  });

  it('lança payroll_entry_not_found quando o holerite não existe', async () => {
    const { db } = setupDb([[]]);
    await expect(getPayslip('ghost', TENANT_ID, db)).rejects.toMatchObject({ code: 'payroll_entry_not_found' });
  });

  it('lista as folhas do tenant', async () => {
    const { db } = setupDb([[baseRunRow()]]);
    const runs = await listPayrollRuns(TENANT_ID, db);
    expect(runs).toHaveLength(1);
  });

  it('devolve a folha com suas entries', async () => {
    const { db } = setupDb([[baseRunRow()], [baseEntryRow()]]);
    const result = await getPayrollRun(RUN_ID, TENANT_ID, db);
    expect(result.run).toMatchObject({ id: RUN_ID });
    expect(result.entries).toHaveLength(1);
  });
});
