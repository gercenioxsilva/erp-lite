import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  useReportPeriod, fmtBRL, fmtInt, categoricalColor, exportXlsx,
  ReportHeader, PeriodFilter, ReportCard, StatTile, KpiRow, StateBlock, ExportButton, SegmentedControl,
  HBarChart, type HBarDatum,
} from './_shared';

type GroupBy = 'month' | 'seller' | 'client' | 'cost_center';

interface SalesRow { label: string; total_revenue: number; invoice_count: number; avg_ticket: number }
interface SalesData { group_by: GroupBy; from: string; to: string; rows: SalesRow[]; total_revenue: number; total_invoices: number }

const GROUP_OPTS: { value: GroupBy; label: string }[] = [
  { value: 'month',       label: 'Por mês' },
  { value: 'seller',      label: 'Por vendedor' },
  { value: 'client',      label: 'Por cliente' },
  { value: 'cost_center', label: 'Por centro de custo' },
];

export function SalesPage() {
  const period = useReportPeriod();
  const [groupBy, setGroupBy] = useState<GroupBy>('month');
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<SalesData>(`/v1/reports/sales?from=${period.from}&to=${period.to}&group_by=${groupBy}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar o faturamento.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period.from, period.to, groupBy]);

  const rows = data?.rows ?? [];
  const chartData: HBarDatum[] = rows.map((r, i) => ({ label: r.label, value: r.total_revenue, color: categoricalColor(i) }));
  const avgTicketGeral = data && data.total_invoices > 0 ? data.total_revenue / data.total_invoices : 0;

  function handleExport() {
    if (!data) return;
    exportXlsx('faturamento', 'Faturamento', rows.map(r => ({
      Dimensão: r.label, Faturamento: r.total_revenue, Pedidos: r.invoice_count, 'Ticket Médio': r.avg_ticket,
    })));
  }

  return (
    <div>
      <ReportHeader title="Faturamento" subtitle="NF-e emitidas no período, agrupadas pela dimensão escolhida."
        actions={<ExportButton onClick={handleExport} disabled={!data || rows.length === 0} />} />

      <PeriodFilter period={period} extra={
        <div style={{ marginLeft: 'auto' }}><SegmentedControl<GroupBy> value={groupBy} onChange={setGroupBy} options={GROUP_OPTS} /></div>
      } />

      <StateBlock loading={loading} error={error} empty={!!data && rows.length === 0} emptyLabel="Nenhuma NF-e emitida no período.">
        {data && (
          <>
            <KpiRow>
              <StatTile label="Faturamento total" value={fmtBRL(data.total_revenue)} tone="positive" />
              <StatTile label="Ticket médio geral" value={fmtBRL(avgTicketGeral)} tone="primary" />
              <StatTile label="Grupos" value={fmtInt(rows.length)} tone="neutral" />
            </KpiRow>

            <ReportCard title="Faturamento por dimensão">
              <HBarChart data={chartData} valueFormat={fmtBRL} />
            </ReportCard>

            <ReportCard title="Detalhamento" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Dimensão</th>
                      <th style={{ textAlign: 'right' }}>Pedidos</th>
                      <th style={{ textAlign: 'right' }}>Faturamento</th>
                      <th style={{ textAlign: 'right' }}>Ticket médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.label + i}>
                        <td style={{ fontWeight: 500 }}>
                          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: categoricalColor(i), marginRight: 8 }} />
                          {r.label}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(r.invoice_count)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{fmtBRL(r.total_revenue)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)' }}>{fmtBRL(r.avg_ticket)}</td>
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
