import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import type { SubscriptionData } from '../../hooks/useSubscription';

// The Checkout redirect can race the Stripe webhook — poll briefly instead of
// always claiming success immediately.
const POLL_INTERVAL_MS  = 1500;
const MAX_POLL_ATTEMPTS = 6;

type ConfirmState = 'confirming' | 'success' | 'failed';

function containerStyle(): CSSProperties {
  return {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: '60vh', textAlign: 'center', padding: 24,
  };
}

export function BillingSuccessPage() {
  const { t } = useI18n();
  const [state, setState]     = useState<ConfirmState>('confirming');
  const [attempt, setAttempt] = useState(0);

  const poll = useCallback(async () => {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      try {
        const data = await api.get<SubscriptionData>('/v1/subscription');
        if (data.status !== 'trial') {
          setState('success');
          return;
        }
      } catch {
        // Transient network error mid-poll — keep retrying until attempts run out.
      }
      if (i < MAX_POLL_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
    setState('failed');
  }, []);

  useEffect(() => {
    setState('confirming');
    poll();
  }, [poll, attempt]);

  function handleRetry() {
    setAttempt(a => a + 1);
  }

  if (state === 'confirming') {
    return (
      <div style={containerStyle()}>
        <div className="spinner">{t('billing.confirming')}</div>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div style={containerStyle()}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{t('billing.title')}</h1>
        <p style={{ color: 'var(--muted)', fontSize: 16, marginBottom: 32, maxWidth: 420 }}>
          {t('billing.stillProcessing')}
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn-secondary" style={{ width: 'auto', padding: '10px 32px' }} onClick={handleRetry}>
            {t('billing.retry')}
          </button>
          <Link to="/dashboard" className="btn btn-primary" style={{ width: 'auto', padding: '10px 32px' }}>
            {t('billing.goToDashboard')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle()}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>{t('billing.successTitle')}</h1>
      <p style={{ color: 'var(--muted)', fontSize: 16, marginBottom: 32, maxWidth: 400 }}>{t('billing.successMsg')}</p>
      <Link to="/dashboard" className="btn btn-primary" style={{ width: 'auto', padding: '10px 32px' }}>
        {t('billing.goToDashboard')}
      </Link>
    </div>
  );
}
