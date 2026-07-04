// Domínio do Funil de Conversão de Propostas — agregação pura (sem I/O).
//
// LIMITAÇÃO CONHECIDA: cada proposal só guarda o status FINAL (não um histórico
// de transições). Por isso "viewed_or_later" só conta status IN ('viewed',
// 'accepted') — uma proposal que foi vista e depois rejeitada/expirada não é
// contabilizada como "vista" aqui, subestimando levemente esse estágio.

export interface ProposalRow {
  status: string;
  rejected_reason: string | null;
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  pct_of_total: number;
  conversion_from_previous: number | null;
}

export interface RejectionReason {
  reason: string;
  count: number;
}

export interface ProposalsFunnelResult {
  period_from: string;
  period_to: string;
  total: number;
  stages: FunnelStage[];
  rejection_reasons: RejectionReason[];
  acceptance_rate: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const MAX_REJECTION_REASONS = 8;

function buildRejectionReasons(rows: ProposalRow[]): RejectionReason[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== 'rejected' || !r.rejected_reason) continue;
    counts.set(r.rejected_reason, (counts.get(r.rejected_reason) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  if (sorted.length <= MAX_REJECTION_REASONS) return sorted;

  const top = sorted.slice(0, MAX_REJECTION_REASONS);
  const othersCount = sorted.slice(MAX_REJECTION_REASONS).reduce((s, r) => s + r.count, 0);
  return [...top, { reason: 'Outros', count: othersCount }];
}

export function buildProposalsFunnel(periodFrom: string, periodTo: string, rows: ProposalRow[]): ProposalsFunnelResult {
  const total = rows.length;
  const pct = (count: number) => (total > 0 ? round1((count / total) * 100) : 0);

  const createdCount = total;
  const sentOrLaterCount = rows.filter(r => r.status !== 'draft').length;
  const viewedOrLaterCount = rows.filter(r => r.status === 'viewed' || r.status === 'accepted').length;
  const acceptedCount = rows.filter(r => r.status === 'accepted').length;

  const conversion = (count: number, previous: number) => (previous > 0 ? round1((count / previous) * 100) : previous === 0 ? 0 : null);

  const stages: FunnelStage[] = [
    { key: 'created',        label: 'Criadas',     count: createdCount,      pct_of_total: pct(createdCount),      conversion_from_previous: null },
    { key: 'sent_or_later',  label: 'Enviadas',    count: sentOrLaterCount, pct_of_total: pct(sentOrLaterCount),  conversion_from_previous: conversion(sentOrLaterCount, createdCount) },
    { key: 'viewed_or_later',label: 'Visualizadas',count: viewedOrLaterCount, pct_of_total: pct(viewedOrLaterCount), conversion_from_previous: conversion(viewedOrLaterCount, sentOrLaterCount) },
    { key: 'accepted',       label: 'Aceitas',     count: acceptedCount,    pct_of_total: pct(acceptedCount),     conversion_from_previous: conversion(acceptedCount, viewedOrLaterCount) },
  ];

  return {
    period_from: periodFrom,
    period_to: periodTo,
    total,
    stages,
    rejection_reasons: buildRejectionReasons(rows),
    acceptance_rate: pct(acceptedCount),
  };
}
