import { useState, useEffect, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GaxLogo } from '../components/GaxLogo';
import { AuthHero } from '../components/AuthHero';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n';
import type { TKey } from '../i18n/pt-BR';
import { maskCNPJ, digits, normalizeCNPJ } from '../lib/brazil';
import { api, actionErrorMessage } from '../lib/api';
import { useSubscription } from '../hooks/useSubscription';
import { PlanCard } from './billing/PlanCard';

type TFn = (key: TKey) => string;

const EYEBROW_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  marginBottom: 6,
};

const STEP_COPY: Record<1 | 2 | 3, { eyebrow: TKey; heading: TKey; subtitle: TKey }> = {
  1: { eyebrow: 'r.step1.eyebrow', heading: 'r.step1.heading', subtitle: 'r.step1.subtitle' },
  2: { eyebrow: 'r.step2.eyebrow', heading: 'r.step2.heading', subtitle: 'r.step2.subtitle' },
  3: { eyebrow: 'r.step3.eyebrow', heading: 'r.step3.heading', subtitle: 'r.step3.subtitle' },
};

/**
 * Compact 3-segment step indicator, purpose-built for the ~360px
 * `.ls-form-body` column. `StepProgress` (ds/) is a full-width app-header
 * component with nowrap text labels — it overflows badly at this width, so
 * this page uses its own minimal bar instead of squeezing that in.
 */
function StepBar({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="reg-stepbar" aria-hidden="true">
      {([1, 2, 3] as const).map(n => (
        <div key={n} className={`reg-stepbar__seg${n <= step ? ' reg-stepbar__seg--active' : ''}`} />
      ))}
    </div>
  );
}

const INIT = {
  company_name: '', trade_name: '', tax_id: '', tax_id_type: 'CNPJ',
  name: '', email: '', password: '', password2: '',
};

interface CompanyStepProps {
  form:     typeof INIT;
  set:      (field: keyof typeof INIT) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onNext:   () => void;
  t:        TFn;
}

function CompanyStep({ form, set, onNext, t }: CompanyStepProps) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onNext();
  }

  return (
    // No noValidate here (unlike AccountStep, which needs custom cross-field
    // password validation): company_name/tax_id are plain required fields, so
    // native browser validation blocking submit is enough — otherwise a user
    // could reach step 2 with step-1 fields empty and only find out from a
    // generic error banner on a screen that isn't showing those fields anymore.
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="company_name">{t('r.legalName')}</label>
        <input id="company_name" value={form.company_name} onChange={set('company_name')} required placeholder="Razão Social / Company name" />
      </div>

      <div className="field">
        <label htmlFor="trade_name">{t('r.tradeName')}</label>
        <input id="trade_name" value={form.trade_name} onChange={set('trade_name')} placeholder="Nome Fantasia (optional)" />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="tax_id">{t('r.taxId')}</label>
          <input
            id="tax_id"
            value={form.tax_id}
            onChange={set('tax_id')}
            required
            placeholder={form.tax_id_type === 'CNPJ' ? '00.000.000/0001-00' : 'Tax ID'}
          />
        </div>
        <div className="field" style={{ flex: '0 0 120px' }}>
          <label htmlFor="tax_id_type">{t('r.taxType')}</label>
          <select id="tax_id_type" value={form.tax_id_type} onChange={set('tax_id_type')}>
            <option value="CNPJ">CNPJ</option>
            <option value="EIN">EIN</option>
            <option value="VAT">VAT</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <button type="submit" className="btn btn-primary">{t('r.continue')}</button>
      </div>
    </form>
  );
}

interface AccountStepProps {
  form:     typeof INIT;
  set:      (field: keyof typeof INIT) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  showPwd:  boolean;
  setShowPwd: (fn: (s: boolean) => boolean) => void;
  loading:  boolean;
  onBack:   () => void;
  onSubmit: (e: FormEvent) => void;
  t:        TFn;
}

function AccountStep({ form, set, showPwd, setShowPwd, loading, onBack, onSubmit, t }: AccountStepProps) {
  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="name">{t('r.yourName')}</label>
        <input id="name" value={form.name} onChange={set('name')} placeholder={t('r.fullNamePH')} />
      </div>

      <div className="field">
        <label htmlFor="reg-email">{t('r.email')}</label>
        <input id="reg-email" type="email" value={form.email} onChange={set('email')} required placeholder="voce@empresa.com" autoComplete="username" />
      </div>

      <div className="field">
        <label htmlFor="reg-pwd">{t('r.password')}</label>
        <div className="pwd-wrap">
          <input
            id="reg-pwd"
            type={showPwd ? 'text' : 'password'}
            value={form.password}
            onChange={set('password')}
            required
            minLength={8}
            placeholder={t('r.minPwdPH')}
            autoComplete="new-password"
          />
          <button type="button" className="pwd-toggle" onClick={() => setShowPwd(s => !s)} tabIndex={-1}>
            {showPwd ? t('l.hide') : t('l.show')}
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="reg-pwd2">{t('r.confirmPwd')}</label>
        <input id="reg-pwd2" type={showPwd ? 'text' : 'password'} value={form.password2} onChange={set('password2')} required placeholder={t('r.repeatPwd')} autoComplete="new-password" />
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
        <button type="button" className="btn btn-secondary" style={{ flex: '0 0 auto' }} onClick={onBack} disabled={loading}>
          {t('r.back')}
        </button>
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
          {loading ? t('r.creating') : t('r.create')}
        </button>
      </div>
    </form>
  );
}

