import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n';

// Interface do endpoint /v1/dashboard
interface DashboardData {
  receivables: { pending_count: number; pending_amount: number; overdue_count: number; overdue_amount: number };
  payables:    { due_week_count: number; due_week_amount: number; overdue_count: number; overdue_amount: number };
  revenue:     { this_month: number; last_month: number };
  orders:      { pending_count: number };
  revenue_by_month: Array<{ month: string; total: number }>;
}

interface StockAlert { id: string; name: string; sku: string; quantity: number; min_qty: number; }

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
}

function MiniBar({ month, total, max }: { month: string; total: number; max: number }) {
  const pct = max > 0 ? Math.max(4, Math.round((total / max) * 100)) : 4;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 36 }}>
      <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{fmt(total).replace('R$ ', '')}</span>
      <div style={{ width: 28, height: `${pct}px`, background: 'var(--primary)', borderRadius: 4, transition: 'height .3s' }} />
      <span style={{ fontSize: 10, color: 'var(--muted)' }}>{month.slice(5)}</span>
    </div>
  );
}

const QUICK_LINKS = [
  { to: '/clients',     labelKey: 'nav.clients'     as const },
  { to: '/orders',      labelKey: 'nav.orders'      as const },
  { to: '/invoices',    labelKey: 'nav.invoices'    as const },
  { to: '/receivables', labelKey: 'nav.receivables' as const },
  { to: '/payables',    labelKey: 'nav.payables'    as const },
];

export function DashboardPage() {
  const { tenantId, user } = useAuth();
  const { t } = useI18n();
  const [data,    setData]    = useState<DashboardData | null>(null);
  const [alerts,  setAlerts]  = useState<StockAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    Promise.all([
      api.get<DashboardData>('/v1/dashboard'),
      api.get<StockAlert[]>(`/v1/stock/alerts?tenant_id=${tenantId}`),
    ]).then(([dash, al]) => {
      setData(dash as DashboardData);
      setAlerts(al as StockAlert[]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [tenantId]);

  if (loading) return <div className="spinner">{t('c.loading')}</div>;

  const maxRev = data ? Math.max(...data.revenue_by_month.map(r => r.total), 1) : 1;
  const revDiff = data ? data.revenue.this_month - data.revenue.last_month : 0;

  return (
    <div>
      <div className="page-header">
        <h1>{t('d.title')}</h1>
        <span className="text-muted">{t('d.welcome')}, {user?.name}</span>
      </div>

      {/* KPI cards */}
      <div className="bento-grid">
        {/* Receita este mês */}
        <div className="bento-card bento-hero">
          <div className="bento-hero-orb bento-hero-orb-1" />
          <div className="bento-hero-orb bento-hero-orb-2" />
          <div className="bento-hero-content">
            <div className="bento-label">{t('d.revenueMonth')}</div>
            <div className="bento-value">{data ? fmt(data.revenue.this_month) : '—'}</div>
            <div className="bento-sub" style={{ color: revDiff >= 0 ? '#22c55e' : '#ef4444' }}>
              {revDiff >= 0 ? '↑' : '↓'} {data ? fmt(Math.abs(revDiff)) : '—'} {t('d.vsLastMonth')}
            </div>
          </div>
        </div>

        {/* A Receber */}
        <div className="bento-card">
          <div className="bento-label">{t('d.toReceive')}</div>
          <div className="bento-value" style={{ fontSize: 22 }}>{data ? fmt(data.receivables.pending_amount) : '—'}</div>
          <div className="bento-sub">{data?.receivables.pending_count ?? 0} {t('d.invoicesPending')}</div>
          {(data?.receivables.overdue_count ?? 0) > 0 && (
            <div style={{ marginTop: 8, color: '#ef4444', fontSize: 13, fontWeight: 600 }}>
              ⚠ {data!.receivables.overdue_count} {t('d.overdue')} — {fmt(data!.receivables.overdue_amount)}
            </div>
          )}
          <Link to="/receivables" style={{ fontSize: 13, color: 'var(--primary)', marginTop: 12, display: 'block' }}>{t('d.seeAll')}</Link>
        </div>

        {/* A Pagar esta semana */}
        <div className="bento-card">
          <div className="bento-label">{t('d.toPayWeek')}</div>
          <div className="bento-value" style={{ fontSize: 22 }}>{data ? fmt(data.payables.due_week_amount) : '—'}</div>
          <div className="bento-sub">{data?.payables.due_week_count ?? 0} {t('d.billsDue')}</div>
          {(data?.payables.overdue_count ?? 0) > 0 && (
            <div style={{ marginTop: 8, color: '#ef4444', fontSize: 13, fontWeight: 600 }}>
              ⚠ {data!.payables.overdue_count} {t('d.overdue')} — {fmt(data!.payables.overdue_amount)}
            </div>
          )}
          <Link to="/payables" style={{ fontSize: 13, color: 'var(--primary)', marginTop: 12, display: 'block' }}>{t('d.seeAll')}</Link>
        </div>

        {/* Pedidos pendentes */}
        <div className="bento-card">
          <div className="bento-label">{t('d.pendingOrders')}</div>
          <div className="bento-value" style={{ fontSize: 36 }}>{data?.orders.pending_count ?? 0}</div>
          <div className="bento-sub">{t('d.ordersConfirmed')}</div>
          <Link to="/orders" style={{ fontSize: 13, color: 'var(--primary)', marginTop: 12, display: 'block' }}>{t('d.seeAll')}</Link>
        </div>
      </div>

      {/* Mini bar chart — receita 6 meses */}
      {data && data.revenue_by_month.length > 0 && (
        <div className="bento-card" style={{ marginTop: 16, padding: 24 }}>
          <div className="bento-label" style={{ marginBottom: 16 }}>{t('d.revenue6Months')}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 120 }}>
            {data.revenue_by_month.map(r => (
              <MiniBar key={r.month} month={r.month} total={r.total} max={maxRev} />
            ))}
          </div>
        </div>
      )}

      {/* Alertas de estoque */}
      {alerts.length > 0 && (
        <div className="bento-card" style={{ marginTop: 16, padding: 24 }}>
          <div className="bento-label" style={{ marginBottom: 12 }}>⚠ {t('d.stockAlerts')} ({alerts.length})</div>
          {alerts.slice(0, 5).map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
              <span>{a.name} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({a.sku})</span></span>
              <span style={{ color: '#ef4444', fontWeight: 600 }}>{a.quantity} / mín {a.min_qty}</span>
            </div>
          ))}
          <Link to="/stock" style={{ fontSize: 13, color: 'var(--primary)', marginTop: 12, display: 'block' }}>{t('d.seeAll')}</Link>
        </div>
      )}

      {/* Quick links */}
      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {QUICK_LINKS.map(l => (
          <Link key={l.to} to={l.to} className="btn btn-secondary" style={{ fontSize: 13 }}>
            {t(l.labelKey)}
          </Link>
        ))}
      </div>
    </div>
  );
}
