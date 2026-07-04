import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  fmtBRL, fmtCompact, fmtInt, fmtDate, AGING_COLORS, AGING_LABELS, exportXlsx,
  ReportHeader, ReportCard, StatTile, KpiRow, StateBlock, ExportButton, SegmentedControl,
  BarChart, ChartLegend, type BarGroup,
} from './_shared';

// ── Tipos (espelham agingDomain.ts) ───────────────────────────────────────────

type BucketKey = 'not_due' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';
interface AgingItem { id: string; party_name: string | null; description: string; due_date: string; remaining: number; days_overdue: number; bucket: BucketKey }
interface AgingResult {
  as_of: string; type: 'receivable' | 'payable';
  buckets: { key: BucketKey; count: number; total: number }[];
  items: AgingItem[]; total: number; count: number;
}

type Kind = 'receivable' | 'payable';

const GROUPS: BarGroup[] = [{ key: 'v', label: 'Total', layers: [{ key: 'v', label: 'Total', color: 'var(--muted)' }] }];
const LEGEND = (['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as BucketKey[]).map(k => ({ label: AGING_LABELS[k], color: AGING_COLORS[k] }));

function todayIso() { return new Date().toISOString().slice(0, 10); }

export function AgingPage() {
  const [kind, setKind] = useState<Kind>('receivable');
  const [asOf, setAsOf] = useState(todayIso());
  const [data, setData] = useState<AgingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<AgingResult>(`/v1/reports/aging?type=${kind}&as_of=${asOf}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar o aging.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [kind, asOf]);

  const overdueTotal = data ? data.buckets.filter(b => b.key !== 'not_due').reduce((a, b) => a + b.total, 0) : 0;
  const barData = (data?.buckets ?? []).map(b => ({ label: AGING_LABELS[b.key], values: { 'v.v': b.total } }));

  function handleExport() {
    if (!data) return;
    exportXlsx(`aging-${kind === 'receivable' ? 'receber' : 'pagar'}`, 'Aging', data.items.map(it => ({
      [kind === 'receivable' ? 'Cliente' : 'Fornecedor']: it.party_name ?? '—',
      Descrição: it.description,
      Vencimento: fmtDate(it.due_date),
      Restante: it.remaining,
      'Dias em atraso': it.days_overdue,
      Faixa: AGING_LABELS[it.bucket],
    })));
  }

  const noun = kind === 'receivable' ? 'a receber' : 'a pagar';

  return (
    <div>
      <ReportHeader
        title="Aging — Posição de Vencimentos"
        subtitle={`Contas ${noun} em aberto, classificadas por faixa de atraso.`}
        actions={<ExportButton onClick={handleExport} disabled={!data || data.count === 0} />}
      />

      <div className="card" style={{ padding: 16, marginBottom: 20, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <SegmentedControl<Kind> value={kind} onChange={setKind}
          options={[{ value: 'receivable', label: 'A receber' }, { value: 'payable', label: 'A pagar' }]} />
        <div className="field" style={{ margin: 0 }}>
          <label style={{ fontSize: 'var(--text-sm)' }}>Posição em</label>
          <input type="date" value={asOf} max={todayIso()} onChange={e => setAsOf(e.target.value)} style={{ maxWidth: 170 }} />
        </div>
      </div>

      <StateBlock loading={loading} error={error} empty={!!data && data.count === 0}
        emptyLabel={`Nenhuma conta ${noun} em aberto. 🎉`}>
        {data && (
          <>
            <KpiRow>
              <StatTile label="Total em aberto" value={fmtBRL(data.total)} tone="primary" hint={`${fmtInt(data.count)} título(s)`} />
              <StatTile label="A vencer" value={fmtBRL(data.buckets.find(b => b.key === 'not_due')?.total ?? 0)} tone="positive" />
              <StatTile label="Vencido" value={fmtBRL(overdueTotal)} tone={overdueTotal > 0 ? 'negative' : 'neutral'} hint="Todas as faixas em atraso" />
              <StatTile label="+90 dias" value={fmtBRL(data.buckets.find(b => b.key === 'd90_plus')?.total ?? 0)}
                tone={(data.buckets.find(b => b.key === 'd90_plus')?.total ?? 0) > 0 ? 'negative' : 'neutral'} hint="Risco elevado" />
            </KpiRow>

            <ReportCard title="Distribuição por faixa">
              <BarChart data={barData} groups={GROUPS} height={240} yFormat={fmtCompact} tipFormat={fmtBRL}
                perCategoryColor={i => AGING_COLORS[data.buckets[i].key]} />
              <div style={{ marginTop: 12 }}><ChartLegend items={LEGEND} /></div>
            </ReportCard>

            <ReportCard title="Títulos em aberto" subtitle={`${fmtInt(data.count)} registro(s)`} pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>{kind === 'receivable' ? 'Cliente' : 'Fornecedor'}</th>
                      <th style={{ textAlign: 'left' }}>Descrição</th>
                      <th style={{ textAlign: 'left' }}>Vencimento</th>
                      <th style={{ textAlign: 'right' }}>Restante</th>
                      <th style={{ textAlign: 'right' }}>Atraso</th>
                      <th style={{ textAlign: 'left' }}>Faixa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map(it => (
                      <tr key={it.id}>
                        <td style={{ fontWeight: 500 }}>{it.party_name ?? '—'}</td>
                        <td>{it.description}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{fmtDate(it.due_date)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{fmtBRL(it.remaining)}</td>
                        <td style={{ textAlign: 'right', color: it.days_overdue > 0 ? 'var(--danger)' : 'var(--muted)' }}>
                          {it.days_overdue > 0 ? `${it.days_overdue}d` : '—'}
                        </td>
                        <td>
                          <span style={{ background: `${AGING_COLORS[it.bucket]}1a`, color: AGING_COLORS[it.bucket], borderRadius: 4, padding: '2px 8px', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                            {AGING_LABELS[it.bucket]}
                          </span>
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