interface PlanStepProps {
  t:        TFn;
  onSkip:   () => void;
}

function PlanStep({ t, onSkip }: PlanStepProps) {
  const { data, loading, error: fetchError } = useSubscription();
  const [busy, setBusy]   = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubscribe(planId: string) {
    setBusy(planId);
    setError(null);
    try {
      const res = await api.post<{ url: string }>('/v1/subscription/checkout-session', { plan_id: planId });
      window.location.href = res.url;
    } catch (err: unknown) {
      setError(actionErrorMessage(err, 'Erro ao iniciar checkout.'));
      setBusy(null);
    }
  }

  const stripeEnabled = data?.stripe_enabled ?? false;

  return (
    <div>
      {(fetchError || error) && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>{fetchError ?? error}</div>
      )}

      {loading && !data ? (
        <p style={{ textAlign: 'center', color: 'var(--muted)', padding: '24px 0' }}>{t('c.loading')}</p>
      ) : data && data.plans.length > 0 ? (
        <div className="plans-grid">
          {data.plans.map((plan, i) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={data.plan === plan.id && data.status !== 'canceled'}
              isActive={data.status === 'active'}
              isRecommended={data.plans.length >= 3 && i === Math.floor(data.plans.length / 2)}
              stripeEnabled={stripeEnabled}
              busy={busy}
              onSubscribe={handleSubscribe}
              t={t}
            />
          ))}
        </div>
      ) : null}

      <p style={{ textAlign: 'center', marginTop: 24 }}>
        <button type="button" className="btn btn-secondary" style={{ width: 'auto' }} onClick={onSkip}>
          {t('r.skipTrial')}
        </button>
      </p>
    </div>
  );
}

export function RegisterPage() {
  const { register, user, loading: authLoading } = useAuth();
  const [step,    setStep]    = useState<1 | 2 | 3>(1);
  const [form,    setForm]    = useState(INIT);
  const [showPwd, setShowPwd] = useState(false);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const navigate      = useNavigate();
  const { t }         = useI18n();

  // Already-authenticated once the async auth check (AuthContext) resolves
  // means register() already ran in an earlier visit (page refresh mid-wizard,
  // or Back navigation from Stripe Checkout) — resubmitting the company/account
  // steps would just 409 on the tax_id/email that already exists, so jump
  // straight back to plan selection instead. `user` starts out `null` and is
  // only populated after `/v1/auth/me` resolves, so this has to be reactive
  // (not a one-shot lazy initializer) or it'd always see `user` as null here.
  useEffect(() => {
    if (!authLoading && user) setStep(3);
  }, [authLoading, user]);

  function goToStep(n: 1 | 2 | 3) {
    setError('');
    setStep(n);
  }

  function set(field: keyof typeof INIT) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      let val = e.target.value;
      if (field === 'tax_id' && form.tax_id_type === 'CNPJ') val = maskCNPJ(val);
      setForm(f => ({ ...f, [field]: val }));
    };
  }

  async function handleAccountSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (form.password !== form.password2) { setError(t('r.errPwdMatch')); return; }
    if (form.password.length < 8)          { setError(t('r.errPwdLen'));   return; }

    setLoading(true);
    try {
      await register({
        company_name: form.company_name,
        trade_name:   form.trade_name || undefined,
        tax_id:       form.tax_id_type === 'CNPJ' ? normalizeCNPJ(form.tax_id) : digits(form.tax_id),
        tax_id_type:  form.tax_id_type,
        name:         form.name,
        email:        form.email,
        password:     form.password,
      });
      setStep(3);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('r.errFailed'));
    } finally {
      setLoading(false);
    }
  }

  const copy = STEP_COPY[step];

  return (
    <div className="ls-shell">

      {/* Hero only carries steps 1-2 — by step 3 the account already exists
          (register() already succeeded), so the job is just picking a plan
          and the panel takes the full width instead. */}
      {step !== 3 && <AuthHero />}

      <section className="ls-form-panel">
        <div className="ls-form-body" style={{ maxWidth: step === 3 ? 880 : 360 }}>
          <div className="ls-form-logo">
            <GaxLogo size="xl" variant="full" theme="light" />
          </div>

          <StepBar step={step} />

          <div className="ls-form-heading">
            <p style={EYEBROW_STYLE}>{t(copy.eyebrow)}</p>
            <h2>{t(copy.heading)}</h2>
            <p>{t(copy.subtitle)}</p>
          </div>

          {error && <div className="alert alert-error" role="alert">{error}</div>}

          {step === 1 && (
            <CompanyStep form={form} set={set} onNext={() => goToStep(2)} t={t} />
          )}

          {step === 2 && (
            <AccountStep
              form={form}
              set={set}
              showPwd={showPwd}
              setShowPwd={setShowPwd}
              loading={loading}
              onBack={() => goToStep(1)}
              onSubmit={handleAccountSubmit}
              t={t}
            />
          )}

          {step === 3 && (
            <PlanStep t={t} onSkip={() => navigate('/dashboard')} />
          )}

          {step !== 3 && (
            <p className="ls-register-link">
              {t('r.hasAccount')}{' '}
              <Link to="/login">{t('r.signin')}</Link>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
