import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  fmtBRL, fmtInt, categoricalColor, exportXlsx,
  ReportHeader, ReportCard, StatTile, KpiRow, StateBlock, ExportButton, SegmentedControl,
  HBarChart, type HBarDatum,
} from './_shared';

interface TopProductRow { name: string; sku: string | null; total_qty: number; total_revenue: number; order_count: number }
interface TopProductsData { rows: TopProductRow[]; days: number }

const DAY_OPTS = [
  { value: '7', label: '7 dias' }, { value: '30', label: '30 dias' }, { value: '90', label: '90 dias' },
  { value: '180', label: '180 dias' }, { value: '365', label: '1 ano' },
];

export function TopProductsPage() {
  const [days, setDays] = useState('30');
  const [data, setData] = useState<TopProductsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<TopProductsData>(`/v1/reports/top-products?days=${days}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar o ranking.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  const rows = data?.rows ?? [];
  const chartData: HBarDatum[] = rows.map((r, i) => ({ label: r.name, value: r.total_revenue, color: categoricalColor(i) }));
  const totalRevenue = rows.reduce((a, r) => a + r.total_revenue, 0);

  function handleExport() {
    if (!data) return;
    exportXlsx('ranking-produtos', 'Ranking', rows.map(r => ({
      Produto: r.name, SKU: r.sku ?? '', 'Qtd vendida': r.total_qty, Faturamento: r.total_revenue, Pedidos: r.order_count,
    })));
  }

  return (
    <div>
      <ReportHeader title="Ranking de Produtos" subtitle="Produtos mais faturados a partir de pedidos confirmados."
        actions={<ExportButton onClick={handleExport} disabled={rows.length === 0} />} />

      <div className="card" style={{ padding: 16, marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Período:</span>
        <SegmentedControl value={days} onChange={setDays} options={DAY_OPTS} />
      </div>

      <StateBlock loading={loading} error={error} empty={!!data && rows.length === 0} emptyLabel="Nenhuma venda encontrada no período.">
        {data && (
          <>
            <KpiRow>
              <StatTile label="Faturamento (top 20)" value={fmtBRL(totalRevenue)} tone="positive" />
              <StatTile label="Produtos no ranking" value={fmtInt(rows.length)} tone="primary" />
              <StatTile label="Líder" value={rows[0]?.name ?? '—'} tone="neutral" hint={rows[0] ? fmtBRL(rows[0].total_revenue) : undefined} />
            </KpiRow>

            <ReportCard title="Faturamento por produto">
              <HBarChart data={chartData} valueFormat={fmtBRL} />
            </ReportCard>

            <ReportCard title="Detalhamento" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th style={{ textAlign: 'left' }}>Produto</th>
                      <th style={{ textAlign: 'left' }}>SKU</th>
                      <th style={{ textAlign: 'right' }}>Qtd</th>
                      <th style={{ textAlign: 'right' }}>Faturamento</th>
                      <th style={{ textAlign: 'right' }}>Pedidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ color: 'var(--muted)', fontWeight: i < 3 ? 700 : 400 }}>
                          {i + 1}{i === 0 ? ' 🥇' : i === 1 ? ' 🥈' : i === 2 ? ' 🥉' : ''}
                        </td>
                        <td style={{ fontWeight: 500 }}>{r.name}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>{r.sku ?? '—'}</td>
                        <td style={{ textAlign: 'right' }}>{fmtInt(r.total_qty)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{fmtBRL(r.total_revenue)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(r.order_count)}</td>
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
