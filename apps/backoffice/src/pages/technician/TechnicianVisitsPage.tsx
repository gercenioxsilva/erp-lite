import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import type { TKey } from '../../i18n/pt-BR';
import { TechnicianLayout } from './TechnicianLayout';

interface VisitListItem {
  id: string; status: string; scheduled_at: string;
  order_title: string; order_number: string;
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    scheduled: 'badge-raw_material', in_progress: 'badge-product',
    completed: 'badge-active', cancelled: 'badge-inactive', no_show: 'badge-inactive',
  };
  return map[s] ?? 'badge-service';
}

export function TechnicianVisitsPage() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  const [visits, setVisits]   = useState<VisitListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || user.role !== 'technician') return;
    api.get<{ data: VisitListItem[] }>('/v1/technician/visits')
      .then(r => setVisits(r.data ?? []))
      .catch(() => setVisits([]))
      .finally(() => setLoading(false));
  }, [user]);

  if (authLoading) return <div className="spinner">{t('c.loading')}</div>;
  if (!user) return <Navigate to={`/tecnico/entrar?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  if (user.role !== 'technician') return <Navigate to="/dashboard" replace />;

  return (
    <TechnicianLayout>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>{t('tp.myVisits')}</h1>

      {loading ? (
        <div className="spinner">{t('c.loading')}</div>
      ) : visits.length === 0 ? (
        <div className="empty-state">{t('tp.noVisits')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visits.map(v => (
            <div key={v.id} className="card" style={{ padding: 16, cursor: 'pointer' }}
              onClick={() => navigate(`/tecnico/visitas/${v.id}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <strong>{v.order_title}</strong>
                <span className={`badge ${statusBadge(v.status)}`}>{t(`so.status.${v.status}` as TKey) ?? v.status}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>#{v.order_number}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                {new Date(v.scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </div>
            </div>
          ))}
        </div>
      )}
    </TechnicianLayout>
  );
}
