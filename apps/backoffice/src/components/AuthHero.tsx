import { GaxLogo } from './GaxLogo';
import { useI18n } from '../i18n';

const FEATURES_PT = [
  'Controle de estoque e inventário em tempo real',
  'Emissão de NF-e para clientes PJ e PF (SEFAZ)',
  'Multi-tenant com controle de acesso por perfil',
  'Gestão financeira integrada',
];

const FEATURES_EN = [
  'Real-time inventory & stock control',
  'NF-e emission for PJ & PF clients (SEFAZ)',
  'Multi-tenant with role-based access',
  'Integrated financial management',
];

const METRICS_PT = [
  { label: 'Receita no Mês',     value: 'R$ 245.8k', trend: '↑ 18,4%',          cls: 'up'   },
  { label: 'Clientes Ativos',    value: '142',       trend: '+12 este mês',      cls: 'up'   },
  { label: 'Alertas de Estoque', value: '4 itens',   trend: '⚠ Precisa revisar', cls: 'warn' },
];

const METRICS_EN = [
  { label: 'Revenue MTD',    value: 'R$ 245.8k', trend: '↑ 18.4%',        cls: 'up'   },
  { label: 'Active Clients', value: '142',       trend: '+12 this mo.',    cls: 'up'   },
  { label: 'Stock Alerts',   value: '4 items',   trend: '⚠ Needs review',  cls: 'warn' },
];

/**
 * Branded left-hand hero for the auth surface (login, forgot, reset).
 * Hidden below 960px via the `.ls-hero` rule. Purely presentational —
 * keeping it shared makes the whole auth flow one continuous surface.
 */
export function AuthHero() {
  const { lang } = useI18n();
  const features = lang === 'pt-BR' ? FEATURES_PT : FEATURES_EN;
  const metrics  = lang === 'pt-BR' ? METRICS_PT  : METRICS_EN;

  return (
    <section className="ls-hero" aria-hidden="true">
      <div className="ls-orb ls-orb-1" />
      <div className="ls-orb ls-orb-2" />
      <div className="ls-orb ls-orb-3" />
      <div className="ls-dots" />
      <div className="ls-top-line" />

      <div className="ls-hero-body">
        <div className="ls-hero-logo">
          <GaxLogo size="xxl" variant="full" theme="dark" />
        </div>

        <h1 className="ls-headline">
          {lang === 'pt-BR'
            ? <>Gerencie todo seu negócio<br />com muito mais <span className="ls-grad-text">inteligência</span></>
            : <>Manage your entire<br />business <span className="ls-grad-text">smarter</span></>}
        </h1>

        <p className="ls-subline">
          {lang === 'pt-BR'
            ? 'Uma plataforma ERP SaaS completa para controlar estoque, gerenciar clientes, finanças e emitir NF-e — tudo em um só lugar.'
            : 'A complete multi-tenant ERP platform to control inventory, manage clients, handle finances and issue NF-e — all in one place.'}
        </p>

        <ul className="ls-features">
          {features.map(f => (
            <li key={f}>
              <span className="ls-check" aria-hidden="true">✓</span>
              {f}
            </li>
          ))}
        </ul>

        <div className="ls-metrics">
          {metrics.map(m => (
            <div key={m.label} className="ls-kpi">
              <span className="ls-kpi-label">{m.label}</span>
              <span className="ls-kpi-value">{m.value}</span>
              <span className={`ls-kpi-trend ${m.cls}`}>{m.trend}</span>
            </div>
          ))}
        </div>

        <div className="ls-social-proof">
          <div className="ls-avatars">
            {['#6366f1','#06b6d4','#8b5cf6','#ec4899'].map((c, i) => (
              <span key={i} className="ls-avatar" style={{ background: c, zIndex: 4 - i }} />
            ))}
          </div>
          <span>
            {lang === 'pt-BR'
              ? <>Confiado por <strong>500+</strong> empresas no Brasil</>
              : <>Trusted by <strong>500+</strong> companies across Brazil</>}
          </span>
        </div>
      </div>
    </section>
  );
}
