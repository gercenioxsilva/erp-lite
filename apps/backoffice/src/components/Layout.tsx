import { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { GaxLogo } from './GaxLogo';
import { useAuth }  from '../contexts/AuthContext';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/clients',   label: 'Clients',   icon: '🏢' },
  { to: '/materials', label: 'Materials', icon: '⬜' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
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
            onClick={handleLogout}
            style={{
              marginTop: 10,
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
            Sign out
          </button>
        </div>
      </aside>

      <div className="main-area">
        <div className="page-content">{children}</div>
      </div>
    </div>
  );
}
