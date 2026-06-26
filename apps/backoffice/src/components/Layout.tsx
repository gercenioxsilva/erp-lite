import { ReactNode, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { GaxLogo }  from './GaxLogo';
import { useAuth }  from '../contexts/AuthContext';
import { useI18n }  from '../i18n';

function IcoDashboard() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="6" height="6" rx="1.5"/><rect x="10" y="2" width="6" height="6" rx="1.5"/>
      <rect x="2" y="10" width="6" height="6" rx="1.5"/><rect x="10" y="10" width="6" height="6" rx="1.5"/>
    </svg>
  );
}
function IcoClients() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="14" height="12" rx="2"/><path d="M6 7h6M6 10h4"/>
    </svg>
  );
}
function IcoMaterials() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2L16 5.5v7L9 16 2 12.5v-7L9 2z"/><path d="M9 2v14M2 5.5l7 3.5 7-3.5"/>
    </svg>
  );
}
function IcoStock() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l4-4 3 3 5-7"/><circle cx="15" cy="5" r="1.5"/>
    </svg>
  );
}
function IcoOrders() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2h8l2 4H3L5 2z"/><rect x="2" y="6" width="14" height="10" rx="1.5"/><path d="M6 10h6M6 13h4"/>
    </svg>
  );
}
function IcoInvoices() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2" width="12" height="14" rx="1.5"/><path d="M6 6h6M6 9h6M6 12h4"/>
    </svg>
  );
}
function IcoReceivables() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="7"/><path d="M9 6v6M6.5 8.5l2.5-2.5 2.5 2.5"/>
    </svg>
  );
}
function IcoPayables() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="14" height="10" rx="1.5"/><path d="M5 5V3h8v2M6 10h6"/>
    </svg>
  );
}
function IcoUsers() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="6" r="3"/><path d="M1 16c0-3.3 2.7-6 6-6"/><circle cx="14" cy="10" r="2.5"/><path d="M11 16c0-1.7 1.3-3 3-3s3 1.3 3 3"/>
    </svg>
  );
}
function IcoCompany() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 16V6l7-4 7 4v10H2z"/><path d="M7 16v-5h4v5"/>
    </svg>
  );
}
function IcoContracts() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2" width="12" height="14" rx="1.5"/><path d="M6 6h6M6 9h4"/><path d="M10 12l2 2 3-3"/>
    </svg>
  );
}

function IcoNfse() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2" width="12" height="14" rx="1.5"/><path d="M6 6h6M6 9h6"/><path d="M6 12h2"/><circle cx="13" cy="13" r="2.2"/>
    </svg>
  );
}
function IcoProposals() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="14" height="14" rx="2"/><path d="M5 6h8M5 9h8M5 12h4"/><path d="M12 11l2 2 3-3"/>
    </svg>
  );
}
function IcoSuppliers() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 14V6l5-4 5 4v8H2z"/><path d="M12 6h4v8h-4"/><path d="M6 14v-3h2v3"/>
    </svg>
  );
}

function IcoMenu() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3 5h12M3 9h12M3 13h12"/>
    </svg>
  );
}

type IconFC = () => JSX.Element;
const NAV_ICONS: Record<string, IconFC> = {
  '/dashboard':   IcoDashboard,
  '/clients':     IcoClients,
  '/materials':   IcoMaterials,
  '/stock':       IcoStock,
  '/orders':      IcoOrders,
  '/invoices':    IcoInvoices,
  '/receivables': IcoReceivables,
  '/suppliers':   IcoSuppliers,
  '/payables':    IcoPayables,
  '/users':       IcoUsers,
  '/company':     IcoCompany,
  '/contracts':   IcoContracts,
  '/nfse':        IcoNfse,
  '/proposals':   IcoProposals,
};

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  function closeMenu() {
    setIsMenuOpen(false);
  }

  const NAV = [
    { to: '/dashboard',   label: t('nav.dashboard')   },
    { to: '/clients',     label: t('nav.clients')     },
    { to: '/materials',   label: t('nav.materials')   },
    { to: '/stock',       label: t('nav.stock')       },
    { to: '/orders',      label: t('nav.orders')      },
    { to: '/proposals',   label: t('nav.proposals')   },
    { to: '/invoices',    label: t('nav.invoices')    },
    { to: '/receivables', label: t('nav.receivables') },
    { to: '/suppliers',   label: t('nav.suppliers')   },
    { to: '/payables',    label: t('nav.payables')    },
    { to: '/contracts',   label: t('nav.contracts')   },
    { to: '/nfse',        label: t('nav.nfse')        },
    { to: '/users',       label: t('nav.users')       },
    { to: '/company',     label: t('nav.company')     },
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
      {isMenuOpen && <div className="sidebar-backdrop" onClick={closeMenu} />}

      <aside className={`sidebar${isMenuOpen ? ' is-open' : ''}`}>
        <div className="sidebar-logo">
          <GaxLogo size="sm" variant="full" theme="dark" />
        </div>

        <nav className="sidebar-nav">
          {NAV.map(n => {
            const Icon = NAV_ICONS[n.to];
            return (
              <NavLink
                key={n.to}
                to={n.to}
                onClick={closeMenu}
                className={({ isActive }) => isActive ? 'active' : ''}
              >
                <span className="nav-icon">{Icon && <Icon />}</span>
                {n.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <strong>{user?.name ?? user?.email}</strong>
          <span className="footer-role">{user?.role}</span>

          <button
            className="sidebar-footer-btn"
            onClick={toggleLang}
            title={lang === 'pt-BR' ? 'Switch to English' : 'Mudar para Português'}
          >
            {t('nav.lang')}
          </button>

          <button className="sidebar-footer-btn" onClick={handleLogout}>
            {t('nav.signout')}
          </button>
        </div>
      </aside>

      <div className="main-area">
        <div className="mobile-topbar">
          <button
            className="menu-toggle"
            onClick={() => setIsMenuOpen(v => !v)}
            aria-label={t('nav.menu')}
            aria-expanded={isMenuOpen}
          >
            <IcoMenu />
          </button>
          <GaxLogo size="sm" variant="full" theme="light" />
        </div>
        <div className="page-content">{children}</div>
      </div>
    </div>
  );
}
