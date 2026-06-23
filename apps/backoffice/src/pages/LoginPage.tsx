import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GaxLogo } from '../components/GaxLogo';
import { useAuth }  from '../contexts/AuthContext';
import { useI18n }  from '../i18n';
import { ApiError } from '../lib/api';

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
  { label: 'Receita no Mês',    value: 'R$ 245.8k', trend: '↑ 18,4%',         cls: 'up'   },
  { label: 'Clientes Ativos',   value: '142',        trend: '+12 este mês',     cls: 'up'   },
  { label: 'Alertas de Estoque',value: '4 itens',    trend: '⚠ Precisa revisar', cls: 'warn' },
];

const METRICS_EN = [
  { label: 'Revenue MTD',    value: 'R$ 245.8k', trend: '↑ 18.4%',     cls: 'up'   },
  { label: 'Active Clients', value: '142',        trend: '+12 this mo.', cls: 'up'   },
  { label: 'Stock Alerts',   value: '4 items',    trend: '⚠ Needs review', cls: 'warn' },
];

export function LoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const { login }  = useAuth();
  const navigate   = useNavigate();
  const { t, lang }= useI18n();

  const features = lang === 'pt-BR' ? FEATURES_PT : FEATURES_EN;
  const metrics  = lang === 'pt-BR' ? METRICS_PT  : METRICS_EN;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 0) {
        setError(t('l.errNetwork'));
      } else if (err instanceof ApiError && err.status >= 500) {
        setError(t('l.errServer'));
      } else {
        setError(t('l.errCreds'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ls-shell">

      {/* ══ LEFT — Hero panel (hidden < 960 px) ════════════════════════ */}
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

      {/* ══ RIGHT — Form panel ════════════════════════════════════════ */}
      <section className="ls-form-panel">
        <div className="ls-form-body">
          <div className="ls-form-logo">
            <GaxLogo size="xl" variant="full" theme="light" />
          </div>

          <div className="ls-form-heading">
            <h2>{t('l.welcome')}</h2>
            <p>{t('l.subtitle')}</p>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">{error}</div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="lf-email">{t('l.email')}</label>
              <input
                id="lf-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
                required
                autoFocus
                autoComplete="username"
              />
            </div>

            <div className="field">
              <label htmlFor="lf-password">{t('l.password')}</label>
              <div className="pwd-wrap">
                <input
                  id="lf-password"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="pwd-toggle"
                  onClick={() => setShowPwd(s => !s)}
                  tabIndex={-1}
                  aria-label={showPwd ? t('l.hide') : t('l.show')}
                >
                  {showPwd ? t('l.hide') : t('l.show')}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary ls-submit"
              disabled={loading}
            >
              {loading ? <><SpinIcon /> {t('l.loading')}</> : t('l.submit')}
            </button>
          </form>

          <p className="ls-register-link">
            {t('l.noAccount')}{' '}
            <Link to="/register">{t('l.register')}</Link>
          </p>
        </div>
      </section>
    </div>
  );
}

function SpinIcon() {
  return (
    <svg
      width="15" height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      style={{ animation: 'ls-spin .75s linear infinite', flexShrink: 0 }}
    >
      <path
        d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
        strokeLinecap="round"
      />
    </svg>
  );
}
