import { describe, it, expect } from 'vitest';
import { buildDRE, type DRECategory } from '../domain/dre/dreDomain';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeCategories(overrides: Partial<DRECategory>[]): DRECategory[] {
  const base: DRECategory = {
    id: 'cat-1', code: 'test', name: 'Test', type: 'revenue', sign: 1, sort_order: 10, amount: 0,
  };
  return overrides.map((o, i) => ({ ...base, id: `cat-${i}`, ...o }));
}

// ── buildDRE ──────────────────────────────────────────────────────────────────

describe('buildDRE', () => {
  it('calcula receita bruta, lucro bruto e resultado liquido simples', () => {
    const cats = makeCategories([
      { code: 'receita_bruta', type: 'revenue',  sign:  1, sort_order: 10, amount: 10000 },
      { code: 'cmv',           type: 'cogs',     sign: -1, sort_order: 30, amount:  -3000 }, // negativo = despesa
      { code: 'pessoal',       type: 'opex',     sign: -1, sort_order: 40, amount:  -2000 },
    ]);

    const dre = buildDRE('2025-01-01', '2025-01-31', cats);

    expect(dre.receita_bruta).toBe(10000);
    expect(dre.deducoes).toBe(0);
    expect(dre.receita_liquida).toBe(10000);
    expect(dre.cmv).toBe(-3000);
    expect(dre.lucro_bruto).toBe(7000);  // 10000 - 3000
    expect(dre.margem_bruta_pct).toBe(70); // 7000/10000 * 100
    expect(dre.despesas_opex).toBe(-2000);
    expect(dre.ebitda).toBe(5000);       // 7000 - 2000
    expect(dre.ebitda_pct).toBe(50);     // 5000/10000 * 100
    expect(dre.resultado_liquido).toBe(5000);
  });

  it('inclui deducoes corretamente na receita liquida', () => {
    const cats = makeCategories([
      { code: 'receita_bruta', type: 'revenue',   sign:  1, amount: 10000 },
      { code: 'deducoes',      type: 'deduction', sign: -1, amount: -1000 },
      { code: 'cmv',           type: 'cogs',      sign: -1, amount:  -2000 },
    ]);
    const dre = buildDRE('2025-01-01', '2025-01-31', cats);
    expect(dre.receita_liquida).toBe(9000); // 10000 - 1000
    expect(dre.lucro_bruto).toBe(7000);     // 9000 - 2000
  });

  it('calcula EBITDA com despesas financeiras e impostos', () => {
    const cats = makeCategories([
      { code: 'receita_bruta',      type: 'revenue',           sign:  1, amount: 20000 },
      { code: 'cmv',                type: 'cogs',              sign: -1, amount:  -8000 },
      { code: 'pessoal',            type: 'opex',              sign: -1, amount:  -4000 },
      { code: 'despesa_financeira', type: 'financial_expense', sign: -1, amount:   -500 },
      { code: 'receita_financeira', type: 'financial_income',  sign:  1, amount:    200 },
      { code: 'irpj_csll',          type: 'taxes',             sign: -1, amount:  -1000 },
    ]);
    const dre = buildDRE('2025-01-01', '2025-01-31', cats);
    expect(dre.ebitda).toBe(8000);              // 12000 - 4000
    expect(dre.despesas_financeiras).toBe(-500);
    expect(dre.receitas_financeiras).toBe(200);
    expect(dre.ebt).toBe(7700);                 // 8000 - 500 + 200
    expect(dre.impostos_resultado).toBe(-1000);
    expect(dre.resultado_liquido).toBe(6700);   // 7700 - 1000
  });

  it('retorna 0% de margem quando receita liquida e zero', () => {
    const cats = makeCategories([
      { code: 'receita_bruta', type: 'revenue', sign: 1, amount: 0 },
    ]);
    const dre = buildDRE('2025-01-01', '2025-01-31', cats);
    expect(dre.margem_bruta_pct).toBe(0);
    expect(dre.ebitda_pct).toBe(0);
    expect(dre.margem_liquida_pct).toBe(0);
  });

  it('ordena categories por sort_order no resultado', () => {
    const cats = makeCategories([
      { code: 'pessoal',       sort_order: 40, type: 'opex',    sign: -1, amount: -1000 },
      { code: 'receita_bruta', sort_order: 10, type: 'revenue', sign:  1, amount: 5000  },
      { code: 'cmv',           sort_order: 30, type: 'cogs',    sign: -1, amount: -2000 },
    ]);
    const dre = buildDRE('2025-01-01', '2025-01-31', cats);
    expect(dre.categories[0].code).toBe('receita_bruta');
    expect(dre.categories[1].code).toBe('cmv');
    expect(dre.categories[2].code).toBe('pessoal');
  });

  it('preserva from/to no resultado', () => {
    const dre = buildDRE('2025-03-01', '2025-03-31', []);
    expect(dre.period_from).toBe('2025-03-01');
    expect(dre.period_to).toBe('2025-03-31');
  });
});
