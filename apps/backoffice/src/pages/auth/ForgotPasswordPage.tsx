import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { GaxLogo } from '../../components/GaxLogo';
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
    <div className="ls-shell" style={{ justifyContent: 'center' }}>
      <div className="ls-form-panel" style={{ maxWidth: 420, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <GaxLogo size="xl" variant="full" theme="light" />
        </div>
        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✉️</div>
            <h2 style={{ margin: '0 0 8px' }}>{t('fp.sentTitle')}</h2>
            <p style={{ color: 'var(--muted)', marginBottom: 24 }}>{t('fp.sentMsg')}</p>
            <Link to="/login" className="btn btn-primary" style={{ display: 'inline-block' }}>{t('fp.backLogin')}</Link>
          </div>
        ) : (
          <>
            <h2 style={{ margin: '0 0 8px' }}>{t('fp.title')}</h2>
            <p style={{ color: 'var(--muted)', marginBottom: 24 }}>{t('fp.subtitle')}</p>
            {error && <div role="alert" className="form-error">{error}</div>}
            <form onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label>{t('fp.email')}</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com" required autoFocus />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 16 }}
                disabled={loading}>{loading ? t('c.loading') : t('fp.send')}</button>
            </form>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Link to="/login" style={{ color: 'var(--muted)', fontSize: 14 }}>{t('fp.backLogin')}</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
