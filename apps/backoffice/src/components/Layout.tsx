import { ReactNode, useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import { GaxLogo }  from './GaxLogo';
import { useAuth }  from '../contexts/AuthContext';
import { useI18n }  from '../i18n';
import { api }      from '../lib/api';
import { useSubscription } from '../hooks/useSubscription';

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
function IcoStock() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l4-4 3 3 5-7"/><circle cx="15" cy="5" r="1.5"/>
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
function IcoCompany() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 16V6l7-4 7 4v10H2z"/><path d="M7 16v-5h4v5"/>
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
function IcoPDV() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="14" height="10" rx="1.5"/>
      <path d="M5 6V4a4 4 0 018 0v2"/>
      <path d="M6 11h6M9 9v4"/>
    </svg>
  );
}

function IcoField() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 2.5a3 3 0 0 0-4 4L2 12l2 2 5.5-5.5a3 3 0 0 0 4-4L11 7l-2-2 2.5-2.5Z"/>
    </svg>
  );
}

function IcoReports() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 15h14"/><path d="M5 15V9M9 15V4M13 15v-4"/>
    </svg>
  );
}

function IcoHr() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="5.5" r="2.5"/><path d="M3.5 15c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>
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

/* ── Modelo de navegação: folha (link) OU grupo colapsável ──────────────── */
// `resource` é opcional — quando presente, o item só aparece se
// can(resource, 'view') for true (Perfil de Acesso/RBAC). Item sem
// `resource` sempre aparece pra qualquer usuário autenticado (mesmo
// espírito de enabledModules: isto é só UX, o controle de verdade é sempre
// requirePermission() no backend).
interface NavChild { to: string; label: string; end?: boolean; resource?: string }
interface NavLeaf  { to: string; label: string; icon: IconFC; end?: boolean; resource?: string }
interface NavGroupDef { id: string; label: string; icon: IconFC; children: NavChild[] }
type NavEntry = NavLeaf | NavGroupDef;
const isGroup = (e: NavEntry): e is NavGroupDef => 'children' in e;

/* Grupo colapsável reutilizável — generaliza o antigo bloco PDV (usado por
   todos os grupos, inclusive o próprio PDV). */
