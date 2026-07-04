import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  fmtBRL, fmtInt, categoricalColor, exportXlsx,
  ReportHeader, ReportCard, StatTile, KpiRow, StateBlock, ExportButton,
  HBarChart, type HBarDatum,
} from './_shared';

interface MrrData {
  as_of: string; mrr_total: number; active_contracts: number;
  by_frequency: { frequency: string; count: number; mrr: number }[];
  new_in_period: { count: number; mrr: number };
  churned_in_period: { count: number; mrr: number };
}

const FREQ_LABELS: Record<string, string> = { monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual' };

function todayIso() { return new Date().toISOString().slice(0, 10); }

export function RecurringRevenuePage() {
  const [asOf, setAsOf] = useState(todayIso());
  const [data, setData] = useState<MrrData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<MrrData>(`/v1/reports/recurring-revenue?as_of=${asOf}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar a receita recorrente.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [asOf]);

  const byFreq = data?.by_frequency ?? [];
  const chartData: HBarDatum[] = byFreq.map((f, i) => ({ label: FREQ_LABELS[f.frequency] ?? f.frequency, value: f.mrr, color: categoricalColor(i) }));

  function handleExport() {
    if (!data) return;
    exportXlsx('receita-recorrente', 'MRR', byFreq.map(f => ({ Frequência: FREQ_LABELS[f.frequency] ?? f.frequency, Contratos: f.count, MRR: f.mrr })));
  }

  return (
    <div>
      <ReportHeader title="Receita Recorrente (MRR)" subtitle="Foto dos contratos de serviço ativos, normalizados para equivalente mensal."
        actions={<ExportButton onClick={handleExport} disabled={byFreq.length === 0} />} />

      <div className="card" style={{ padding: 16, marginBottom: 20 }}>
        <div className="field" style={{ margin: 0, maxWidth: 220 }}>
          <label style={{ fontSize: 'var(--text-sm)' }}>Posição em</label>
          <input type="date" value={asOf} max={todayIso()} onChange={e => setAsOf(e.target.value)} />
        </div>
      </div>

      <StateBlock loading={loading} error={error} empty={!!data && data.active_contracts === 0} emptyLabel="Nenhum contrato ativo nesta data.">
        {data && (
          <>
            <KpiRow>
              <StatTile label="MRR Total" value={fmtBRL(data.mrr_total)} tone="primary" />
              <StatTile label="Contratos ativos" value={fmtInt(data.active_contracts)} tone="neutral" />
              <StatTile label="Novos (30 dias)" value={fmtInt(data.new_in_period.count)} tone="positive" hint={fmtBRL(data.new_in_period.mrr)} />
              <StatTile label="Encerrados (30 dias)" value={fmtInt(data.churned_in_period.count)} tone={data.churned_in_period.count > 0 ? 'negative' : 'neutral'} hint={fmtBRL(data.churned_in_period.mrr)} />
            </KpiRow>

            <ReportCard title="MRR por frequência de cobrança">
              <HBarChart data={chartData} valueFormat={fmtBRL} />
            </ReportCard>

            <ReportCard title="Detalhamento" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={{ textAlign: 'left' }}>Frequência</th><th style={{ textAlign: 'right' }}>Contratos</th><th style={{ textAlign: 'right' }}>MRR</th></tr></thead>
                  <tbody>
                    {byFreq.map((f, i) => (
                      <tr key={f.frequency}>
                        <td style={{ fontWeight: 500 }}>
                          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: categoricalColor(i), marginRight: 8 }} />
                          {FREQ_LABELS[f.frequency] ?? f.frequency}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(f.count)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{fmtBRL(f.mrr)}</td>
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
