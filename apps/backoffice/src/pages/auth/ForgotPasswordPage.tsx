import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { GaxLogo } from '../../components/GaxLogo';
import { AuthHero } from '../../components/AuthHero';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email,   setEmail]   = useState('');
  const [sent,    setSent]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await api.post('/v1/auth/forgot-password', { email });
      setSent(true);
    } catch {
      setError(t('fp.error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ls-shell">
      <AuthHero />

      <section className="ls-form-panel">
        <div className="ls-form-body">
          <div className="ls-form-logo">
            <GaxLogo size="xl" variant="full" theme="light" />
          </div>

          {sent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }} aria-hidden="true">✉️</div>
              <div className="ls-form-heading">
                <h2>{t('fp.sentTitle')}</h2>
                <p>{t('fp.sentMsg')}</p>
              </div>
              <Link to="/login" className="btn btn-primary ls-submit" style={{ marginTop: 8 }}>
                {t('fp.backLogin')}
              </Link>
            </div>
          ) : (
            <>
              <div className="ls-form-heading">
                <h2>{t('fp.title')}</h2>
                <p>{t('fp.subtitle')}</p>
              </div>

              {error && <div className="alert alert-error" role="alert">{error}</div>}

              <form onSubmit={handleSubmit} noValidate>
                <div className="field">
                  <label htmlFor="fp-email">{t('fp.email')}</label>
                  <input
                    id="fp-email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    required
                    autoFocus
                    autoComplete="username"
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary ls-submit"
                  disabled={loading}
                >
                  {loading ? t('c.loading') : t('fp.send')}
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
