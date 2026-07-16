// idAtividade do PGDAS-D — PURO. Enum FECHADO 1..43 publicado pela SERPRO
// (dados_de_dominio). NÃO é o código LC116, NÃO é o CNAE.
//
// 🚨 ARMADILHA CENTRAL: para atividade sujeita ao FATOR R, o anexo é OUTPUT — a
// SERPRO deriva III vs V do folhasSalario. Os ids 10/11/12 NÃO nomeiam anexo.
// Calcular o Fator R nós mesmos e cravar 13/14/15 declara "NÃO sujeito ao fator
// r" — outra afirmação jurídica, que dá o mesmo imposto neste mês e um errado
// no mês em que a folha cair. Logo: se fator_r_aplicavel, manda 10/11/12 e
// deixa a SERPRO enquadrar. (Nossa apuração ainda decide o NOSSO número; o
// indicadorComparacao confronta os dois.)
//
// Eixos de seleção (serviço, não-construção):
//   (a) sujeito ao fator r?           fator_r_aplicavel
//   (b) ISS retido pelo tomador?      iss_retido_padrao
//   (c) ISS de OUTRO município?       (v1 só suporta ISS do próprio município)
// Matriz ISS do próprio município:
//   fator r  → 11 (sem retenção) / 12 (com retenção)
//   Anexo III fixo → 14 (sem retenção) / 15 (com retenção)
// (ids 10/13 são a variante "ISS de outro município" — exigem
//  codigoOutroMunicipio + outraUf; bloqueados pelo guard de município.)

import { SimplesDomainError } from '../simples/simplesDomain';

export interface AtividadeContext {
  fator_r_aplicavel: boolean;
  iss_retido_padrao: boolean;
}

/** Resolve o idAtividade (1..43) do caso suportado; lança se indefinido. */
export function resolveIdAtividade(cfg: AtividadeContext): number {
  if (cfg.fator_r_aplicavel) {
    return cfg.iss_retido_padrao ? 12 : 11; // SERPRO resolve Anexo III vs V pelo folhasSalario
  }
  return cfg.iss_retido_padrao ? 15 : 14;   // Anexo III fixo (não sujeito ao fator r)
}

/** Códigos de tributo do PGDAS-D (valoresParaComparacao). */
export const CODIGO_TRIBUTO = {
  irpj: 1001, csll: 1002, cofins: 1004, pis: 1005, cpp: 1006, icms: 1007, iss: 1010,
} as const;

export type TributoComparavel = keyof typeof CODIGO_TRIBUTO;

/** Guard tipado: casos fora do suportado por v1 recusam em vez de adivinhar. */
export function assertAtividadeSuportada(cfg: {
  iss_fixo?: boolean; iss_retido_padrao?: boolean;
}): void {
  if (cfg.iss_fixo) {
    // apuracaoDomain não modela ISS fixo — o DAS já sairia errado antes.
    throw new SimplesDomainError('transmissao_iss_fixo_nao_suportado');
  }
  if (cfg.iss_retido_padrao) {
    // Nosso valor_iss é LÍQUIDO da retenção; a SERPRO só chega no líquido se
    // declararmos a retenção via qualificacoesTributarias, cuja estrutura ela
    // NÃO documenta. Sem isso, garante divergência na conferência.
    throw new SimplesDomainError('transmissao_iss_retido_nao_suportado');
  }
}
