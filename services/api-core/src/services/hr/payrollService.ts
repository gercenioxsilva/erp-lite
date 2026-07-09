// Application Service — Folha de Pagamento (RH Simplificado). Orquestra I/O +
// transação: gera a folha do mês calculando cada funcionário ativo (via
// payrollDomain#computePayrollEntry), permite ajustes extras enquanto
// `draft`, e ao fechar gera 1 `payables` por funcionário — reaproveitando
// 100% da infraestrutura de contas a pagar/DRE/Centro de Custo já existente.
//
// ESCOPO DELIBERADO: nunca envia nada ao eSocial — só calcula e organiza.

import { eq, and, isNull, sql } from 'drizzle-orm';
import { db as _db } from '../../db';
import { payrollRuns, payrollEntries, employees, payables, dreCategories } from '../../db/schema';
import {
  computePayrollEntry, assertCanCloseRun, assertEntryEditable, PayrollDomainError,
  type PayrollTaxBracketSet, type PayrollLineItem, type EmployeeRegime,
} from '../../domain/hr/payrollDomain';

export type DrizzleDB = typeof _db;
export { PayrollDomainError };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Faixas de imposto vigentes ──────────────────────────────────────────────
// Só a vintage mais recente por tipo é usada (valid_from mais alto) — permite
// futuramente inserir uma nova geração de faixas (lei muda) sem apagar o
// histórico usado por folhas já fechadas.

async function getActiveTaxBrackets(db: DrizzleDB): Promise<PayrollTaxBracketSet> {
  const rows = await db.execute<{
    type: string; min_value: string; max_value: string | null; rate: string; deduction_value: string; valid_from: string;
  }>(sql`SELECT type, min_value, max_value, rate, deduction_value, valid_from FROM payroll_tax_brackets WHERE valid_from <= CURRENT_DATE`);

  function latestByType(type: 'inss' | 'irrf') {
    const ofType = rows.rows.filter(r => r.type === type);
    if (!ofType.length) return [];
    const latestDate = ofType.reduce((max, r) => (r.valid_from > max ? r.valid_from : max), ofType[0].valid_from);
    return ofType
      .filter(r => r.valid_from === latestDate)
      .map(r => ({
        min_value: Number(r.min_value),
        max_value: r.max_value == null ? null : Number(r.max_value),
        rate: Number(r.rate),
        deduction_value: Number(r.deduction_value),
      }))
      .sort((a, b) => a.min_value - b.min_value);
  }

  return { inss: latestByType('inss'), irrf: latestByType('irrf') };
}

// ── Categoria DRE "Despesas com Pessoal" (global, seed da regra 42/DRE) ────
// Reaproveita a categoria já existente — nenhuma categoria nova é criada por
// este módulo.

async function getPayrollDreCategoryId(db: DrizzleDB): Promise<string | null> {
  const [row] = await db.select({ id: dreCategories.id }).from(dreCategories)
    .where(and(isNull(dreCategories.tenant_id), eq(dreCategories.code, 'pessoal')));
  return row?.id ?? null;
}

// Vencimento = dia 5 do mês seguinte ao mês de referência (convenção comum
// de folha — salário pago até o 5º dia do mês seguinte). `month` já vem
// 1-indexed de referenceMonth ('YYYY-MM-DD'), e Date.UTC espera monthIndex
// 0-indexed — por isso passar `month` direto já produz "o mês seguinte".
function computeDueDate(referenceMonth: string): string {
  const [year, month] = referenceMonth.split('-').map(Number);
  return new Date(Date.UTC(year, month, 5)).toISOString().slice(0, 10);
}

