import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { api, ApiError } from '../../lib/api';
import './portal.css';

// ── Contrato do /v1/portal/me — compartilhado pelas páginas do portal ─────────

export interface PortalMe {
  client: {
    id:           string;
    full_name:    string;
    company_name: string | null;
    email:        string | null;
    phone:        string | null;
  };
  user: {
    email: string;
    name:  string;
  };
  business: {
    business_name:      string | null;
    business_type:      string | null;
    allow_self_booking: boolean;
    min_advance_hours:  number;
    cancel_window_hours: number;
  };
}

interface PortalOutletContext {
  me: PortalMe;
}

/** Payload do /portal/me carregado uma vez pelo PortalLayout — as páginas filhas
 *  leem via Outlet context, então só renderizam depois que ele existe. */
export function usePortalMe(): PortalMe {
  return useOutletContext<PortalOutletContext>().me;
}

// ── Ícones do tab bar ──────────────────────────────────────────────────────────

type TabIconName = 'home' | 'sessions' | 'book' | 'packages' | 'profile';

function TabIcon({ name }: { name: TabIconName }) {
  const common = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'home':
      return <svg {...common}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>;
    case 'sessions':
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>;
    case 'book':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>;
    case 'packages':
      return <svg {...common}><path d="M21 8.5 12 13 3 8.5 12 4l9 4.5Z" /><path d="M3 8.5V16l9 4.5 9-4.5V8.5" /><path d="M12 13v7.5" /></svg>;
    case 'profile':
      return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-3.6 4.4-5.5 8-5.5s6.5 1.9 8 5.5" /></svg>;
  }
}

const TABS: { to: string; end?: boolean; label: string; icon: TabIconName }[] = [
  { to: '/portal',          end: true, label: 'Início',  icon: 'home' },
  { to: '/portal/sessoes',             label: 'Sessões', icon: 'sessions' },
  { to: '/portal/agendar',             label: 'Agendar', icon: 'book' },
  { to: '/portal/pacotes',             label: 'Pacotes', icon: 'packages' },
  { to: '/portal/perfil',              label: 'Perfil',  icon: 'profile' },
];

// ── Layout ─────────────────────────────────────────────────────────────────────

type MeState = 'loading' | 'ready' | 'not_linked' | 'error';

/** Shell do Portal do Cliente — de propósito SEM o menu do backoffice: usuários
 *  com role='client' só enxergam /v1/portal/*, e o layout reflete isso. */
export function PortalLayout() {
  const { user, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();

  const [me,        setMe]        = useState<PortalMe | null>(null);
  const [meState,   setMeState]   = useState<MeState>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  const isClient = user?.role === 'client';

  useEffect(() => {
    if (!isClient) return;
    let alive = true;
    setMeState('loading');
    api.get<PortalMe>('/v1/portal/me')
      .then(res => { if (!alive) return; setMe(res); setMeState('ready'); })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 403 && err.body?.error === 'client_not_linked') {
          setMeState('not_linked');
        } else {
          setMeState('error');
        }
      });
    return () => { alive = false; };
  }, [isClient, reloadKey]);

  if (authLoading) return <div className="spinner">Carregando…</div>;
  if (!user)                   return <Navigate to="/portal/entrar" replace />;
  if (user.role !== 'client')  return <Navigate to="/" replace />;

  function handleLogout() {
    logout();
    navigate('/portal/entrar');
  }

  const businessName = me?.business.business_name || 'Agendamentos';

  return (
    <div className="portal-shell">
      <header className="portal-topbar">
        <div className="portal-topbar__inner">
          <div className="portal-topbar__brand">
            <span className="portal-topbar__eyebrow">Portal do Cliente</span>
            <span className="portal-topbar__name">{businessName}</span>
          </div>
          <button type="button" className="portal-topbar__logout" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </header>

      <main className="portal-main">
        {meState === 'loading' && <div className="spinner">Carregando…</div>}

        {meState === 'not_linked' && (
          <div className="portal-card">
            <div className="portal-note" role="alert">
              Sua conta não está vinculada a um cadastro. Fale com o profissional.
            </div>
          </div>
        )}

        {meState === 'error' && (
          <div className="portal-card">
            <div className="alert alert-error" role="alert">
              Não foi possível carregar seus dados.
            </div>
            <button type="button" className="portal-btn-ghost" onClick={() => setReloadKey(k => k + 1)}>
              Tentar novamente
            </button>
          </div>
        )}

        {meState === 'ready' && me && <Outlet context={{ me } satisfies PortalOutletContext} />}
      </main>

      <nav className="portal-tabbar" aria-label="Navegação do portal">
        <div className="portal-tabbar__inner">
          {/* "Agendar" só existe quando o tenant permite auto-agendamento —
              antes era uma aba morta com um aviso dentro (fix de auditoria). */}
          {TABS.filter(tab => tab.to !== '/portal/agendar' || me?.business.allow_self_booking).map(tab => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => `portal-tab${isActive ? ' active' : ''}`}
            >
              <TabIcon name={tab.icon} />
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
