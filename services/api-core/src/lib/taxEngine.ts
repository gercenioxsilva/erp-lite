// Motor de cálculo de impostos — stateless, pure functions.
// Segue o mesmo padrão de separação de responsabilidades do Avalara:
// calcular impostos independente de persistência ou de I/O; quem chama decide
// o que fazer com o resultado.
//
// Este módulo NÃO resolve alíquotas (isso é responsabilidade de
// taxRulesResolver.ts + taxCalculationService.ts) — ele só recebe as alíquotas
// já resolvidas para a operação e faz a aritmética. Mantém o motor puro e
// testável sem mock de banco.

export type TaxRegime = 'lucro_real' | 'lucro_presumido' | 'simples_nacional' | 'mei';

// ── Rate tables (somente classificação fiscal, não alíquota) ──────────────────

const PIS_COFINS_BY_REGIME: Record<TaxRegime, { pis: number; cofins: number }> = {
  lucro_presumido:  { pis: 0.65, cofins: 3.00 }, // regime cumulativo (Lei 9.718/98)
  lucro_real:       { pis: 1.65, cofins: 7.60 }, // regime não-cumulativo (Lei 10.637/02 e 10.833/03)
  simples_nacional: { pis: 0,    cofins: 0    }, // unificados no DAS (LC 123/06)
  mei:              { pis: 0,    cofins: 0    }, // unificados no DAS (LC 128/08)
};

// ── Public types ───────────────────────────────────────────────────────────────

export interface TaxLine {
  ncm_code?:  string;
  quantity:   number;
  unit_price: number;
  ipi_rate?:  number; // IPI is "por fora" (added on top); defaults to 0
}

export interface TaxTransaction {
  origin_state:      string; // 2-char UF (e.g. 'SP')
  destination_state: string;
  tax_regime:        TaxRegime;
  icms_rate:          number; // já resolvido (interno ou interestadual) pelo taxCalculationService
  fcp_rate?:          number; // já resolvido — 0 se a UF de destino não tem FCP configurado
  icms_difal_rate?:   number; // já resolvido — 0 se a operação não é DIFAL (EC 87/2015)
  lines:              TaxLine[];
}

export interface TaxLineResult {
  subtotal:      number;
  // ICMS — "por dentro": embedded in the sale price
  icms_cst:      string;  // CST '00'/'40' or CSOSN '102'/'400' for Simples/MEI
  icms_base:     number;
  icms_rate:     number;
  icms_value:    number;
  // FCP — Fundo de Combate à Pobreza, "por dentro" como o ICMS
  fcp_rate:      number;
  fcp_value:     number;
  // ICMS-DIFAL — diferencial de alíquota (EC 87/2015), venda interestadual a não contribuinte
  icms_difal_value: number;
  // PIS — "por dentro"
  pis_cst:       string;  // CST '01' or '07' for Simples/MEI
  pis_base:      number;
  pis_rate:      number;
  pis_value:     number;
  // COFINS — "por dentro"
  cofins_cst:    string;  // CST '01' or '70' for Simples/MEI
  cofins_base:   number;
  cofins_rate:   number;
  cofins_value:  number;
  // IPI — "por fora": added on top of subtotal
  ipi_base:      number;
  ipi_rate:      number;
  ipi_value:     number;
  // Summary
  embedded_tax_total: number; // ICMS + FCP + DIFAL + PIS + COFINS (informational; já está dentro do subtotal)
  line_total:         number; // subtotal + ipi_value
}

