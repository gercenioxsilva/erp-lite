// Guia de impostos (E8) — builder PURO do roteiro assistido do PGDAS-D a
// partir de uma linha de simples_apuracao. Reusado pelo export (que também
// marca status='exported') e pelo endpoint/tela da guia (read-only, sem side
// effect). O DAS oficial com código de barras só sai do PGDAS-D — este
// documento é o kit de preenchimento com os valores conferidos.

import { dasDueDate } from './alertRulesDomain';

export interface ApuracaoRowLike {
  competencia: string;
  rbt12: string | null;
  receita_competencia: string | null;
  das_total: string | null;
  fator_r: string | null;
  sublimite_excedido: boolean | null;
  valor_irpj: string | null; valor_csll: string | null; valor_cofins: string | null; valor_pis: string | null;
  valor_cpp: string | null; valor_icms: string | null; valor_ipi: string | null; valor_iss: string | null;
  iss_retido: string | null;
  memoria: unknown;
}

export const GUIA_AVISO =
  'O PGDAS-D não possui API oficial de transmissão. Lance os valores abaixo manualmente no portal (www8.receita.fazenda.gov.br) — este documento é a memória de cálculo assistida, não a guia oficial com código de barras (essa só o portal gera).';

export function buildRoteiroPassos(competencia: string, receita: string | null): string[] {
  return [
    '1. Acesse o PGDAS-D no portal do Simples Nacional com certificado ou código de acesso.',
    `2. Selecione o período de apuração ${competencia}.`,
    `3. Informe a receita bruta do mês: R$ ${receita ?? '0'}.`,
    '4. Confira a RBT12 calculada pelo portal contra a memória abaixo.',
    '5. Segregue as receitas por atividade/anexo conforme a memória.',
    '6. Confira o DAS apurado com o valor estimado e gere o DAS para pagamento.',
  ];
}

export function buildGuia(row: ApuracaoRowLike) {
  return {
    aviso: GUIA_AVISO,
    competencia: row.competencia,
    vencimento: dasDueDate(row.competencia).toISOString().slice(0, 10),
    passos: buildRoteiroPassos(row.competencia, row.receita_competencia),
    valores: {
      rbt12: row.rbt12, receita_competencia: row.receita_competencia,
      das_total: row.das_total, fator_r: row.fator_r, sublimite_excedido: row.sublimite_excedido,
      tributos: {
        irpj: row.valor_irpj, csll: row.valor_csll, cofins: row.valor_cofins, pis: row.valor_pis,
        cpp: row.valor_cpp, icms: row.valor_icms, ipi: row.valor_ipi, iss: row.valor_iss,
        iss_retido_abatido: row.iss_retido,
      },
    },
    memoria: row.memoria,
  };
}
