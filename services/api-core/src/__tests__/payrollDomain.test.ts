import { describe, it, expect } from 'vitest';
import {
  PayrollDomainError, assertCanCloseRun, assertEntryEditable, validateEmployeeCpf, validateBaseSalary,
  calculateInss, calculateProLaboreInss, calculateIrrf, calculateFgts,
  calculateFeriasProvisao, calculateDecimoTerceiroProvisao, computePayrollEntry,
  type TaxBracket,
} from '../domain/hr/payrollDomain';

// Faixas 2026 exatamente como semeadas em db/migrations/0060_hr.sql — ver a
// ressalva de que os valores de IRRF acima de R$5.000 são uma aproximação
// (não confirmada), documentada na própria migration.
const INSS_BRACKETS: TaxBracket[] = [
  { min_value: 0,       max_value: 1621.00, rate: 0.075, deduction_value: 0 },
  { min_value: 1621.01, max_value: 2902.84, rate: 0.09,  deduction_value: 0 },
  { min_value: 2902.85, max_value: 4354.27, rate: 0.12,  deduction_value: 0 },
  { min_value: 4354.28, max_value: 8475.55, rate: 0.14,  deduction_value: 0 },
];
const IRRF_BRACKETS: TaxBracket[] = [
  { min_value: 0,       max_value: 5000.00, rate: 0,     deduction_value: 0 },
  { min_value: 5000.01, max_value: 7000.00, rate: 0.15,  deduction_value: 750.00 },
  { min_value: 7000.01, max_value: null,    rate: 0.275, deduction_value: 1362.50 },
];

describe('assertCanCloseRun / assertEntryEditable', () => {
  it('permite fechar só a partir de draft', () => {
    expect(() => assertCanCloseRun('draft')).not.toThrow();
    expect(() => assertCanCloseRun('closed')).toThrow(PayrollDomainError);
  });

  it('só permite editar ajustes enquanto a folha está draft', () => {
    expect(() => assertEntryEditable('draft')).not.toThrow();
    expect(() => assertEntryEditable('closed')).toThrow(PayrollDomainError);
  });
});

describe('validateEmployeeCpf / validateBaseSalary', () => {
  it('rejeita CPF inválido', () => {
    expect(() => validateEmployeeCpf('11111111111')).toThrow(PayrollDomainError);
    expect(() => validateEmployeeCpf('123')).toThrow(PayrollDomainError);
  });

  it('aceita CPF válido', () => {
    expect(() => validateEmployeeCpf('11144477735')).not.toThrow();
  });

  it('rejeita salário negativo ou não finito', () => {
    expect(() => validateBaseSalary(-1)).toThrow(PayrollDomainError);
    expect(() => validateBaseSalary(NaN)).toThrow(PayrollDomainError);
  });

  it('aceita salário zero ou positivo', () => {
    expect(() => validateBaseSalary(0)).not.toThrow();
    expect(() => validateBaseSalary(3000)).not.toThrow();
  });
});

describe('calculateInss — progressivo/marginal', () => {
  it('salário inteiro na primeira faixa: tributa só 7,5%', () => {
    expect(calculateInss(1000, INSS_BRACKETS)).toBeCloseTo(75.00, 2);
  });

  it('salário cruzando duas faixas: soma o pedaço de cada uma', () => {
    // 1621 * 0.075 + 378.99 * 0.09 = 121.575 + 34.1091 = 155.6841
    expect(calculateInss(2000, INSS_BRACKETS)).toBeCloseTo(155.68, 1);
  });

  it('salário zero ou negativo não gera INSS', () => {
    expect(calculateInss(0, INSS_BRACKETS)).toBe(0);
    expect(calculateInss(-100, INSS_BRACKETS)).toBe(0);
  });
});

describe('calculateProLaboreInss — alíquota fixa de 11%, com teto', () => {
  it('11% flat abaixo do teto', () => {
    expect(calculateProLaboreInss(2000, INSS_BRACKETS)).toBeCloseTo(220.00, 2);
  });

  it('capado no teto de contribuição (maior max_value das faixas de INSS)', () => {
    expect(calculateProLaboreInss(10000, INSS_BRACKETS)).toBeCloseTo(8475.55 * 0.11, 2);
  });
});