async function recalculateRunTotals(runId: string, tenantId: string, db: DrizzleDB): Promise<void> {
  const entries = await db.select().from(payrollEntries)
    .where(and(eq(payrollEntries.payroll_run_id, runId), eq(payrollEntries.tenant_id, tenantId)));

  const totals = entries.reduce((acc, e) => ({
    gross:      acc.gross + Number(e.gross_total),
    deductions: acc.deductions + Number(e.deductions_total),
    net:        acc.net + Number(e.net_total),
    employer:   acc.employer + Number(e.fgts_value) + Number(e.ferias_provisao) + Number(e.decimo_terceiro_provisao),
  }), { gross: 0, deductions: 0, net: 0, employer: 0 });

  await db.update(payrollRuns).set({
    gross_total:            String(round2(totals.gross)),
    deductions_total:       String(round2(totals.deductions)),
    net_total:               String(round2(totals.net)),
    employer_charges_total: String(round2(totals.employer)),
    updated_at:             new Date(),
  }).where(eq(payrollRuns.id, runId));
}

// ── Folhas (runs) ────────────────────────────────────────────────────────────

export async function listPayrollRuns(tenantId: string, db: DrizzleDB = _db) {
  return db.select().from(payrollRuns).where(eq(payrollRuns.tenant_id, tenantId))
    .orderBy(sql`${payrollRuns.reference_month} DESC`);
}

async function getRunOrThrow(id: string, tenantId: string, db: DrizzleDB) {
  const [run] = await db.select().from(payrollRuns)
    .where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenant_id, tenantId)));
  if (!run) throw new PayrollDomainError('payroll_run_not_found', { id });
  return run;
}

export async function getPayrollRun(id: string, tenantId: string, db: DrizzleDB = _db) {
  const run = await getRunOrThrow(id, tenantId, db);
  const entries = await db.select().from(payrollEntries)
    .where(and(eq(payrollEntries.payroll_run_id, id), eq(payrollEntries.tenant_id, tenantId)));
  return { run, entries };
}

export interface CreatePayrollRunArgs { tenantId: string; companyId?: string | null; referenceMonth: string; }

/** Gera a folha do mês: 1 payroll_entries por funcionário ativo, calculado
 * via computePayrollEntry() com as faixas de imposto vigentes. UNIQUE
 * (tenant_id, company_id, reference_month) garante que não duplica. */
export async function createPayrollRun(args: CreatePayrollRunArgs, db: DrizzleDB = _db) {
  const brackets = await getActiveTaxBrackets(db);

  const conditions = [eq(employees.tenant_id, args.tenantId), eq(employees.is_active, true)];
  if (args.companyId) conditions.push(eq(employees.company_id, args.companyId));
  const activeEmployees = await db.select().from(employees).where(and(...conditions));

  return db.transaction(async (tx) => {
    let run;
    try {
      [run] = await tx.insert(payrollRuns).values({
        tenant_id: args.tenantId, company_id: args.companyId || null, reference_month: args.referenceMonth,
      }).returning();
    } catch (err: any) {
      if (err.code === '23505') throw new PayrollDomainError('payroll_run_already_exists', { referenceMonth: args.referenceMonth });
      throw err;
    }

    for (const emp of activeEmployees) {
      const calc = computePayrollEntry({
        regime: emp.regime as EmployeeRegime,
        baseSalary: Number(emp.base_salary),
      }, brackets);

      await tx.insert(payrollEntries).values({
        tenant_id: args.tenantId, payroll_run_id: run.id, employee_id: emp.id, employee_name: emp.name,
        regime: emp.regime, base_salary: emp.base_salary,
        inss_value:   String(calc.inssValue),
        irrf_value:   String(calc.irrfValue),
        fgts_value:   String(calc.fgtsValue),
        ferias_provisao:          String(calc.feriasProvisao),
        decimo_terceiro_provisao: String(calc.decimoTerceiroProvisao),
        gross_total:      String(calc.grossTotal),
        deductions_total: String(calc.deductionsTotal),
        net_total:        String(calc.netTotal),
      });
    }

    await recalculateRunTotals(run.id, args.tenantId, tx as unknown as DrizzleDB);
    const [updatedRun] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    return updatedRun;
  });
}

export interface UpdatePayrollEntryArgs { extraEarnings?: PayrollLineItem[]; extraDeductions?: PayrollLineItem[]; }

/** Ajusta os extras (vale-transporte, faltas, hora extra etc.) de um holerite
 * e recalcula — só permitido enquanto a folha ainda está `draft`. */
