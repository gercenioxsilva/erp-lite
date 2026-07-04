import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  useReportPeriod, fmtBRL, fmtInt, fmtPct, categoricalColor, exportXlsx,
  ReportHeader, PeriodFilter, ReportCard, StatTile, KpiRow, StateBlock, ExportButton, SegmentedControl,
  HBarChart, type HBarDatum,
} from './_shared';

type Metric = 'revenue' | 'margin';
type AbcClass = 'A' | 'B' | 'C';

interface AbcItem { name: string; sku: string | null; quantity: number; revenue: number; margin: number; value: number; rank: number; cumulative_pct: number; class: AbcClass }
interface AbcData {
  metric: Metric; items: AbcItem[];
  summary: { class_a: { count: number; total: number }; class_b: { count: number; total: number }; class_c: { count: number; total: number }; grand_total: number };
}

const CLASS_STYLE: Record<AbcClass, { bg: string; fg: string }> = {
  A: { bg: '#dcfce7', fg: '#16a34a' }, B: { bg: '#fef3c7', fg: '#d97706' }, C: { bg: '#f1f5f9', fg: '#64748b' },
};

export function AbcPage() {
  const period = useReportPeriod();
  const [metric, setMetric] = useState<Metric>('revenue');
  const [data, setData] = useState<AbcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<AbcData>(`/v1/reports/abc?from=${period.from}&to=${period.to}&metric=${metric}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar a curva ABC.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period.from, period.to, metric]);

  const items = data?.items ?? [];
  const classAItems = items.filter(i => i.class === 'A');
  const chartData: HBarDatum[] = classAItems.map((it, i) => ({ label: it.name, value: it.value, color: categoricalColor(i) }));

  function handleExport() {
    if (!data) return;
    exportXlsx('curva-abc', 'Curva ABC', items.map(it => ({
      Rank: it.rank, Produto: it.name, SKU: it.sku ?? '', Valor: it.value, '% Acumulado': it.cumulative_pct, Classe: it.class,
    })));
  }

  return (
    <div>
      <ReportHeader title="Curva ABC de Produtos" subtitle="Classificação por participação acumulada em faturamento ou margem."
        actions={<ExportButton onClick={handleExport} disabled={items.length === 0} />} />

      <PeriodFilter period={period} extra={
        <div style={{ marginLeft: 'auto' }}>
          <SegmentedControl<Metric> value={metric} onChange={setMetric} options={[{ value: 'revenue', label: 'Faturamento' }, { value: 'margin', label: 'Margem' }]} />
        </div>
      } />

      <StateBlock loading={loading} error={error} empty={!!data && items.length === 0} emptyLabel="Nenhuma venda encontrada no período.">
        {data && (
          <>
            <KpiRow>
              <StatTile label="Classe A" value={fmtBRL(data.summary.class_a.total)} tone="positive" hint={`${fmtInt(data.summary.class_a.count)} produto(s)`} />
              <StatTile label="Classe B" value={fmtBRL(data.summary.class_b.total)} tone="warning" hint={`${fmtInt(data.summary.class_b.count)} produto(s)`} />
              <StatTile label="Classe C" value={fmtBRL(data.summary.class_c.total)} tone="neutral" hint={`${fmtInt(data.summary.class_c.count)} produto(s)`} />
            </KpiRow>

            <ReportCard title="Classe A" subtitle="Produtos que respondem por até 80% do valor">
              <HBarChart data={chartData} valueFormat={fmtBRL} showShare={false} />
            </ReportCard>

            <ReportCard title="Detalhamento completo" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th style={{ textAlign: 'left' }}>Produto</th>
                      <th style={{ textAlign: 'left' }}>SKU</th>
                      <th style={{ textAlign: 'right' }}>Valor</th>
                      <th style={{ textAlign: 'right' }}>% Acumulado</th>
                      <th style={{ textAlign: 'left' }}>Classe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => {
                      const st = CLASS_STYLE[it.class];
                      return (
                        <tr key={it.rank}>
                          <td style={{ color: 'var(--muted)' }}>{it.rank}</td>
                          <td style={{ fontWeight: 500 }}>{it.name}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>{it.sku ?? '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{fmtBRL(it.value)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtPct(it.cumulative_pct)}</td>
                          <td>
                            <span style={{ background: st.bg, color: st.fg, borderRadius: 4, padding: '2px 8px', fontSize: 'var(--text-xs)', fontWeight: 700 }}>{it.class}</span>
                          </td>
                        </tr>
                      );
                    })}
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
