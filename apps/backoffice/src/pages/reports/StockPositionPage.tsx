import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  fmtBRL, fmtInt, exportXlsx,
  ReportHeader, ReportCard, StatTile, KpiRow, StateBlock, ExportButton,
} from './_shared';

type StockStatus = 'critical' | 'low' | 'ok' | 'excess';

interface StockItem {
  id: string; name: string; sku: string | null; category: string | null;
  quantity: number; min_qty: number; max_qty: number | null;
  sale_price: number; cost_price: number; status: StockStatus; stock_value: number;
}
interface StockPositionData {
  items: StockItem[];
  summary: { total_items: number; critical_count: number; low_count: number; excess_count: number; total_stock_value: number };
}

const STATUS_STYLE: Record<StockStatus, { bg: string; fg: string; label: string }> = {
  critical: { bg: '#fee2e2', fg: '#dc2626', label: 'Crítico' },
  low:      { bg: '#fff7ed', fg: '#d97706', label: 'Baixo' },
  ok:       { bg: '#dcfce7', fg: '#16a34a', label: 'OK' },
  excess:   { bg: '#dbeafe', fg: '#1d4ed8', label: 'Excesso' },
};

export function StockPositionPage() {
  const [data, setData] = useState<StockPositionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<StockPositionData>('/v1/reports/stock-position')
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar a posição de estoque.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  function handleExport() {
    if (!data) return;
    exportXlsx('posicao-estoque', 'Posição de Estoque', data.items.map(it => ({
      Produto: it.name, SKU: it.sku ?? '', Categoria: it.category ?? '',
      Quantidade: it.quantity, Mínimo: it.min_qty, Máximo: it.max_qty ?? '',
      'Valor em Estoque': it.stock_value, Status: STATUS_STYLE[it.status].label,
    })));
  }

  const s = data?.summary;

  return (
    <div>
      <ReportHeader title="Posição de Estoque" subtitle="Saldo atual por produto vs. mínimo e máximo cadastrados."
        actions={<ExportButton onClick={handleExport} disabled={!data || data.items.length === 0} />} />

      <StateBlock loading={loading} error={error} empty={!!data && data.items.length === 0} emptyLabel="Nenhum item com controle de estoque cadastrado.">
        {s && (
          <>
            <KpiRow>
              <StatTile label="Itens críticos" value={fmtInt(s.critical_count)} tone={s.critical_count > 0 ? 'negative' : 'neutral'} hint="Sem estoque" />
              <StatTile label="Itens em atenção" value={fmtInt(s.low_count)} tone={s.low_count > 0 ? 'warning' : 'neutral'} hint="Abaixo do mínimo" />
              <StatTile label="Itens em excesso" value={fmtInt(s.excess_count)} tone="neutral" hint="Acima do máximo" />
              <StatTile label="Valor total em estoque" value={fmtBRL(s.total_stock_value)} tone="primary" />
            </KpiRow>

            <ReportCard title="Itens em estoque" subtitle={`${fmtInt(s.total_items)} produto(s) — críticos e baixos primeiro`} pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Produto</th>
                      <th style={{ textAlign: 'left' }}>SKU</th>
                      <th style={{ textAlign: 'right' }}>Qtd</th>
                      <th style={{ textAlign: 'right' }}>Mínimo</th>
                      <th style={{ textAlign: 'right' }}>Máximo</th>
                      <th style={{ textAlign: 'right' }}>Valor</th>
                      <th style={{ textAlign: 'left' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.items.map(it => {
                      const st = STATUS_STYLE[it.status];
                      return (
                        <tr key={it.id}>
                          <td style={{ fontWeight: 500 }}>{it.name}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>{it.sku ?? '—'}</td>
                          <td style={{ textAlign: 'right' }}>{fmtInt(it.quantity)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(it.min_qty)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{it.max_qty != null ? fmtInt(it.max_qty) : '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{fmtBRL(it.stock_value)}</td>
                          <td>
                            <span style={{ background: st.bg, color: st.fg, borderRadius: 4, padding: '2px 8px', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                              {st.label}
                            </span>
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
