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
  bank_code: string | null; agency: string | null; account: string | null; account_digit: string | null;
  billing_provider: string | null; billing_days_to_expire: number | null;
}

interface NfeCfg {
  cnpj: string; razao_social: string; nome_fantasia: string | null;
  regime_tributario: number;
  logradouro: string; numero: string; complemento: string | null;
  bairro: string; municipio: string; uf: string; cep: string;
  telefone: string | null; email: string | null;
  cfop_padrao: string; cfop_interestadual: string;
  natureza_operacao: string; focus_ambiente: number;
  focus_token_homologacao: string | null; // masked from API (****XXXX)
  focus_token_producao:    string | null; // masked from API (****XXXX)
}

const EMPTY_NFE_FORM = {
  cnpj: '', razao_social: '', nome_fantasia: '', regime_tributario: '1',
  logradouro: '', numero: '', complemento: '', bairro: '',
  municipio: 'SAO PAULO', uf: 'SP', cep: '',
  telefone: '', email: '',
  cfop_padrao: '5102', cfop_interestadual: '6102',
  natureza_operacao: 'Venda de mercadoria', focus_ambiente: '2',
  focus_token_homologacao: '', // empty = keep current; filled = update
  focus_token_producao:    '',
};

const MAX_LOGO_SIZE = 300 * 1024; // 300 KB

const BANKS = [
  { value: '341', label: 'Itaú (341)' },
];

const PROVIDERS = [
  { value: 'itau', label: 'Itaú' },
];

