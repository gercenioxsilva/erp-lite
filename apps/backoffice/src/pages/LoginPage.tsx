import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GaxLogo } from '../components/GaxLogo';
import { useAuth }  from '../contexts/AuthContext';

/* ── Feature list shown in the hero panel ────────────────────────────────── */
const FEATURES = [
  'Real-time inventory & stock control',
  'NF-e emission for PJ & PF clients (SEFAZ)',
  'Multi-tenant with role-based access',
  'Integrated financial management',
];

/* ── Mock KPI cards that preview the product ─────────────────────────────── */
const METRICS = [
  { label: 'Revenue MTD',    value: 'R$ 245.8k', trend: '↑ 18.4%',     cls: 'up'   },
  { label: 'Active Clients', value: '142',        trend: '+12 this mo.',  cls: 'up'   },
  { label: 'Stock Alerts',   value: '4 items',    trend: '⚠ Needs review', cls: 'warn' },
];

export function LoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const { login } = useAuth();
  const navigate  = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ls-shell">

      {/* ══════════════════════════════════════════════════════════════════
          LEFT — Hero panel  (hidden below 960 px)
      ══════════════════════════════════════════════════════════════════ */}
      <section className="ls-hero" aria-hidden="true">

        {/* Animated gradient orbs */}
        <div className="ls-orb ls-orb-1" />
        <div className="ls-orb ls-orb-2" />
        <div className="ls-orb ls-orb-3" />

        {/* Dot-grid overlay sits on top of orbs, below content */}
        <div className="ls-dots" />

        {/* Decorative top-edge glow line */}
        <div className="ls-top-line" />

        <div className="ls-hero-body">

          {/* Brand */}
          <div className="ls-hero-logo">
            <GaxLogo size="md" variant="full" theme="dark" />
          </div>

          {/* Headline */}
          <h1 className="ls-headline">
            Manage your entire<br />
            business{' '}
            <span className="ls-grad-text">smarter</span>
          </h1>

          <p className="ls-subline">
            A complete multi-tenant ERP platform to control inventory,
            manage clients, handle finances and issue NF-e — all in one place.
          </p>

          {/* Feature checklist */}
          <ul className="ls-features">
            {FEATURES.map(f => (
              <li key={f}>
                <span className="ls-check" aria-hidden="true">✓</span>
                {f}
              </li>
            ))}
          </ul>

          {/* KPI preview cards */}
          <div className="ls-metrics">
            {METRICS.map(m => (
              <div key={m.label} className="ls-kpi">
                <span className="ls-kpi-label">{m.label}</span>
                <span className="ls-kpi-value">{m.value}</span>
                <span className={`ls-kpi-trend ${m.cls}`}>{m.trend}</span>
              </div>
            ))}
          </div>

          {/* Social proof */}
          <div className="ls-social-proof">
            <div className="ls-avatars">
              {['#6366f1','#06b6d4','#8b5cf6','#ec4899'].map((c, i) => (
                <span key={i} className="ls-avatar" style={{ background: c, zIndex: 4 - i }} />
              ))}
            </div>
            <span>Trusted by <strong>500+</strong> companies across Brazil</span>
          </div>

        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          RIGHT — Login form panel
      ══════════════════════════════════════════════════════════════════ */}
      <section className="ls-form-panel">
        <div className="ls-form-body">

          {/* Logo — shown here on mobile (hero is hidden) */}
          <div className="ls-form-logo">
            <GaxLogo size="lg" variant="full" theme="light" />
          </div>

          <div className="ls-form-heading">
            <h2>Welcome back</h2>
            <p>Sign in to continue to GAX ERP</p>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">{error}</div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="lf-email">Email</label>
              <input
                id="lf-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoFocus
                autoComplete="username"
              />
            </div>

            <div className="field">
              <label htmlFor="lf-password">Password</label>
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
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                >
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary ls-submit"
              disabled={loading}
            >
              {loading
                ? <><SpinIcon /> Signing in…</>
                : 'Sign in'}
            </button>
          </form>

          <p className="ls-register-link">
            No account yet?{' '}
            <Link to="/register">Create your company →</Link>
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
