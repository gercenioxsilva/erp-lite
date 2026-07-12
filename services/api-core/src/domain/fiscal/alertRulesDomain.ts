// Regras de alerta TEMPORAIS/de estado — PURAS. Checks de DADOS pertencem
// ao inconsistencyDomain (dono único); aqui só o que depende de calendário
// ou de transição de estado: DAS vencendo/vencido (dia 20, regra de dia
// útil), certificado expirando, mudança de faixa, perda do Fator R e
// município não cadastrado no registry.

import { InconsistencyFinding } from './inconsistencyDomain';
import { FATOR_R_THRESHOLD } from '../simples/simplesDomain';
import { BracketRow } from '../simples/apuracaoDomain';
import { faixaDoRbt12 } from '../simples/simuladorDomain';

export type AlertRuleKey =
  | 'das_due' | 'certificado_expirando' | 'mudou_de_faixa'
  | 'perdeu_fator_r' | 'municipio_nao_cadastrado'
  // rule_keys herdadas do inconsistencyDomain (mapeadas 1:1):
  | InconsistencyFinding['rule'];

export interface AlertCandidate {
  ruleKey: AlertRuleKey;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail?: string;
  refType?: string;
  refId?: string;
  periodo?: string | null;
  payload?: Record<string, unknown>;
}

/** `rule|ref|período` — company entra no escopo da linha, não na chave. */
export function buildDedupeKey(c: AlertCandidate): string {
  return `${c.ruleKey}|${c.refId ?? '-'}|${c.periodo ?? '-'}`;
}

/** Vencimento do DAS: dia 20 do mês seguinte à competência; fim de semana
 *  prorroga para o próximo dia útil (feriados = limitação documentada). */
export function dasDueDate(competencia: string): Date {
  const [y, m] = competencia.split('-').map(Number);
  const due = new Date(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 20);
  while (due.getDay() === 0 || due.getDay() === 6) due.setDate(due.getDate() + 1);
  return due;
}

export interface AlertSnapshot {
  today: Date;
  // Apurações sem pagamento correspondente (de estimadoVsPago):
  apuracoesSemPagamento: Array<{ apuracaoId: string; competencia: string; dasTotal: number }>;
  certValidTo: Date | null;
  // Faixa por competência (via brackets — nunca parser de memoria jsonb):
  rbt12Atual: number | null;
  rbt12Anterior: number | null;
  brackets: BracketRow[] | null;
  fatorRAtual: number | null;   // null = não aplicável
  municipioCadastrado: boolean; // registry nfse_municipalities cobre o IBGE da empresa
  codigoIbge: string | null;
  avisoDiasDas: number;         // antecedência do warning (default 8)
  avisoDiasCert: number;        // default 30
}

export function evaluateAlertRules(s: AlertSnapshot): AlertCandidate[] {
  const out: AlertCandidate[] = [];

  for (const a of s.apuracoesSemPagamento) {
    const due = dasDueDate(a.competencia);
    const days = Math.ceil((due.getTime() - s.today.getTime()) / 86_400_000);
    if (days < 0) {
      out.push({
        ruleKey: 'das_due', severity: 'critical', periodo: a.competencia,
        refType: 'apuracao', refId: a.apuracaoId,
        title: `DAS de ${a.competencia} (R$ ${a.dasTotal.toFixed(2)}) VENCIDO há ${-days} dia(s)`,
        payload: { dasTotal: a.dasTotal, dueDate: due.toISOString().slice(0, 10) },
      });
    } else if (days <= s.avisoDiasDas) {
      out.push({
        ruleKey: 'das_due', severity: 'warning', periodo: a.competencia,
        refType: 'apuracao', refId: a.apuracaoId,
        title: `Faltam ${days} dia(s) para o DAS de ${a.competencia} (R$ ${a.dasTotal.toFixed(2)})`,
        payload: { dasTotal: a.dasTotal, dueDate: due.toISOString().slice(0, 10) },
      });
    }
  }

  if (s.certValidTo) {
    const days = Math.ceil((s.certValidTo.getTime() - s.today.getTime()) / 86_400_000);
    if (days < 0) {
      out.push({ ruleKey: 'certificado_expirando', severity: 'critical', title: `Certificado A1 EXPIRADO há ${-days} dia(s) — emissão de NFS-e bloqueada`, payload: { days } });
    } else if (days <= s.avisoDiasCert) {
      out.push({ ruleKey: 'certificado_expirando', severity: days <= 7 ? 'critical' : 'warning', title: `Certificado A1 expira em ${days} dia(s)`, payload: { days } });
    }
  }

  if (s.brackets && s.rbt12Atual !== null && s.rbt12Anterior !== null) {
    const atual = faixaDoRbt12(s.brackets, s.rbt12Atual);
    const anterior = faixaDoRbt12(s.brackets, s.rbt12Anterior);
    if (atual !== anterior) {
      out.push({
        ruleKey: 'mudou_de_faixa', severity: 'warning',
        periodo: new Date().toISOString().slice(0, 7),
        title: `Empresa mudou da faixa ${anterior} para a faixa ${atual} do Simples (RBT12 R$ ${s.rbt12Atual.toFixed(2)})`,
        payload: { faixaAnterior: anterior, faixaAtual: atual, rbt12: s.rbt12Atual },
      });
    }
  }

  if (s.fatorRAtual !== null && s.fatorRAtual < FATOR_R_THRESHOLD) {
    out.push({
      ruleKey: 'perdeu_fator_r', severity: 'warning',
      periodo: new Date().toISOString().slice(0, 7),
      title: `Fator R em ${(s.fatorRAtual * 100).toFixed(1)}% (< 28%) — receita de serviço tributada pelo Anexo V`,
      payload: { fatorR: s.fatorRAtual },
    });
  }

  if (!s.municipioCadastrado && s.codigoIbge) {
    out.push({
      ruleKey: 'municipio_nao_cadastrado', severity: 'warning',
      title: `Município ${s.codigoIbge} não cadastrado no registry de NFS-e — emissão própria indisponível`,
      payload: { codigoIbge: s.codigoIbge },
    });
  }

  return out;
}

/** Findings do detector (dono único) viram alertas com o mesmo rule_key. */
export function mapFindingToCandidate(f: InconsistencyFinding): AlertCandidate {
  return {
    ruleKey: f.rule, severity: f.severity, title: f.title,
    refType: f.refs[0]?.type, refId: f.refs[0]?.id,
    periodo: f.competencia, payload: f.payload,
  };
}
