import { useEffect, useState, useRef, FormEvent } from 'react';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';
import { digits, fetchAddressByCEP } from '../../lib/brazil';
import type { TKey } from '../../i18n/pt-BR';

interface Tenant {
  id: string; company_name: string; trade_name: string | null;
  tax_id: string; tax_id_type: string; phone: string | null; website: string | null;
  street: string | null; street_number: string | null; complement: string | null;
  neighborhood: string | null; city: string | null; state: string | null; postal_code: string | null;
  logo_url: string | null; state_reg: string | null; proposal_banner_url: string | null;
  status: string; plan: string;
  bank_code: string | null; agency: string | null; account: string | null; account_digit: string | null;
  billing_provider: string | null; billing_days_to_expire: number | null;
  itau_client_id: string | null; itau_client_secret: string | null;
  simples_rbt12: string | null;
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
  // NFS-e
  inscricao_municipal: string | null;
  codigo_municipio_ibge: string | null;
  aliquota_iss_padrao: string | null;
  codigo_servico_padrao: string | null;
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
  inscricao_municipal: '', codigo_municipio_ibge: '3550308',
  aliquota_iss_padrao: '5.00', codigo_servico_padrao: '',
};

const MAX_LOGO_SIZE = 300 * 1024; // 300 KB
const MAX_BANNER_SIZE = 5 * 1024 * 1024; // 5 MB — banner da proposta

const BANKS = [
  { value: '341', label: 'Itaú (341)' },
];

const PROVIDERS = [
  { value: 'itau', label: 'Itaú' },
];