export interface TaxResult {
  lines: TaxLineResult[];
  totals: {
    subtotal:           number;
    icms_total:         number;
    fcp_total:          number;
    icms_difal_total:   number;
    pis_total:          number;
    cofins_total:       number;
    ipi_total:          number;
    embedded_tax_total: number;
    grand_total:        number; // subtotal + ipi_total
  };
  applied_rates: {
    icms:        number;
    fcp:         number;
    icms_difal:  number;
    pis:         number;
    cofins:      number;
  };
  tax_regime:        TaxRegime;
  origin_state:      string;
  destination_state: string;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function icmsCst(regime: TaxRegime, rate: number): string {
  const isSimples = regime === 'simples_nacional' || regime === 'mei';
  if (isSimples) return rate > 0 ? '102' : '400'; // CSOSN codes
  return rate > 0 ? '00' : '40';                  // CST codes
}

function pisCst(regime: TaxRegime): string {
  return (regime === 'simples_nacional' || regime === 'mei') ? '07' : '01';
}

function cofinsCst(regime: TaxRegime): string {
  return (regime === 'simples_nacional' || regime === 'mei') ? '70' : '01';
}

// ── Main calculation ───────────────────────────────────────────────────────────

export function calculateTaxes(tx: TaxTransaction): TaxResult {
  const isSimples = tx.tax_regime === 'simples_nacional' || tx.tax_regime === 'mei';
  const icms      = tx.icms_rate;
  // FCP e DIFAL não se aplicam a optantes do Simples Nacional nesta versão do
  // motor — RE 970.821 (Tema 1284/STF, 2024) reconheceu a imunidade do Simples
  // ao DIFAL interestadual; tratamento de FCP segue a mesma lógica de cautela.
  const fcpRate   = isSimples ? 0 : (tx.fcp_rate ?? 0);
  const difalRate = isSimples ? 0 : (tx.icms_difal_rate ?? 0);
  const { pis, cofins } = PIS_COFINS_BY_REGIME[tx.tax_regime] ?? PIS_COFINS_BY_REGIME.lucro_presumido;

  const lines: TaxLineResult[] = tx.lines.map(line => {
    const subtotal  = round2(line.quantity * line.unit_price);
    const ipiRate   = line.ipi_rate ?? 0;

    // ICMS/FCP/DIFAL/PIS/COFINS are "por dentro" — computed on the gross sale value
    const icmsValue   = isSimples ? 0 : round2(subtotal * icms     / 100);
    const fcpValue     = isSimples ? 0 : round2(subtotal * fcpRate   / 100);
    const difalValue   = isSimples ? 0 : round2(subtotal * difalRate / 100);
    const pisValue    = round2(subtotal * pis    / 100);
    const cofinsValue = round2(subtotal * cofins / 100);

    // IPI is "por fora" — computed on subtotal then added to the total
    const ipiValue = round2(subtotal * ipiRate / 100);

    const embedded = round2(icmsValue + fcpValue + difalValue + pisValue + cofinsValue);

    return {
      subtotal,
      icms_cst:      icmsCst(tx.tax_regime, icms),
      icms_base:     subtotal,
      icms_rate:     isSimples ? 0 : icms,
      icms_value:    icmsValue,
      fcp_rate:      isSimples ? 0 : fcpRate,
      fcp_value:     fcpValue,
      icms_difal_value: difalValue,
      pis_cst:       pisCst(tx.tax_regime),
      pis_base:      subtotal,
      pis_rate:      pis,
      pis_value:     pisValue,
      cofins_cst:    cofinsCst(tx.tax_regime),
      cofins_base:   subtotal,
      cofins_rate:   cofins,
      cofins_value:  cofinsValue,
      ipi_base:      subtotal,
      ipi_rate:      ipiRate,
      ipi_value:     ipiValue,
      embedded_tax_total: embedded,
      line_total:    round2(subtotal + ipiValue),
    };
  });

  const ZERO = { subtotal: 0, icms_total: 0, fcp_total: 0, icms_difal_total: 0,
                 pis_total: 0, cofins_total: 0, ipi_total: 0, embedded_tax_total: 0, grand_total: 0 };

  const totals = lines.reduce((acc, l) => ({
    subtotal:           round2(acc.subtotal           + l.subtotal),
    icms_total:         round2(acc.icms_total         + l.icms_value),
    fcp_total:          round2(acc.fcp_total          + l.fcp_value),
    icms_difal_total:   round2(acc.icms_difal_total   + l.icms_difal_value),
    pis_total:          round2(acc.pis_total          + l.pis_value),
    cofins_total:       round2(acc.cofins_total       + l.cofins_value),
    ipi_total:          round2(acc.ipi_total          + l.ipi_value),
    embedded_tax_total: round2(acc.embedded_tax_total + l.embedded_tax_total),
    grand_total:        round2(acc.grand_total        + l.line_total),
  }), ZERO);

  return {
    lines,
    totals,
    applied_rates: {
      icms:       isSimples ? 0 : icms,
      fcp:        isSimples ? 0 : fcpRate,
      icms_difal: isSimples ? 0 : difalRate,
      pis, cofins,
    },
    tax_regime:        tx.tax_regime,
    origin_state:      tx.origin_state,
    destination_state: tx.destination_state,
  };
}
