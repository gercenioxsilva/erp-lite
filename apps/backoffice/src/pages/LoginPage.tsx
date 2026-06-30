import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { GaxLogo } from '../components/GaxLogo';
import { AuthHero } from '../components/AuthHero';
import { useAuth }  from '../contexts/AuthContext';
import { useI18n }  from '../i18n';
import { ApiError } from '../lib/api';

export function LoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const { login }  = useAuth();
  const navigate   = useNavigate();
  const { t }      = useI18n();

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
      <AuthHero />

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

            <div style={{ textAlign: 'right', marginBottom: 8 }}>
              <Link to="/forgot-password" style={{ fontSize: 13, color: 'var(--muted)' }}>
                {t('l.forgotPassword')}
              </Link>
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
