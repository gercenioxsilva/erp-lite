import { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { GaxLogo }  from './GaxLogo';
import { useAuth }  from '../contexts/AuthContext';
import { useI18n }  from '../i18n';

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();

  const NAV = [
    { to: '/dashboard',  label: t('nav.dashboard'),  icon: '▦'  },
    { to: '/clients',    label: t('nav.clients'),    icon: '🏢' },
    { to: '/materials',  label: t('nav.materials'),  icon: '⬜' },
    { to: '/stock',      label: t('nav.stock'),      icon: '📦' },
    { to: '/orders',     label: t('nav.orders'),     icon: '📋' },
    { to: '/invoices',   label: t('nav.invoices'),   icon: '🧾' },
    { to: '/receivables',label: t('nav.receivables'),icon: '💰' },
    { to: '/payables',   label: t('nav.payables'),   icon: '💸' },
    { to: '/users',      label: t('nav.users'),      icon: '👥' },
    { to: '/company',    label: t('nav.company'),    icon: '🏛️' },
    { to: '/contracts',  label: t('nav.contracts'),  icon: '📝' },
  ];

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function toggleLang() {
    setLang(lang === 'pt-BR' ? 'en' : 'pt-BR');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <GaxLogo size="sm" variant="full" theme="dark" />
        </div>

        <nav className="sidebar-nav">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'active' : ''}>
              <span style={{ fontSize: 14 }}>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <strong>{user?.name ?? user?.email}</strong>
          <span style={{ display: 'block', fontSize: 11, marginTop: 2 }}>{user?.role}</span>

          <button
            onClick={toggleLang}
            title={lang === 'pt-BR' ? 'Switch to English' : 'Mudar para Português'}
            style={{
              marginTop: 8,
              background: 'none',
              border: '1px solid #334155',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 6,
              width: '100%',
              fontWeight: 600,
              letterSpacing: '.04em',
              transition: 'color .15s, border-color .15s',
            }}
          >
            {t('nav.lang')}
          </button>

          <button
            onClick={handleLogout}
            style={{
              marginTop: 6,
              background: 'none',
              border: '1px solid #334155',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 6,
              width: '100%',
              transition: 'color .15s, border-color .15s',
            }}
          >
            {t('nav.signout')}
          </button>
        </div>
      </aside>

      <div className="main-area">
        <div className="page-content">{children}</div>
      </div>
    </div>
  );
}
