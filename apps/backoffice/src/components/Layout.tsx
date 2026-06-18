import { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const NAV = [
  { to: '/dashboard',  label: 'Dashboard',  icon: '▦' },
  { to: '/materials',  label: 'Materials',  icon: '⬜' },
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
        <div className="sidebar-logo">ERP Lite</div>
        <nav className="sidebar-nav">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'active' : ''}>
              <span>{n.icon}</span> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <strong>{user?.name ?? user?.email}</strong>
          {user?.role}
          <br />
          <button
            onClick={handleLogout}
            style={{ marginTop: 8, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, padding: 0 }}
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
