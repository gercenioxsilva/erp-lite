import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge } from '../../ds';
import type { BadgeVariant } from '../../ds';
import { todayISO, formatDateShortBR } from '../../lib/schedulingTime';
import { usePortalMe } from './PortalLayout';

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionStatus = 'pending' | 'confirmed' | 'completed' | 'canceled' | 'declined';

interface PortalSession {
  id:             string;
  date:           string;
  start_time:     string;
  end_time:       string;
  status:         SessionStatus;
  decline_reason: string | null;
  notes:          string | null;
  area_id:        string | null;
  professional_id: string | null;
}

interface PortalArea {
  id:   string;
  name: string;
}

const STATUS_META: Record<SessionStatus, { label: string; variant: BadgeVariant }> = {
  pending:   { label: 'Aguardando aprovação', variant: 'pending' },
  confirmed: { label: 'Confirmada',           variant: 'confirmed' },
  completed: { label: 'Concluída',            variant: 'active' },
  canceled:  { label: 'Cancelada',            variant: 'cancelled' },
  declined:  { label: 'Recusada',             variant: 'overdue' },
};

const hm = (t: string): string => t.slice(0, 5);

// ── Main component ─────────────────────────────────────────────────────────────

export function PortalSessionsPage() {
  const me = usePortalMe();

  const [sessions,  setSessions]  = useState<PortalSession[]>([]);
  const [areas,     setAreas]     = useState<PortalArea[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab,       setTab]       = useState<'upcoming' | 'history'>('upcoming');
  const [reloadKey, setReloadKey] = useState(0);

  // ── Cancelamento (confirmação inline, sem modal do backoffice) ─────────────
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [canceling,    setCanceling]    = useState(false);
  const [actionError,  setActionError]  = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError('');
    Promise.all([
      api.get<{ data: PortalSession[] }>('/v1/portal/sessions?per_page=100'),
      api.get<{ data: PortalArea[] }>('/v1/portal/areas'),
    ])
      .then(([s, a]) => { if (!alive) return; setSessions(s.data); setAreas(a.data); })
      .catch(() => { if (alive) setLoadError('Não foi possível carregar suas sessões. Tente novamente.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadKey]);

  async function handleCancel(session: PortalSession) {
    setCanceling(true);
    setActionError('');
    try {
      await api.post(`/v1/portal/sessions/${session.id}/cancel`, {});
      setConfirmingId(null);
      setReloadKey(k => k + 1);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 422 && err.body?.error === 'cancel_window_violation') {
        const h = typeof err.body.cancel_window_hours === 'number'
          ? err.body.cancel_window_hours
          : me.business.cancel_window_hours;
        setActionError(`O prazo para cancelar já passou (${h}h antes do horário).`);
      } else if (err instanceof ApiError && err.status === 422 && err.body?.error === 'client_cancel_only_pending') {
        setActionError('Só é possível cancelar solicitações que ainda aguardam aprovação.');
        setReloadKey(k => k + 1);
      } else {
        setActionError('Não foi possível cancelar a solicitação. Tente novamente.');
      }
      setConfirmingId(null);
    } finally { setCanceling(false); }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const today = todayISO();
  const isUpcoming = (s: PortalSession) =>
    s.date >= today && (s.status === 'pending' || s.status === 'confirmed');

  const visible = sessions
    .filter(s => (tab === 'upcoming' ? isUpcoming(s) : !isUpcoming(s)))
    .sort((a, b) => {
      const ka = a.date + a.start_time;
      const kb = b.date + b.start_time;
      return tab === 'upcoming' ? ka.localeCompare(kb) : kb.localeCompare(ka);
    });

  const areaName = (id: string | null) => areas.find(a => a.id === id)?.name ?? null;

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      <h1 className="portal-hello">Minhas sessões</h1>
      <p className="portal-hello-sub">Acompanhe suas solicitações e o histórico.</p>

      <div className="portal-seg" role="tablist" aria-label="Filtro de sessões">
        <button type="button" role="tab" aria-selected={tab === 'upcoming'}
          className={tab === 'upcoming' ? 'is-active' : ''} onClick={() => setTab('upcoming')}>
          Próximas
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'}
          className={tab === 'history' ? 'is-active' : ''} onClick={() => setTab('history')}>
          Histórico
        </button>
      </div>

      {actionError && <div className="alert alert-error" role="alert">{actionError}</div>}
      {loadError   && <div className="alert alert-error" role="alert">{loadError}</div>}

      {loading ? (
        <div className="portal-card"><div className="spinner">Carregando…</div></div>
      ) : visible.length === 0 ? (
        <div className="portal-card">
          <div className="portal-empty">
            {tab === 'upcoming' ? 'Nenhuma sessão marcada por enquanto.' : 'Nenhuma sessão no histórico.'}
          </div>
        </div>
      ) : (
        <div className="portal-stack">
          {visible.map(s => {
            const meta = STATUS_META[s.status];
            return (
              <div key={s.id} className="portal-card portal-session">
                <div className="portal-session__row">
                  <div>
                    <div className="portal-session__date">{formatDateShortBR(s.date)}</div>
                    <div className="portal-session__time">{hm(s.start_time)} – {hm(s.end_time)}</div>
                    {areaName(s.area_id) && <div className="portal-session__meta">{areaName(s.area_id)}</div>}
                  </div>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                </div>

                {s.status === 'declined' && s.decline_reason && (
                  <div className="portal-session__reason">Motivo: {s.decline_reason}</div>
                )}

                {s.status === 'pending' && (
                  <div className="portal-session__actions">
                    {confirmingId === s.id ? (
                      <>
                        <span className="portal-session__confirm-label">Cancelar esta solicitação?</span>
                        <button type="button" className="portal-link-danger" disabled={canceling}
                          onClick={() => void handleCancel(s)}>
                          {canceling ? 'Cancelando…' : 'Sim, cancelar'}
                        </button>
                        <button type="button" className="portal-link-quiet" disabled={canceling}
                          onClick={() => setConfirmingId(null)}>
                          Voltar
                        </button>
                      </>
                    ) : (
                      <button type="button" className="portal-link-danger"
                        onClick={() => { setActionError(''); setConfirmingId(s.id); }}>
                        Cancelar solicitação
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
