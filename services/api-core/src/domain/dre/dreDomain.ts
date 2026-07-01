// Domínio do DRE Gerencial — cálculo e estrutura do Demonstrativo de Resultado.
// Abordagem Caminho A: sem dupla entrada, lê dados já existentes (invoices, payables).
//
// IMPORTANTE: Este é um DRE GERENCIAL, não contábil formal. Não substitui SPED
// Contábil/ECD. Destina-se a visão de resultado para o gestor/sócio da empresa.

export type DRELineType =
  | 'revenue'
  | 'deduction'
  | 'cogs'
  | 'opex'
  | 'financial_expense'
  | 'financial_income'
  | 'taxes'
  | 'other';

export interface DRECategory {
  id:         string;
  code:       string;
  name:       string;
  type:       DRELineType;
  sign:       1 | -1;
  sort_order: number;
  amount:     number; // valor acumulado no período
}

// ── Estrutura do DRE com totalizadores intermediários ─────────────────────────

export interface DREResult {
  period_from: string;
  period_to:   string;

  // (+) Receita Bruta
  receita_bruta: number;
  // (-) Deduções (cancelamentos, impostos sobre receita)
  deducoes: number;
  // (=) Receita Líquida
  receita_liquida: number;

  // (-) CMV / CSP
  cmv: number;
  // (=) Lucro Bruto
  lucro_bruto: number;
  // % Margem Bruta
  margem_bruta_pct: number;

  // (-) Despesas Operacionais (pessoal + aluguel + utilidades + marketing + admin + tributária + outras)
  despesas_opex: number;
  // (=) EBITDA (Resultado Operacional antes de financeiro e impostos sobre resultado)
  ebitda: number;
  // % Margem EBITDA
  ebitda_pct: number;

  // (-) Despesas Financeiras
  despesas_financeiras: number;
  // (+) Receitas Financeiras
  receitas_financeiras: number;
  // (=) EBT (Resultado antes dos Impostos sobre Resultado)
  ebt: number;

  // (-) IRPJ/CSLL
  impostos_resultado: number;
  // (=) Resultado Líquido
  resultado_liquido: number;
  // % Margem Líquida
  margem_liquida_pct: number;

  // Linhas detalhadas por categoria (para a tabela)
  categories: DRECategory[];
}

// ── Funções de agregação pura ─────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safePct(value: number, base: number): number {
  if (base === 0) return 0;
  return round2((value / base) * 100);
}

export function buildDRE(
  periodFrom:  string,
  periodTo:    string,
  categories:  DRECategory[],
): DREResult {
  const sum = (type: DRELineType | DRELineType[]) => {
    const types = Array.isArray(type) ? type : [type];
    return round2(
      categories
        .filter(c => types.includes(c.type))
        .reduce((s, c) => s + c.amount, 0),
    );
  };

  const receita_bruta       = sum('revenue');
  const deducoes            = sum('deduction');
  const receita_liquida     = round2(receita_bruta + deducoes); // deducoes is signed negative

  const cmv                 = sum('cogs');
  const lucro_bruto         = round2(receita_liquida + cmv);    // cmv is signed negative

  const despesas_opex       = sum(['opex', 'other']);
  const ebitda              = round2(lucro_bruto + despesas_opex);

  const despesas_financeiras = sum('financial_expense');
  const receitas_financeiras = sum('financial_income');
  const ebt                  = round2(ebitda + despesas_financeiras + receitas_financeiras);

  const impostos_resultado  = sum('taxes');
  const resultado_liquido   = round2(ebt + impostos_resultado);

  return {
    period_from: periodFrom,
    period_to:   periodTo,
    receita_bruta,
    deducoes,
    receita_liquida,
    cmv,
    lucro_bruto,
    margem_bruta_pct:  safePct(lucro_bruto,     receita_liquida),
    despesas_opex,
    ebitda,
    ebitda_pct:        safePct(ebitda,           receita_liquida),
    despesas_financeiras,
    receitas_financeiras,
    ebt,
    impostos_resultado,
    resultado_liquido,
    margem_liquida_pct: safePct(resultado_liquido, receita_liquida),
    categories: [...categories].sort((a, b) => a.sort_order - b.sort_order),
  };
}
