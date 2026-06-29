import { useEffect, useState } from 'react';
import { api }     from '../../lib/api';
import { useI18n } from '../../i18n';

interface Plan {
  id:                string;
  name:              string;
  price_monthly:     number;
  max_users:         number | null;
  max_nfe_per_month: number | null;
  max_clients:       number | null;
  features:          { reports?: boolean; api_access?: boolean };
}

interface SubscriptionData {
  status:                  string;
  plan:                    string;
  days_left:               number | null;
  subscription_period_end: string | null;
  cancel_at_period_end:    boolean;
  stripe_enabled:          boolean;
  plans:                   Plan[];
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function BillingPage() {
  const { t } = useI18n();
  const [data, setData]       = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    api.get<SubscriptionData>('/v1/subscription')
      .then(setData)
      .catch(() => setError('Erro ao carregar dados de assinatura.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubscribe(planId: string) {
    setBusy(planId);
    setError(null);
    try {
      const res = await api.post<{ url: string }>('/v1/subscription/checkout-session', { plan_id: planId });
      window.location.href = res.url;
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao iniciar checkout.');
      setBusy(null);
    }
  }

  async function handleManage() {
    setBusy('portal');
    setError(null);
    try {
      const res = await api.post<{ url: string }>('/v1/subscription/portal-session', {});
      window.location.href = res.url;
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao acessar portal.');
      setBusy(null);
    }
  }

  const statusColor: Record<string, string> = {
    trial:    '#d97706',
    active:   '#16a34a',
    past_due: '#dc2626',
    canceled: '#6b7280',
  };

  const statusLabel: Record<string, string> = {
    trial:    t('billing.status.trial'),
    active:   t('billing.status.active'),
    past_due: t('billing.status.past_due'),
    canceled: t('billing.status.canceled'),
  };

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1>{t('billing.title')}</h1></div>
        <div className="spinner">{t('c.loading')}</div>
      </div>
    );
  }

  const isSubscribed   = data?.status === 'active' || data?.status === 'past_due';
  const stripeEnabled  = data?.stripe_enabled ?? false;

  return (
    <div>
      <div className="page-header">
        <h1>{t('billing.title')}</h1>
      </div>

      {/* Current status card */}
      {data && (
        <div className="bento-card" style={{ padding: '20px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div className="bento-label">{t('billing.currentPlan')}</div>
            <div style={{ fontWeight: 700, fontSize: 18, textTransform: 'capitalize' }}>{data.plan}</div>
          </div>
          <div>
            <div className="bento-label">{t('billing.status.trial').replace('Teste', '') || 'Status'}</div>
            <span style={{
              background: `${statusColor[data.status]}20`,
              color: statusColor[data.status],
              padding: '3px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600,
            }}>
              {statusLabel[data.status] ?? data.status}
            </span>
          </div>
          {data.status === 'trial' && data.days_left !== null && (
            <div>
              <div className="bento-label">{t('billing.trial')}</div>
              <div style={{ fontWeight: 600, color: data.days_left <= 3 ? '#dc2626' : '#d97706' }}>
                {t('billing.daysLeft').replace('{n}', String(data.days_left))}
              </div>
            </div>
          )}
          {data.subscription_period_end && (
            <div>
              <div className="bento-label">{data.cancel_at_period_end ? t('billing.cancelAtEnd') : t('billing.nextBilling')}</div>
              <div style={{ fontWeight: 500 }}>
                {new Date(data.subscription_period_end).toLocaleDateString('pt-BR')}
              </div>
            </div>
          )}
          {isSubscribed && stripeEnabled && (
            <div style={{ marginLeft: 'auto' }}>
              <button
                className="btn btn-secondary"
                style={{ width: 'auto' }}
                onClick={handleManage}
                disabled={busy === 'portal'}
              >
                {busy === 'portal' ? '…' : t('billing.manage')}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>
      )}

      {!stripeEnabled && (
        <div className="card" style={{ padding: 20, marginBottom: 24, color: 'var(--muted)', fontSize: 14 }}>
          {t('billing.notConfigured')}
        </div>
      )}

      {/* Plans grid */}
      {data && data.plans.length > 0 && stripeEnabled && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{t('billing.choosePlan')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {data.plans.map((plan) => {
              const isCurrent = data.plan === plan.id && data.status !== 'canceled';
              return (
                <div
                  key={plan.id}
                  className="bento-card"
                  style={{
                    padding: 24,
                    border: isCurrent ? '2px solid var(--primary)' : '1px solid var(--border)',
                    position: 'relative',
                  }}
                >
                  {isCurrent && (
                    <span style={{
                      position: 'absolute', top: -10, left: 16,
                      background: 'var(--primary)', color: '#fff',
                      padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    }}>
                      {t('billing.currentPlan')}
                    </span>
                  )}
                  <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{plan.name}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--primary)', marginBottom: 16 }}>
                    {BRL.format(plan.price_monthly)}
                    <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>/{t('billing.perMonth')}</span>
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', fontSize: 13, lineHeight: 1.8 }}>
                    <li>
                      {plan.max_users
                        ? t('billing.users').replace('{n}', String(plan.max_users))
                        : t('billing.usersUnlimited')}
                    </li>
                    <li>
                      {plan.max_nfe_per_month
                        ? t('billing.nfe').replace('{n}', String(plan.max_nfe_per_month))
                        : t('billing.nfeUnlimited')}
                    </li>
                    <li>
                      {plan.max_clients
                        ? t('billing.clients').replace('{n}', String(plan.max_clients))
                        : t('billing.clientsUnlimited')}
                    </li>
                    {plan.features.reports && <li>✓ Relatórios avançados</li>}
                    {plan.features.api_access && <li>✓ Acesso à API</li>}
                  </ul>
                  <button
                    className={`btn ${isCurrent ? 'btn-secondary' : 'btn-primary'}`}
                    style={{ width: '100%' }}
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={busy === plan.id || (isCurrent && data.status === 'active')}
                  >
                    {busy === plan.id ? '…' : isCurrent && data.status === 'active' ? t('billing.currentPlan') : t('billing.subscribe')}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
