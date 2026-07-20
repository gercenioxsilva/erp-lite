// Payload TRANSDECLARACAO11 (PGDAS-D) — PURO. Traduz o que o ERP já calcula
// (ApuracaoResult + ledger de receita + folha + cadastro) no objeto `dados` que
// a SERPRO Integra Contador recebe. NÃO faz I/O — o serviço monta os insumos.
//
// Regras não-óbvias:
//   - `pa` é NÚMERO YYYYMM (não string).
//   - o RBT12 NÃO vai no payload: a RFB o recalcula de receitasBrutasAnteriores.
//     (É por isso que o ledger precisa estar completo — a conferência é cega a
//      um mês faltando; ver readinessDomain.)
//   - valoresParaComparacao OMITE tributos zerados (nunca manda 0); 1003/1009
//     não existem.
//   - indicadorComparacao é SEMPRE true no serviço (divergência de R$0,01
//     bloqueia); aqui só montamos os valores.

import { CODIGO_TRIBUTO, TributoComparavel } from './atividadesDomain';

export interface ReceitaMensal {
  competencia: string; // 'YYYY-MM'
  valor: number;
}

export interface TransdeclaracaoInput {
  cnpjCompleto: string;              // 14 dígitos
  competencia: string;               // 'YYYY-MM'
  regime: 'competencia' | 'caixa';
  receitaMes: number;                // receita bruta interna da competência
  idAtividade: number;               // 1..43 (resolveIdAtividade)
  receitasBrutasAnteriores: ReceitaMensal[];  // 12 meses anteriores (interno)
  folhasSalario: ReceitaMensal[];             // 12 meses (folha + pró-labore)
  valoresParaComparacao: Partial<Record<TributoComparavel, number>>;
  indicadorTransmissao: boolean;     // false=conferência, true=transmitir
  tipoDeclaracao: 1 | 2;             // 1=original, 2=retificadora
}

/** 'YYYY-MM' → 202602 (Number). */
export function competenciaToPa(competencia: string): number {
  return Number(competencia.replace('-', ''));
}

export interface TransdeclaracaoDados {
  cnpjCompleto: string;
  pa: number;
  indicadorTransmissao: boolean;
  indicadorComparacao: boolean;
  declaracao: {
    tipoDeclaracao: number;
    receitaPaCompetenciaInterno: number | null;
    receitaPaCompetenciaExterno: number | null;
    receitaPaCaixaInterno: number | null;
    receitaPaCaixaExterno: number | null;
    valorFixoIcms: number | null;
    valorFixoIss: number | null;
    receitasBrutasAnteriores: Array<{ pa: number; valorInterno: number; valorExterno: number }>;
    folhasSalario: Array<{ pa: number; valor: number }>;
    naoOptante: null;
    estabelecimentos: Array<{
      cnpjCompleto: string;
      atividades: Array<{
        idAtividade: number;
        valorAtividade: number;
        receitasAtividade: Array<{
          valor: number;
          codigoOutroMunicipio: number | null;
          outraUf: string | null;
          isencoes: unknown[];
          reducoes: unknown[];
          qualificacoesTributarias: unknown[];
          exigibilidadesSuspensas: null;
        }>;
      }>;
    }>;
  };
  valoresParaComparacao: Array<{ codigoTributo: number; valor: number }>;
}

/** Monta o objeto `dados` do TRANSDECLARACAO11 (regime caixa ⇒ campos Caixa). */
export function buildTransdeclaracaoDados(input: TransdeclaracaoInput): TransdeclaracaoDados {
  const pa = competenciaToPa(input.competencia);
  const isCaixa = input.regime === 'caixa';

  const valoresParaComparacao = (Object.keys(CODIGO_TRIBUTO) as TributoComparavel[])
    .map((t) => ({ codigoTributo: CODIGO_TRIBUTO[t], valor: input.valoresParaComparacao[t] ?? 0 }))
    .filter((v) => v.valor > 0); // OMITE zerados — nunca manda 0

  return {
    cnpjCompleto: input.cnpjCompleto,
    pa,
    indicadorTransmissao: input.indicadorTransmissao,
    indicadorComparacao: true, // divergência bloqueia — ver pgdasdService
    declaracao: {
      tipoDeclaracao: input.tipoDeclaracao,
      receitaPaCompetenciaInterno: isCaixa ? null : input.receitaMes,
      receitaPaCompetenciaExterno: isCaixa ? null : 0,
      receitaPaCaixaInterno: isCaixa ? input.receitaMes : null,
      receitaPaCaixaExterno: isCaixa ? 0 : null,
      valorFixoIcms: null,
      valorFixoIss: null,
      receitasBrutasAnteriores: input.receitasBrutasAnteriores.map((r) => ({
        pa: competenciaToPa(r.competencia), valorInterno: r.valor, valorExterno: 0,
      })),
      folhasSalario: input.folhasSalario.map((f) => ({
        pa: competenciaToPa(f.competencia), valor: f.valor,
      })),
      naoOptante: null,
      estabelecimentos: [{
        cnpjCompleto: input.cnpjCompleto,
        atividades: [{
          idAtividade: input.idAtividade,
          valorAtividade: input.receitaMes,
          receitasAtividade: [{
            valor: input.receitaMes,
            codigoOutroMunicipio: null, // v1: ISS do próprio município
            outraUf: null,
            isencoes: [],
            reducoes: [],
            qualificacoesTributarias: [],
            exigibilidadesSuspensas: null,
          }],
        }],
      }],
    },
    valoresParaComparacao,
  };
}

/** `dados` vai como STRING JSON-escapada dentro de pedidoDados. */
export function serializeDados(dados: TransdeclaracaoDados): string {
  return JSON.stringify(dados);
}
