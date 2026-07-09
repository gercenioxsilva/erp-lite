import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { GaxLogo } from '../../components/GaxLogo';
import { AuthHero } from '../../components/AuthHero';
import { useI18n } from '../../i18n';
import { useAuth } from '../../contexts/AuthContext';
import { api, ApiError } from '../../lib/api';

/**
 * Confirma o e-mail automaticamente ao carregar (o clique já aconteceu no
 * e-mail — não faz sentido pedir um segundo clique aqui). Mesmo padrão
 * visual de ResetPasswordPage.tsx.
 */
export function VerifyEmailPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setState('error'); setError(t('ve.invalidLink')); return; }
    api.post('/v1/auth/verify-email', { token })
      .then(async () => {
        // A sessão (token de login) já existe desde o registro — só o
        // status de ativação muda. Atualiza o AuthContext ANTES de navegar
        // pro /dashboard, senão a tela de bloqueio (baseada no user antigo,
        // carregado no boot) reapareceria por engano.
        await refreshUser().catch(() => {});
        setState('done');
        setTimeout(() => navigate('/dashboard'), 3000);
      })
      .catch(err => {
        setState('error');
        setError(err instanceof ApiError ? err.message : t('ve.error'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="ls-shell">
      <AuthHero />
      <section className="ls-form-panel">
        <div className="ls-form-body" style={{ textAlign: 'center' }}>
          <div className="ls-form-logo">
            <GaxLogo size="xl" variant="full" theme="light" />
          </div>

          {state === 'loading' && (
            <div className="ls-form-heading">
              <h2>{t('ve.loadingTitle')}</h2>
              <p>{t('c.loading')}</p>
            </div>
          )}

          {state === 'done' && (
            <>
              <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }} aria-hidden="true">✅</div>
              <div className="ls-form-heading">
                <h2>{t('ve.doneTitle')}</h2>
                <p>{t('ve.doneMsg')}</p>
              </div>
            </>
          )}

          {state === 'error' && (
            <>
              <p style={{ color: 'var(--muted)', marginBottom: 16 }}>{error}</p>
              <Link to="/login" className="btn btn-primary ls-submit">{t('fp.backLogin')}</Link>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
