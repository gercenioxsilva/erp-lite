import { useState } from 'react';
import { GaxLogo } from './GaxLogo';
import { AuthHero } from './AuthHero';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n';
import { api, ApiError } from '../lib/api';

/**
 * Renderizada no lugar do app normal (GuardedRoutes) enquanto
 * tenant_activated_at estiver null — mesmo espírito de bloqueio já usado
 * pra trial expirado (subscriptionGuard), só que pra identidade/e-mail em
 * vez de assinatura. Nunca é o controle de acesso de verdade — isso é
 * sempre tenantActivationGuard.ts no backend; esta tela só evita que o
 * tenant veja um app quebrado cheio de 403.
 */
export function EmailNotVerifiedScreen() {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleResend() {
    setState('sending');
    setError('');
    try {
      await api.post('/v1/auth/resend-verification', {});
      setState('sent');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiError ? err.message : t('ve.resendError'));
    }
  }

  return (
    <div className="ls-shell">
      <AuthHero />
      <section className="ls-form-panel">
        <div className="ls-form-body" style={{ textAlign: 'center' }}>
          <div className="ls-form-logo">
            <GaxLogo size="xl" variant="full" theme="light" />
          </div>

          <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }} aria-hidden="true">📩</div>
          <div className="ls-form-heading">
            <h2>{t('ve.blockedTitle')}</h2>
            <p>{t('ve.blockedMsg').replace('{email}', user?.email ?? '')}</p>
          </div>

          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {state === 'sent' && <div className="alert alert-success" role="status">{t('ve.resendSent')}</div>}

          <button
            type="button"
            className="btn btn-primary ls-submit"
            onClick={handleResend}
            disabled={state === 'sending'}
          >
            {state === 'sending' ? t('c.loading') : t('ve.resend')}
          </button>

          <p className="ls-register-link">
            <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={logout}>
              {t('nav.signout')}
            </button>
          </p>
        </div>
      </section>
    </div>
  );
}