export function CompanyPage() {
  const { tenantId } = useAuth();
  const { t }        = useI18n();

  const [tab, setTab]           = useState<'general' | 'banking' | 'fiscal'>('general');
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

  const [bankForm, setBankForm] = useState({
    bank_code: '', agency: '', account: '', account_digit: '',
    billing_provider: 'itau', billing_days_to_expire: '30',
  });
  const [bankSaving, setBankSaving] = useState(false);
  const [bankSuccess, setBankSuccess] = useState('');
  const [bankError, setBankError]   = useState('');

  const [nfeCfg, setNfeCfg]           = useState<NfeCfg | null>(null);
  const [nfeLoading, setNfeLoading]   = useState(false);
  const [nfeForm, setNfeForm]         = useState({ ...EMPTY_NFE_FORM });
  const [nfeSaving, setNfeSaving]     = useState(false);
  const [nfeSuccess, setNfeSuccess]   = useState('');
  const [nfeError, setNfeError]       = useState('');

  useEffect(() => {
    if (!tenantId) return;
    loadTenant();
    loadNfeConfig();
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
      setBankForm({
        bank_code:              data.bank_code              || '',
        agency:                 data.agency                 || '',
        account:                data.account                || '',
        account_digit:          data.account_digit          || '',
        billing_provider:       data.billing_provider       || 'itau',
        billing_days_to_expire: String(data.billing_days_to_expire ?? 30),
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

  async function loadNfeConfig() {
    setNfeLoading(true);
    try {
      const data = await api.get<NfeCfg>(`/v1/nfe-config?tenant_id=${tenantId}`);
      setNfeCfg(data);
      setNfeForm({
        cnpj:                   data.cnpj || '',
        razao_social:           data.razao_social || '',
        nome_fantasia:          data.nome_fantasia || '',
        regime_tributario:      String(data.regime_tributario ?? 1),
        logradouro:             data.logradouro || '',
        numero:                 data.numero || '',
        complemento:            data.complemento || '',
        bairro:                 data.bairro || '',
        municipio:              data.municipio || 'SAO PAULO',
        uf:                     data.uf || 'SP',
        cep:                    data.cep || '',
        telefone:               data.telefone || '',
        email:                  data.email || '',
        cfop_padrao:            data.cfop_padrao || '5102',
        cfop_interestadual:     data.cfop_interestadual || '6102',
        natureza_operacao:      data.natureza_operacao || 'Venda de mercadoria',
        focus_ambiente:         String(data.focus_ambiente ?? 2),
        focus_token_homologacao: '', // always start empty — masked value from API is display-only
        focus_token_producao:    '',
      });
    } catch {
      // 404 is expected if no config yet; other errors are silent (user sees empty form)
      setNfeForm({ ...EMPTY_NFE_FORM });
    } finally { setNfeLoading(false); }
  }

  async function handleNfeSave(e: FormEvent) {
    e.preventDefault(); setNfeError(''); setNfeSuccess('');
    if (!nfeForm.cnpj.trim() || !nfeForm.razao_social.trim())
      return setNfeError(t('comp.nfe.errRequired'));
    setNfeSaving(true);
    try {
      await api.put('/v1/nfe-config', {
        tenant_id:              tenantId,
        cnpj:                   nfeForm.cnpj,
        razao_social:           nfeForm.razao_social,
        nome_fantasia:          nfeForm.nome_fantasia || null,
        regime_tributario:      Number(nfeForm.regime_tributario),
        logradouro:             nfeForm.logradouro,
        numero:                 nfeForm.numero,
        complemento:            nfeForm.complemento || null,
        bairro:                 nfeForm.bairro,
        municipio:              nfeForm.municipio,
        uf:                     nfeForm.uf,
        cep:                    nfeForm.cep,
        telefone:               nfeForm.telefone || null,
        email:                  nfeForm.email || null,
        cfop_padrao:            nfeForm.cfop_padrao,
        cfop_interestadual:     nfeForm.cfop_interestadual,
        natureza_operacao:      nfeForm.natureza_operacao,
        focus_ambiente:         Number(nfeForm.focus_ambiente),
        focus_token_homologacao: nfeForm.focus_token_homologacao || null,
        focus_token_producao:    nfeForm.focus_token_producao    || null,
      });
      setNfeSuccess(t('comp.nfe.saved'));
      loadNfeConfig();
    } catch (err: any) {
      setNfeError(err.message || t('comp.nfe.errSave'));
    } finally { setNfeSaving(false); }
  }

  async function handleBankSave(e: FormEvent) {
    e.preventDefault(); setBankError(''); setBankSuccess('');
    setBankSaving(true);
    try {
      await api.patch('/v1/tenant', {
        bank_code:              bankForm.bank_code              || null,
        agency:                 bankForm.agency                 || null,
        account:                bankForm.account                || null,
        account_digit:          bankForm.account_digit          || null,
        billing_provider:       bankForm.billing_provider       || null,
        billing_days_to_expire: bankForm.billing_days_to_expire ? Number(bankForm.billing_days_to_expire) : null,
      });
      setBankSuccess(t('comp.bank.saved'));
      loadTenant();
    } catch (err: any) {
      setBankError(err.message || t('comp.bank.errSave'));
    } finally { setBankSaving(false); }
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

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)' }}>
        {(['general', 'banking', 'fiscal'] as const).map(key => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: 'none', border: 'none', padding: '10px 20px', cursor: 'pointer',
            fontWeight: tab === key ? 700 : 400,
            color: tab === key ? 'var(--primary)' : 'var(--muted)',
            borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: -2, fontSize: 14,
          }}>
            {key === 'general' ? t('comp.tabGeneral') : key === 'banking' ? t('comp.tabBanking') : t('comp.tabFiscal')}
          </button>
        ))}
      </div>

      {tab === 'general' && (
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
      )}

      {tab === 'banking' && (
        <div style={{ maxWidth: 600 }}>
          <div className="card" style={{ padding: 24 }}>
            <form onSubmit={handleBankSave} noValidate>
              {bankError   && <div role="alert" className="alert alert-error"   style={{ marginBottom: 16 }}>{bankError}</div>}
              {bankSuccess && <div role="alert" className="alert alert-success"  style={{ marginBottom: 16 }}>{bankSuccess}</div>}

              <h3 style={{ marginBottom: 8 }}>{t('comp.bank.title')}</h3>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>{t('comp.bank.hint')}</p>

              <div className="field">
                <label>{t('comp.bank.bankCode')}</label>
                <select value={bankForm.bank_code}
                  onChange={e => setBankForm(f => ({ ...f, bank_code: e.target.value }))}>
                  <option value="">{t('comp.bank.selectBank')}</option>
                  {BANKS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </div>

              <div className="field-row">
                <div className="field">
                  <label>{t('comp.bank.agency')}</label>
                  <input type="text" value={bankForm.agency}
                    placeholder={t('comp.bank.agencyPH')}
                    onChange={e => setBankForm(f => ({ ...f, agency: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 2 }}>
                  <label>{t('comp.bank.account')}</label>
                  <input type="text" value={bankForm.account}
                    placeholder={t('comp.bank.accountPH')}
                    onChange={e => setBankForm(f => ({ ...f, account: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 0.6 }}>
                  <label>{t('comp.bank.accountDigit')}</label>
                  <input type="text" value={bankForm.account_digit} maxLength={2}
                    placeholder={t('comp.bank.digitPH')}
                    onChange={e => setBankForm(f => ({ ...f, account_digit: e.target.value }))} />
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label>{t('comp.bank.provider')}</label>
                  <select value={bankForm.billing_provider}
                    onChange={e => setBankForm(f => ({ ...f, billing_provider: e.target.value }))}>
                    {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>{t('comp.bank.daysToExpire')}</label>
                  <input type="number" min={1} max={365} value={bankForm.billing_days_to_expire}
                    onChange={e => setBankForm(f => ({ ...f, billing_days_to_expire: e.target.value }))} />
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <button type="submit" className="btn btn-primary" disabled={bankSaving}>
                  {bankSaving ? t('c.saving') : t('c.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tab === 'fiscal' && (
        <div style={{ maxWidth: 720 }}>
          {nfeLoading ? (
            <div className="spinner">{t('c.loading')}</div>
          ) : (
            <div className="card" style={{ padding: 24 }}>
              <form onSubmit={handleNfeSave} noValidate>
                {nfeError   && <div role="alert" className="alert alert-error"   style={{ marginBottom: 16 }}>{nfeError}</div>}
                {nfeSuccess && <div role="alert" className="alert alert-success"  style={{ marginBottom: 16 }}>{nfeSuccess}</div>}

                <h3 style={{ marginBottom: 8 }}>{t('comp.nfe.title')}</h3>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>{t('comp.nfe.hint')}</p>

                {/* Dados do emitente */}
                <div className="field-row">
                  <div className="field">
                    <label>{t('comp.nfe.cnpj')} *</label>
                    <input type="text" value={nfeForm.cnpj} maxLength={18}
                      placeholder="00.000.000/0001-00"
                      onChange={e => setNfeForm(f => ({ ...f, cnpj: e.target.value }))} required />
                  </div>
                  <div className="field" style={{ flex: 2 }}>
                    <label>{t('comp.nfe.razaoSocial')} *</label>
                    <input type="text" value={nfeForm.razao_social}
                      onChange={e => setNfeForm(f => ({ ...f, razao_social: e.target.value }))} required />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>{t('comp.nfe.nomeFantasia')}</label>
                    <input type="text" value={nfeForm.nome_fantasia}
                      onChange={e => setNfeForm(f => ({ ...f, nome_fantasia: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{t('comp.nfe.regime')}</label>
                    <select value={nfeForm.regime_tributario}
                      onChange={e => setNfeForm(f => ({ ...f, regime_tributario: e.target.value }))}>
                      <option value="1">{t('comp.nfe.regime1')}</option>
                      <option value="2">{t('comp.nfe.regime2')}</option>
                      <option value="3">{t('comp.nfe.regime3')}</option>
                    </select>
                  </div>
                </div>

                {/* Endereço */}
                <div className="field-row" style={{ marginTop: 8 }}>
                  <div className="field" style={{ flex: 2 }}>
                    <label>{t('comp.street')}</label>
                    <input type="text" value={nfeForm.logradouro}
                      onChange={e => setNfeForm(f => ({ ...f, logradouro: e.target.value }))} />
                  </div>
                  <div className="field" style={{ flex: 0.6 }}>
                    <label>{t('comp.number')}</label>
                    <input type="text" value={nfeForm.numero}
                      onChange={e => setNfeForm(f => ({ ...f, numero: e.target.value }))} />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>{t('comp.complement')}</label>
                    <input type="text" value={nfeForm.complemento}
                      onChange={e => setNfeForm(f => ({ ...f, complemento: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{t('comp.neighborhood')}</label>
                    <input type="text" value={nfeForm.bairro}
                      onChange={e => setNfeForm(f => ({ ...f, bairro: e.target.value }))} />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field" style={{ flex: 2 }}>
                    <label>{t('comp.city')}</label>
                    <input type="text" value={nfeForm.municipio}
                      onChange={e => setNfeForm(f => ({ ...f, municipio: e.target.value.toUpperCase() }))} />
                  </div>
                  <div className="field" style={{ flex: 0.5 }}>
                    <label>{t('comp.state')}</label>
                    <input type="text" value={nfeForm.uf} maxLength={2}
                      onChange={e => setNfeForm(f => ({ ...f, uf: e.target.value.toUpperCase() }))} />
                  </div>
                  <div className="field">
                    <label>{t('comp.postalCode')}</label>
                    <input type="text" value={nfeForm.cep} maxLength={9}
                      onChange={e => setNfeForm(f => ({ ...f, cep: e.target.value }))} />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>{t('comp.phone')}</label>
                    <input type="text" value={nfeForm.telefone}
                      onChange={e => setNfeForm(f => ({ ...f, telefone: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{t('c.email')}</label>
                    <input type="email" value={nfeForm.email}
                      onChange={e => setNfeForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                </div>

                {/* Configurações fiscais */}
                <div className="field-row" style={{ marginTop: 8 }}>
                  <div className="field">
                    <label>{t('comp.nfe.cfopPadrao')}</label>
                    <input type="text" value={nfeForm.cfop_padrao} maxLength={4}
                      onChange={e => setNfeForm(f => ({ ...f, cfop_padrao: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{t('comp.nfe.cfopInterest')}</label>
                    <input type="text" value={nfeForm.cfop_interestadual} maxLength={4}
                      onChange={e => setNfeForm(f => ({ ...f, cfop_interestadual: e.target.value }))} />
                  </div>
                  <div className="field" style={{ flex: 2 }}>
                    <label>{t('comp.nfe.natOp')}</label>
                    <input type="text" value={nfeForm.natureza_operacao}
                      onChange={e => setNfeForm(f => ({ ...f, natureza_operacao: e.target.value }))} />
                  </div>
                </div>

                {/* Ambiente Focus NF-e */}
                <div className="field" style={{ marginTop: 8 }}>
                  <label>{t('comp.nfe.ambiente')}</label>
                  <select value={nfeForm.focus_ambiente}
                    onChange={e => setNfeForm(f => ({ ...f, focus_ambiente: e.target.value }))}>
                    <option value="2">{t('comp.nfe.homo')}</option>
                    <option value="1">{t('comp.nfe.prod')}</option>
                  </select>
                </div>

                {/* Tokens por tenant */}
                <div style={{ marginTop: 16, padding: '16px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <h4 style={{ marginBottom: 4 }}>{t('comp.nfe.tokensTitle')}</h4>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{t('comp.nfe.tokenHint')}</p>

                  <div className="field">
                    <label>{t('comp.nfe.tokenHomo')}</label>
                    {nfeCfg?.focus_token_homologacao && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                        {t('comp.nfe.tokenSet')}: <code>{nfeCfg.focus_token_homologacao}</code>
                      </div>
                    )}
                    <input type="password" value={nfeForm.focus_token_homologacao}
                      placeholder={nfeCfg?.focus_token_homologacao ? t('comp.nfe.tokenKeep') : t('comp.nfe.tokenPH')}
                      autoComplete="new-password"
                      onChange={e => setNfeForm(f => ({ ...f, focus_token_homologacao: e.target.value }))} />
                  </div>

                  <div className="field">
                    <label>{t('comp.nfe.tokenProd')}</label>
                    {nfeCfg?.focus_token_producao && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                        {t('comp.nfe.tokenSet')}: <code>{nfeCfg.focus_token_producao}</code>
                      </div>
                    )}
                    <input type="password" value={nfeForm.focus_token_producao}
                      placeholder={nfeCfg?.focus_token_producao ? t('comp.nfe.tokenKeep') : t('comp.nfe.tokenPH')}
                      autoComplete="new-password"
                      onChange={e => setNfeForm(f => ({ ...f, focus_token_producao: e.target.value }))} />
                  </div>
                </div>

                <div style={{ marginTop: 20 }}>
                  <button type="submit" className="btn btn-primary" disabled={nfeSaving}>
                    {nfeSaving ? t('c.saving') : t('c.save')}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
