import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { GaxLogo }  from '../../components/GaxLogo';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';

// Shell minimalista do portal do técnico — de propósito SEM o menu lateral
// completo do backoffice (regra de segurança: role='technician' só deveria
// ver este espaço, o layout reflete isso visualmente também).
export function TechnicianLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/tecnico/entrar');
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper-2, #F6F8FC)' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', background: '#fff', borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <GaxLogo size="sm" variant="full" theme="light" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{user?.name}</span>
          <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={handleLogout}>
            {t('tp.logout')}
          </button>
        </div>
      </header>
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 60px' }}>
        {children}
      </main>
    </div>
  );
}
