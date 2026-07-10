import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { Can } from '../../rbac';
import { Badge, KPICard } from '../../ds';
import { formatDateShortBR } from '../../lib/schedulingTime';
import {
  SessionFormDrawer, SESSION_STATUS_BADGE, SESSION_STATUS_LABEL,
} from './SessionFormDrawer';
import type { SessionRow } from './SessionFormDrawer';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface DashboardResp {
  today:               SessionRow[];
  upcoming:            SessionRow[];
  pending_requests:    number;
  date:                string;
  onboarding_complete: boolean;
}

const POLL_INTERVAL_MS = 30_000;

// ── Componente ────────────────────────────────────────────────────────────────

export function SchedulingDashboardPage() {
  const navigate = useNavigate();

  const [data,       setData]       = useState<DashboardResp | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const resp = await api.get<DashboardResp>('/v1/scheduling/dashboard');
      if (resp.onboarding_complete === false) {
        navigate('/scheduling/onboarding');
        return;
      }
      setData(resp);
    } catch { /**/ } finally { if (!silent) setLoading(false); }
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  // Agenda é operação viva: atualiza sozinha a cada 30s (sem flicker).
  useEffect(() => {
    const id = setInterval(() => { void load(true); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  const pending = data?.pending_requests ?? 0;

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <h1>Agendamentos</h1>
        <div className="flex-gap">
          <button className="btn btn-secondary btn-cta" style={{ width: 'auto' }}
            onClick={() => navigate('/scheduling/calendar')}>
            Ver calendário
          </button>
          <Can permission="scheduling:manage">
            <button className="btn btn-primary btn-cta" style={{ width: 'auto' }}
              onClick={() => setDrawerOpen(true)}>
              + Agendar sessão
            </button>
          </Can>
        </div>
      </div>

      {/* ── KPIs ─────────────────────────────────────────────────────── */}
      <div className="bento-grid">
        <KPICard
          label="Sessões hoje"
          value={data ? data.today.length : '—'}
          icon="📅"
          iconVariant="blue"
          sub={data ? formatDateShortBR(data.date) : undefined}
        />
        <KPICard
          label="Próximas sessões"
          value={data ? data.upcoming.length : '—'}
          icon="⏱"
          iconVariant="green"
          sub="Confirmadas nos próximos dias"
        />
        <KPICard
          label="Solicitações pendentes"
          value={data ? pending : '—'}
          icon="✋"
          iconVariant={pending > 0 ? 'amber' : 'blue'}
          sub={pending > 0 ? 'Aguardando sua decisão' : 'Nada aguardando aprovação'}
          active={pending > 0}
          onClick={() => navigate('/scheduling/requests')}
        />
      </div>

      {/* ── Listas: hoje e próximas ──────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <SessionListCard
          title="Hoje"
          sessions={data?.today ?? []}
          loading={loading}
          emptyLabel="Nenhuma sessão marcada para hoje."
          showDate={false}
        />
        <SessionListCard
          title="Próximas"
          sessions={data?.upcoming ?? []}
          loading={loading}
          emptyLabel="Nenhuma sessão futura agendada."
          showDate
        />
      </div>

      {/* ── Drawer de agendamento ────────────────────────────────────── */}
      <SessionFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => void load(true)}
      />
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function SessionListCard({ title, sessions, loading, emptyLabel, showDate }: {
  title:      string;
  sessions:   SessionRow[];
  loading:    boolean;
  emptyLabel: string;
  showDate:   boolean;
}) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>
        {title}
      </div>
      <div style={{ padding: '8px 16px 12px' }}>
        {loading ? (
          <div className="spinner" style={{ margin: '24px auto' }}>Carregando…</div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: '20px 0', fontSize: 13, color: 'var(--muted)' }}>{emptyLabel}</div>
        ) : (
          sessions.map(s => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 0', borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {showDate && (
                  <span style={{ color: 'var(--muted)', marginRight: 8 }}>
                    {formatDateShortBR(s.date)}
                  </span>
                )}
                {s.start_time}–{s.end_time}
              </div>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.client_name}
              </div>
              <Badge variant={SESSION_STATUS_BADGE[s.status]}>
                {SESSION_STATUS_LABEL[s.status]}
              </Badge>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