describe('calculateIrrf — faixa única + parcela a deduzir', () => {
  it('isento até R$5.000', () => {
    expect(calculateIrrf(3000, IRRF_BRACKETS)).toBe(0);
    expect(calculateIrrf(5000, IRRF_BRACKETS)).toBe(0);
  });

  it('segunda faixa: base * 0,15 - 750', () => {
    expect(calculateIrrf(6000, IRRF_BRACKETS)).toBeCloseTo(150.00, 2);
  });

  it('terceira faixa (aberta): base * 0,275 - 1362,50', () => {
    expect(calculateIrrf(8000, IRRF_BRACKETS)).toBeCloseTo(837.50, 2);
  });

  it('nunca devolve valor negativo', () => {
    expect(calculateIrrf(5000.01, IRRF_BRACKETS)).toBeGreaterThanOrEqual(0);
  });
});

describe('encargos/provisões CLT', () => {
  it('FGTS é 8% flat', () => {
    expect(calculateFgts(3000)).toBeCloseTo(240.00, 2);
  });

  it('provisão de férias é 1/12 × 4/3 (11,11%)', () => {
    expect(calculateFeriasProvisao(3000)).toBeCloseTo(333.33, 2);
  });

  it('provisão de 13º é 1/12 (8,33%)', () => {
    expect(calculateDecimoTerceiroProvisao(3000)).toBeCloseTo(250.00, 2);
  });
});

describe('computePayrollEntry', () => {
  const brackets = { inss: INSS_BRACKETS, irrf: IRRF_BRACKETS };

  it('CLT: inclui FGTS/férias/13º; pró-labore nunca inclui', () => {
    const clt = computePayrollEntry({ regime: 'clt', baseSalary: 3000 }, brackets);
    expect(clt.fgtsValue).toBeGreaterThan(0);
    expect(clt.feriasProvisao).toBeGreaterThan(0);
    expect(clt.decimoTerceiroProvisao).toBeGreaterThan(0);

    const proLabore = computePayrollEntry({ regime: 'pro_labore', baseSalary: 3000 }, brackets);
    expect(proLabore.fgtsValue).toBe(0);
    expect(proLabore.feriasProvisao).toBe(0);
    expect(proLabore.decimoTerceiroProvisao).toBe(0);
  });

  it('pró-labore usa INSS fixo de 11%, CLT usa a tabela progressiva (valores diferentes pro mesmo salário)', () => {
    const clt = computePayrollEntry({ regime: 'clt', baseSalary: 3000 }, brackets);
    const proLabore = computePayrollEntry({ regime: 'pro_labore', baseSalary: 3000 }, brackets);
    expect(clt.inssValue).not.toBeCloseTo(proLabore.inssValue, 2);
    expect(proLabore.inssValue).toBeCloseTo(330.00, 2); // 3000 * 0.11
  });

  it('ganhos/descontos extras entram no total bruto/líquido', () => {
    const withExtras = computePayrollEntry({
      regime: 'clt', baseSalary: 3000,
      extraEarnings: [{ description: 'Hora extra', amount: 200 }],
      extraDeductions: [{ description: 'Falta', amount: 50 }],
    }, brackets);
    const withoutExtras = computePayrollEntry({ regime: 'clt', baseSalary: 3000 }, brackets);

    expect(withExtras.grossTotal).toBeCloseTo(withoutExtras.grossTotal + 200, 2);
    // líquido reflete o desconto extra de 50, mesmo com a base tributável maior por causa do ganho extra
    expect(withExtras.netTotal).toBeLessThan(withoutExtras.netTotal + 200);
  });

  it('nunca soma mais do que o bruto nas deduções (net_total nunca negativo em cenário normal)', () => {
    const calc = computePayrollEntry({ regime: 'clt', baseSalary: 3000 }, brackets);
    expect(calc.netTotal).toBeGreaterThan(0);
    expect(calc.deductionsTotal).toBeLessThan(calc.grossTotal);
  });
});
