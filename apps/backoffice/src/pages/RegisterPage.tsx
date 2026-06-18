import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function RegisterPage() {
  const [form, setForm] = useState({
    company_name: '',
    trade_name:   '',
    tax_id:       '',
    tax_id_type:  'CNPJ',
    name:         '',
    email:        '',
    password:     '',
    password2:    '',
  });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate      = useNavigate();

  function set(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (form.password !== form.password2) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const { password2: _, ...data } = form;
      await register(data);
      navigate('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <h1>ERP Lite</h1>
        <h2>Create your company account</h2>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Company name *</label>
            <input value={form.company_name} onChange={set('company_name')} required />
          </div>
          <div className="field">
            <label>Trade name</label>
            <input value={form.trade_name} onChange={set('trade_name')} placeholder="Optional" />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Tax ID *</label>
              <input value={form.tax_id} onChange={set('tax_id')} required placeholder="00.000.000/0001-00" />
            </div>
            <div className="field">
              <label>Type</label>
              <select value={form.tax_id_type} onChange={set('tax_id_type')}>
                <option value="CNPJ">CNPJ</option>
                <option value="EIN">EIN</option>
                <option value="VAT">VAT</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0 16px' }} />

          <div className="field">
            <label>Your name</label>
            <input value={form.name} onChange={set('name')} placeholder="Full name" />
          </div>
          <div className="field">
            <label>Email *</label>
            <input type="email" value={form.email} onChange={set('email')} required />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Password *</label>
              <input type="password" value={form.password} onChange={set('password')} required minLength={8} />
            </div>
            <div className="field">
              <label>Confirm password *</label>
              <input type="password" value={form.password2} onChange={set('password2')} required />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-muted mt-16" style={{ fontSize: 13, textAlign: 'center' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
