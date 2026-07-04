import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  useReportPeriod, fmtBRL, fmtInt, categoricalColor, exportXlsx,
  ReportHeader, PeriodFilter, ReportCard, StatTile, KpiRow, StateBlock, ExportButton,
  HBarChart, type HBarDatum,
} from './_shared';

interface TaxTotals { icms: number; pis: number; cofins: number; ipi: number; fcp: number; icms_difal: number }
interface UfRow { uf: string; total: number }
interface TaxSummaryData { from: string; to: string; totals: TaxTotals; grand_total: number; by_uf: UfRow[] }

const TAX_LABELS: Record<keyof TaxTotals, string> = {
  icms: 'ICMS', pis: 'PIS', cofins: 'COFINS', ipi: 'IPI', fcp: 'FCP', icms_difal: 'ICMS-DIFAL',
};

export function TaxSummaryPage() {
  const period = useReportPeriod();
  const [data, setData] = useState<TaxSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<TaxSummaryData>(`/v1/reports/tax-summary?from=${period.from}&to=${period.to}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar a apuração de impostos.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period.from, period.to]);

  const taxRows: HBarDatum[] = data
    ? (Object.keys(data.totals) as (keyof TaxTotals)[])
        .map((k, i) => ({ label: TAX_LABELS[k], value: data.totals[k], color: categoricalColor(i) }))
        .sort((a, b) => b.value - a.value)
    : [];
  const byUf = data?.by_uf ?? [];

  function handleExport() {
    if (!data) return;
    exportXlsx('impostos-por-tipo', 'Impostos', taxRows.map(r => ({ Imposto: r.label, Total: r.value })));
    exportXlsx('impostos-por-uf', 'Por UF', byUf.map(r => ({ UF: r.uf, Total: r.total })));
  }

  return (
    <div>
      <ReportHeader title="Apuração de Impostos" subtitle="Carga tributária das NF-e emitidas no período, por tipo de imposto e UF."
        actions={<ExportButton onClick={handleExport} disabled={!data || data.grand_total === 0} />} />

      <PeriodFilter period={period} />

      <StateBlock loading={loading} error={error} empty={!!data && data.grand_total === 0} emptyLabel="Nenhuma NF-e emitida com impostos no período.">
        {data && (
          <>
            <KpiRow>
              <StatTile label="Carga tributária total" value={fmtBRL(data.grand_total)} tone="negative" />
              <StatTile label="Maior componente" value={taxRows[0]?.label ?? '—'} tone="warning" hint={taxRows[0] ? fmtBRL(taxRows[0].value) : undefined} />
              <StatTile label="Estados envolvidos" value={fmtInt(byUf.length)} tone="neutral" />
            </KpiRow>

            <ReportCard title="Impostos por tipo">
              <HBarChart data={taxRows} valueFormat={fmtBRL} />
            </ReportCard>

            <ReportCard title="Carga tributária por UF" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={{ textAlign: 'left' }}>UF</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
                  <tbody>
                    {byUf.map(r => (
                      <tr key={r.uf}>
                        <td style={{ fontWeight: 500 }}>{r.uf}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{fmtBRL(r.total)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{data.grand_total > 0 ? `${((r.total / data.grand_total) * 100).toFixed(1).replace('.', ',')}%` : '—'}</td>
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