function NavGroup({ group, open, active, onToggle, closeMenu }: {
  group: NavGroupDef; open: boolean; active: boolean; onToggle: () => void; closeMenu: () => void;
}) {
  const Icon = group.icon;
  return (
    <>
      <button onClick={onToggle} className={`nav-group${active ? ' active' : ''}`}>
        <span className="nav-icon"><Icon /></span>
        <span style={{ flex: 1, textAlign: 'left' }}>{group.label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
             stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
             style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 180ms ease', opacity: 0.5, flexShrink: 0 }}>
          <path d="M2 4l4 4 4-4"/>
        </svg>
      </button>
      {open && (
        <div className="nav-sub">
          {group.children.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} onClick={closeMenu}
                     className={({ isActive }) => isActive ? 'active' : ''}>
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </>
  );
}

function TrialBanner({ daysLeft }: { daysLeft: number }) {
  const { t } = useI18n();
  return (
    <div style={{
      background: daysLeft <= 3 ? '#fef2f2' : '#fffbeb',
      borderBottom: `1px solid ${daysLeft <= 3 ? '#fca5a5' : '#fcd34d'}`,
      padding: '8px 20px',
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    }}>
      <span style={{ color: daysLeft <= 3 ? '#dc2626' : '#b45309', fontWeight: 500 }}>
        {t('billing.trialBanner').replace('{n}', String(daysLeft))}
      </span>
      <Link to="/billing" style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 13 }}>
        {t('billing.choosePlan')} →
      </Link>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout, can } = useAuth();
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [enabledModules, setEnabledModules] = useState<string[]>([]);

  const { data: subscription } = useSubscription();
  const trialDaysLeft =
    subscription?.stripe_enabled && subscription.status === 'trial' && subscription.days_left !== null
      ? subscription.days_left
      : null;

  // Item com `resource` só aparece se can(resource, 'view'). owner sempre
  // tem can()===true pra tudo (bypass já resolvido no backend) — este
  // filtro nunca restringe o próprio owner.
  const visible = (item: NavChild) => !item.resource || can(item.resource, 'view');

  // Devolve 0 ou 1 grupo já filtrado — grupo sem nenhum filho visível some
  // inteiro do menu (nunca aparece uma seta que abre uma lista vazia).
  function group(id: string, label: string, icon: IconFC, children: NavChild[]): NavGroupDef[] {
    const filtered = children.filter(visible);
    return filtered.length ? [{ id, label, icon, children: filtered }] : [];
  }

  const NAV: NavEntry[] = [
    { to: '/dashboard', label: t('nav.dashboard'), icon: IcoDashboard },
    ...group('commercial', t('nav.group.commercial'), IcoProposals, [
      ...(enabledModules.includes('sales_pipeline') ? [{ to: '/sales-pipeline', label: t('nav.salesPipeline'), resource: 'sales_pipeline' }] : []),
      { to: '/proposals', label: t('nav.proposals'), resource: 'proposals' },
      { to: '/orders',    label: t('nav.orders'),    resource: 'orders'    },
      { to: '/invoices',  label: t('nav.invoices'),  resource: 'invoices'  },
      { to: '/nfse',      label: t('nav.nfse'),      resource: 'nfse'      },
      { to: '/simples-remessa', label: t('nav.simplesRemessa'), resource: 'simples_remessa' },
    ]),
    ...(enabledModules.includes('service_orders') ? group('fieldService', t('nav.group.fieldService'), IcoField, [
      { to: '/service-orders', label: t('nav.serviceOrders'), resource: 'service_orders' },
      { to: '/technicians',    label: t('nav.technicians'),   resource: 'technicians'    },
    ]) : []),
    ...(enabledModules.includes('pos') ? group('pos', t('nav.pos'), IcoPDV, [
      { to: '/pos/caixa',     label: 'Caixa',           resource: 'pos' },
      { to: '/pos',           label: 'Venda', end: true, resource: 'pos' },
      { to: '/pos/sales',     label: 'Histórico',       resource: 'pos' },
      { to: '/pos/terminals', label: 'Terminais',       resource: 'pos' },
      { to: '/pos/sessions',  label: 'Sessões',         resource: 'pos' },
    ]) : []),
    ...(enabledModules.includes('hr') ? group('hr', t('nav.group.hr'), IcoHr, [
      { to: '/employees', label: t('nav.employees'), resource: 'employees' },
      { to: '/payroll',   label: t('nav.payroll'),   resource: 'payroll'   },
    ]) : []),
    ...group('inventory', t('nav.group.inventory'), IcoStock, [
      { to: '/materials',         label: t('nav.materials'),        resource: 'materials'        },
      { to: '/stock',             label: t('nav.stock'),            resource: 'stock'             },
      { to: '/suppliers',         label: t('nav.suppliers'),        resource: 'suppliers'        },
      { to: '/purchase-orders',   label: t('nav.purchaseOrders'),   resource: 'purchase_orders'   },
      { to: '/supplier-invoices', label: t('nav.supplierInvoices'), resource: 'supplier_invoices' },
    ]),
    ...group('finance', t('nav.group.finance'), IcoReceivables, [
      { to: '/receivables',  label: t('nav.receivables'), resource: 'receivables'  },
      { to: '/payables',     label: t('nav.payables'),    resource: 'payables'     },
      { to: '/cost-centers', label: t('nav.costCenters'), resource: 'cost_centers' },
      { to: '/sellers',      label: t('nav.sellers'),     resource: 'sellers'      },
    ]),
    ...group('reports', t('nav.reports'), IcoReports, [
      { to: '/reports',              label: 'Visão geral', end: true, resource: 'reports' },
      { to: '/reports/cashflow',     label: 'Fluxo de Caixa', resource: 'reports' },
      { to: '/reports/aging',        label: 'Aging',          resource: 'reports' },
      { to: '/reports/expenses',     label: 'Despesas',       resource: 'reports' },
      { to: '/dre',                  label: t('nav.dre'),     resource: 'dre'     },
      { to: '/reports/overdue',      label: 'Inadimplência',  resource: 'reports' },
      ...(enabledModules.includes('pos') ? [{ to: '/reports/pos-cash', label: 'Caixa PDV', resource: 'reports' }] : []),
      { to: '/reports/sales',              label: 'Faturamento',          resource: 'reports' },
      { to: '/reports/top-products',       label: 'Ranking de Produtos',  resource: 'reports' },
      { to: '/reports/proposals-funnel',   label: 'Funil de Propostas',   resource: 'reports' },
      { to: '/reports/commissions',        label: 'Comissões',            resource: 'reports' },
      ...(enabledModules.includes('pos') ? [{ to: '/reports/pos-payments', label: 'Formas de Pagamento (PDV)', resource: 'reports' }] : []),
      { to: '/reports/stock-position',     label: 'Posição de Estoque',   resource: 'reports' },
      { to: '/reports/abc',                label: 'Curva ABC',            resource: 'reports' },
      { to: '/reports/kardex',             label: 'Kardex',               resource: 'reports' },
      ...(enabledModules.includes('service_orders') ? [{ to: '/reports/technician-productivity', label: 'Produtividade Técnicos', resource: 'reports' }] : []),
      { to: '/reports/recurring-revenue',  label: 'Receita Recorrente',   resource: 'reports' },
      { to: '/reports/supplier-spend',     label: 'Gasto por Fornecedor', resource: 'reports' },
      { to: '/reports/tax-summary',        label: 'Apuração de Impostos', resource: 'reports' },
    ]),
    ...group('registrations', t('nav.group.registrations'), IcoClients, [
      { to: '/clients',   label: t('nav.clients'),   resource: 'clients'   },
      { to: '/contracts', label: t('nav.contracts'), resource: 'contracts' },
    ]),
    ...group('admin', t('nav.group.admin'), IcoCompany, [
      { to: '/users',   label: t('nav.users'),   resource: 'users'   },
      ...(user?.role === 'owner' ? [{ to: '/access-profiles', label: t('nav.accessProfiles') }] : []),
      { to: '/company', label: t('nav.company'), resource: 'company' },
      { to: '/billing', label: t('nav.billing'), resource: 'billing' },
    ]),
  ];

  const isChildActive = (c: NavChild) =>
    c.end ? location.pathname === c.to : location.pathname.startsWith(c.to);
  const isGroupActive = (g: NavGroupDef) => g.children.some(isChildActive);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    NAV.forEach(e => { if (isGroup(e) && isGroupActive(e)) o[e.id] = true; });
    return o;
  });

  // Abre automaticamente o grupo da rota atual (sem fechar os demais).
  useEffect(() => {
    NAV.forEach(e => {
      if (isGroup(e) && isGroupActive(e)) {
        setOpenGroups(prev => (prev[e.id] ? prev : { ...prev, [e.id]: true }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Item de menu de módulo opcional só aparece se o tenant tiver habilitado —
  // backend (requireModule) é a autoridade de verdade; isto é só conveniência de UX.
  useEffect(() => {
    api.get<{ available: string[]; enabled: string[] }>('/v1/tenant/modules')
      .then(data => setEnabledModules(data.enabled ?? []))
      .catch(() => {});
  }, []);

  function closeMenu() {
    setIsMenuOpen(false);
  }

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
          {NAV.map(entry => {
            if (isGroup(entry)) {
              return (
                <NavGroup
                  key={entry.id}
                  group={entry}
                  open={!!openGroups[entry.id]}
                  active={isGroupActive(entry)}
                  onToggle={() => setOpenGroups(p => ({ ...p, [entry.id]: !p[entry.id] }))}
                  closeMenu={closeMenu}
                />
              );
            }
            const Icon = entry.icon;
            return (
              <NavLink
                key={entry.to}
                to={entry.to}
                end={entry.end}
                onClick={closeMenu}
                className={({ isActive }) => isActive ? 'active' : ''}
              >
                <span className="nav-icon"><Icon /></span>
                {entry.label}
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
        {trialDaysLeft !== null && <TrialBanner daysLeft={trialDaysLeft} />}
        <div className="page-content">{children}</div>
      </div>
    </div>
  );
}
