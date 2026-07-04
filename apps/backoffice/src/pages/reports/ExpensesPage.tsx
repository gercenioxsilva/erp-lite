import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  useReportPeriod, fmtBRL, fmtInt, categoricalColor, exportXlsx,
  ReportHeader, PeriodFilter, ReportCard, StatTile, KpiRow, StateBlock, ExportButton, SegmentedControl,
  HBarChart, type HBarDatum,
} from './_shared';

type GroupBy = 'category' | 'cost_center' | 'dre_category';

interface ExpensesResult {
  group_by: GroupBy; from: string; to: string;
  rows: { label: string; total: number; count: number }[];
  total: number;
}

// Rótulos amigáveis do enum payables.category (o backend devolve o valor cru).
const CAT_LABELS: Record<string, string> = {
  rent: 'Aluguel', utilities: 'Utilidades', payroll: 'Folha de pagamento',
  supplies: 'Suprimentos', services: 'Serviços', taxes: 'Impostos', other: 'Outros',
};

const GROUP_OPTS: { value: GroupBy; label: string }[] = [
  { value: 'category',     label: 'Categoria' },
  { value: 'cost_center',  label: 'Centro de custo' },
  { value: 'dre_category', label: 'Classificação DRE' },
];

export function ExpensesPage() {
  const period = useReportPeriod();
  const [groupBy, setGroupBy] = useState<GroupBy>('category');
  const [data, setData] = useState<ExpensesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<ExpensesResult>(`/v1/reports/expenses?from=${period.from}&to=${period.to}&group_by=${groupBy}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar as despesas.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period.from, period.to, groupBy]);

  const label = (raw: string) => (groupBy === 'category' ? CAT_LABELS[raw] ?? raw : raw);
  const rows = data?.rows ?? [];
  const chartData: HBarDatum[] = rows.map((r, i) => ({ label: label(r.label), value: r.total, color: categoricalColor(i) }));
  const biggest = rows[0];

  function handleExport() {
    if (!data) return;
    exportXlsx('despesas', 'Despesas', rows.map(r => ({
      Dimensão: label(r.label), Total: r.total, Lançamentos: r.count,
      Participação: data.total > 0 ? `${((r.total / data.total) * 100).toFixed(1)}%` : '0%',
    })));
  }

  return (
    <div>
      <ReportHeader
        title="Despesas"
        subtitle="Contas a pagar do período agrupadas por dimensão."
        actions={<ExportButton onClick={handleExport} disabled={!data || rows.length === 0} />}
      />

      <PeriodFilter period={period} extra={
        <div style={{ marginLeft: 'auto' }}>
          <SegmentedControl<GroupBy> value={groupBy} onChange={setGroupBy} options={GROUP_OPTS} />
        </div>
      } />

      <StateBlock loading={loading} error={error} empty={!!data && rows.length === 0} emptyLabel="Nenhuma despesa lançada no período.">
        {data && (
          <>
            <KpiRow>
              <StatTile label="Total de despesas" value={fmtBRL(data.total)} tone="negative" />
              <StatTile label="Maior grupo" value={biggest ? label(biggest.label) : '—'} tone="neutral"
                hint={biggest ? fmtBRL(biggest.total) : undefined} />
              <StatTile label="Grupos" value={fmtInt(rows.length)} tone="primary" />
            </KpiRow>

            <ReportCard title="Distribuição das despesas" subtitle="Ordenado por valor (participação % no total)">
              <HBarChart data={chartData} valueFormat={fmtBRL} />
            </ReportCard>

            <ReportCard title="Detalhamento" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Dimensão</th>
                      <th style={{ textAlign: 'right' }}>Lançamentos</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'right' }}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.label + i}>
                        <td style={{ fontWeight: 500 }}>
                          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: categoricalColor(i), marginRight: 8 }} />
                          {label(r.label)}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(r.count)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{fmtBRL(r.total)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{data.total > 0 ? `${((r.total / data.total) * 100).toFixed(1).replace('.', ',')}%` : '—'}</td>
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
