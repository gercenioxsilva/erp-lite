// São Paulo tax calculation engine — stateless, pure functions.
// Follows the same separation-of-concerns pattern used by Avalara:
// compute taxes independently of persistence; callers decide what to store.

export type TaxRegime = 'lucro_real' | 'lucro_presumido' | 'simples_nacional' | 'mei';

// ── Rate tables ────────────────────────────────────────────────────────────────

// States that receive 12% ICMS from SP (developed states per CONFAZ convention).
// All other states (North, Northeast, ES) receive 7%.
const STATES_12PCT_FROM_SP = new Set([
  'MG', 'RJ',             // Southeast (ES is treated as 7%)
  'PR', 'SC', 'RS',       // South
  'GO', 'MS', 'MT', 'DF', // Center-West
]);

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
  lines:             TaxLine[];
}

export interface TaxLineResult {
  subtotal:      number;
  // ICMS — "por dentro": embedded in the sale price
  icms_cst:      string;  // CST '00'/'40' or CSOSN '102'/'400' for Simples/MEI
  icms_base:     number;
  icms_rate:     number;
  icms_value:    number;
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
  embedded_tax_total: number; // ICMS + PIS + COFINS (informational; already inside subtotal)
  line_total:         number; // subtotal + ipi_value
}

export interface TaxResult {
  lines: TaxLineResult[];
  totals: {
    subtotal:           number;
    icms_total:         number;
    pis_total:          number;
    cofins_total:       number;
    ipi_total:          number;
    embedded_tax_total: number; // icms + pis + cofins combined
    grand_total:        number; // subtotal + ipi_total
  };
  applied_rates: {
    icms:   number;
    pis:    number;
    cofins: number;
  };
  tax_regime:        TaxRegime;
  origin_state:      string;
  destination_state: string;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function icmsRate(origin: string, dest: string): number {
  if (origin === dest) return 12; // internal operation — SP standard internal rate
  if (origin === 'SP') return STATES_12PCT_FROM_SP.has(dest) ? 12 : 7;
  // Non-SP origin: apply same table as reasonable default for MVP
  return STATES_12PCT_FROM_SP.has(dest) ? 12 : 7;
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
  const icms      = icmsRate(tx.origin_state, tx.destination_state);
  const { pis, cofins } = PIS_COFINS_BY_REGIME[tx.tax_regime] ?? PIS_COFINS_BY_REGIME.lucro_presumido;

  const lines: TaxLineResult[] = tx.lines.map(line => {
    const subtotal  = round2(line.quantity * line.unit_price);
    const ipiRate   = line.ipi_rate ?? 0;

    // ICMS/PIS/COFINS are "por dentro" — computed on the gross sale value
    const icmsValue   = isSimples ? 0 : round2(subtotal * icms   / 100);
    const pisValue    = round2(subtotal * pis    / 100);
    const cofinsValue = round2(subtotal * cofins / 100);

    // IPI is "por fora" — computed on subtotal then added to the total
    const ipiValue = round2(subtotal * ipiRate / 100);

    const embedded = round2(icmsValue + pisValue + cofinsValue);

    return {
      subtotal,
      icms_cst:      icmsCst(tx.tax_regime, icms),
      icms_base:     subtotal,
      icms_rate:     isSimples ? 0 : icms,
      icms_value:    icmsValue,
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

  const ZERO = { subtotal: 0, icms_total: 0, pis_total: 0, cofins_total: 0,
                 ipi_total: 0, embedded_tax_total: 0, grand_total: 0 };

  const totals = lines.reduce((acc, l) => ({
    subtotal:           round2(acc.subtotal           + l.subtotal),
    icms_total:         round2(acc.icms_total         + l.icms_value),
    pis_total:          round2(acc.pis_total          + l.pis_value),
    cofins_total:       round2(acc.cofins_total       + l.cofins_value),
    ipi_total:          round2(acc.ipi_total          + l.ipi_value),
    embedded_tax_total: round2(acc.embedded_tax_total + l.embedded_tax_total),
    grand_total:        round2(acc.grand_total        + l.line_total),
  }), ZERO);

  return {
    lines,
    totals,
    applied_rates: { icms: isSimples ? 0 : icms, pis, cofins },
    tax_regime:        tx.tax_regime,
    origin_state:      tx.origin_state,
    destination_state: tx.destination_state,
  };
}