export function CompanyPage() {
  const { tenantId } = useAuth();
  const { t }        = useI18n();

  const [tab, setTab]           = useState<'general' | 'banking' | 'fiscal' | 'notifications' | 'modules'>('general');
  const [tenant, setTenant]     = useState<Tenant | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [success, setSuccess]   = useState('');
  const [error, setError]       = useState('');
  const [logoError, setLogoError] = useState('');
  const [logoSaving, setLogoSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [bannerError, setBannerError] = useState('');
  const [bannerSaving, setBannerSaving] = useState(false);
  const bannerRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    company_name: '', trade_name: '', state_reg: '', phone: '', website: '',
    street: '', street_number: '', complement: '', neighborhood: '',
    city: '', state: '', postal_code: '',
  });

  const [bankForm, setBankForm] = useState({
    bank_code: '', agency: '', account: '', account_digit: '',
    billing_provider: 'itau', billing_days_to_expire: '30',
    itau_client_id: '', itau_client_secret: '',
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
  const [cepLoading, setCepLoading]   = useState(false);

  const [notifForm, setNotifForm]     = useState({ notify_receivable_due_days: 3 });
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifSuccess, setNotifSuccess] = useState('');
  const [notifError, setNotifError]   = useState('');
  // Simples Nacional — faturamento bruto acumulado 12 meses (tenants.simples_rbt12)
  const [simplesRbt12,       setSimplesRbt12]       = useState('');
  const [simplesRbt12Saving, setSimplesRbt12Saving] = useState(false);
  const [simplesRbt12Msg,    setSimplesRbt12Msg]    = useState('');

  useEffect(() => {
    if (!tenantId) return;
    loadTenant();
    loadNfeConfig();
    loadNotifConfig();
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
        state_reg:     data.state_reg     || '',
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
      setSimplesRbt12(data.simples_rbt12 != null ? String(data.simples_rbt12) : '');
      setBankForm({
        bank_code:              data.bank_code              || '',
        agency:                 data.agency                 || '',
        account:                data.account                || '',
        account_digit:          data.account_digit          || '',
        billing_provider:       data.billing_provider       || 'itau',
        billing_days_to_expire: String(data.billing_days_to_expire ?? 30),
        itau_client_id:         data.itau_client_id         || '',
        itau_client_secret:     data.itau_client_secret     || '',
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
        inscricao_municipal:    data.inscricao_municipal || '',
        codigo_municipio_ibge:  data.codigo_municipio_ibge || '3550308',
        aliquota_iss_padrao:    data.aliquota_iss_padrao != null ? String(data.aliquota_iss_padrao) : '5.00',
        codigo_servico_padrao:  data.codigo_servico_padrao || '',
      });
    } catch {
      // 404 is expected if no config yet; other errors are silent (user sees empty form)
      setNfeForm({ ...EMPTY_NFE_FORM });
    } finally { setNfeLoading(false); }
  }

  async function loadNotifConfig() {
    try {
      const data = await api.get<any>(`/v1/notification-config?tenant_id=${tenantId}`);
      setNotifForm({ notify_receivable_due_days: data.notify_receivable_due_days ?? 3 });
    } catch { /* silent */ }
  }

  async function handleNotifSave(e: React.FormEvent) {
    e.preventDefault(); setNotifError(''); setNotifSuccess('');
    setNotifSaving(true);
    try {
      await api.put('/v1/notification-config', {
        tenant_id: tenantId,
        notify_receivable_due_days: notifForm.notify_receivable_due_days,
      });
      setNotifSuccess(t('comp.saved'));
    } catch (err: any) {
      setNotifError(err.message || t('comp.errSave'));
    } finally { setNotifSaving(false); }
  }

  async function handleSimplesRbt12Save() {
    setSimplesRbt12Saving(true); setSimplesRbt12Msg('');
    try {
      await api.patch('/v1/tenant', {
        simples_rbt12: simplesRbt12 ? Number(simplesRbt12) : null,
      });
      setSimplesRbt12Msg(t('comp.saved'));
    } catch (err: any) {
      setSimplesRbt12Msg(err.message || t('comp.errSave'));
    } finally { setSimplesRbt12Saving(false); }
  }

  async function handleNfeCEP(cep: string) {
    setCepLoading(true);
    const addr = await fetchAddressByCEP(cep);
    setCepLoading(false);
    if (!addr) return;
    setNfeForm(f => ({
      ...f,
      logradouro: addr.street       || f.logradouro,
      bairro:     addr.neighborhood || f.bairro,
      municipio:  addr.city         ? addr.city.toUpperCase() : f.municipio,
      uf:         addr.state        || f.uf,
    }));
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
        inscricao_municipal:    nfeForm.inscricao_municipal || null,
        codigo_municipio_ibge:  nfeForm.codigo_municipio_ibge || null,
        aliquota_iss_padrao:    nfeForm.aliquota_iss_padrao ? Number(nfeForm.aliquota_iss_padrao) : null,
        codigo_servico_padrao:  nfeForm.codigo_servico_padrao || null,
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
        itau_client_id:         bankForm.itau_client_id         || null,
        itau_client_secret:     bankForm.itau_client_secret     || null,
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

  function handleBannerClick() { bannerRef.current?.click(); }

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBannerError('');

    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setBannerError(t('comp.logoTypeErr')); return;
    }
    if (file.size > MAX_BANNER_SIZE) {
      setBannerError(t('comp.bannerSizeErr')); return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUri = ev.target?.result as string;
      setBannerSaving(true);
      try {
        await api.put('/v1/tenant/proposal-banner', { banner_url: dataUri });
        await loadTenant();
      } catch (err: any) {
        setBannerError(err.message || t('comp.errSave'));
      } finally {
        setBannerSaving(false);
        if (bannerRef.current) bannerRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleBannerDelete() {
    setBannerError('');
    setBannerSaving(true);
    try {
      await api.delete('/v1/tenant/proposal-banner');
      await loadTenant();
    } catch (err: any) {
      setBannerError(err.message || t('comp.errSave'));
    } finally { setBannerSaving(false); }
  }

  if (loading) return <div className="spinner">{t('c.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{t('comp.title')}</h1>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)' }}>
        {(['general', 'banking', 'fiscal', 'notifications', 'modules'] as const).map(key => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: 'none', border: 'none', padding: '10px 20px', cursor: 'pointer',
            fontWeight: tab === key ? 700 : 400,
            color: tab === key ? 'var(--primary)' : 'var(--muted)',
            borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: -2, fontSize: 14,
          }}>
            {key === 'general' ? t('comp.tabGeneral') : key === 'banking' ? t('comp.tabBanking') : key === 'fiscal' ? t('comp.tabFiscal') : key === 'notifications' ? t('comp.tabNotifications') : t('comp.tabModules')}
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

              <div className="field-row">
                <div className="field">
                  <label>{t('comp.stateReg')}</label>
                  <input type="text" value={form.state_reg}
                    onChange={e => setForm(f => ({ ...f, state_reg: e.target.value }))}
                    placeholder={t('comp.stateRegPH')} />
                </div>
                <div className="field" />
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

            {/* Banner da proposta */}
            <div className="card" style={{ padding: 20, textAlign: 'center' }}>
              <h4 style={{ marginBottom: 12 }}>{t('comp.banner')}</h4>

              {tenant?.proposal_banner_url ? (
                <img src={tenant.proposal_banner_url} alt="Banner" style={{
                  width: '100%', height: 90, objectFit: 'cover',
                  borderRadius: 8, marginBottom: 12, border: '1px solid var(--border)',
                }} />
              ) : (
                <div style={{
                  width: '100%', height: 90, background: 'var(--surface)',
                  borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--muted)', fontSize: 13, marginBottom: 12,
                  border: '2px dashed var(--border)',
                }}>
                  {t('comp.noBanner')}
                </div>
              )}

              {bannerError && <div role="alert" className="alert alert-error" style={{ fontSize: 12, marginBottom: 8 }}>{bannerError}</div>}

              <input ref={bannerRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                style={{ display: 'none' }} onChange={handleBannerChange} />

              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-secondary btn-sm" onClick={handleBannerClick} disabled={bannerSaving}>
                  {bannerSaving ? t('c.saving') : (tenant?.proposal_banner_url ? t('comp.changeBanner') : t('comp.uploadBanner'))}
                </button>
                {tenant?.proposal_banner_url && (
                  <button className="btn btn-danger btn-sm" onClick={handleBannerDelete} disabled={bannerSaving}>
                    {t('comp.removeBanner')}
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                {t('comp.bannerHint')}
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

              {bankForm.billing_provider === 'itau' && (
                <>
                  <div style={{ marginTop: 16, marginBottom: 8, fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>
                    {t('comp.bank.itauOauth')}
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>{t('comp.bank.itauClientId')}</label>
                      <input type="text" value={bankForm.itau_client_id}
                        placeholder={t('comp.bank.itauClientIdPH')}
                        onChange={e => setBankForm(f => ({ ...f, itau_client_id: e.target.value }))} />
                    </div>
                    <div className="field">
                      <label>{t('comp.bank.itauClientSecret')}</label>
                      <input type="password" value={bankForm.itau_client_secret}
                        placeholder={t('comp.bank.itauClientSecretPH')}
                        autoComplete="new-password"
                        onChange={e => setBankForm(f => ({ ...f, itau_client_secret: e.target.value }))} />
                    </div>
                  </div>
                </>
              )}

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

                {/* Simples Nacional — RBT12: mostrado apenas quando regime = 1 */}
                {nfeForm.regime_tributario === '1' && (
                  <div style={{ marginTop: 12, padding: '14px 16px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div className="field" style={{ marginBottom: 10 }}>
                      <label>{t('comp.nfe.rbt12')}</label>
                      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 8px' }}>{t('comp.nfe.rbt12Hint')}</p>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={simplesRbt12}
                        placeholder="Ex.: 250000.00"
                        onChange={e => setSimplesRbt12(e.target.value)}
                        style={{ maxWidth: 220 }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                        onClick={() => void handleSimplesRbt12Save()}
                        disabled={simplesRbt12Saving}>
                        {simplesRbt12Saving ? t('c.saving') : t('c.save')}
                      </button>
                      {simplesRbt12Msg && (
                        <span style={{ fontSize: 12, color: simplesRbt12Msg.startsWith('Erro') ? 'var(--danger)' : 'var(--success)' }}>
                          {simplesRbt12Msg}
                        </span>
                      )}
                    </div>
                  </div>
                )}

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
                    <label>
                      {t('comp.postalCode')}
                      {cepLoading && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>{t('sup.searching')}</span>}
                    </label>
                    <input type="text" value={nfeForm.cep} maxLength={9}
                      onChange={e => setNfeForm(f => ({ ...f, cep: e.target.value }))}
                      onBlur={e => { if (digits(e.target.value).length === 8) void handleNfeCEP(e.target.value); }} />
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

                {/* Ambiente Focus NF-e — toggle HML/PRD */}
                <div className="field" style={{ marginTop: 8 }}>
                  <label>{t('comp.nfe.ambiente')}</label>
                  <div className="seg-toggle">
                    <button type="button"
                      className={`seg-homo ${nfeForm.focus_ambiente === '2' ? 'is-active' : ''}`}
                      onClick={() => setNfeForm(f => ({ ...f, focus_ambiente: '2' }))}>
                      {t('comp.nfe.homo')}
                    </button>
                    <button type="button"
                      className={`seg-prod ${nfeForm.focus_ambiente === '1' ? 'is-active' : ''}`}
                      onClick={() => setNfeForm(f => ({ ...f, focus_ambiente: '1' }))}>
                      {t('comp.nfe.prod')}
                    </button>
                  </div>
                  {nfeForm.focus_ambiente === '1' && (
                    <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6, fontWeight: 600 }}>
                      {t('comp.nfe.prodWarn')}
                    </div>
                  )}
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

                {/* ── NFS-e (Nota Fiscal de Serviços) ── */}
                <div style={{ marginTop: 16, padding: '16px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <h4 style={{ marginBottom: 4 }}>{t('comp.nfse.title')}</h4>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{t('comp.nfse.hint')}</p>

                  <div className="field-row">
                    <div className="field">
                      <label>{t('comp.nfse.inscricaoMunicipal')}</label>
                      <input type="text" value={nfeForm.inscricao_municipal} maxLength={20}
                        onChange={e => setNfeForm(f => ({ ...f, inscricao_municipal: e.target.value }))} />
                    </div>
                    <div className="field">
                      <label>{t('comp.nfse.codigoMunicipioIbge')}</label>
                      <input type="text" value={nfeForm.codigo_municipio_ibge} maxLength={10}
                        onChange={e => setNfeForm(f => ({ ...f, codigo_municipio_ibge: e.target.value }))} />
                    </div>
                  </div>

                  <div className="field-row">
                    <div className="field">
                      <label>{t('comp.nfse.aliquotaIss')}</label>
                      <input type="number" step="0.01" min={0} value={nfeForm.aliquota_iss_padrao}
                        onChange={e => setNfeForm(f => ({ ...f, aliquota_iss_padrao: e.target.value }))} />
                    </div>
                    <div className="field">
                      <label>{t('comp.nfse.codigoServico')}</label>
                      <input type="text" value={nfeForm.codigo_servico_padrao} maxLength={10}
                        placeholder={t('comp.nfse.codigoServicoPH')}
                        onChange={e => setNfeForm(f => ({ ...f, codigo_servico_padrao: e.target.value }))} />
                    </div>
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

      {tab === 'notifications' && (
        <div style={{ maxWidth: 600 }}>
          <div className="card" style={{ padding: 24 }}>
            <form onSubmit={handleNotifSave} noValidate>
              {notifError   && <div role="alert" className="alert alert-error"   style={{ marginBottom: 16 }}>{notifError}</div>}
              {notifSuccess && <div role="alert" className="alert alert-success"  style={{ marginBottom: 16 }}>{notifSuccess}</div>}

              <h3 style={{ marginBottom: 8 }}>{t('comp.tabNotifications')}</h3>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>{t('nc.hint')}</p>

              <div className="field">
                <label>{t('nc.dueDays')}</label>
                <select value={notifForm.notify_receivable_due_days}
                  onChange={e => setNotifForm(f => ({ ...f, notify_receivable_due_days: Number(e.target.value) }))}>
                  <option value={0}>{t('nc.dueDaysOff')}</option>
                  <option value={1}>1 dia antes</option>
                  <option value={3}>3 dias antes</option>
                  <option value={5}>5 dias antes</option>
                  <option value={7}>7 dias antes</option>
                </select>
              </div>

              <div style={{ marginTop: 20 }}>
                <button type="submit" className="btn btn-primary" disabled={notifSaving}>
                  {notifSaving ? t('c.saving') : t('c.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tab === 'modules' && <ModulesTab />}
    </div>
  );
}

// ── Módulos opcionais ─────────────────────────────────────────────────────────
// Backend é sempre a autoridade (requireModule em cada rota gated) — este
// toggle é só a interface de autoatendimento para o tenant ligar/desligar.
interface ModulesResponse { available: string[]; enabled: string[]; }

const MODULE_LABELS: Record<string, { titleKey: 'comp.modules.serviceOrders'; descKey: 'comp.modules.serviceOrdersDesc' }> = {
  service_orders: { titleKey: 'comp.modules.serviceOrders', descKey: 'comp.modules.serviceOrdersDesc' },
};

function ModulesTab() {
  const { t } = useI18n();
  const [data, setData]       = useState<ModulesResponse | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError]     = useState('');

  async function load() {
    try {
      const r = await api.get<ModulesResponse>('/v1/tenant/modules');
      setData(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar módulos');
    }
  }
  useEffect(() => { void load(); }, []);

  async function toggle(key: string, enabled: boolean) {
    setBusyKey(key); setError('');
    try {
      await api.patch(`/v1/tenant/modules/${key}`, { enabled });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar módulo');
    } finally {
      setBusyKey(null);
    }
  }

  if (!data) return <div className="spinner">{t('c.loading')}</div>;

  return (
    <div style={{ maxWidth: 680 }}>
      <h3 style={{ marginBottom: 4 }}>{t('comp.modules.title')}</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>{t('comp.modules.subtitle')}</p>

      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {data.available.map(key => {
        const enabled = data.enabled.includes(key);
        const labels  = MODULE_LABELS[key];
        if (!labels) return null;
        return (
          <div key={key} className="card" style={{ padding: 20, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <strong>{t(labels.titleKey)}</strong>
                  <span className={`badge ${enabled ? 'badge-active' : 'badge-inactive'}`}>
                    {enabled ? t('comp.modules.enabled') : t('comp.modules.disabled')}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{t(labels.descKey)}</p>
              </div>
              <button
                className={`btn ${enabled ? 'btn-secondary' : 'btn-primary'} btn-sm`}
                style={{ width: 'auto', flex: 'none' }}
                disabled={busyKey === key}
                onClick={() => toggle(key, !enabled)}
              >
                {busyKey === key ? t('c.saving') : enabled ? t('comp.modules.disable') : t('comp.modules.enable')}
              </button>
            </div>

            {key === 'service_orders' && <ServiceOrderFlowDiagram />}
          </div>
        );
      })}
    </div>
  );
}

// ── Diagrama do fluxo de Ordem de Serviço / Visita Técnica ────────────────────
// Mostrado junto do módulo (mesmo antes de habilitar) para o tenant entender o
// processo de ponta a ponta antes de decidir ligar a chave.
function ServiceOrderFlowDiagram() {
  const { t } = useI18n();
  const steps: { icon: string; titleKey: TKey; descKey: TKey }[] = [
    { icon: '📋', titleKey: 'so.flow.step1Title', descKey: 'so.flow.step1Desc' },
    { icon: '📅', titleKey: 'so.flow.step2Title', descKey: 'so.flow.step2Desc' },
    { icon: '🔐', titleKey: 'so.flow.step3Title', descKey: 'so.flow.step3Desc' },
    { icon: '📍', titleKey: 'so.flow.step4Title', descKey: 'so.flow.step4Desc' },
    { icon: '📷', titleKey: 'so.flow.step5Title', descKey: 'so.flow.step5Desc' },
    { icon: '✅', titleKey: 'so.flow.step6Title', descKey: 'so.flow.step6Desc' },
  ];

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      <strong style={{ fontSize: 13, display: 'block', marginBottom: 14 }}>{t('comp.modules.howItWorks')}</strong>
      <div>
        {steps.map((s, i) => (
          <div key={s.titleKey} style={{ display: 'flex', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', background: 'var(--primary)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flex: 'none',
              }}>
                {s.icon}
              </div>
              {i < steps.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 22, background: 'var(--border)' }} />}
            </div>
            <div style={{ paddingBottom: i < steps.length - 1 ? 16 : 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{t(s.titleKey)}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{t(s.descKey)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
