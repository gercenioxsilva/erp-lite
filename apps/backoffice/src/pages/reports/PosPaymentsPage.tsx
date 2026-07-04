import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  useReportPeriod, fmtBRL, fmtInt, categoricalColor, exportXlsx,
  ReportHeader, PeriodFilter, ReportCard, StatTile, KpiRow, StateBlock, ExportButton,
  HBarChart, type HBarDatum,
} from './_shared';

interface PosPaymentRow { method: string; total: number; count: number }
interface PosPaymentsData { from: string; to: string; rows: PosPaymentRow[]; total: number }

const METHOD_LABELS: Record<string, string> = {
  cash: 'Dinheiro', debit: 'Débito', credit: 'Crédito', pix: 'PIX', voucher: 'Voucher', store_credit: 'Crédito da loja',
};

export function PosPaymentsPage() {
  const period = useReportPeriod();
  const [data, setData] = useState<PosPaymentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<PosPaymentsData>(`/v1/reports/pos-payments?from=${period.from}&to=${period.to}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar as vendas por forma de pagamento.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period.from, period.to]);

  const rows = data?.rows ?? [];
  const label = (m: string) => METHOD_LABELS[m] ?? m;
  const chartData: HBarDatum[] = rows.map((r, i) => ({ label: label(r.method), value: r.total, color: categoricalColor(i) }));
  const leader = rows[0];

  function handleExport() {
    if (!data) return;
    exportXlsx('vendas-formas-pagamento', 'Formas de Pagamento', rows.map(r => ({ Forma: label(r.method), Total: r.total, Vendas: r.count })));
  }

  return (
    <div>
      <ReportHeader title="Vendas por Forma de Pagamento" subtitle="Vendas finalizadas no PDV, agrupadas por método de pagamento."
        actions={<ExportButton onClick={handleExport} disabled={rows.length === 0} />} />

      <PeriodFilter period={period} />

      <StateBlock loading={loading} error={error} empty={!!data && rows.length === 0} emptyLabel="Nenhuma venda finalizada no período.">
        {data && (
          <>
            <KpiRow>
              <StatTile label="Total vendido" value={fmtBRL(data.total)} tone="positive" />
              <StatTile label="Forma mais usada" value={leader ? label(leader.method) : '—'} tone="primary" hint={leader ? fmtBRL(leader.total) : undefined} />
              <StatTile label="Formas usadas" value={fmtInt(rows.length)} tone="neutral" />
            </KpiRow>

            <ReportCard title="Vendas por forma de pagamento">
              <HBarChart data={chartData} valueFormat={fmtBRL} />
            </ReportCard>

            <ReportCard title="Detalhamento" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={{ textAlign: 'left' }}>Forma</th><th style={{ textAlign: 'right' }}>Vendas</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.method}>
                        <td style={{ fontWeight: 500 }}>
                          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: categoricalColor(i), marginRight: 8 }} />
                          {label(r.method)}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(r.count)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{fmtBRL(r.total)}</td>
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
