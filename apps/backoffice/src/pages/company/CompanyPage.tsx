import { useEffect, useState, useRef, FormEvent } from 'react';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';

interface Tenant {
  id: string; company_name: string; trade_name: string | null;
  tax_id: string; tax_id_type: string; phone: string | null; website: string | null;
  street: string | null; street_number: string | null; complement: string | null;
  neighborhood: string | null; city: string | null; state: string | null; postal_code: string | null;
  logo_url: string | null; status: string; plan: string;
}

const MAX_LOGO_SIZE = 300 * 1024; // 300 KB

export function CompanyPage() {
  const { tenantId } = useAuth();
  const { t }        = useI18n();

  const [tenant, setTenant]     = useState<Tenant | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [success, setSuccess]   = useState('');
  const [error, setError]       = useState('');
  const [logoError, setLogoError] = useState('');
  const [logoSaving, setLogoSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    company_name: '', trade_name: '', phone: '', website: '',
    street: '', street_number: '', complement: '', neighborhood: '',
    city: '', state: '', postal_code: '',
  });

  useEffect(() => {
    if (!tenantId) return;
    loadTenant();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function loadTenant() {
    setLoading(true);
    try {
      const data = await api.get<Tenant>('/v1/tenant');
      setTenant(data);
      setForm({
        company_name:  data.company_name  || '',
        trade_name:    data.trade_name    || '',
        phone:         data.phone         || '',
        website:       data.website       || '',
        street:        data.street        || '',
        street_number: data.street_number || '',
        complement:    data.complement    || '',
        neighborhood:  data.neighborhood  || '',
        city:          data.city          || '',
        state:         data.state         || '',
        postal_code:   data.postal_code   || '',
      });
    } catch (err: any) {
      setError(err.message || t('comp.errLoad'));
    } finally { setLoading(false); }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault(); setError(''); setSuccess('');
    if (!form.company_name.trim()) { setError(t('comp.errName')); return; }
    setSaving(true);
    try {
      await api.patch('/v1/tenant', form);
      setSuccess(t('comp.saved'));
      loadTenant();
    } catch (err: any) {
      setError(err.message || t('comp.errSave'));
    } finally { setSaving(false); }
  }

  function handleLogoClick() { fileRef.current?.click(); }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError('');

    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setLogoError(t('comp.logoTypeErr')); return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      setLogoError(t('comp.logoSizeErr')); return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUri = ev.target?.result as string;
      setLogoSaving(true);
      try {
        await api.put('/v1/tenant/logo', { logo_url: dataUri });
        await loadTenant();
      } catch (err: any) {
        setLogoError(err.message || t('comp.errSave'));
      } finally {
        setLogoSaving(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleLogoDelete() {
    setLogoError('');
    setLogoSaving(true);
    try {
      await api.delete('/v1/tenant/logo');
      await loadTenant();
    } catch (err: any) {
      setLogoError(err.message || t('comp.errSave'));
    } finally { setLogoSaving(false); }
  }

  if (loading) return <div className="spinner">{t('c.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{t('comp.title')}</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24, alignItems: 'start' }}>
        {/* ── Formulário principal ── */}
        <div className="card" style={{ padding: 24 }}>
          <form onSubmit={handleSave} noValidate>
            {error   && <div role="alert" className="alert alert-error"  style={{ marginBottom: 16 }}>{error}</div>}
            {success && <div role="alert" className="alert alert-success" style={{ marginBottom: 16 }}>{success}</div>}

            <h3 style={{ marginBottom: 16 }}>{t('comp.basicInfo')}</h3>

            <div className="field-row">
              <div className="field">
                <label>{t('comp.legalName')} *</label>
                <input type="text" value={form.company_name}
                  onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} required />
              </div>
              <div className="field">
                <label>{t('comp.tradeName')}</label>
                <input type="text" value={form.trade_name}
                  onChange={e => setForm(f => ({ ...f, trade_name: e.target.value }))} />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>{t('comp.phone')}</label>
                <input type="text" value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="field">
                <label>{t('comp.website')}</label>
                <input type="text" value={form.website}
                  onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                  placeholder="https://..." />
              </div>
            </div>

            <h3 style={{ marginTop: 20, marginBottom: 16 }}>{t('comp.address')}</h3>

            <div className="field-row">
              <div className="field" style={{ flex: 2 }}>
                <label>{t('comp.street')}</label>
                <input type="text" value={form.street}
                  onChange={e => setForm(f => ({ ...f, street: e.target.value }))} />
              </div>
              <div className="field">
                <label>{t('comp.number')}</label>
                <input type="text" value={form.street_number}
                  onChange={e => setForm(f => ({ ...f, street_number: e.target.value }))} />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>{t('comp.complement')}</label>
                <input type="text" value={form.complement}
                  onChange={e => setForm(f => ({ ...f, complement: e.target.value }))} />
              </div>
              <div className="field">
                <label>{t('comp.neighborhood')}</label>
                <input type="text" value={form.neighborhood}
                  onChange={e => setForm(f => ({ ...f, neighborhood: e.target.value }))} />
              </div>
            </div>

            <div className="field-row">
              <div className="field" style={{ flex: 2 }}>
                <label>{t('comp.city')}</label>
                <input type="text" value={form.city}
                  onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="field" style={{ flex: 0.5 }}>
                <label>{t('comp.state')}</label>
                <input type="text" value={form.state} maxLength={2}
                  onChange={e => setForm(f => ({ ...f, state: e.target.value.toUpperCase() }))} />
              </div>
              <div className="field">
                <label>{t('comp.postalCode')}</label>
                <input type="text" value={form.postal_code}
                  onChange={e => setForm(f => ({ ...f, postal_code: e.target.value }))} />
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? t('c.saving') : t('c.save')}
              </button>
            </div>
          </form>
        </div>

        {/* ── Logo + Info ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Logo */}
          <div className="card" style={{ padding: 20, textAlign: 'center' }}>
            <h4 style={{ marginBottom: 12 }}>{t('comp.logo')}</h4>

            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt="Logo" style={{
                maxWidth: '100%', maxHeight: 120, objectFit: 'contain',
                borderRadius: 8, marginBottom: 12, border: '1px solid var(--border)',
              }} />
            ) : (
              <div style={{
                width: '100%', height: 100, background: 'var(--surface)',
                borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--muted)', fontSize: 13, marginBottom: 12,
                border: '2px dashed var(--border)',
              }}>
                {t('comp.noLogo')}
              </div>
            )}

            {logoError && <div role="alert" className="alert alert-error" style={{ fontSize: 12, marginBottom: 8 }}>{logoError}</div>}

            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
              style={{ display: 'none' }} onChange={handleLogoChange} />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-secondary btn-sm" onClick={handleLogoClick} disabled={logoSaving}>
                {logoSaving ? t('c.saving') : (tenant?.logo_url ? t('comp.changeLogo') : t('comp.uploadLogo'))}
              </button>
              {tenant?.logo_url && (
                <button className="btn btn-danger btn-sm" onClick={handleLogoDelete} disabled={logoSaving}>
                  {t('comp.removeLogo')}
                </button>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
              {t('comp.logoHint')}
            </div>
          </div>

          {/* Info SaaS */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{t('comp.taxId')}</div>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>
              {tenant?.tax_id} <span style={{ fontSize: 11, color: 'var(--muted)' }}>({tenant?.tax_id_type})</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{t('comp.plan')}</div>
            <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{tenant?.plan}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
