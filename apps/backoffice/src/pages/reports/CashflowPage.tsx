import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  useReportPeriod, fmtBRL, fmtCompact, fmtBucket, fmtDate, SEMANTIC, exportXlsx,
  ReportHeader, PeriodFilter, ReportCard, StatTile, KpiRow, StateBlock, ExportButton,
  BarChart, LineChart, ChartLegend, type BarGroup, type BarDatum,
} from './_shared';

// ── Tipos (espelham cashflowDomain.ts) ────────────────────────────────────────

interface CashflowBucket {
  period: string;
  realized_inflow: number; realized_outflow: number;
  projected_inflow: number; projected_outflow: number;
  realized_net: number; projected_net: number; net: number; accumulated: number;
}
interface CashflowResult {
  period_from: string; period_to: string; granularity: 'week' | 'month'; opening_balance: number;
  buckets: CashflowBucket[];
  summary: {
    total_realized_inflow: number; total_realized_outflow: number;
    total_projected_inflow: number; total_projected_outflow: number;
    realized_net: number; projected_net: number; net: number; closing_balance: number;
  };
}

const BAR_GROUPS: BarGroup[] = [
  { key: 'in',  label: 'Entradas', layers: [
    { key: 'real', label: 'Realizado', color: SEMANTIC.inflow },
    { key: 'proj', label: 'A receber', color: SEMANTIC.inflowSoft },
  ] },
  { key: 'out', label: 'Saídas', layers: [
    { key: 'real', label: 'Realizado', color: SEMANTIC.outflow },
    { key: 'proj', label: 'A pagar',   color: SEMANTIC.outflowSoft },
  ] },
];

const LEGEND = [
  { label: 'Entradas realizadas', color: SEMANTIC.inflow },
  { label: 'A receber (projetado)', color: SEMANTIC.inflowSoft },
  { label: 'Saídas realizadas', color: SEMANTIC.outflow },
  { label: 'A pagar (projetado)', color: SEMANTIC.outflowSoft },
];

export function CashflowPage() {
  const period = useReportPeriod({ granularity: 'month' });
  const [data, setData] = useState<CashflowResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<CashflowResult>(`/v1/reports/cashflow?from=${period.from}&to=${period.to}&granularity=${period.granularity}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar o fluxo de caixa.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period.from, period.to, period.granularity]);

  const barData: BarDatum[] = (data?.buckets ?? []).map(b => ({
    label: fmtBucket(b.period, data!.granularity),
    values: { 'in.real': b.realized_inflow, 'in.proj': b.projected_inflow, 'out.real': b.realized_outflow, 'out.proj': b.projected_outflow },
  }));

  const lineData = (data?.buckets ?? []).map(b => ({ label: fmtBucket(b.period, data!.granularity), value: b.accumulated }));

  function handleExport() {
    if (!data) return;
    exportXlsx('fluxo-de-caixa', 'Fluxo de Caixa', data.buckets.map(b => ({
      Período: fmtDate(b.period),
      'Entradas realizadas': b.realized_inflow,
      'Saídas realizadas': b.realized_outflow,
      'A receber (projetado)': b.projected_inflow,
      'A pagar (projetado)': b.projected_outflow,
      'Saldo do período': b.net,
      'Saldo acumulado': b.accumulated,
    })));
  }

  const s = data?.summary;
  const empty = !!data && data.buckets.every(b =>
    b.realized_inflow === 0 && b.realized_outflow === 0 && b.projected_inflow === 0 && b.projected_outflow === 0);

  return (
    <div>
      <ReportHeader
        title="Fluxo de Caixa"
        subtitle="Realizado vs. projetado — entradas e saídas por período, com saldo acumulado."
        actions={<ExportButton onClick={handleExport} disabled={!data || empty} />}
      />

      <PeriodFilter period={period} showGranularity />

      <StateBlock loading={loading} error={error} empty={empty} emptyLabel="Nenhuma movimentação de caixa no período selecionado.">
        {s && (
          <>
            <KpiRow>
              <StatTile label="Entradas realizadas" value={fmtBRL(s.total_realized_inflow)}  tone="positive" />
              <StatTile label="Saídas realizadas"   value={fmtBRL(s.total_realized_outflow)} tone="negative" />
              <StatTile label="Resultado do período" value={fmtBRL(s.net)} tone={s.net >= 0 ? 'positive' : 'negative'}
                hint="Realizado + projetado" />
              <StatTile label="Saldo projetado ao fim" value={fmtBRL(s.closing_balance)} tone={s.closing_balance >= 0 ? 'primary' : 'negative'}
                hint={`Abertura ${fmtBRL(data!.opening_balance)}`} />
            </KpiRow>

            <ReportCard title="Entradas × Saídas" subtitle={period.granularity === 'week' ? 'Por semana' : 'Por mês'}>
              <BarChart data={barData} groups={BAR_GROUPS} height={280} yFormat={fmtCompact} tipFormat={fmtBRL} />
              <div style={{ marginTop: 12 }}><ChartLegend items={LEGEND} /></div>
            </ReportCard>

            <ReportCard title="Saldo de caixa acumulado" subtitle="Abertura + resultado acumulado ao longo do período">
              <LineChart data={lineData} height={220} color={SEMANTIC.balance} yFormat={fmtCompact} tipFormat={fmtBRL} />
            </ReportCard>

            <ReportCard title="Detalhamento" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Período</th>
                      <th style={{ textAlign: 'right' }}>Entradas</th>
                      <th style={{ textAlign: 'right' }}>Saídas</th>
                      <th style={{ textAlign: 'right' }}>A receber</th>
                      <th style={{ textAlign: 'right' }}>A pagar</th>
                      <th style={{ textAlign: 'right' }}>Resultado</th>
                      <th style={{ textAlign: 'right' }}>Acumulado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.buckets.map(b => (
                      <tr key={b.period}>
                        <td style={{ fontWeight: 500 }}>{fmtDate(b.period)}</td>
                        <NumCell v={b.realized_inflow}  tone="pos" />
                        <NumCell v={b.realized_outflow} tone="neg" />
                        <NumCell v={b.projected_inflow}  muted />
                        <NumCell v={b.projected_outflow} muted />
                        <NumCell v={b.net} tone={b.net >= 0 ? 'pos' : 'neg'} bold />
                        <NumCell v={b.accumulated} bold />
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

function NumCell({ v, tone, muted, bold }: { v: number; tone?: 'pos' | 'neg'; muted?: boolean; bold?: boolean }) {
  const color = muted ? 'var(--muted)' : tone === 'pos' ? 'var(--success)' : tone === 'neg' ? 'var(--danger)' : 'var(--text)';
  return (
    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', color, fontWeight: bold ? 700 : 400 }}>
      {v === 0 ? '—' : fmtBRL(v)}
    </td>
  );
}
