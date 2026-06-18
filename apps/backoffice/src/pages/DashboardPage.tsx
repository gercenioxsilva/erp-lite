import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface StockAlert { id: string; name: string; sku: string; quantity: number; min_qty: number; }
interface MaterialsResp { total: number; }

export function DashboardPage() {
  const { tenantId, user } = useAuth();
  const [total,    setTotal]    = useState<number | null>(null);
  const [alerts,   setAlerts]   = useState<StockAlert[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    Promise.all([
      api.get<MaterialsResp>(`/v1/materials?tenant_id=${tenantId}&per_page=1`),
      api.get<StockAlert[]>(`/v1/stock/alerts?tenant_id=${tenantId}`),
    ]).then(([mats, al]) => {
      setTotal((mats as any).total ?? 0);
      setAlerts(al as StockAlert[]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [tenantId]);

  if (loading) return <div className="spinner">Loading…</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <span className="text-muted">Welcome, {user?.name}</span>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Materials</div>
          <div className="stat-value">{total ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Stock Alerts</div>
          <div className="stat-value" style={{ color: alerts.length ? 'var(--danger)' : 'inherit' }}>
            {alerts.length}
          </div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="card">
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
            Low Stock Alerts
          </div>
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th className="text-right">Current</th>
                <th className="text-right">Minimum</th>
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
            <p>All stock levels are healthy. <Link to="/materials">View materials →</Link></p>
          </div>
        </div>
      )}
    </div>
  );
}
