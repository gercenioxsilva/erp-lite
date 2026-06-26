import { useState, FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { GaxLogo } from '../../components/GaxLogo';
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
    <div className="ls-shell" style={{ justifyContent: 'center' }}>
      <div className="ls-form-panel" style={{ textAlign: 'center' }}>
        <p>{t('rp.invalidLink')}</p>
        <Link to="/login">{t('fp.backLogin')}</Link>
      </div>
    </div>
  );

  return (
    <div className="ls-shell" style={{ justifyContent: 'center' }}>
      <div className="ls-form-panel" style={{ maxWidth: 420, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <GaxLogo size="xl" variant="full" theme="light" />
        </div>
        {done ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2>{t('rp.doneTitle')}</h2>
            <p style={{ color: 'var(--muted)' }}>{t('rp.doneMsg')}</p>
          </div>
        ) : (
          <>
            <h2 style={{ margin: '0 0 8px' }}>{t('rp.title')}</h2>
            {error && <div role="alert" className="form-error">{error}</div>}
            <form onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label>{t('rp.newPassword')}</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="mínimo 6 caracteres" required minLength={6} autoFocus />
              </div>
              <div className="form-group">
                <label>{t('rp.confirmPassword')}</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  placeholder="repita a nova senha" required />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 16 }}
                disabled={loading}>{loading ? t('c.loading') : t('rp.save')}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
