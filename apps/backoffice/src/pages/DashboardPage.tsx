import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n';

interface StockAlert { id: string; name: string; sku: string; quantity: number; min_qty: number; }
interface MaterialsResp { total: number; }

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

  return (
    <div>
      <div className="page-header">
        <h1>{t('d.title')}</h1>
        <span className="text-muted">{t('d.welcome')} {user?.name}</span>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">{t('d.totalMat')}</div>
          <div className="stat-value">{total ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('d.alerts')}</div>
          <div className="stat-value" style={{ color: alerts.length ? 'var(--danger)' : 'inherit' }}>
            {alerts.length}
          </div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="card">
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
            {t('d.lowStock')}
          </div>
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

      {alerts.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <p>{t('d.healthy')} <Link to="/materials">{t('d.viewMats')}</Link></p>
          </div>
        </div>
      )}
    </div>
  );
}
