import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  useReportPeriod, fmtInt, fmtPct, categoricalColor, exportXlsx,
  ReportHeader, PeriodFilter, ReportCard, StatTile, KpiRow, StateBlock, ExportButton,
} from './_shared';

interface FunnelStage { key: string; label: string; count: number; pct_of_total: number; conversion_from_previous: number | null }
interface RejectionReason { reason: string; count: number }
interface FunnelData { period_from: string; period_to: string; total: number; stages: FunnelStage[]; rejection_reasons: RejectionReason[]; acceptance_rate: number }

export function ProposalsFunnelPage() {
  const period = useReportPeriod();
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<FunnelData>(`/v1/reports/proposals-funnel?from=${period.from}&to=${period.to}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar o funil.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period.from, period.to]);

  function handleExport() {
    if (!data) return;
    exportXlsx('funil-propostas', 'Funil', data.stages.map(s => ({
      Estágio: s.label, Quantidade: s.count, '% do Total': s.pct_of_total, 'Conversão do Anterior': s.conversion_from_previous ?? '',
    })));
  }

  const maxCount = data ? Math.max(1, ...data.stages.map(s => s.count)) : 1;

  return (
    <div>
      <ReportHeader title="Funil de Conversão de Propostas" subtitle="Do envio à aceitação — onde as propostas emperram."
        actions={<ExportButton onClick={handleExport} disabled={!data || data.total === 0} />} />

      <PeriodFilter period={period} />

      <StateBlock loading={loading} error={error} empty={!!data && data.total === 0} emptyLabel="Nenhuma proposta criada no período.">
        {data && (
          <>
            <KpiRow>
              <StatTile label="Total de propostas" value={fmtInt(data.total)} tone="primary" />
              <StatTile label="Taxa de aceitação" value={fmtPct(data.acceptance_rate)} tone={data.acceptance_rate > 0 ? 'positive' : 'neutral'} />
              <StatTile label="Visualizadas" value={fmtInt(data.stages.find(s => s.key === 'viewed_or_later')?.count ?? 0)} tone="neutral" />
            </KpiRow>

            <ReportCard title="Funil" subtitle="Largura proporcional à quantidade em cada estágio">
              <div style={{ display: 'grid', gap: 10 }}>
                {data.stages.map((s, i) => (
                  <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{s.label}</span>
                    <div style={{ background: 'var(--border-soft)', borderRadius: 6, height: 28, position: 'relative', overflow: 'hidden' }}>
                      <div style={{
                        position: 'absolute', inset: 0, width: `${(s.count / maxCount) * 100}%`,
                        background: categoricalColor(i), borderRadius: 6, transition: 'width 200ms ease',
                        display: 'flex', alignItems: 'center', paddingLeft: 10,
                      }}>
                        <span style={{ color: '#fff', fontSize: 'var(--text-xs)', fontWeight: 700 }}>{fmtInt(s.count)}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', minWidth: 90, textAlign: 'right' }}>
                      {fmtPct(s.pct_of_total)}
                      {s.conversion_from_previous !== null && <><br />↓ {fmtPct(s.conversion_from_previous)}</>}
                    </span>
                  </div>
                ))}
              </div>
            </ReportCard>

            <ReportCard title="Motivos de rejeição" pad={0}>
              {data.rejection_reasons.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Nenhuma proposta rejeitada com motivo registrado.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={{ textAlign: 'left' }}>Motivo</th><th style={{ textAlign: 'right' }}>Quantidade</th></tr></thead>
                    <tbody>
                      {data.rejection_reasons.map((r, i) => (
                        <tr key={r.reason + i}>
                          <td>{r.reason}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtInt(r.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ReportCard>
          </>
        )}
      </StateBlock>
    </div>
  );
}
