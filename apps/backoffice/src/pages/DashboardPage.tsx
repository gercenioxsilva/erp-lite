import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n';

interface StockAlert { id: string; name: string; sku: string; quantity: number; min_qty: number; }
interface MaterialsResp { total: number; }

const QUICK_LINKS = [
  { to: '/clients',     labelKey: 'nav.clients'     as const },
  { to: '/materials',   labelKey: 'nav.materials'   as const },
  { to: '/stock',       labelKey: 'nav.stock'       as const },
  { to: '/orders',      labelKey: 'nav.orders'      as const },
  { to: '/invoices',    labelKey: 'nav.invoices'    as const },
  { to: '/receivables', labelKey: 'nav.receivables' as const },
  { to: '/payables',    labelKey: 'nav.payables'    as const },
];

export function DashboardPage() {
  const { tenantId, user } = useAuth();
  const { t } = useI18n();
  const [total,   setTotal]   = useState<number | null>(null);
  const [alerts,  setAlerts]  = useState<StockAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    Promise.all([
      api.get<MaterialsResp>(`/v1/materials?tenant_id=${tenantId}&per_page=1`),
      api.get<StockAlert[]>(`/v1/stock/alerts?tenant_id=${tenantId}`),
    ]).then(([mats, al]) => {
      setTotal((mats as { total: number }).total ?? 0);
      setAlerts(al as StockAlert[]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [tenantId]);

  if (loading) return <div className="spinner">{t('c.loading')}</div>;

  const hasAlerts = alerts.length > 0;

  return (
    <div>
      <div className="page-header">
        <h1>{t('d.title')}</h1>
        <span className="text-muted">{t('d.welcome')} {user?.name}</span>
      </div>

      <div className="bento-grid">
        <div className="bento-card bento-hero">
          <div className="bento-hero-orb bento-hero-orb-1" />
          <div className="bento-hero-orb bento-hero-orb-2" />
          <div className="bento-hero-content">
            <div className="bento-label">{t('d.totalMat')}</div>
            <div className="bento-value">{total ?? '—'}</div>
            <div className="bento-sub">{t('nav.materials')}</div>
          </div>
        </div>

        <div className="bento-card">
          <div className="bento-icon bento-icon-red">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 2l7 13H2L9 2z"/><path d="M9 7v4M9 13h.01"/>
            </svg>
          </div>
          <div className="bento-label">{t('d.alerts')}</div>
          <div className="bento-value-md" style={{ color: hasAlerts ? 'var(--danger)' : 'var(--text)' }}>
            {alerts.length}
          </div>
          <span className={`bento-badge ${hasAlerts ? 'bento-badge-warn' : 'bento-badge-ok'}`}>
            {hasAlerts ? t('d.lowStock') : t('d.healthy')}
          </span>
        </div>
      </div>

      <div className="quick-links">
        {QUICK_LINKS.map(ql => (
          <Link key={ql.to} to={ql.to} className="quick-link">
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9h6M9 6l3 3-3 3"/>
            </svg>
            {t(ql.labelKey)}
          </Link>
        ))}
      </div>

      {hasAlerts && (
        <div className="card">
          <div className="card-header">{t('d.lowStock')}</div>
          <table>
            <thead>
              <tr>
                <th>{t('d.sku')}</th>
                <th>{t('c.name')}</th>
                <th className="text-right">{t('d.current')}</th>
                <th className="text-right">{t('d.minimum')}</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map(a => (
                <tr key={a.id}>
                  <td><code>{a.sku}</code></td>
                  <td>{a.name}</td>
                  <td className="text-right" style={{ color: 'var(--danger)' }}>{a.quantity}</td>
                  <td className="text-right text-muted">{a.min_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!hasAlerts && (
        <div className="card">
          <div className="empty-state">
            <p>{t('d.healthy')} <Link to="/materials">{t('d.viewMats')}</Link></p>
          </div>
        </div>
      )}
    </div>
  );
}
