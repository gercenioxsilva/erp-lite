import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useI18n }  from '../../i18n';
import type { TKey } from '../../i18n/pt-BR';
import { useSubscription } from '../../hooks/useSubscription';
import type { Plan, SubscriptionData } from '../../hooks/useSubscription';
import '../../ds/components/DataTable.css'; // .ds-skeleton shimmer primitive, reused here instead of a duplicate

type TFn = (key: TKey) => string;

function actionErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const STATUS_COLOR: Record<string, string> = {
  trial:    '#d97706',
  active:   '#16a34a',
  past_due: '#dc2626',
  canceled: '#6b7280',
};

function StatusHeroSkeleton() {
  return (
    <div className="bento-card" style={{ marginBottom: 24 }}>
      <div className="ds-skeleton" style={{ width: 120, height: 11, marginBottom: 10 }} />
      <div className="ds-skeleton" style={{ width: 200, height: 26, marginBottom: 14 }} />
      <div className="ds-skeleton" style={{ width: 100, height: 22, borderRadius: 20 }} />
    </div>
  );
}

function PlansGridSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
      {[0, 1, 2].map(i => (
        <div key={i} className="bento-card" style={{ padding: 24 }}>
          <div className="ds-skeleton" style={{ width: '50%', height: 16, marginBottom: 14 }} />
          <div className="ds-skeleton" style={{ width: '70%', height: 30, marginBottom: 22 }} />
          <div className="ds-skeleton" style={{ width: '100%', height: 90, marginBottom: 22 }} />
          <div className="ds-skeleton" style={{ width: '100%', height: 38, borderRadius: 8 }} />
        </div>
      ))}
    </div>
  );
}

interface StatusHeroProps {
  data:     SubscriptionData;
  busy:     string | null;
  onManage: () => void;
  t:        TFn;
}

function StatusHero({ data, busy, onManage, t }: StatusHeroProps) {
  const planName    = data.plans.find(p => p.id === data.plan)?.name ?? data.plan;
  const isPastDue    = data.status === 'past_due';
  const isCanceled   = data.status === 'canceled';
  const isSubscribed = data.status === 'active' || isPastDue;
  const stripeEnabled = data.stripe_enabled;

  const statusLabel: Record<string, string> = {
    trial:    t('billing.status.trial'),
    active:   t('billing.status.active'),
    past_due: t('billing.status.past_due'),
    canceled: t('billing.status.canceled'),
  };

  return (
    <div
      className="bento-card"
      style={{
        marginBottom: 24,
        borderLeft: isPastDue ? '4px solid var(--danger)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <div className="bento-label">{t('billing.currentPlan')}</div>
          <div className="bento-value-md" style={{ marginBottom: 8 }}>{planName}</div>
          <span style={{
            background: `${STATUS_COLOR[data.status] ?? '#6b7280'}20`,
            color: STATUS_COLOR[data.status] ?? '#6b7280',
            padding: '3px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600,
          }}>
            {statusLabel[data.status] ?? data.status}
          </span>
        </div>

        {isSubscribed && stripeEnabled && (
          <button
            className={`btn ${isPastDue ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto' }}
            onClick={onManage}
            disabled={busy === 'portal'}
          >
            {busy === 'portal' ? '…' : t('billing.manage')}
          </button>
        )}
        {isCanceled && (
          <a href="#plans" className="btn btn-primary" style={{ width: 'auto' }}>
            {t('billing.resubscribe')}
          </a>
        )}
      </div>

      {isPastDue && (
        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 'var(--r-sm)',
          background: '#fef2f2', border: '1.5px solid #fecaca', color: 'var(--danger)',
          fontSize: 13, fontWeight: 500,
        }}>
          ⚠ {t('billing.pastDueWarning')}
        </div>
      )}

      {(data.status === 'trial' && data.days_left !== null) || data.subscription_period_end ? (
        <div style={{ display: 'flex', gap: 28, marginTop: 16, flexWrap: 'wrap' }}>
          {data.status === 'trial' && data.days_left !== null && (
            <div>
              <div className="bento-label">{t('billing.trial')}</div>
              <div style={{ fontWeight: 600, color: data.days_left <= 3 ? 'var(--danger)' : 'var(--warning)' }}>
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
        </div>
      ) : null}
    </div>
  );
}

interface PlanCardProps {
  plan:          Plan;
  isCurrent:     boolean;
  isActive:      boolean;
  stripeEnabled: boolean;
  busy:          string | null;
  onSubscribe:   (planId: string) => void;
  t:             TFn;
}

function PlanCard({ plan, isCurrent, isActive, stripeEnabled, busy, onSubscribe, t }: PlanCardProps) {
  const isDisabled = !stripeEnabled || busy === plan.id || (isCurrent && isActive);
  const label = !stripeEnabled
    ? t('billing.contactSupport')
    : busy === plan.id
    ? '…'
    : isCurrent && isActive
    ? t('billing.currentPlan')
    : t('billing.subscribe');

  return (
    <div
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
        onClick={() => onSubscribe(plan.id)}
        disabled={isDisabled}
      >
        {label}
      </button>
    </div>
  );
}

export function BillingPage() {
  const { t } = useI18n();
  const { data, loading, error: fetchError } = useSubscription();
  const [busy, setBusy]             = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleSubscribe(planId: string) {
    setBusy(planId);
    setActionError(null);
    try {
      const res = await api.post<{ url: string }>('/v1/subscription/checkout-session', { plan_id: planId });
      window.location.href = res.url;
    } catch (err: unknown) {
      setActionError(actionErrorMessage(err, 'Erro ao iniciar checkout.'));
      setBusy(null);
    }
  }

  async function handleManage() {
    setBusy('portal');
    setActionError(null);
    try {
      const res = await api.post<{ url: string }>('/v1/subscription/portal-session', {});
      window.location.href = res.url;
    } catch (err: unknown) {
      setActionError(actionErrorMessage(err, 'Erro ao acessar portal.'));
      setBusy(null);
    }
  }

  const stripeEnabled = data?.stripe_enabled ?? false;
  const showStatusSkeleton = loading && !data;
  const showPlansSkeleton  = loading && !data;

  return (
    <div>
      <div className="page-header">
        <h1>{t('billing.title')}</h1>
      </div>

      {showStatusSkeleton ? (
        <StatusHeroSkeleton />
      ) : data ? (
        <StatusHero data={data} busy={busy} onManage={handleManage} t={t} />
      ) : null}

      {(fetchError || actionError) && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>{fetchError ?? actionError}</div>
      )}

      {showPlansSkeleton ? (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{t('billing.choosePlan')}</h2>
          <PlansGridSkeleton />
        </>
      ) : data && data.plans.length > 0 ? (
        <>
          <h2 id="plans" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{t('billing.choosePlan')}</h2>
          {!stripeEnabled && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
              {t('billing.notConfigured')}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginTop: stripeEnabled ? 16 : 0 }}>
            {data.plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrent={data.plan === plan.id && data.status !== 'canceled'}
                isActive={data.status === 'active'}
                stripeEnabled={stripeEnabled}
                busy={busy}
                onSubscribe={handleSubscribe}
                t={t}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
