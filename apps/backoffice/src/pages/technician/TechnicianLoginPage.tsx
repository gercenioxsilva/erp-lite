import { useState, FormEvent, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GaxLogo } from '../../components/GaxLogo';
import { AuthHero } from '../../components/AuthHero';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { ApiError } from '../../lib/api';

// Rota de ENTRADA do técnico — o link do e-mail de agendamento aponta para cá
// com ?redirect=/tecnico/visitas/:id. O link em si não concede acesso a nada:
// é só roteamento. O login aqui reaproveita o mesmo POST /v1/auth/login já
// usado pelo backoffice — a diferença é o destino pós-login.
export function TechnicianLoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const { t }    = useI18n();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/tecnico/visitas';

  useEffect(() => {
    if (user?.role === 'technician') navigate(redirect, { replace: true });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await login(email, password);
      navigate(redirect, { replace: true });
    } catch (err: unknown) {
      setError(err instanceof ApiError && err.status === 0 ? t('l.errNetwork') : t('l.errCreds'));
    } finally { setLoading(false); }
  }

  return (
    <div className="ls-shell">
      <AuthHero />
      <section className="ls-form-panel">
        <div className="ls-form-body">
          <div className="ls-form-logo"><GaxLogo size="xl" variant="full" theme="light" /></div>
          <div className="ls-form-heading">
            <h2>{t('tp.loginTitle')}</h2>
            <p>{t('tp.loginSubtitle')}</p>
          </div>

          {error && <div className="alert alert-error" role="alert">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="tl-email">{t('l.email')}</label>
              <input id="tl-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus autoComplete="username" />
            </div>
            <div className="field">
              <label htmlFor="tl-password">{t('l.password')}</label>
              <input id="tl-password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                required autoComplete="current-password" />
            </div>
            <button type="submit" className="btn btn-primary ls-submit" disabled={loading}>
              {loading ? t('l.loading') : t('l.submit')}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
