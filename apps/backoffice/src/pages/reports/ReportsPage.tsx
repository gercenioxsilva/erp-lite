import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { api }     from '../../lib/api';
import { useI18n } from '../../i18n';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmt(v: number) { return BRL.format(v); }

interface OverdueRow {
  id:          string;
  description: string;
  amount:      number;
  paid_amount: number;
  remaining:   number;
  due_date:    string;
  client_name: string | null;
  days_overdue: number;
}

interface OverdueData {
  rows:          OverdueRow[];
  total_overdue: number;
  count:         number;
}

interface TopProductRow {
  name:          string;
  sku:           string | null;
  total_qty:     number;
  total_revenue: number;
  order_count:   number;
}

interface TopProductsData {
  rows: TopProductRow[];
  days: number;
}

type Tab = 'overdue' | 'top-products';
const DAYS_OPTIONS = [7, 30, 90, 180, 365];

export function ReportsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('overdue');

  // Overdue
  const [overdue,        setOverdue]        = useState<OverdueData | null>(null);
  const [overdueLoading, setOverdueLoading] = useState(false);

  // Top products
  const [topDays,          setTopDays]          = useState(30);
  const [topProducts,      setTopProducts]      = useState<TopProductsData | null>(null);
  const [topProductsLoading, setTopProductsLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'overdue' || overdue) return;
    setOverdueLoading(true);
    api.get<OverdueData>('/v1/reports/overdue')
      .then(r => setOverdue(r))
      .catch(() => {})
      .finally(() => setOverdueLoading(false));
  }, [tab]);

  useEffect(() => {
    if (tab !== 'top-products') return;
    setTopProductsLoading(true);
    api.get<TopProductsData>(`/v1/reports/top-products?days=${topDays}`)
      .then(r => setTopProducts(r))
      .catch(() => {})
      .finally(() => setTopProductsLoading(false));
  }, [tab, topDays]);

  function exportOverdueXlsx() {
    if (!overdue) return;
    const ws = XLSX.utils.json_to_sheet(overdue.rows.map(r => ({
      Cliente:         r.client_name ?? '—',
      Descrição:       r.description,
      Valor:           r.amount,
      Pago:            r.paid_amount,
      Restante:        r.remaining,
      Vencimento:      r.due_date,
      'Dias em atraso': r.days_overdue,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inadimplência');
    XLSX.writeFile(wb, `inadimplencia-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportTopXlsx() {
    if (!topProducts) return;
    const ws = XLSX.utils.json_to_sheet(topProducts.rows.map(r => ({
      Produto:    r.name,
      SKU:        r.sku ?? '',
      Qtd:        r.total_qty,
      Faturamento: r.total_revenue,
      Pedidos:    r.order_count,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ranking');
    XLSX.writeFile(wb, `ranking-produtos-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t('rep.title')}</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
        {(['overdue', 'top-products'] as Tab[]).map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              background: 'none', border: 'none', padding: '10px 20px', cursor: 'pointer', fontSize: 14,
              fontWeight: tab === key ? 700 : 400,
              color: tab === key ? 'var(--primary)' : 'var(--muted)',
              borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: -2,
            }}
          >
            {key === 'overdue' ? t('rep.tabOverdue') : t('rep.tabTopProducts')}
          </button>
        ))}
      </div>

      {/* ── Inadimplência ──────────────────────────────────────────── */}
      {tab === 'overdue' && (
        <div>
          {overdueLoading ? (
            <div className="spinner">{t('c.loading')}</div>
          ) : overdue ? (
            <>
              {/* Summary row */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
                <div className="bento-card" style={{ padding: '16px 24px', flex: '1 0 160px' }}>
                  <div className="bento-label">{t('rep.overdueCount')}</div>
                  <div className="bento-value" style={{ fontSize: 28 }}>{overdue.count}</div>
                </div>
                <div className="bento-card" style={{ padding: '16px 24px', flex: '1 0 200px' }}>
                  <div className="bento-label">{t('rep.overdueTotal')}</div>
                  <div className="bento-value" style={{ fontSize: 22, color: '#ef4444' }}>
                    {fmt(overdue.total_overdue)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button className="btn btn-secondary btn-sm" onClick={exportOverdueXlsx} disabled={overdue.count === 0}>
                    ↓ {t('rep.export')}
                  </button>
                </div>
              </div>

              {overdue.count === 0 ? (
                <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                  {t('rep.overdueEmpty')}
                </div>
              ) : (
                <div className="card">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('rep.overdueClient')}</th>
                        <th>{t('rep.overdueDesc')}</th>
                        <th style={{ textAlign: 'right' }}>{t('rep.overdueAmount')}</th>
                        <th style={{ textAlign: 'right' }}>{t('rep.overdueRemaining')}</th>
                        <th>{t('rep.overdueDueDate')}</th>
                        <th style={{ textAlign: 'right' }}>{t('rep.overdueDays')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overdue.rows.map(r => (
                        <tr key={r.id}>
                          <td style={{ fontWeight: 500 }}>{r.client_name ?? '—'}</td>
                          <td>{r.description}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{fmt(r.amount)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: '#ef4444', fontWeight: 600 }}>
                            {fmt(r.remaining)}
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {new Date(r.due_date + 'T12:00:00Z').toLocaleDateString('pt-BR')}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span style={{ background: r.days_overdue > 30 ? '#fee2e2' : '#fff7ed', color: r.days_overdue > 30 ? '#dc2626' : '#d97706', borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
                              {r.days_overdue}d
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* ── Ranking de Produtos ────────────────────────────────────── */}
      {tab === 'top-products' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 14, fontWeight: 500 }}>{t('rep.topPeriod')}:</label>
            <div className="flex-gap" style={{ flexWrap: 'wrap' }}>
              {DAYS_OPTIONS.map(d => (
                <button
                  key={d}
                  className={`btn btn-sm ${topDays === d ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ width: 'auto' }}
                  onClick={() => setTopDays(d)}
                >
                  {d === 7 ? t('rep.top7d') : d === 30 ? t('rep.top30d') : d === 90 ? t('rep.top90d') : d === 180 ? t('rep.top180d') : t('rep.top365d')}
                </button>
              ))}
            </div>
            {topProducts && topProducts.rows.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={exportTopXlsx}>
                ↓ {t('rep.export')}
              </button>
            )}
          </div>

          {topProductsLoading ? (
            <div className="spinner">{t('c.loading')}</div>
          ) : topProducts ? (
            topProducts.rows.length === 0 ? (
              <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                {t('rep.topEmpty')}
              </div>
            ) : (
              <div className="card">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>#</th>
                      <th>{t('rep.topProduct')}</th>
                      <th>{t('rep.topSku')}</th>
                      <th style={{ textAlign: 'right' }}>{t('rep.topQty')}</th>
                      <th style={{ textAlign: 'right' }}>{t('rep.topRevenue')}</th>
                      <th style={{ textAlign: 'right' }}>{t('rep.topOrders')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.rows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ color: 'var(--muted)', fontWeight: i < 3 ? 700 : 400 }}>
                          {i + 1}
                          {i === 0 && ' 🥇'}
                          {i === 1 && ' 🥈'}
                          {i === 2 && ' 🥉'}
                        </td>
                        <td style={{ fontWeight: 500 }}>{r.name}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' }}>{r.sku ?? '—'}</td>
                        <td style={{ textAlign: 'right' }}>{Number(r.total_qty).toLocaleString('pt-BR')}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>
                          {fmt(r.total_revenue)}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{r.order_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
