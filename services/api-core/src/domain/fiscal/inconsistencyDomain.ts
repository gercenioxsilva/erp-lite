// Detector de inconsistências fiscais — DONO ÚNICO dos checks de dados
// (contrato congelado: alertas mapeia rule→fiscal_alerts.rule_key, o Score
// pesa os findings e o robô de fechamento injeta este detector no gate).
// Funções PURAS: recebem structs já buscadas, nunca tocam o banco.

export type InconsistencyRule =
  | 'payment_without_invoice'      // recebimento sem documento fiscal vinculado
  | 'invoice_without_payment'      // nota autorizada sem recebimento após N dias
  | 'card_revenue_mismatch'        // receita da maquininha ≠ receita de notas na competência
  | 'iss_retention_mismatch'       // ISS retido da nota × default do cadastro
  | 'invoice_missing_service_code' // NFS-e sem código de serviço
  | 'missing_cnae'                 // cadastro sem CNAE principal
  | 'das_above_moving_avg';        // DAS da competência muito acima da média móvel

export type InconsistencySeverity = 'info' | 'warning' | 'critical';

export interface InconsistencyRef {
  type: 'receivable_payment' | 'invoice' | 'nfse' | 'imported_transaction' | 'apuracao' | 'config';
  id: string;
}

export interface InconsistencyFinding {
  rule: InconsistencyRule;
  severity: InconsistencySeverity;
  competencia: string | null;
  title: string;
  refs: InconsistencyRef[];
  payload: Record<string, unknown>;
}

export interface ChecksInput {
  competencia: string | null; // null = geral (sem recorte de mês)
  // Recebimentos do período sem vínculo com documento fiscal:
  paymentsWithoutDoc: Array<{ id: string; amount: number; paymentDate: string }>;
  // Notas autorizadas há mais de N dias cujo receivable segue em aberto:
  unpaidInvoices: Array<{ id: string; kind: 'invoice' | 'nfse'; amount: number; authDate: string; daysOpen: number }>;
  // Comparação maquininha × notas por competência:
  cardVsNotes: Array<{ competencia: string; cardRevenue: number; notesRevenue: number }>;
  // NFS-e com retenção divergente do cadastro:
  issMismatches: Array<{ id: string; issRetidoNota: boolean; issRetidoConfig: boolean }>;
  // NFS-e sem código de serviço:
  nfseSemServiceCode: Array<{ id: string }>;
  // Cadastro:
  hasCnaePrincipal: boolean;
  configId: string | null;
  // Série de DAS apurados (ordem cronológica) p/ média móvel:
  dasSeries: Array<{ competencia: string; apuracaoId: string; dasTotal: number }>;
  thresholds?: Partial<Thresholds>;
}

export interface Thresholds {
  diasSemRecebimento: number;   // invoice_without_payment
  tolPercent: number;           // card_revenue_mismatch (±%)
  dasAvgPercent: number;        // das_above_moving_avg (+% sobre a média)
  minApuracoes: number;         // amostra mínima p/ média móvel
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  diasSemRecebimento: 30, tolPercent: 5, dasAvgPercent: 25, minApuracoes: 3,
};

export function runInconsistencyChecks(input: ChecksInput): InconsistencyFinding[] {
  const t = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const findings: InconsistencyFinding[] = [];

  for (const p of input.paymentsWithoutDoc) {
    findings.push({
      rule: 'payment_without_invoice', severity: 'warning', competencia: input.competencia,
      title: `Recebimento de R$ ${p.amount.toFixed(2)} em ${p.paymentDate} sem documento fiscal vinculado`,
      refs: [{ type: 'receivable_payment', id: p.id }], payload: { amount: p.amount },
    });
  }

  for (const inv of input.unpaidInvoices) {
    if (inv.daysOpen < t.diasSemRecebimento) continue;
    findings.push({
      rule: 'invoice_without_payment', severity: inv.daysOpen >= t.diasSemRecebimento * 2 ? 'critical' : 'warning',
      competencia: input.competencia,
      title: `${inv.kind === 'nfse' ? 'NFS-e' : 'NF-e'} de R$ ${inv.amount.toFixed(2)} autorizada há ${inv.daysOpen} dias sem recebimento`,
      refs: [{ type: inv.kind, id: inv.id }], payload: { daysOpen: inv.daysOpen, amount: inv.amount },
    });
  }

  for (const c of input.cardVsNotes) {
    if (c.cardRevenue <= 0) continue;
    const diffPct = c.notesRevenue > 0
      ? Math.abs(c.cardRevenue - c.notesRevenue) / c.cardRevenue * 100
      : 100;
    if (diffPct <= t.tolPercent) continue;
    findings.push({
      rule: 'card_revenue_mismatch', severity: diffPct > 20 ? 'critical' : 'warning', competencia: c.competencia,
      title: `Receita da maquininha (R$ ${c.cardRevenue.toFixed(2)}) diverge das notas (R$ ${c.notesRevenue.toFixed(2)}) em ${diffPct.toFixed(1)}%`,
      refs: [], payload: { cardRevenue: c.cardRevenue, notesRevenue: c.notesRevenue, diffPct },
    });
  }

  for (const m of input.issMismatches) {
    findings.push({
      rule: 'iss_retention_mismatch', severity: 'warning', competencia: input.competencia,
      title: `NFS-e com ISS retido=${m.issRetidoNota ? 'sim' : 'não'} divergente do padrão do cadastro (${m.issRetidoConfig ? 'sim' : 'não'})`,
      refs: [{ type: 'nfse', id: m.id }], payload: m as unknown as Record<string, unknown>,
    });
  }

  for (const n of input.nfseSemServiceCode) {
    findings.push({
      rule: 'invoice_missing_service_code', severity: 'warning', competencia: input.competencia,
      title: 'NFS-e sem código de serviço (LC116)',
      refs: [{ type: 'nfse', id: n.id }], payload: {},
    });
  }

  if (!input.hasCnaePrincipal) {
    findings.push({
      rule: 'missing_cnae', severity: 'warning', competencia: null,
      title: 'Cadastro fiscal sem CNAE principal',
      refs: input.configId ? [{ type: 'config', id: input.configId }] : [], payload: {},
    });
  }

  // Média móvel do DAS: exige amostra mínima; empresa nova → ausência de finding.
  if (input.dasSeries.length >= t.minApuracoes + 1) {
    const last = input.dasSeries[input.dasSeries.length - 1];
    const prev = input.dasSeries.slice(0, -1).slice(-t.minApuracoes);
    const avg = prev.reduce((s, x) => s + x.dasTotal, 0) / prev.length;
    if (avg > 0 && last.dasTotal > avg * (1 + t.dasAvgPercent / 100)) {
      findings.push({
        rule: 'das_above_moving_avg', severity: 'info', competencia: last.competencia,
        title: `DAS de ${last.competencia} (R$ ${last.dasTotal.toFixed(2)}) está ${(((last.dasTotal / avg) - 1) * 100).toFixed(0)}% acima da média das últimas ${prev.length} competências`,
        refs: [{ type: 'apuracao', id: last.apuracaoId }], payload: { dasTotal: last.dasTotal, movingAvg: avg },
      });
    }
  }

  return findings;
}
