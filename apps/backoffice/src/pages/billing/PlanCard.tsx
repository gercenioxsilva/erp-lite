import type { TKey } from '../../i18n/pt-BR';
import type { Plan } from '../../hooks/useSubscription';
import { ApiError } from '../../lib/api';

export type TFn = (key: TKey) => string;

// Shared by BillingPage and RegisterPage's PlanStep — both hit checkout-session
// with the same error shape, no reason to inline this twice.
export function actionErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Plano é feito pra quem — derivado do que o plano de fato inclui, não uma
// estatística inventada ("mais escolhido por X%"). Cai fora graciosamente
// pra qualquer plan.id futuro que não esteja aqui (sem tagline, não quebra).
const PLAN_TAGLINE: Record<string, TKey> = {
  starter:    'billing.tagline.starter',
  pro:        'billing.tagline.pro',
  enterprise: 'billing.tagline.enterprise',
};

function IcoCheck() {
  return (
    <svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 9.5l3.5 3.5 7.5-8" />
    </svg>
  );
}

export interface PlanCardProps {
  plan:          Plan;
  isCurrent:     boolean;
  isActive:      boolean;
  isRecommended: boolean;
  stripeEnabled: boolean;
  busy:          string | null;
  onSubscribe:   (planId: string) => void;
  t:             TFn;
}

export function PlanCard({ plan, isCurrent, isActive, isRecommended, stripeEnabled, busy, onSubscribe, t }: PlanCardProps) {
  const isDisabled = !stripeEnabled || busy === plan.id || (isCurrent && isActive);
  const label = !stripeEnabled
    ? t('billing.contactSupport')
    : busy === plan.id
    ? '…'
    : isCurrent && isActive
    ? t('billing.currentPlan')
    : t('billing.subscribe');

  // CTA weight: current plan always reads as neutral/disabled; otherwise the
  // recommended tier gets the filled, elevated button and the other two stay
  // outlined — one deliberate hierarchy move, not three identical buttons.
  const ctaVariant = isCurrent && isActive ? 'btn-secondary' : isRecommended ? 'btn-primary' : 'btn-secondary';

  const tagline = PLAN_TAGLINE[plan.id];
  const features = [
    plan.max_users
      ? t('billing.users').replace('{n}', String(plan.max_users))
      : t('billing.usersUnlimited'),
    plan.max_nfe_per_month
      ? t('billing.nfe').replace('{n}', String(plan.max_nfe_per_month))
      : t('billing.nfeUnlimited'),
    plan.max_clients
      ? t('billing.clients').replace('{n}', String(plan.max_clients))
      : t('billing.clientsUnlimited'),
    ...(plan.features.reports ? ['Relatórios avançados'] : []),
    ...(plan.features.api_access ? ['Acesso à API'] : []),
  ];

  return (
    <div className={`plan-card${isCurrent ? ' plan-card--current' : isRecommended ? ' plan-card--recommended' : ''}`}>
      {isCurrent ? (
        <span className="plan-card__badge plan-card__badge--current">{t('billing.currentPlan')}</span>
      ) : isRecommended ? (
        <span className="plan-card__badge plan-card__badge--recommended">{t('billing.recommended')}</span>
      ) : null}

      <div className="plan-card__name">{plan.name}</div>
      {tagline && <p className="plan-card__tagline">{t(tagline)}</p>}

      <div className="plan-card__price">
        {BRL.format(plan.price_monthly)}
        <span className="plan-card__price-suffix">/{t('billing.perMonth')}</span>
      </div>

      <ul className="plan-card__features">
        {features.map(f => (
          <li key={f} className="plan-card__feature">
            <span className="plan-card__feature-icon"><IcoCheck /></span>
            {f}
          </li>
        ))}
      </ul>

      <button
        className={`btn ${ctaVariant} plan-card__cta`}
        style={{ width: '100%' }}
        onClick={() => onSubscribe(plan.id)}
        disabled={isDisabled}
      >
        {label}
      </button>
    </div>
  );
}
