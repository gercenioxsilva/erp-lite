import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  useReportPeriod, fmtBRL, fmtInt, categoricalColor, exportXlsx,
  ReportHeader, PeriodFilter, ReportCard, StatTile, KpiRow, StateBlock, ExportButton,
  HBarChart, type HBarDatum,
} from './_shared';

interface CommissionRow { seller_id: string; seller_name: string; sale_count: number; total_accrued: number; total_cancelled: number }
interface CommissionsData { rows: CommissionRow[]; total_accrued: number }

export function CommissionsPage() {
  const period = useReportPeriod();
  const [data, setData] = useState<CommissionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<CommissionsData>(`/v1/reports/commissions?from=${period.from}&to=${period.to}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar as comissões.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period.from, period.to]);

  const rows = data?.rows ?? [];
  const chartData: HBarDatum[] = rows.map((r, i) => ({ label: r.seller_name, value: r.total_accrued, color: categoricalColor(i) }));

  function handleExport() {
    if (!data) return;
    exportXlsx('comissoes', 'Comissões', rows.map(r => ({
      Vendedor: r.seller_name, Vendas: r.sale_count, 'Comissão acumulada': r.total_accrued, 'Comissão estornada': r.total_cancelled,
    })));
  }

  return (
    <div>
      <ReportHeader title="Comissões" subtitle="Apuração de comissão por vendedor a partir das NF-e autorizadas."
        actions={<ExportButton onClick={handleExport} disabled={rows.length === 0} />} />

      <PeriodFilter period={period} />

      <StateBlock loading={loading} error={error} empty={!!data && rows.length === 0} emptyLabel="Nenhuma comissão apurada no período.">
        {data && (
          <>
            <KpiRow>
              <StatTile label="Comissão total" value={fmtBRL(data.total_accrued)} tone="positive" />
              <StatTile label="Vendedores" value={fmtInt(rows.length)} tone="primary" />
              <StatTile label="Top vendedor" value={rows[0]?.seller_name ?? '—'} tone="neutral" hint={rows[0] ? fmtBRL(rows[0].total_accrued) : undefined} />
            </KpiRow>

            <ReportCard title="Comissão por vendedor">
              <HBarChart data={chartData} valueFormat={fmtBRL} />
            </ReportCard>

            <ReportCard title="Detalhamento" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Vendedor</th>
                      <th style={{ textAlign: 'right' }}>Vendas</th>
                      <th style={{ textAlign: 'right' }}>Comissão acumulada</th>
                      <th style={{ textAlign: 'right' }}>Estornada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.seller_id}>
                        <td style={{ fontWeight: 500 }}>
                          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: categoricalColor(i), marginRight: 8 }} />
                          {r.seller_name}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(r.sale_count)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--success)' }}>{fmtBRL(r.total_accrued)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', color: r.total_cancelled > 0 ? 'var(--danger)' : 'var(--muted)' }}>
                          {r.total_cancelled > 0 ? fmtBRL(r.total_cancelled) : '—'}
                        </td>
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
