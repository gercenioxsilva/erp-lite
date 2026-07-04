import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  useReportPeriod, fmtInt, fmtDate, categoricalColor, exportXlsx,
  ReportHeader, PeriodFilter, ReportCard, StatTile, KpiRow, StateBlock, ExportButton,
  HBarChart, type HBarDatum,
} from './_shared';

interface KardexSummary { total_in: number; total_out: number; net: number; movement_count: number }
interface KardexSummaryRow { material_id: string; name: string; sku: string | null; total_in: number; total_out: number; net: number; movement_count: number }
interface KardexMovement { movement_type: string; quantity: number; quantity_before: number; quantity_after: number; reason: string | null; created_at: string }
type KardexData =
  | { mode: 'summary'; rows: KardexSummaryRow[] }
  | { mode: 'detail'; material: { id: string; name: string; sku: string | null } | null; movements: KardexMovement[]; summary: KardexSummary };

const TYPE_LABELS: Record<string, string> = { in: 'Entrada', out: 'Saída', adjustment: 'Ajuste', return: 'Devolução', transfer: 'Transferência' };

export function KardexPage() {
  const period = useReportPeriod();
  const [materialId, setMaterialId] = useState('');
  const [data, setData] = useState<KardexData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    const qs = materialId.trim() ? `&material_id=${encodeURIComponent(materialId.trim())}` : '';
    api.get<KardexData>(`/v1/reports/kardex?from=${period.from}&to=${period.to}${qs}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar o kardex.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period.from, period.to, materialId]);

  function handleExport() {
    if (!data) return;
    if (data.mode === 'summary') {
      exportXlsx('kardex-resumo', 'Kardex', data.rows.map(r => ({
        Produto: r.name, SKU: r.sku ?? '', Entradas: r.total_in, Saídas: r.total_out, Líquido: r.net, Movimentações: r.movement_count,
      })));
    } else {
      exportXlsx('kardex-detalhe', 'Kardex', data.movements.map(m => ({
        Data: fmtDate(m.created_at), Tipo: TYPE_LABELS[m.movement_type] ?? m.movement_type,
        Quantidade: m.quantity, 'Saldo Antes': m.quantity_before, 'Saldo Depois': m.quantity_after, Motivo: m.reason ?? '',
      })));
    }
  }

  const isEmpty = !!data && (data.mode === 'summary' ? data.rows.length === 0 : data.movements.length === 0);

  return (
    <div>
      <ReportHeader title="Kardex / Giro de Estoque" subtitle="Movimentações de estoque no período — visão geral ou detalhe por produto."
        actions={<ExportButton onClick={handleExport} disabled={isEmpty} />} />

      <PeriodFilter period={period} extra={
        <div className="field" style={{ margin: 0, marginLeft: 'auto', minWidth: 220 }}>
          <label style={{ fontSize: 'var(--text-sm)' }}>ID do produto (opcional)</label>
          <input type="text" placeholder="Cole o material_id para ver o detalhe" value={materialId} onChange={e => setMaterialId(e.target.value)} />
        </div>
      } />

      <StateBlock loading={loading} error={error} empty={isEmpty} emptyLabel="Nenhuma movimentação no período.">
        {data && data.mode === 'summary' && (
          <>
            <KpiRow>
              <StatTile label="Produtos com movimentação" value={fmtInt(data.rows.length)} tone="primary" />
              <StatTile label="Movimentações totais" value={fmtInt(data.rows.reduce((a, r) => a + r.movement_count, 0))} tone="neutral" />
            </KpiRow>
            <ReportCard title="Ranking por movimentações" subtitle="Top 30 produtos — cole um ID acima para ver o detalhe cronológico">
              <HBarChart data={data.rows.map((r, i): HBarDatum => ({ label: r.name, value: r.movement_count, color: categoricalColor(i) }))} valueFormat={fmtInt} showShare={false} />
            </ReportCard>
            <ReportCard title="Detalhamento" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={{ textAlign: 'left' }}>Produto</th><th style={{ textAlign: 'right' }}>Entradas</th><th style={{ textAlign: 'right' }}>Saídas</th><th style={{ textAlign: 'right' }}>Líquido</th><th style={{ textAlign: 'right' }}>Movs.</th></tr></thead>
                  <tbody>
                    {data.rows.map(r => (
                      <tr key={r.material_id}>
                        <td style={{ fontWeight: 500 }}>{r.name} <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>{r.sku ?? ''}</span></td>
                        <td style={{ textAlign: 'right', color: 'var(--success)' }}>{fmtInt(r.total_in)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--danger)' }}>{fmtInt(r.total_out)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtInt(r.net)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(r.movement_count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ReportCard>
          </>
        )}

        {data && data.mode === 'detail' && (
          <>
            <KpiRow>
              <StatTile label="Produto" value={data.material?.name ?? 'Não encontrado'} tone="neutral" hint={data.material?.sku ?? undefined} />
              <StatTile label="Entradas" value={fmtInt(data.summary.total_in)} tone="positive" />
              <StatTile label="Saídas" value={fmtInt(data.summary.total_out)} tone="negative" />
              <StatTile label="Saldo líquido" value={fmtInt(data.summary.net)} tone={data.summary.net >= 0 ? 'primary' : 'negative'} />
            </KpiRow>
            <ReportCard title="Movimentações" subtitle={`${fmtInt(data.summary.movement_count)} registro(s), em ordem cronológica`} pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={{ textAlign: 'left' }}>Data</th><th style={{ textAlign: 'left' }}>Tipo</th><th style={{ textAlign: 'right' }}>Qtd</th><th style={{ textAlign: 'right' }}>Antes</th><th style={{ textAlign: 'right' }}>Depois</th><th style={{ textAlign: 'left' }}>Motivo</th></tr></thead>
                  <tbody>
                    {data.movements.map((m, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{fmtDate(m.created_at)}</td>
                        <td>{TYPE_LABELS[m.movement_type] ?? m.movement_type}</td>
                        <td style={{ textAlign: 'right', color: m.quantity >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtInt(m.quantity)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(m.quantity_before)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtInt(m.quantity_after)}</td>
                        <td style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>{m.reason ?? '—'}</td>
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
