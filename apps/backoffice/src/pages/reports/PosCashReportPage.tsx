import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  useReportPeriod, fmtBRL, fmtInt, fmtDate, categoricalColor, exportXlsx,
  ReportHeader, PeriodFilter, ReportCard, StatTile, KpiRow, StateBlock, ExportButton,
  HBarChart, type HBarDatum,
} from './_shared';

interface PosCashRow {
  id: string; terminal_name: string; operator_name: string;
  opened_at: string; closed_at: string | null;
  opening_amount: number; closing_expected: number | null; closing_counted: number | null; difference: number | null;
  suprimento: number; sangria: number; sale_count: number; sale_total: number;
}
interface PosCashResult {
  from: string; to: string; rows: PosCashRow[];
  summary: { session_count: number; total_sales: number; total_difference: number };
}

export function PosCashReportPage() {
  const period = useReportPeriod();
  const [data, setData] = useState<PosCashResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<PosCashResult>(`/v1/reports/pos-cash?from=${period.from}&to=${period.to}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar o fechamento de caixa.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period.from, period.to]);

  const rows = data?.rows ?? [];
  const salesData: HBarDatum[] = rows.map((r, i) => ({
    label: `${r.terminal_name} · ${r.closed_at ? fmtDate(r.closed_at) : '—'}`,
    value: r.sale_total, color: categoricalColor(i),
  }));

  function handleExport() {
    if (!data) return;
    exportXlsx('fechamento-caixa-pdv', 'Fechamento PDV', rows.map(r => ({
      Terminal: r.terminal_name, Operador: r.operator_name,
      Fechamento: r.closed_at ? fmtDate(r.closed_at) : '—',
      'Fundo de troco': r.opening_amount, Suprimentos: r.suprimento, Sangrias: r.sangria,
      Vendas: r.sale_count, 'Total vendas': r.sale_total,
      Esperado: r.closing_expected ?? 0, Contado: r.closing_counted ?? 0, Diferença: r.difference ?? 0,
    })));
  }

  const s = data?.summary;

  return (
    <div>
      <ReportHeader
        title="Fechamento de Caixa — PDV"
        subtitle="Sessões de caixa encerradas no período, com quebra por operador e terminal."
        actions={<ExportButton onClick={handleExport} disabled={!data || rows.length === 0} />}
      />

      <PeriodFilter period={period} />

      <StateBlock loading={loading} error={error} empty={!!data && rows.length === 0} emptyLabel="Nenhuma sessão de caixa encerrada no período.">
        {s && (
          <>
            <KpiRow>
              <StatTile label="Sessões encerradas" value={fmtInt(s.session_count)} tone="primary" />
              <StatTile label="Total de vendas" value={fmtBRL(s.total_sales)} tone="positive" />
              <StatTile label="Diferença total" value={fmtBRL(s.total_difference)}
                tone={s.total_difference < 0 ? 'negative' : s.total_difference > 0 ? 'warning' : 'neutral'}
                hint={s.total_difference < 0 ? 'Falta de caixa' : s.total_difference > 0 ? 'Sobra de caixa' : 'Sem divergência'} />
            </KpiRow>

            <ReportCard title="Vendas por sessão">
              <HBarChart data={salesData} valueFormat={fmtBRL} showShare={false} />
            </ReportCard>

            <ReportCard title="Sessões" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Terminal</th>
                      <th style={{ textAlign: 'left' }}>Operador</th>
                      <th style={{ textAlign: 'left' }}>Fechamento</th>
                      <th style={{ textAlign: 'right' }}>Vendas</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'right' }}>Esperado</th>
                      <th style={{ textAlign: 'right' }}>Contado</th>
                      <th style={{ textAlign: 'right' }}>Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const diff = r.difference ?? 0;
                      const diffColor = diff < 0 ? 'var(--danger)' : diff > 0 ? 'var(--warning)' : 'var(--muted)';
                      return (
                        <tr key={r.id}>
                          <td style={{ fontWeight: 500 }}>{r.terminal_name}</td>
                          <td>{r.operator_name}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{r.closed_at ? fmtDate(r.closed_at) : '—'}</td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(r.sale_count)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{fmtBRL(r.sale_total)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)' }}>{fmtBRL(r.closing_expected ?? 0)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)' }}>{fmtBRL(r.closing_counted ?? 0)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 700, color: diffColor }}>
                            {diff === 0 ? '—' : fmtBRL(diff)}
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
