// Orquestra a resolução de alíquotas (taxRulesResolver) e a aritmética pura
// (taxEngine) — é aqui que mora a regra de negócio de QUANDO cada coisa se
// aplica (DIFAL, FCP), não no motor nem no resolver.

import { getIcmsRate, getFcpRate, getIbsCbsRates, type DrizzleDB } from './taxRulesResolver';
import { calculateTaxes, type TaxRegime, type TaxLine, type TaxResult } from './taxEngine';

export interface ResolveTaxInput {
  origin_state:      string;
  destination_state: string;
  tax_regime:        TaxRegime;
  // clients.icms_taxpayer: '1' Contribuinte | '2' Contribuinte Isento | '9' Não Contribuinte
  icms_taxpayer?:     string;
  // clients.consumer_type: '0' Normal (B2B) | '1' Consumidor Final (B2C)
  consumer_type?:     string;
  lines:              TaxLine[];
}

export async function resolveAndCalculateTaxes(input: ResolveTaxInput, db: DrizzleDB): Promise<TaxResult> {
  const origin = input.origin_state.toUpperCase();
  const dest   = input.destination_state.toUpperCase();
  const interstate = origin !== dest;

  const [icmsRate, fcpRate, ibsCbs] = await Promise.all([
    getIcmsRate(origin, dest, db),
    getFcpRate(dest, db),
    // IBS é do destino, mesmo racional já usado pra ICMS interno/DIFAL (regra 44).
    getIbsCbsRates(dest, db),
  ]);

  // DIFAL (EC 87/2015, Convênio ICMS 236/2021): venda interestadual para
  // consumidor final não contribuinte do ICMS.
  const isNonContribuinte = input.icms_taxpayer === '9';
  const isConsumidorFinal = input.consumer_type === '1';
  const applyDifal = interstate && isNonContribuinte && isConsumidorFinal;

  let difalRate = 0;
  if (applyDifal) {
    const destInternalRate = await getIcmsRate(dest, dest, db);
    // Simplificação: diferença direta entre alíquota interna do destino e a
    // interestadual já aplicada — não faz o "cálculo por dentro" (gross-up) do
    // Anexo VI do Convênio 236/2021. Ver limitação documentada no README v15.0.
    difalRate = Math.max(0, destInternalRate - icmsRate);
  }

  return calculateTaxes({
    origin_state:      origin,
    destination_state: dest,
    tax_regime:        input.tax_regime,
    icms_rate:          icmsRate,
    fcp_rate:           fcpRate,
    icms_difal_rate:    difalRate,
    ibs_rate:           ibsCbs.ibsRate,
    cbs_rate:           ibsCbs.cbsRate,
    lines:              input.lines,
  });
}
