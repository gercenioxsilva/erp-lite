import { describe, it, expect } from 'vitest';
import { calculateTaxes } from '../lib/taxEngine';
import type { TaxTransaction } from '../lib/taxEngine';

const BASE: TaxTransaction = {
  origin_state:      'SP',
  destination_state: 'SP',
  tax_regime:        'lucro_presumido',
  icms_rate:          18,
  lines: [{ quantity: 10, unit_price: 100 }], // subtotal = 1000
};

describe('calculateTaxes — ICMS interno (sem FCP/DIFAL)', () => {
  it('applies the resolved icms_rate "por dentro" on subtotal', () => {
    const result = calculateTaxes(BASE);
    expect(result.lines[0].icms_rate).toBe(18);
    expect(result.lines[0].icms_value).toBe(180); // 1000 * 18%
    expect(result.lines[0].icms_cst).toBe('00');
    expect(result.totals.icms_total).toBe(180);
  });

  it('PIS/COFINS follow the regime table (lucro_presumido = cumulativo)', () => {
    const result = calculateTaxes(BASE);
    expect(result.lines[0].pis_rate).toBe(0.65);
    expect(result.lines[0].cofins_rate).toBe(3.00);
    expect(result.lines[0].pis_value).toBe(6.5);
    expect(result.lines[0].cofins_value).toBe(30);
  });

  it('IPI is "por fora" — added on top of the line total, not embedded', () => {
    const result = calculateTaxes({
      ...BASE,
      lines: [{ quantity: 10, unit_price: 100, ipi_rate: 10 }],
    });
    expect(result.lines[0].ipi_value).toBe(100); // 1000 * 10%
    expect(result.lines[0].line_total).toBe(1100); // subtotal + ipi
    expect(result.totals.grand_total).toBe(1100);
  });
});

describe('calculateTaxes — FCP', () => {
  it('adds FCP "por dentro" on top of ICMS when fcp_rate is provided', () => {
    const result = calculateTaxes({ ...BASE, fcp_rate: 2 });
    expect(result.lines[0].fcp_rate).toBe(2);
    expect(result.lines[0].fcp_value).toBe(20); // 1000 * 2%
    expect(result.totals.fcp_total).toBe(20);
    // embedded_tax_total = icms(180) + fcp(20) + pis(6.5) + cofins(30)
    expect(result.lines[0].embedded_tax_total).toBe(236.5);
  });

  it('defaults fcp_rate to 0 when omitted', () => {
    const result = calculateTaxes(BASE);
    expect(result.lines[0].fcp_value).toBe(0);
  });
});

describe('calculateTaxes — DIFAL (EC 87/2015)', () => {
  it('applies icms_difal_rate as a separate "por dentro" charge', () => {
    const result = calculateTaxes({
      ...BASE,
      origin_state: 'SP', destination_state: 'BA',
      icms_rate: 7, icms_difal_rate: 13, // 20 (interno BA) - 7 (interestadual) = 13
    });
    expect(result.lines[0].icms_value).toBe(70);        // 1000 * 7%
    expect(result.lines[0].icms_difal_value).toBe(130); // 1000 * 13%
    expect(result.totals.icms_difal_total).toBe(130);
  });
});

describe('calculateTaxes — Simples Nacional / MEI', () => {
  it('zeroes ICMS, FCP, DIFAL, PIS and COFINS — unified in DAS', () => {
    const result = calculateTaxes({
      ...BASE, tax_regime: 'simples_nacional',
      fcp_rate: 2, icms_difal_rate: 5,
    });
    expect(result.lines[0].icms_value).toBe(0);
    expect(result.lines[0].fcp_value).toBe(0);
    expect(result.lines[0].icms_difal_value).toBe(0);
    expect(result.lines[0].pis_value).toBe(0);
    expect(result.lines[0].cofins_value).toBe(0);
  });

  it('uses CSOSN codes instead of CST', () => {
    // CSOSN é classificado pela alíquota normal subjacente (icms_rate=18, "se não
    // fosse Simples"), não pelo icms_value zerado — 102 = tributada pelo Simples
    // sem permissão de crédito (caso comum de mercadoria não isenta).
    const result = calculateTaxes({ ...BASE, tax_regime: 'simples_nacional' });
    expect(result.lines[0].icms_cst).toBe('102');
    expect(result.lines[0].pis_cst).toBe('07');
    expect(result.lines[0].cofins_cst).toBe('70');
  });

  it('MEI behaves the same as simples_nacional for tax purposes', () => {
    const result = calculateTaxes({ ...BASE, tax_regime: 'mei' });
    expect(result.lines[0].icms_value).toBe(0);
    expect(result.lines[0].pis_value).toBe(0);
  });
});

describe('calculateTaxes — lucro_real (não-cumulativo)', () => {
  it('uses the higher non-cumulative PIS/COFINS rates', () => {
    const result = calculateTaxes({ ...BASE, tax_regime: 'lucro_real' });
    expect(result.lines[0].pis_rate).toBe(1.65);
    expect(result.lines[0].cofins_rate).toBe(7.60);
  });
});

describe('calculateTaxes — multiple lines', () => {
  it('sums totals across all lines correctly', () => {
    const result = calculateTaxes({
      ...BASE,
      lines: [
        { quantity: 10, unit_price: 100 }, // 1000
        { quantity: 5,  unit_price: 50  }, // 250
      ],
    });
    expect(result.totals.subtotal).toBe(1250);
    expect(result.totals.icms_total).toBe(225); // 1250 * 18%
  });
});
