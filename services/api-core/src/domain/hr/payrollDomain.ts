// Domínio do RH Simplificado — regras de negócio puras, sem I/O. Segue o
// mesmo padrão de Clean Architecture já usado em salesPipelineDomain.ts/
// accessControlDomain.ts.
//
// ESCOPO DELIBERADO: calculadora/organizador interno de folha — nunca uma
// fonte de verdade legal. As faixas de INSS/IRRF vêm de fora (tabela
// `payroll_tax_brackets`, global e atualizável), nunca hardcoded aqui — mesmo
// racional do motor fiscal multi-estado (regra 15) e do Simples Nacional.

import { isValidCPF } from '../serviceVisit/serviceVisitDomain';

export class PayrollDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'PayrollDomainError';
  }
}

export type EmployeeRegime = 'clt' | 'pro_labore';
export type PayrollRunStatus = 'draft' | 'closed';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Guardas de transição ────────────────────────────────────────────────────
// Fechar uma folha é definitivo — mesmo espírito de invoice.status='issued'
// nunca voltar a 'draft'. Reabrir uma folha fechada, no mundo real, exige
// estorno contábil manual — não é um "desfazer" de sistema.

export function assertCanCloseRun(status: PayrollRunStatus): void {
  if (status !== 'draft') {
    throw new PayrollDomainError('payroll_run_not_draft', { status });
  }
}

export function assertEntryEditable(runStatus: PayrollRunStatus): void {
  if (runStatus !== 'draft') {
    throw new PayrollDomainError('payroll_run_closed', { status: runStatus });
  }
}

export function validateEmployeeCpf(cpf: string): void {
  if (!isValidCPF(cpf)) {
    throw new PayrollDomainError('employee_cpf_invalid', { cpf });
  }
}

export function validateBaseSalary(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new PayrollDomainError('base_salary_invalid', { value });
  }
}

// ── Faixas de imposto (vêm de fora, nunca hardcoded) ───────────────────────

export interface TaxBracket {
  min_value: number;
  max_value: number | null;
  rate: number;
  deduction_value: number;
}

// INSS — progressivo/marginal: cada faixa tributa só a parte do salário que
// cai nela (mecanismo em vigor desde a reforma da Previdência de 2020).
// Diferente do IRRF, que usa uma única faixa + parcela a deduzir.
export function calculateInss(grossSalary: number, brackets: TaxBracket[]): number {
  if (grossSalary <= 0) return 0;
  let total = 0;
  for (const b of brackets) {
    if (grossSalary <= b.min_value) continue;
    const upper = b.max_value ?? grossSalary;
    const taxableInBracket = Math.min(grossSalary, upper) - b.min_value;
    if (taxableInBracket > 0) total += taxableInBracket * b.rate;
  }
  return round2(total);
}

// Pró-labore — INSS em alíquota FIXA de 11% (mecanismo diferente do CLT, não
// progressivo), respeitando o mesmo teto de contribuição (maior max_value
// das faixas de INSS, nunca hardcoded).
export function calculateProLaboreInss(grossValue: number, inssBrackets: TaxBracket[]): number {
  if (grossValue <= 0) return 0;
  const ceiling = inssBrackets.reduce((max, b) => (b.max_value != null && b.max_value > max ? b.max_value : max), 0);
  const base = ceiling > 0 ? Math.min(grossValue, ceiling) : grossValue;
  return round2(base * 0.11);
}

// IRRF — mecanismo tradicional de faixa única + parcela a deduzir (nunca
// somado por faixa, ao contrário do INSS).
export function calculateIrrf(baseAfterInss: number, brackets: TaxBracket[]): number {
  if (baseAfterInss <= 0) return 0;
  const bracket = brackets.find(b => baseAfterInss >= b.min_value && (b.max_value == null || baseAfterInss <= b.max_value));
  if (!bracket) return 0;
  return round2(Math.max(0, baseAfterInss * bracket.rate - bracket.deduction_value));
}

// Encargos/provisões — só fazem sentido pro regime CLT (pró-labore não tem
// FGTS, férias nem 13º — ver diferença legal documentada no README).
export function calculateFgts(grossSalary: number): number {
  return round2(grossSalary * 0.08);
}

export function calculateFeriasProvisao(grossSalary: number): number {
  return round2(grossSalary / 9); // 1/12 × 4/3 (inclui 1/3 constitucional)
}

export function calculateDecimoTerceiroProvisao(grossSalary: number): number {
  return round2(grossSalary / 12);
}

// ── Cálculo completo de um holerite ─────────────────────────────────────────

export interface PayrollLineItem { description: string; amount: number; }

export interface EmployeeForPayroll {
  regime:           EmployeeRegime;
  baseSalary:       number;
  extraEarnings?:   PayrollLineItem[];
  extraDeductions?: PayrollLineItem[];
}

export interface PayrollTaxBracketSet { inss: TaxBracket[]; irrf: TaxBracket[]; }

export interface PayrollEntryCalculation {
  grossTotal:              number;
  inssValue:                number;
  irrfValue:                number;
  fgtsValue:                number;
  feriasProvisao:           number;
  decimoTerceiroProvisao:   number;
  deductionsTotal:          number;
  netTotal:                 number;
}

function sumLineItems(items: PayrollLineItem[] | undefined): number {
  return (items ?? []).reduce((sum, item) => sum + item.amount, 0);
}

export function computePayrollEntry(employee: EmployeeForPayroll, brackets: PayrollTaxBracketSet): PayrollEntryCalculation {
  const grossTotal = round2(employee.baseSalary + sumLineItems(employee.extraEarnings));

  let inssValue = 0, fgtsValue = 0, feriasProvisao = 0, decimoTerceiroProvisao = 0;
  if (employee.regime === 'clt') {
    inssValue = calculateInss(grossTotal, brackets.inss);
    fgtsValue = calculateFgts(grossTotal);
    feriasProvisao = calculateFeriasProvisao(grossTotal);
    decimoTerceiroProvisao = calculateDecimoTerceiroProvisao(grossTotal);
  } else {
    inssValue = calculateProLaboreInss(grossTotal, brackets.inss);
  }

  const irrfValue = calculateIrrf(grossTotal - inssValue, brackets.irrf);
  const extraDeductionsTotal = sumLineItems(employee.extraDeductions);
  const deductionsTotal = round2(inssValue + irrfValue + extraDeductionsTotal);
  const netTotal = round2(grossTotal - deductionsTotal);

  return { grossTotal, inssValue, irrfValue, fgtsValue, feriasProvisao, decimoTerceiroProvisao, deductionsTotal, netTotal };
}
