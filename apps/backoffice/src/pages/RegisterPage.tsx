import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GaxLogo } from '../components/GaxLogo';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n';
import { maskCNPJ, digits, normalizeCNPJ } from '../lib/brazil';

const INIT = {
  company_name: '', trade_name: '', tax_id: '', tax_id_type: 'CNPJ',
  name: '', email: '', password: '', password2: '',
};

export function RegisterPage() {
  const [form,    setForm]    = useState(INIT);
  const [showPwd, setShowPwd] = useState(false);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate      = useNavigate();
  const { t }         = useI18n();

  function set(field: keyof typeof INIT) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      let val = e.target.value;
      if (field === 'tax_id' && form.tax_id_type === 'CNPJ') val = maskCNPJ(val);
      setForm(f => ({ ...f, [field]: val }));
    };
  }

  async function handleSubmit(e: FormEvent) {
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
      navigate('/billing');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('r.errFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 500 }}>

        <div className="auth-logo">
          <GaxLogo size="md" variant="full" />
        </div>

        <div className="auth-heading">
          <h2>{t('r.title')}</h2>
          <p>{t('r.subtitle')}</p>
        </div>

        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>

          {/* ── Company section ──────────────────────────────────────── */}
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 12 }}>
            {t('r.company')}
          </p>

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

          {/* ── Admin user section ───────────────────────────────────── */}
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', margin: '20px 0 12px' }}>
            {t('r.adminUser')}
          </p>

          <div className="field">
            <label htmlFor="name">{t('r.yourName')}</label>
            <input id="name" value={form.name} onChange={set('name')} placeholder={t('r.fullNamePH')} />
          </div>

          <div className="field">
            <label htmlFor="reg-email">{t('r.email')}</label>
            <input id="reg-email" type="email" value={form.email} onChange={set('email')} required placeholder="voce@empresa.com" autoComplete="username" />
          </div>

          <div className="field-row">
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
          </div>

          <div style={{ marginTop: 24 }}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? t('r.creating') : t('r.create')}
            </button>
          </div>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
          {t('r.hasAccount')}{' '}
          <Link to="/login" style={{ fontWeight: 600 }}>{t('r.signin')}</Link>
        </p>
      </div>
    </div>
  );
}