export async function updatePayrollEntryAdjustments(
  entryId: string, tenantId: string, args: UpdatePayrollEntryArgs, db: DrizzleDB = _db,
) {
  const [row] = await db.select({ entry: payrollEntries, runStatus: payrollRuns.status })
    .from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payroll_run_id, payrollRuns.id))
    .where(and(eq(payrollEntries.id, entryId), eq(payrollEntries.tenant_id, tenantId)));
  if (!row) throw new PayrollDomainError('payroll_entry_not_found', { id: entryId });
  assertEntryEditable(row.runStatus as 'draft' | 'closed');

  const brackets = await getActiveTaxBrackets(db);
  const calc = computePayrollEntry({
    regime: row.entry.regime as EmployeeRegime,
    baseSalary: Number(row.entry.base_salary),
    extraEarnings: args.extraEarnings,
    extraDeductions: args.extraDeductions,
  }, brackets);

  const [updated] = await db.update(payrollEntries).set({
    extra_earnings:   args.extraEarnings   ?? [],
    extra_deductions: args.extraDeductions ?? [],
    inss_value:   String(calc.inssValue),
    irrf_value:   String(calc.irrfValue),
    fgts_value:   String(calc.fgtsValue),
    ferias_provisao:          String(calc.feriasProvisao),
    decimo_terceiro_provisao: String(calc.decimoTerceiroProvisao),
    gross_total:      String(calc.grossTotal),
    deductions_total: String(calc.deductionsTotal),
    net_total:        String(calc.netTotal),
    updated_at: new Date(),
  }).where(eq(payrollEntries.id, entryId)).returning();

  await recalculateRunTotals(row.entry.payroll_run_id, tenantId, db);
  return updated;
}

/** Fecha a folha (irreversível) e gera 1 payable por funcionário — categoria
 * 'payroll', dre_category "Despesas com Pessoal" (global, já existente),
 * cost_center herdado do funcionário. */
export async function closePayrollRun(runId: string, tenantId: string, userId: string | null, db: DrizzleDB = _db) {
  const run = await getRunOrThrow(runId, tenantId, db);
  assertCanCloseRun(run.status as 'draft' | 'closed');

  const rows = await db.select({ entry: payrollEntries, employeeCostCenterId: employees.cost_center_id })
    .from(payrollEntries)
    .innerJoin(employees, eq(payrollEntries.employee_id, employees.id))
    .where(and(eq(payrollEntries.payroll_run_id, runId), eq(payrollEntries.tenant_id, tenantId)));

  const dreCategoryId = await getPayrollDreCategoryId(db);
  const dueDate = computeDueDate(run.reference_month as unknown as string);

  return db.transaction(async (tx) => {
    for (const row of rows) {
      const [payable] = await tx.insert(payables).values({
        tenant_id:       tenantId,
        category:        'payroll',
        description:     `Folha de Pagamento ${run.reference_month} — ${row.entry.employee_name}`,
        amount:          row.entry.net_total,
        due_date:        dueDate,
        status:          'pending',
        dre_category_id: dreCategoryId,
        cost_center_id:  row.employeeCostCenterId,
      }).returning();

      await tx.update(payrollEntries).set({ payable_id: payable.id, updated_at: new Date() })
        .where(eq(payrollEntries.id, row.entry.id));
    }

    const [closedRun] = await tx.update(payrollRuns).set({
      status: 'closed', closed_at: new Date(), closed_by: userId,
    }).where(eq(payrollRuns.id, runId)).returning();

    return closedRun;
  });
}

export async function getPayslip(entryId: string, tenantId: string, db: DrizzleDB = _db) {
  const [row] = await db.select({ entry: payrollEntries, referenceMonth: payrollRuns.reference_month, runStatus: payrollRuns.status })
    .from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payroll_run_id, payrollRuns.id))
    .where(and(eq(payrollEntries.id, entryId), eq(payrollEntries.tenant_id, tenantId)));
  if (!row) throw new PayrollDomainError('payroll_entry_not_found', { id: entryId });
  return row;
}
