import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Badge, BalanceBar } from '../../ds';
import { todayISO, formatDateShortBR } from '../../lib/schedulingTime';
import { usePortalMe } from './PortalLayout';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalSession {
  id:         string;
  date:       string;
  start_time: string;
  end_time:   string;
  status:     'pending' | 'confirmed' | 'completed' | 'canceled' | 'declined';
  area_id:    string | null;
}

interface PortalPackage {
  id:                 string;
  name:               string;
  total_sessions:     number;
  used_sessions:      number;
  remaining_sessions: number;
}

interface PortalArea {
  id:   string;
  name: string;
}

const hm = (t: string): string => t.slice(0, 5);

// ── Main component ─────────────────────────────────────────────────────────────

export function PortalHomePage() {
  const me = usePortalMe();
  const { user } = useAuth();

  const [sessions, setSessions] = useState<PortalSession[]>([]);
  const [packages, setPackages] = useState<PortalPackage[]>([]);
  const [areas,    setAreas]    = useState<PortalArea[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<{ data: PortalSession[] }>(`/v1/portal/sessions?from=${todayISO()}&per_page=100`),
      api.get<{ data: PortalPackage[] }>('/v1/portal/packages?status=active'),
      api.get<{ data: PortalArea[] }>('/v1/portal/areas'),
    ])
      .then(([s, p, a]) => {
        if (!alive) return;
        setSessions(s.data);
        setPackages(p.data);
        setAreas(a.data);
      })
      .catch(() => { if (alive) setError('Não foi possível carregar seus dados. Tente novamente.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // ── Derived values ─────────────────────────────────────────────────────────

  const firstName = (user?.name ?? me.user.name).split(' ')[0];
  const areaName  = (id: string | null) => areas.find(a => a.id === id)?.name ?? null;

  const next = sessions
    .filter(s => s.status === 'pending' || s.status === 'confirmed')
    .filter(s => s.date >= todayISO())
    .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))[0];

  const topPackages = packages.slice(0, 2);

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      <h1 className="portal-hello">Olá, {firstName}</h1>
      <p className="portal-hello-sub">Bem-vindo(a) de volta.</p>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {me.business.allow_self_booking ? (
        <Link className="portal-cta" to="/portal/agendar">+ Solicitar horário</Link>
      ) : (
        <div className="portal-note">
          Agendamentos são feitos diretamente com o profissional.
        </div>
      )}

      {/* ── Próxima sessão ────────────────────────────────────────────── */}
      <div className="portal-section-head">
        <h2>Próxima sessão</h2>
        <Link to="/portal/sessoes">Ver todas</Link>
      </div>
      <div className="portal-card portal-session">
        {loading ? (
          <div className="spinner">Carregando…</div>
        ) : !next ? (
          <div className="portal-empty">Você não tem sessões marcadas.</div>
        ) : (
          <div className="portal-session__row">
            <div>
              <div className="portal-session__date">{formatDateShortBR(next.date)}</div>
              <div className="portal-session__time">{hm(next.start_time)} – {hm(next.end_time)}</div>
              {areaName(next.area_id) && <div className="portal-session__meta">{areaName(next.area_id)}</div>}
            </div>
            {next.status === 'confirmed'
              ? <Badge variant="confirmed">Confirmada</Badge>
              : <Badge variant="pending">Aguardando aprovação</Badge>}
          </div>
        )}
      </div>

      {/* ── Meus pacotes ──────────────────────────────────────────────── */}
      <div className="portal-section-head">
        <h2>Meus pacotes</h2>
        <Link to="/portal/pacotes">Ver todos</Link>
      </div>
      {loading ? (
        <div className="portal-card"><div className="spinner">Carregando…</div></div>
      ) : topPackages.length === 0 ? (
        <div className="portal-card">
          <div className="portal-empty">Nenhum pacote ativo no momento.</div>
        </div>
      ) : (
        <div className="portal-stack">
          {topPackages.map(p => (
            <div key={p.id} className="portal-card">
              <div className="portal-option__title">{p.name}</div>
              <div className="portal-option__meta">
                {p.remaining_sessions} de {p.total_sessions} {p.remaining_sessions === 1 ? 'sessão restante' : 'sessões restantes'}
              </div>
              <div className="portal-option__balance">
                <BalanceBar total={p.total_sessions} used={p.used_sessions} compact />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
