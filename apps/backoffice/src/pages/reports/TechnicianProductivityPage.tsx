import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  useReportPeriod, fmtInt, fmtPct, categoricalColor, exportXlsx,
  ReportHeader, PeriodFilter, ReportCard, StatTile, KpiRow, StateBlock, ExportButton,
  HBarChart, type HBarDatum,
} from './_shared';

interface TechnicianStats {
  technician_id: string; technician_name: string; total_visits: number; completed: number; no_show: number;
  no_show_rate: number; avg_duration_minutes: number | null; on_time_rate: number | null;
}
interface TechnicianProductivityData {
  technicians: TechnicianStats[];
  summary: { total_visits: number; total_no_show: number; overall_no_show_rate: number };
}

function fmtDuration(minutes: number | null): string {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export function TechnicianProductivityPage() {
  const period = useReportPeriod();
  const [data, setData] = useState<TechnicianProductivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<TechnicianProductivityData>(`/v1/reports/technician-productivity?from=${period.from}&to=${period.to}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar a produtividade dos técnicos.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period.from, period.to]);

  const techs = data?.technicians ?? [];
  const chartData: HBarDatum[] = techs.map((t, i) => ({ label: t.technician_name, value: t.total_visits, color: categoricalColor(i) }));

  function handleExport() {
    if (!data) return;
    exportXlsx('produtividade-tecnicos', 'Produtividade', techs.map(t => ({
      Técnico: t.technician_name, Visitas: t.total_visits, Concluídas: t.completed,
      'Taxa No-show': t.no_show_rate, 'Duração Média (min)': t.avg_duration_minutes ?? '', 'Taxa no Prazo': t.on_time_rate ?? '',
    })));
  }

  const s = data?.summary;

  return (
    <div>
      <ReportHeader title="Produtividade e SLA por Técnico" subtitle="Visitas técnicas do período — no-show, duração e pontualidade."
        actions={<ExportButton onClick={handleExport} disabled={techs.length === 0} />} />

      <PeriodFilter period={period} />

      <StateBlock loading={loading} error={error} empty={!!data && techs.length === 0} emptyLabel="Nenhuma visita agendada no período.">
        {s && (
          <>
            <KpiRow>
              <StatTile label="Total de visitas" value={fmtInt(s.total_visits)} tone="primary" />
              <StatTile label="Taxa de no-show geral" value={fmtPct(s.overall_no_show_rate)} tone={s.overall_no_show_rate > 10 ? 'negative' : 'positive'} />
              <StatTile label="Técnicos ativos" value={fmtInt(techs.length)} tone="neutral" />
            </KpiRow>

            <ReportCard title="Visitas por técnico">
              <HBarChart data={chartData} valueFormat={fmtInt} showShare={false} />
            </ReportCard>

            <ReportCard title="Detalhamento" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Técnico</th>
                      <th style={{ textAlign: 'right' }}>Visitas</th>
                      <th style={{ textAlign: 'right' }}>Concluídas</th>
                      <th style={{ textAlign: 'right' }}>No-show</th>
                      <th style={{ textAlign: 'right' }}>Duração média</th>
                      <th style={{ textAlign: 'right' }}>No prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {techs.map(t => (
                      <tr key={t.technician_id}>
                        <td style={{ fontWeight: 500 }}>{t.technician_name}</td>
                        <td style={{ textAlign: 'right' }}>{fmtInt(t.total_visits)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(t.completed)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <span style={{ background: t.no_show_rate > 10 ? '#fee2e2' : '#f1f5f9', color: t.no_show_rate > 10 ? '#dc2626' : '#64748b', borderRadius: 4, padding: '2px 8px', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                            {fmtPct(t.no_show_rate)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtDuration(t.avg_duration_minutes)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{t.on_time_rate != null ? fmtPct(t.on_time_rate) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ReportCard>
          </>
        )}
      </StateBlock>
    </div>
  );
}
