import { useState, FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { GaxLogo } from '../../components/GaxLogo';
import { AuthHero } from '../../components/AuthHero';
import { useI18n } from '../../i18n';
import { api, ApiError } from '../../lib/api';

export function ResetPasswordPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [done,      setDone]      = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError(t('rp.mismatch'));
    if (password.length < 6)  return setError(t('rp.tooShort'));
    setLoading(true);
    try {
      await api.post('/v1/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('rp.error'));
    } finally {
      setLoading(false);
    }
  }

  if (!token) return (
    <div className="ls-shell">
      <AuthHero />
      <section className="ls-form-panel">
        <div className="ls-form-body" style={{ textAlign: 'center' }}>
          <div className="ls-form-logo">
            <GaxLogo size="xl" variant="full" theme="light" />
          </div>
          <p style={{ color: 'var(--muted)', marginBottom: 16 }}>{t('rp.invalidLink')}</p>
          <Link to="/login" className="btn btn-primary ls-submit">{t('fp.backLogin')}</Link>
        </div>
      </section>
    </div>
  );

  return (
    <div className="ls-shell">
      <AuthHero />

      <section className="ls-form-panel">
        <div className="ls-form-body">
          <div className="ls-form-logo">
            <GaxLogo size="xl" variant="full" theme="light" />
          </div>

          {done ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }} aria-hidden="true">✅</div>
              <div className="ls-form-heading">
                <h2>{t('rp.doneTitle')}</h2>
                <p>{t('rp.doneMsg')}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="ls-form-heading">
                <h2>{t('rp.title')}</h2>
              </div>

              {error && <div className="alert alert-error" role="alert">{error}</div>}

              <form onSubmit={handleSubmit} noValidate>
                <div className="field">
                  <label htmlFor="rp-new">{t('rp.newPassword')}</label>
                  <input
                    id="rp-new"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="mínimo 6 caracteres"
                    required
                    minLength={6}
                    autoFocus
                    autoComplete="new-password"
                  />
                </div>
                <div className="field">
                  <label htmlFor="rp-confirm">{t('rp.confirmPassword')}</label>
                  <input
                    id="rp-confirm"
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="repita a nova senha"
                    required
                    autoComplete="new-password"
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary ls-submit"
                  disabled={loading}
                >
                  {loading ? t('c.loading') : t('rp.save')}
                </button>
              </form>

              <p className="ls-register-link">
                <Link to="/login">{t('fp.backLogin')}</Link>
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
