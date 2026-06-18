import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GaxLogo } from '../components/GaxLogo';
import { useAuth } from '../contexts/AuthContext';
import { maskCNPJ, digits } from '../lib/brazil';

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
    if (form.password !== form.password2) { setError('Passwords do not match'); return; }
    if (form.password.length < 8)          { setError('Password must be at least 8 characters'); return; }

    setLoading(true);
    try {
      await register({
        company_name: form.company_name,
        trade_name:   form.trade_name || undefined,
        tax_id:       digits(form.tax_id),
        tax_id_type:  form.tax_id_type,
        name:         form.name,
        email:        form.email,
        password:     form.password,
      });
      navigate('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
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
          <h2>Create your company account</h2>
          <p>Start your free trial — no credit card required</p>
        </div>

        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>

          {/* ── Company section ──────────────────────────────────────── */}
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 12 }}>
            Company
          </p>

          <div className="field">
            <label htmlFor="company_name">Legal name *</label>
            <input id="company_name" value={form.company_name} onChange={set('company_name')} required placeholder="Razão Social / Company name" />
          </div>

          <div className="field">
            <label htmlFor="trade_name">Trade name</label>
            <input id="trade_name" value={form.trade_name} onChange={set('trade_name')} placeholder="Nome Fantasia (optional)" />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="tax_id">Tax ID *</label>
              <input
                id="tax_id"
                value={form.tax_id}
                onChange={set('tax_id')}
                required
                placeholder={form.tax_id_type === 'CNPJ' ? '00.000.000/0001-00' : 'Tax ID'}
              />
            </div>
            <div className="field" style={{ flex: '0 0 120px' }}>
              <label htmlFor="tax_id_type">Type</label>
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
            Admin user
          </p>

          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" value={form.name} onChange={set('name')} placeholder="Full name" />
          </div>

          <div className="field">
            <label htmlFor="reg-email">Email *</label>
            <input id="reg-email" type="email" value={form.email} onChange={set('email')} required placeholder="you@company.com" autoComplete="username" />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="reg-pwd">Password *</label>
              <div className="pwd-wrap">
                <input
                  id="reg-pwd"
                  type={showPwd ? 'text' : 'password'}
                  value={form.password}
                  onChange={set('password')}
                  required
                  minLength={8}
                  placeholder="Min 8 characters"
                  autoComplete="new-password"
                />
                <button type="button" className="pwd-toggle" onClick={() => setShowPwd(s => !s)} tabIndex={-1}>
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="reg-pwd2">Confirm password *</label>
              <input id="reg-pwd2" type={showPwd ? 'text' : 'password'} value={form.password2} onChange={set('password2')} required placeholder="Repeat password" autoComplete="new-password" />
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </div>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ fontWeight: 600 }}>Sign in →</Link>
        </p>
      </div>
    </div>
  );
}
