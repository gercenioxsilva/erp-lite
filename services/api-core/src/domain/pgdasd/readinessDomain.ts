// Prontidão para transmitir o PGDAS-D — PURO. Molde de evaluateEmissionReadiness
// (fiscalCompanyConfigDomain): lista TODOS os bloqueios de uma vez, em vez de
// falhar no primeiro. Recusar > adivinhar: cada caso fora do suportado por v1
// vira um motivo tipado, nunca um payload inventado.
//
// O motivo `ledger_incompleto` é o mais importante: é a ÚNICA classe de erro
// que a conferência (indicadorComparacao) NÃO pega — a RFB recalcula sobre a
// MESMA janela furada que mandamos e concorda ao centavo com um número errado.

export type ReadinessReason =
  | 'mei_nao_suportado'
  | 'nao_optante'
  | 'sem_receita_na_competencia'
  | 'rbt12_source_manual'      // bootstrap manual não tem quebra mensal
  | 'ledger_incompleto'        // faltam meses no ledger (janela furada)
  | 'iss_fixo_nao_suportado'
  | 'iss_retido_nao_suportado' // qualificacoesTributarias não documentada
  | 'multi_anexo_nao_suportado'
  | 'sublimite_nao_suportado'
  | 'exportacao_nao_suportada'
  | 'inscricao_municipal_ausente';

export interface ReadinessInput {
  enquadramento: string;                 // MEI|ME|EPP
  optanteSimples: boolean;
  issFixo: boolean;
  issRetidoPadrao: boolean;
  inscricaoMunicipal: string | null;
  rbt12Source: 'ledger' | 'manual';
  receitaMes: number;
  sublimiteExcedido: boolean;
  anexosNaCompetencia: number;           // nº de anexos distintos com receita
  competencia: string;                   // 'YYYY-MM'
  dataAbertura: string | null;           // 'YYYY-MM-DD'
  competenciasComReceita: string[];      // meses da janela que TÊM linha no ledger
}

export interface ReadinessResult {
  ready: boolean;
  reasons: ReadinessReason[];
  mesesFaltantes: string[];              // detalhe do ledger_incompleto
}

/** Meses da janela que deveriam ter receita (a partir de dataAbertura) e não têm. */
export function missingLedgerMonths(input: {
  janela: string[]; dataAbertura: string | null; competenciasComReceita: string[];
}): string[] {
  const aberturaComp = input.dataAbertura ? input.dataAbertura.slice(0, 7) : null;
  const presentes = new Set(input.competenciasComReceita);
  return input.janela
    .filter((c) => !aberturaComp || c >= aberturaComp)   // só meses após a abertura
    .filter((c) => !presentes.has(c));
}

export function evaluateTransmissionReadiness(
  input: ReadinessInput, janela: string[],
): ReadinessResult {
  const reasons: ReadinessReason[] = [];

  if (input.enquadramento === 'MEI') reasons.push('mei_nao_suportado');
  if (!input.optanteSimples) reasons.push('nao_optante');
  if (input.receitaMes <= 0) reasons.push('sem_receita_na_competencia');
  if (!input.inscricaoMunicipal) reasons.push('inscricao_municipal_ausente');
  if (input.rbt12Source === 'manual') reasons.push('rbt12_source_manual');
  if (input.issFixo) reasons.push('iss_fixo_nao_suportado');
  if (input.issRetidoPadrao) reasons.push('iss_retido_nao_suportado');
  if (input.sublimiteExcedido) reasons.push('sublimite_nao_suportado');
  if (input.anexosNaCompetencia > 1) reasons.push('multi_anexo_nao_suportado');

  // Ledger completo: todo mês da janela a partir da abertura precisa ter receita.
  // (Só faz sentido quando o RBT12 vem do ledger; no manual o motivo acima já
  //  bloqueia.)
  const mesesFaltantes = input.rbt12Source === 'ledger'
    ? missingLedgerMonths({
        janela, dataAbertura: input.dataAbertura,
        competenciasComReceita: input.competenciasComReceita,
      })
    : [];
  if (mesesFaltantes.length > 0) reasons.push('ledger_incompleto');

  return { ready: reasons.length === 0, reasons, mesesFaltantes };
}
