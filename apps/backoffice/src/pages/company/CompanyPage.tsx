import { useEffect, useState, useRef, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { digits, fetchAddressByCEP } from '../../lib/brazil';
import type { TKey } from '../../i18n/pt-BR';
import { Switch } from '../../ds/components/Switch';
import { Badge } from '../../ds/components/Badge';
import { Can } from '../../rbac';
import { SEGMENTS, getSegment } from '../../branding/segments';
import { applyPalette, resetPalette } from '../../branding/BrandingProvider';

interface Tenant {
  id: string; company_name: string; trade_name: string | null;
  tax_id: string; tax_id_type: string; phone: string | null; website: string | null;
  street: string | null; street_number: string | null; complement: string | null;
  neighborhood: string | null; city: string | null; state: string | null; postal_code: string | null;
  logo_url: string | null; state_reg: string | null; proposal_banner_url: string | null;
  status: string; plan: string;
  bank_code: string | null; agency: string | null; account: string | null; account_digit: string | null;
  billing_provider: string | null; billing_days_to_expire: number | null;
  itau_client_id: string | null; itau_client_secret: string | null; // @deprecated — ver credentials
  credentials: Record<string, string> | null; // genérico por provedor (migration 0064), mascarado na leitura
  simples_rbt12: string | null;
  // Branding (migration 0065) — segment_key = preset; brand_* = override de cor.
  segment_key: string | null; brand_primary: string | null; brand_accent: string | null;
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
  // Responsabilidade de emissão por empresa (regra 53)
  emite_nfe: boolean;
  emite_nfse: boolean;
}

// Empresa/CNPJ (regra 40) — mesmo shape de NfeCfg, com identidade própria.
// GET /v1/companies sempre retorna ao menos 1 linha (a empresa padrão).
interface Company extends NfeCfg { id: string; is_default: boolean; is_active: boolean; }

// Conta bancária (regra 41) — N por empresa. GET /v1/bank-accounts sempre
// retorna ao menos 1 linha por empresa que já tinha dados bancários configurados.
interface BankAccount {
  id: string; company_id: string; label: string | null; is_default: boolean; is_active: boolean;
  bank_code: string; agency: string; account: string; account_digit: string;
  billing_provider: string; billing_days_to_expire: number;
  itau_client_id: string | null; itau_client_secret: string | null; // @deprecated — ver credentials
  credentials: Record<string, string> | null; // genérico por provedor (migration 0064), mascarado na leitura
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
  emite_nfe: true, emite_nfse: true,
};

// "NF-e" | "NFS-e" | "NF-e + NFS-e" | "—" — etiqueta de resumo pra faixa de
// seleção de empresa (regra 53), sem precisar abrir cada uma pra saber.
function emissionBadge(c: { emite_nfe: boolean; emite_nfse: boolean }): string {
  if (c.emite_nfe && c.emite_nfse) return 'NF-e + NFS-e';
  if (c.emite_nfe) return 'NF-e';
  if (c.emite_nfse) return 'NFS-e';
  return '—';
}

const MAX_LOGO_SIZE = 300 * 1024; // 300 KB
const MAX_BANNER_SIZE = 5 * 1024 * 1024; // 5 MB — banner da proposta

const BANKS = [
  { value: '336', label: 'C6 Bank (336)' },
  { value: '341', label: 'Itaú (341)' },
];

const PROVIDERS = [
  { value: 'itau', label: 'Itaú' },
  { value: 'c6', label: 'C6 Bank' },
];

export function CompanyPage() {
  const { tenantId, refreshUser } = useAuth();
  const { t }        = useI18n();
  const modal         = useModal();

  const [tab, setTab] = useState<'general' | 'branding' | 'banking' | 'fiscal' | 'notifications' | 'modules' | 'integrations'>(
    () => (new URLSearchParams(window.location.search).get('ml_status') ? 'integrations' : 'general'),
  );
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

  // Zona de risco — desativação em massa de produtos sem movimentação de
  // estoque (nunca um DELETE físico, regra 8; mesmo soft-delete de sempre).
  const [bulkDeactivating, setBulkDeactivating] = useState(false);

  // Upload de certificado/chave C6 (mTLS) — mesmo padrão de fileRef/bannerRef
  // acima, mas lendo como texto puro (readAsText), não base64: cert/key já são
  // PEM (texto), diferente de logo/banner que são imagem binária.
  const c6CertRef = useRef<HTMLInputElement>(null);
  const c6KeyRef  = useRef<HTMLInputElement>(null);
  const [c6CertFileName, setC6CertFileName] = useState('');
  const [c6KeyFileName,  setC6KeyFileName]  = useState('');
  const [c6CertWarning,  setC6CertWarning]  = useState('');
  const [c6KeyWarning,   setC6KeyWarning]   = useState('');

  const [form, setForm] = useState({
    company_name: '', trade_name: '', state_reg: '', phone: '', website: '',
    street: '', street_number: '', complement: '', neighborhood: '',
    city: '', state: '', postal_code: '',
  });

  // Branding (migration 0065): segmento + override de cor. brand_* vazio = usar
  // a cor do preset do segmento. Preview ao vivo aplica as CSS vars na hora.
  const [brandingForm, setBrandingForm] = useState({ segment_key: 'generic', brand_primary: '', brand_accent: '' });
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingSuccess, setBrandingSuccess] = useState('');
  const [brandingError, setBrandingError] = useState('');

  const [bankForm, setBankForm] = useState({
    bank_code: '', agency: '', account: '', account_digit: '',
    billing_provider: 'itau', billing_days_to_expire: '30',
    itau_client_id: '', itau_client_secret: '',
    c6_client_id: '', c6_client_secret: '', c6_cert: '', c6_key: '',
  });
  const [bankSaving, setBankSaving] = useState(false);
  const [bankSuccess, setBankSuccess] = useState('');
  const [bankError, setBankError]   = useState('');

  // Indica, por campo sensível, se JÁ existe um valor salvo no backend —
  // client_secret/cert/key nunca são pré-preenchidos de volta no formulário
  // (o backend só devolve mascarado, ****xxxx, e reenviar isso como se fosse
  // um valor novo corromperia o segredo real). Sem esse indicador, um campo
  // em branco parecia "nada foi salvo", quando na verdade só está esperando
  // um valor novo pra trocar — achado do usuário testando com credenciais
  // reais de C6.
  const [credentialsConfigured, setCredentialsConfigured] = useState({
    itau_client_secret: false, c6_client_secret: false, c6_cert: false, c6_key: false,
  });
  // "Definir como conta padrão" — ação explícita no salvar, nunca implícita.
  // Antes não existia NENHUM jeito de promover uma conta não-padrão (ex.: a
  // C6 recém-cadastrada) a padrão pela tela — só a 1ª conta de cada empresa
  // nascia padrão automaticamente.
  const [setAsDefaultOnSave, setSetAsDefaultOnSave] = useState(false);

  // Multi-conta bancária (regra 41) — N contas por empresa. Seletor só aparece
  // com mais de 1 conta no tenant; tenant com 1 empresa/1 conta não vê mudança.
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankingCompanyId, setBankingCompanyId] = useState<string | null>(null);
  // null = conta padrão da empresa padrão (fluxo legado /v1/tenant) · 'new' =
  // criando nova conta · id = editando uma conta específica via /v1/bank-accounts/:id
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string | 'new' | null>(null);

  const [nfeCfg, setNfeCfg]           = useState<NfeCfg | null>(null);
  const [nfeLoading, setNfeLoading]   = useState(false);
  const [nfeForm, setNfeForm]         = useState({ ...EMPTY_NFE_FORM });
  const [nfeSaving, setNfeSaving]     = useState(false);
  const [nfeSuccess, setNfeSuccess]   = useState('');
  const [nfeError, setNfeError]       = useState('');
  const [cepLoading, setCepLoading]   = useState(false);

  // Multi-empresa (regra 40) — módulo opcional. companies sempre tem ao menos
  // 1 linha (a empresa padrão); o seletor só aparece com mais de uma.
  const [companies, setCompanies]             = useState<Company[]>([]);
  const [multiEmpresaEnabled, setMultiEmpresaEnabled] = useState(false);
  // null = empresa padrão (fluxo legado /v1/nfe-config) · 'new' = criando nova
  // empresa · id = editando uma empresa específica não-padrão via /v1/companies/:id
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | 'new' | null>(null);

  // Fallback: se o tenant nunca configurou nenhuma conta bancária ainda,
  // bankAccounts vem vazio e não há de onde inferir bankingCompanyId a partir
  // dele — usa a empresa padrão assim que companies carregar, senão "+ Nova
  // Conta" nunca teria um company_id para enviar no POST.
  useEffect(() => {
    if (bankingCompanyId || companies.length === 0) return;
    setBankingCompanyId(companies.find(c => c.is_default)?.id ?? companies[0]?.id ?? null);
  }, [companies, bankingCompanyId]);

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
    loadCompanies();
    loadMultiEmpresaFlag();
    loadBankAccounts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function loadCompanies() {
    try {
      const r = await api.get<{ data: Company[] }>('/v1/companies');
      setCompanies(r.data);
    } catch { /* silent — comportamento de empresa única fica intacto */ }
  }

  async function loadBankAccounts() {
    try {
      const r = await api.get<{ data: BankAccount[] }>('/v1/bank-accounts');
      setBankAccounts(r.data);
      setBankingCompanyId(prev => prev || r.data.find(a => a.is_default)?.company_id || null);
    } catch { /* silent — comportamento de conta única fica intacto */ }
  }

  function fillBankFormFromAccount(a: BankAccount) {
    // credentials vem mascarado do backend (****xxxx em client_secret/cert/key)
    // — client_id não é sensível, então é o único campo pré-preenchido de
    // verdade; os demais ficam em branco (usuário precisa reenviar pra trocar,
    // mesmo comportamento que o Itaú já tem hoje pro client_secret). O
    // indicador "já configurado" (abaixo) é o que deixa isso visível na tela,
    // em vez de parecer que o dado nunca foi salvo.
    const c = a.credentials || {};
    setBankForm({
      bank_code: a.bank_code || '', agency: a.agency || '', account: a.account || '', account_digit: a.account_digit || '',
      billing_provider: a.billing_provider || 'itau', billing_days_to_expire: String(a.billing_days_to_expire ?? 30),
      itau_client_id: a.itau_client_id || '', itau_client_secret: '',
      c6_client_id: a.billing_provider === 'c6' ? (c.client_id || '') : '',
      c6_client_secret: '', c6_cert: '', c6_key: '',
    });
    setCredentialsConfigured({
      itau_client_secret: Boolean(a.itau_client_secret),
      c6_client_secret:   Boolean(c.client_secret),
      c6_cert:             Boolean(c.cert),
      c6_key:               Boolean(c.key),
    });
    setSetAsDefaultOnSave(false);
    resetC6FileState();
  }

  function resetC6FileState() {
    setC6CertFileName(''); setC6KeyFileName('');
    setC6CertWarning(''); setC6KeyWarning('');
  }

  function selectBankAccount(id: string | 'new' | null) {
    setSelectedBankAccountId(id);
    setBankError(''); setBankSuccess('');
    if (id === 'new') {
      setBankForm({
        bank_code: '', agency: '', account: '', account_digit: '', billing_provider: 'itau', billing_days_to_expire: '30',
        itau_client_id: '', itau_client_secret: '', c6_client_id: '', c6_client_secret: '', c6_cert: '', c6_key: '',
      });
      setCredentialsConfigured({ itau_client_secret: false, c6_client_secret: false, c6_cert: false, c6_key: false });
      setSetAsDefaultOnSave(false);
      resetC6FileState();
      return;
    }
    if (id === null) { loadTenant(); return; } // conta padrão — fluxo legado
    const account = bankAccounts.find(a => a.id === id);
    if (account) fillBankFormFromAccount(account);
  }

  async function loadMultiEmpresaFlag() {
    try {
      const r = await api.get<{ available: string[]; enabled: string[] }>('/v1/tenant/modules');
      setMultiEmpresaEnabled(r.enabled.includes('multi_empresa'));
    } catch { /* silent */ }
  }

  function fillNfeFormFromCompany(c: Company) {
    setNfeForm({
      cnpj: c.cnpj || '', razao_social: c.razao_social || '', nome_fantasia: c.nome_fantasia || '',
      regime_tributario: String(c.regime_tributario ?? 1),
      logradouro: c.logradouro || '', numero: c.numero || '', complemento: c.complemento || '',
      bairro: c.bairro || '', municipio: c.municipio || 'SAO PAULO', uf: c.uf || 'SP', cep: c.cep || '',
      telefone: c.telefone || '', email: c.email || '',
      cfop_padrao: c.cfop_padrao || '5102', cfop_interestadual: c.cfop_interestadual || '6102',
      natureza_operacao: c.natureza_operacao || 'Venda de mercadoria', focus_ambiente: String(c.focus_ambiente ?? 2),
      focus_token_homologacao: '', focus_token_producao: '',
      inscricao_municipal: c.inscricao_municipal || '', codigo_municipio_ibge: c.codigo_municipio_ibge || '3550308',
      aliquota_iss_padrao: c.aliquota_iss_padrao != null ? String(c.aliquota_iss_padrao) : '5.00',
      codigo_servico_padrao: c.codigo_servico_padrao || '',
      emite_nfe: c.emite_nfe ?? true, emite_nfse: c.emite_nfse ?? true,
    });
  }

  function selectCompany(id: string | 'new' | null) {
    setSelectedCompanyId(id);
    setNfeError(''); setNfeSuccess('');
    if (id === 'new') { setNfeForm({ ...EMPTY_NFE_FORM }); return; }
    if (id === null) { loadNfeConfig(); return; } // empresa padrão — fluxo legado
    const company = companies.find(c => c.id === id);
    if (company) fillNfeFormFromCompany(company);
  }

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
      setBrandingForm({
        segment_key:   data.segment_key   || 'generic',
        brand_primary: data.brand_primary || '',
        brand_accent:  data.brand_accent  || '',
      });
      const c = data.credentials || {};
      setBankForm({
        bank_code:              data.bank_code              || '',
        agency:                 data.agency                 || '',
        account:                data.account                || '',
        account_digit:          data.account_digit          || '',
        billing_provider:       data.billing_provider       || 'itau',
        billing_days_to_expire: String(data.billing_days_to_expire ?? 30),
        itau_client_id:         data.itau_client_id         || '',
        // itau_client_secret NUNCA pré-preenchido com o valor mascarado
        // (****xxxx) que a API devolve — reenviar isso como se fosse um
        // valor novo corromperia o segredo real (achado do usuário testando
        // com credenciais reais de C6, corrigido aqui e no caminho de
        // fillBankFormFromAccount, que já fazia certo). O indicador "já
        // configurado" abaixo é o que mostra que existe algo salvo.
        itau_client_secret: '',
        c6_client_id:           data.billing_provider === 'c6' ? (c.client_id || '') : '',
        c6_client_secret: '', c6_cert: '', c6_key: '',
      });
      setCredentialsConfigured({
        itau_client_secret: Boolean(data.itau_client_secret),
        c6_client_secret:   Boolean(c.client_secret),
        c6_cert:             Boolean(c.cert),
        c6_key:               Boolean(c.key),
      });
      setSetAsDefaultOnSave(false);
      resetC6FileState();
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

  // Cor efetiva de preview: override manual, senão a cor do preset do segmento.
  const brandingPreset  = getSegment(brandingForm.segment_key);
  const effectivePrimary = brandingForm.brand_primary || brandingPreset.primary;
  const effectiveAccent  = brandingForm.brand_accent  || brandingPreset.accent;

  // Preview ao vivo enquanto a aba está aberta; ao sair, o BrandingProvider
  // (controlado pelo /auth/me) volta a mandar — restauramos o estado salvo.
  useEffect(() => {
    if (tab !== 'branding') return;
    applyPalette(effectivePrimary, effectiveAccent);
    return () => { void refreshUser().catch(() => resetPalette()); };
  }, [tab, effectivePrimary, effectiveAccent, refreshUser]);

  async function handleBrandingSave(e: FormEvent) {
    e.preventDefault(); setBrandingError(''); setBrandingSuccess('');
    setBrandingSaving(true);
    try {
      await api.patch('/v1/tenant', {
        segment_key:   brandingForm.segment_key,
        brand_primary: brandingForm.brand_primary || null,
        brand_accent:  brandingForm.brand_accent  || null,
      });
      setBrandingSuccess(t('comp.saved'));
      await refreshUser();        // /auth/me atualiza → BrandingProvider reaplica
      await loadTenant();
    } catch (err: any) {
      setBrandingError(err.message || t('comp.errSave'));
    } finally { setBrandingSaving(false); }
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
        emite_nfe:              data.emite_nfe ?? true, emite_nfse: data.emite_nfse ?? true,
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

    const payload = {
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
      emite_nfe:              nfeForm.emite_nfe,
      emite_nfse:             nfeForm.emite_nfse,
    };

    try {
      if (selectedCompanyId === 'new') {
        await api.post('/v1/companies', payload);
        setNfeSuccess(t('comp.nfe.saved'));
        await loadCompanies();
        setSelectedCompanyId(null);
        loadNfeConfig();
      } else if (selectedCompanyId) {
        await api.patch(`/v1/companies/${selectedCompanyId}`, payload);
        setNfeSuccess(t('comp.nfe.saved'));
        await loadCompanies();
      } else {
        // Empresa padrão — fluxo legado, retrocompatível (regra 40).
        await api.put('/v1/nfe-config', { tenant_id: tenantId, ...payload });
        setNfeSuccess(t('comp.nfe.saved'));
        loadNfeConfig();
        loadCompanies();
      }
    } catch (err: any) {
      setNfeError(err.message || t('comp.nfe.errSave'));
    } finally { setNfeSaving(false); }
  }

  const MAX_C6_CREDENTIAL_FILE_BYTES = 64 * 1024; // certificado/chave real tem poucos KB — limite defensivo

  // Upload de certificado/chave C6: lê o arquivo local como TEXTO (readAsText,
  // não readAsDataURL — cert/key já são PEM, não precisam de base64) e escreve
  // no MESMO state que a textarea já escrevia — nenhuma outra parte do fluxo
  // de save muda. `.crt`/`.key` não têm um `file.type` (MIME) confiável no
  // browser (costuma vir vazio) — a checagem de tamanho é o único guard aqui,
  // sem checar `file.type` (diferente de handleLogoChange, que checa MIME
  // porque imagem tem um MIME confiável).
  // Cada campo tem seu próprio critério de "parece certo" — chave privada
  // pode vir como PRIVATE KEY (PKCS#8), RSA PRIVATE KEY ou EC PRIVATE KEY
  // (PKCS#1/SEC1), por isso é uma regex, não um prefixo fixo como o de
  // certificado (só existe uma forma de header pra certificado).
  const isCertificatePem = (text: string) => text.trimStart().startsWith('-----BEGIN CERTIFICATE-----');
  const isPrivateKeyPem  = (text: string) => /^-----BEGIN ((RSA|EC) )?PRIVATE KEY-----/.test(text.trimStart());

  function readC6CredentialFile(
    file: File,
    field: 'c6_cert' | 'c6_key',
    looksValid: (text: string) => boolean,
    setFileName: (name: string) => void,
    setWarning: (msg: string) => void,
  ) {
    setWarning('');
    if (file.size > MAX_C6_CREDENTIAL_FILE_BYTES) {
      setWarning(t('comp.bank.c6FileTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? '';
      setBankForm(f => ({ ...f, [field]: text }));
      setFileName(file.name);
      // Validação de formato só como aviso — não bloqueia salvar. A validação
      // real continua no backend (assertC6Credentials), isso só pega o erro
      // mais comum (usuário selecionou o arquivo errado nesse campo) antes de
      // gastar um round-trip.
      if (!looksValid(text)) {
        setWarning(t('comp.bank.c6FileFormatWarning'));
      }
    };
    reader.readAsText(file);
  }

  function handleC6CertFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) readC6CredentialFile(file, 'c6_cert', isCertificatePem, setC6CertFileName, setC6CertWarning);
    if (c6CertRef.current) c6CertRef.current.value = '';
  }

  function handleC6KeyFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) readC6CredentialFile(file, 'c6_key', isPrivateKeyPem, setC6KeyFileName, setC6KeyWarning);
    if (c6KeyRef.current) c6KeyRef.current.value = '';
  }

  async function handleBankSave(e: FormEvent) {
    e.preventDefault(); setBankError(''); setBankSuccess('');
    setBankSaving(true);

    // Genérico por provedor (migration 0064) — só o provedor selecionado
    // manda credencial; os demais provedores (brcode/santander/bradesco, sem
    // adapter ainda) não têm campo próprio, credentials fica null.
    const credentials =
      bankForm.billing_provider === 'itau' ? { client_id: bankForm.itau_client_id, client_secret: bankForm.itau_client_secret } :
      bankForm.billing_provider === 'c6'   ? { client_id: bankForm.c6_client_id, client_secret: bankForm.c6_client_secret, cert: bankForm.c6_cert, key: bankForm.c6_key } :
      null;

    const payload = {
      bank_code:              bankForm.bank_code              || null,
      agency:                 bankForm.agency                 || null,
      account:                bankForm.account                || null,
      account_digit:          bankForm.account_digit          || null,
      billing_provider:       bankForm.billing_provider       || null,
      billing_days_to_expire: bankForm.billing_days_to_expire ? Number(bankForm.billing_days_to_expire) : null,
      credentials,
    };

    try {
      if (selectedBankAccountId === 'new') {
        const created = await api.post<BankAccount>('/v1/bank-accounts', { ...payload, company_id: bankingCompanyId });
        if (setAsDefaultOnSave) await api.patch(`/v1/bank-accounts/${created.id}/set-default`, {});
        setBankSuccess(t('comp.bank.saved'));
        await loadBankAccounts();
        setSelectedBankAccountId(null);
      } else if (selectedBankAccountId) {
        await api.patch(`/v1/bank-accounts/${selectedBankAccountId}`, payload);
        if (setAsDefaultOnSave) await api.patch(`/v1/bank-accounts/${selectedBankAccountId}/set-default`, {});
        setBankSuccess(t('comp.bank.saved'));
        await loadBankAccounts();
      } else {
        // Conta padrão — fluxo legado, retrocompatível (regra 41). Já É a
        // conta padrão por definição — não há "definir como padrão" aqui.
        await api.patch('/v1/tenant', payload);
        setBankSuccess(t('comp.bank.saved'));
        loadTenant();
        loadBankAccounts();
      }
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

  async function handleBulkDeactivateProducts() {
    const ok = await modal.confirm({
      title:        t('comp.bulkDeactivateProducts'),
      message:      t('comp.bulkDeactivateConfirmMsg'),
      confirmLabel: t('comp.bulkDeactivateProducts'),
      danger:       true,
    });
    if (!ok) return;
    setBulkDeactivating(true);
    try {
      const result = await api.post<{ deactivated: number }>('/v1/materials/bulk-deactivate', {});
      modal.success(t('comp.bulkDeactivateResult').replace('{n}', String(result.deactivated)));
    } catch (err: unknown) {
      modal.error(err);
    } finally { setBulkDeactivating(false); }
  }

  if (loading) return <div className="spinner">{t('c.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{t('comp.title')}</h1>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)' }}>
        {(['general', 'branding', 'banking', 'fiscal', 'notifications', 'integrations', 'modules'] as const).map(key => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: 'none', border: 'none', padding: '10px 20px', cursor: 'pointer',
            fontWeight: tab === key ? 700 : 400,
            color: tab === key ? 'var(--primary)' : 'var(--muted)',
            borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: -2, fontSize: 14,
          }}>
            {key === 'general' ? t('comp.tabGeneral') : key === 'branding' ? t('comp.tabBranding') : key === 'banking' ? t('comp.tabBanking') : key === 'fiscal' ? t('comp.tabFiscal') : key === 'notifications' ? t('comp.tabNotifications') : key === 'integrations' ? t('comp.tabIntegrations') : t('comp.tabModules')}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <>
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
                <Can permission="company:edit">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? t('c.saving') : t('c.save')}
                  </button>
                </Can>
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
                <Can permission="company:edit">
                  <button className="btn btn-secondary btn-sm" onClick={handleLogoClick} disabled={logoSaving}>
                    {logoSaving ? t('c.saving') : (tenant?.logo_url ? t('comp.changeLogo') : t('comp.uploadLogo'))}
                  </button>
                </Can>
                {tenant?.logo_url && (
                  <Can permission="company:edit">
                    <button className="btn btn-danger btn-sm" onClick={handleLogoDelete} disabled={logoSaving}>
                      {t('comp.removeLogo')}
                    </button>
                  </Can>
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
                <Can permission="company:edit">
                  <button className="btn btn-secondary btn-sm" onClick={handleBannerClick} disabled={bannerSaving}>
                    {bannerSaving ? t('c.saving') : (tenant?.proposal_banner_url ? t('comp.changeBanner') : t('comp.uploadBanner'))}
                  </button>
                </Can>
                {tenant?.proposal_banner_url && (
                  <Can permission="company:edit">
                    <button className="btn btn-danger btn-sm" onClick={handleBannerDelete} disabled={bannerSaving}>
                      {t('comp.removeBanner')}
                    </button>
                  </Can>
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

        {/* ── Zona de risco ── */}
        <Can permission="materials:delete">
          <div className="card" style={{ padding: 24, marginTop: 24, border: '1px solid var(--danger)' }}>
            <h3 style={{ marginBottom: 4, color: 'var(--danger)' }}>{t('comp.dangerZone')}</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
              <div style={{ maxWidth: 560 }}>
                <strong style={{ display: 'block', marginBottom: 4 }}>{t('comp.bulkDeactivateProducts')}</strong>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{t('comp.bulkDeactivateProductsDesc')}</p>
              </div>
              <button className="btn btn-danger btn-sm" style={{ width: 'auto' }}
                disabled={bulkDeactivating} onClick={handleBulkDeactivateProducts}>
                {bulkDeactivating ? t('c.saving') : t('comp.bulkDeactivateProducts')}
              </button>
            </div>
          </div>
        </Can>
        </>
      )}

      {tab === 'branding' && (
        <div style={{ maxWidth: 640 }}>
          <div className="card" style={{ padding: 24 }}>
            <form onSubmit={handleBrandingSave} noValidate>
              {brandingError   && <div role="alert" className="alert alert-error"   style={{ marginBottom: 16 }}>{brandingError}</div>}
              {brandingSuccess && <div role="alert" className="alert alert-success" style={{ marginBottom: 16 }}>{brandingSuccess}</div>}

              <h3 style={{ marginBottom: 4 }}>{t('comp.branding.title')}</h3>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>{t('comp.branding.hint')}</p>

              {/* Segmento — troca cores/termos padrão */}
              <div className="field">
                <label>{t('comp.branding.segment')}</label>
                <select value={brandingForm.segment_key}
                  onChange={e => setBrandingForm(f => ({ ...f, segment_key: e.target.value }))}>
                  {SEGMENTS.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
                <span style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{t('comp.branding.segmentHint')}</span>
              </div>

              {/* Cores — override manual por cima do preset do segmento */}
              <div className="field-row" style={{ marginTop: 4 }}>
                <div className="field">
                  <label>{t('comp.branding.primary')}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={effectivePrimary} aria-label={t('comp.branding.primary')}
                      onChange={e => setBrandingForm(f => ({ ...f, brand_primary: e.target.value }))}
                      style={{ width: 44, height: 34, padding: 2, borderRadius: 6, cursor: 'pointer' }} />
                    <code style={{ fontSize: 12, color: 'var(--muted)' }}>{effectivePrimary}</code>
                  </div>
                </div>
                <div className="field">
                  <label>{t('comp.branding.accent')}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={effectiveAccent} aria-label={t('comp.branding.accent')}
                      onChange={e => setBrandingForm(f => ({ ...f, brand_accent: e.target.value }))}
                      style={{ width: 44, height: 34, padding: 2, borderRadius: 6, cursor: 'pointer' }} />
                    <code style={{ fontSize: 12, color: 'var(--muted)' }}>{effectiveAccent}</code>
                  </div>
                </div>
              </div>

              {(brandingForm.brand_primary || brandingForm.brand_accent) && (
                <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto', marginBottom: 8 }}
                  onClick={() => setBrandingForm(f => ({ ...f, brand_primary: '', brand_accent: '' }))}>
                  {t('comp.branding.useSegmentColors')}
                </button>
              )}

              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 16px' }}>
                {t('comp.branding.logoNote')}
              </p>

              <div style={{ marginTop: 8 }}>
                <Can permission="company:edit">
                  <button type="submit" className="btn btn-primary" disabled={brandingSaving}>
                    {brandingSaving ? t('c.saving') : t('c.save')}
                  </button>
                </Can>
              </div>
            </form>
          </div>
        </div>
      )}

      {tab === 'banking' && (
        <div style={{ maxWidth: 600 }}>
          {/* Seletor de empresa + conta bancária (regra 41) — só aparece com
              mais de 1 empresa ou mais de 1 conta cadastrada. Tenant com 1
              empresa/1 conta não vê nenhuma mudança aqui. */}
          {companies.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {companies.map(c => (
                <button key={c.id} type="button"
                  className={`btn btn-sm ${bankingCompanyId === c.id ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ width: 'auto' }}
                  onClick={() => { setBankingCompanyId(c.id); selectBankAccount(null); }}>
                  {c.razao_social}
                </button>
              ))}
            </div>
          )}
          {(() => {
            const accountsForCompany = bankAccounts.filter(a => a.company_id === bankingCompanyId);
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
                {accountsForCompany.length > 1 && (
                  <>
                    <button type="button"
                      className={`btn btn-sm ${selectedBankAccountId === null ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ width: 'auto' }}
                      onClick={() => selectBankAccount(null)}>
                      {accountsForCompany.find(a => a.is_default)?.label || t('comp.bank.defaultAccount')}
                    </button>
                    {accountsForCompany.filter(a => !a.is_default).map(a => (
                      <button key={a.id} type="button"
                        className={`btn btn-sm ${selectedBankAccountId === a.id ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ width: 'auto' }}
                        onClick={() => selectBankAccount(a.id)}>
                        {a.label || `${a.bank_code} · ${a.agency}/${a.account}`}
                      </button>
                    ))}
                  </>
                )}
                {/* Sempre visível — é assim que se cria a 2ª+ conta (sem isso, ninguém
                    consegue sair de "1 conta só", já que os seletores acima só
                    aparecem quando já existe mais de uma). */}
                <button type="button"
                  className={`btn btn-sm ${selectedBankAccountId === 'new' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ width: 'auto' }}
                  onClick={() => selectBankAccount('new')}>
                  + {t('comp.bank.newAccount')}
                </button>
              </div>
            );
          })()}

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
                      {credentialsConfigured.itau_client_secret && !bankForm.itau_client_secret && (
                        <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 4 }}>{t('comp.bank.alreadyConfigured')}</div>
                      )}
                      <input type="password" value={bankForm.itau_client_secret}
                        placeholder={credentialsConfigured.itau_client_secret ? t('comp.bank.leaveBlankToKeep') : t('comp.bank.itauClientSecretPH')}
                        autoComplete="new-password"
                        onChange={e => setBankForm(f => ({ ...f, itau_client_secret: e.target.value }))} />
                    </div>
                  </div>
                </>
              )}

              {bankForm.billing_provider === 'c6' && (
                <>
                  <div style={{ marginTop: 16, marginBottom: 8, fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>
                    {t('comp.bank.c6Auth')}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{t('comp.bank.c6Hint')}</p>
                  <div className="field-row">
                    <div className="field">
                      <label>{t('comp.bank.c6ClientId')}</label>
                      <input type="text" value={bankForm.c6_client_id}
                        placeholder={t('comp.bank.c6ClientIdPH')}
                        onChange={e => setBankForm(f => ({ ...f, c6_client_id: e.target.value }))} />
                    </div>
                    <div className="field">
                      <label>{t('comp.bank.c6ClientSecret')}</label>
                      {credentialsConfigured.c6_client_secret && !bankForm.c6_client_secret && (
                        <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 4 }}>{t('comp.bank.alreadyConfigured')}</div>
                      )}
                      <input type="password" value={bankForm.c6_client_secret}
                        placeholder={credentialsConfigured.c6_client_secret ? t('comp.bank.leaveBlankToKeep') : t('comp.bank.c6ClientSecretPH')}
                        autoComplete="new-password"
                        onChange={e => setBankForm(f => ({ ...f, c6_client_secret: e.target.value }))} />
                    </div>
                  </div>
                  <input ref={c6CertRef} type="file" accept=".crt,.pem,.cer" style={{ display: 'none' }} onChange={handleC6CertFile} />
                  <input ref={c6KeyRef}  type="file" accept=".key,.pem"      style={{ display: 'none' }} onChange={handleC6KeyFile} />
                  <div className="field-row">
                    <div className="field">
                      <label>{t('comp.bank.c6Cert')}</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => c6CertRef.current?.click()}>
                          {t('comp.bank.c6SelectFile')}
                        </button>
                        {c6CertFileName && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{c6CertFileName}</span>}
                      </div>
                      {c6CertWarning && <div role="alert" className="alert alert-warning" style={{ marginBottom: 6, fontSize: 12 }}>{c6CertWarning}</div>}
                      {credentialsConfigured.c6_cert && !bankForm.c6_cert && (
                        <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 4 }}>{t('comp.bank.alreadyConfigured')}</div>
                      )}
                      <textarea rows={4} value={bankForm.c6_cert}
                        placeholder={credentialsConfigured.c6_cert ? t('comp.bank.leaveBlankToKeep') : t('comp.bank.c6CertPH')}
                        style={{ fontFamily: 'monospace', fontSize: 12 }}
                        onChange={e => setBankForm(f => ({ ...f, c6_cert: e.target.value }))} />
                    </div>
                    <div className="field">
                      <label>{t('comp.bank.c6Key')}</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => c6KeyRef.current?.click()}>
                          {t('comp.bank.c6SelectFile')}
                        </button>
                        {c6KeyFileName && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{c6KeyFileName}</span>}
                      </div>
                      {c6KeyWarning && <div role="alert" className="alert alert-warning" style={{ marginBottom: 6, fontSize: 12 }}>{c6KeyWarning}</div>}
                      {credentialsConfigured.c6_key && !bankForm.c6_key && (
                        <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 4 }}>{t('comp.bank.alreadyConfigured')}</div>
                      )}
                      <textarea rows={4} value={bankForm.c6_key}
                        placeholder={credentialsConfigured.c6_key ? t('comp.bank.leaveBlankToKeep') : t('comp.bank.c6KeyPH')}
                        autoComplete="new-password"
                        style={{ fontFamily: 'monospace', fontSize: 12 }}
                        onChange={e => setBankForm(f => ({ ...f, c6_key: e.target.value }))} />
                    </div>
                  </div>
                </>
              )}

              {/* "Definir como conta padrão" — antes não existia NENHUMA forma de
                  promover uma conta (nova ou já existente) a padrão pela tela;
                  só a 1ª conta de cada empresa nascia padrão automaticamente.
                  Escondido pra conta que já É a padrão (id null, o fluxo legado
                  /v1/tenant) — nada a fazer ali. */}
              {selectedBankAccountId !== null && !bankAccounts.find(a => a.id === selectedBankAccountId)?.is_default && (
                <div className="field" style={{ marginTop: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, cursor: 'pointer' }}>
                    <input type="checkbox" checked={setAsDefaultOnSave}
                      onChange={e => setSetAsDefaultOnSave(e.target.checked)} />
                    {t('comp.bank.setAsDefault')}
                  </label>
                </div>
              )}

              <div style={{ marginTop: 20 }}>
                <Can permission="company:edit">
                  <button type="submit" className="btn btn-primary" disabled={bankSaving}>
                    {bankSaving ? t('c.saving') : t('c.save')}
                  </button>
                </Can>
              </div>
            </form>
          </div>
        </div>
      )}

      {tab === 'fiscal' && (
        <div style={{ maxWidth: 720 }}>
          {/* Seletor de empresa (regra 40) — só aparece com mais de 1 CNPJ
              cadastrado ou quando o módulo multi_empresa está habilitado.
              Tenant com 1 empresa só não vê nenhuma mudança aqui. */}
          {(companies.length > 1 || multiEmpresaEnabled) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
              <button type="button"
                className={`btn btn-sm ${selectedCompanyId === null ? 'btn-primary' : 'btn-secondary'}`}
                style={{ width: 'auto' }}
                onClick={() => selectCompany(null)}>
                {companies.find(c => c.is_default)?.razao_social || t('comp.companies.default')}
                {companies.find(c => c.is_default) && (
                  <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.8 }}>· {emissionBadge(companies.find(c => c.is_default)!)}</span>
                )}
              </button>
              {companies.filter(c => !c.is_default).map(c => (
                <button key={c.id} type="button"
                  className={`btn btn-sm ${selectedCompanyId === c.id ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ width: 'auto' }}
                  onClick={() => selectCompany(c.id)}>
                  {c.razao_social}
                  <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.8 }}>· {emissionBadge(c)}</span>
                </button>
              ))}
              {multiEmpresaEnabled && (
                <button type="button"
                  className={`btn btn-sm ${selectedCompanyId === 'new' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ width: 'auto' }}
                  onClick={() => selectCompany('new')}>
                  + {t('comp.companies.new')}
                </button>
              )}
            </div>
          )}

          {nfeLoading ? (
            <div className="spinner">{t('c.loading')}</div>
          ) : (
            <div className="card" style={{ padding: 24 }}>
              <form onSubmit={handleNfeSave} noValidate>
                {nfeError   && <div role="alert" className="alert alert-error"   style={{ marginBottom: 16 }}>{nfeError}</div>}
                {nfeSuccess && <div role="alert" className="alert alert-success"  style={{ marginBottom: 16 }}>{nfeSuccess}</div>}

                <h3 style={{ marginBottom: 8 }}>{t('comp.nfe.title')}</h3>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>{t('comp.nfe.hint')}</p>

                {/* Responsabilidade de emissão por empresa (regra 53) */}
                <div style={{ marginBottom: 20, padding: '14px 16px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>{t('comp.emission.title')}</strong>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{t('comp.emission.hint')}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Switch
                      checked={nfeForm.emite_nfe}
                      onChange={() => setNfeForm(f => ({ ...f, emite_nfe: !f.emite_nfe }))}
                      label={t('comp.emission.emiteNfe')}
                    />
                    <Switch
                      checked={nfeForm.emite_nfse}
                      onChange={() => setNfeForm(f => ({ ...f, emite_nfse: !f.emite_nfse }))}
                      label={t('comp.emission.emiteNfse')}
                    />
                  </div>
                  {!nfeForm.emite_nfe && !nfeForm.emite_nfse && (
                    <div className="alert alert-error" style={{ marginTop: 12, fontSize: 12 }}>
                      {t('comp.emission.warnNone')}
                    </div>
                  )}
                </div>

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
                      <Can permission="company:edit">
                        <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                          onClick={() => void handleSimplesRbt12Save()}
                          disabled={simplesRbt12Saving}>
                          {simplesRbt12Saving ? t('c.saving') : t('c.save')}
                        </button>
                      </Can>
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

                {/* Configurações fiscais — só relevante pra quem emite NF-e (regra 53) */}
                {nfeForm.emite_nfe && (
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
                )}

                {/* Ambiente de emissão (toggle HML/PRD) + credenciais — um só card,
                    já que a credencial ativa depende diretamente do ambiente. */}
                <div style={{
                  marginTop: 16, padding: '16px', borderRadius: 8,
                  background: nfeForm.focus_ambiente === '1' ? 'var(--status-cancelled-bg)' : 'var(--surface)',
                  border: `1px solid ${nfeForm.focus_ambiente === '1' ? 'rgba(220,38,38,.28)' : 'var(--border)'}`,
                  transition: 'background-color 150ms ease, border-color 150ms ease',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <h4 style={{ margin: 0 }}>{t('comp.nfe.ambiente')}</h4>
                    <Badge variant={nfeForm.focus_ambiente === '1' ? 'cancelled' : 'draft'}>
                      {nfeForm.focus_ambiente === '1' ? t('comp.nfe.prod') : t('comp.nfe.homo')}
                    </Badge>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>{t('comp.nfe.ambienteHint')}</p>

                  <Switch
                    checked={nfeForm.focus_ambiente === '1'}
                    onChange={() => setNfeForm(f => ({ ...f, focus_ambiente: f.focus_ambiente === '1' ? '2' : '1' }))}
                    label={t('comp.nfe.ambienteToggle')}
                  />

                  {nfeForm.focus_ambiente === '1' && (
                    <div className="alert alert-error" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
                      {t('comp.nfe.prodWarn')}
                    </div>
                  )}

                  <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-soft, var(--border))' }}>
                    <strong style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>{t('comp.nfe.tokensTitle')}</strong>
                    <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{t('comp.nfe.tokenHint')}</p>

                    <div className="field">
                      <label>{t('comp.nfe.tokenHomo')}</label>
                      {nfeCfg?.focus_token_homologacao && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <Badge variant="active">{t('comp.nfe.tokenSet')}</Badge>
                          <code style={{ fontSize: 11, color: 'var(--muted)' }}>{nfeCfg.focus_token_homologacao}</code>
                        </div>
                      )}
                      <input type="password" value={nfeForm.focus_token_homologacao}
                        placeholder={nfeCfg?.focus_token_homologacao ? t('comp.nfe.tokenKeep') : t('comp.nfe.tokenPH')}
                        autoComplete="new-password"
                        onChange={e => setNfeForm(f => ({ ...f, focus_token_homologacao: e.target.value }))} />
                    </div>

                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>{t('comp.nfe.tokenProd')}</label>
                      {nfeCfg?.focus_token_producao && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <Badge variant="active">{t('comp.nfe.tokenSet')}</Badge>
                          <code style={{ fontSize: 11, color: 'var(--muted)' }}>{nfeCfg.focus_token_producao}</code>
                        </div>
                      )}
                      <input type="password" value={nfeForm.focus_token_producao}
                        placeholder={nfeCfg?.focus_token_producao ? t('comp.nfe.tokenKeep') : t('comp.nfe.tokenPH')}
                        autoComplete="new-password"
                        onChange={e => setNfeForm(f => ({ ...f, focus_token_producao: e.target.value }))} />
                    </div>
                  </div>
                </div>

                {/* ── NFS-e (Nota Fiscal de Serviços) — só relevante pra quem emite NFS-e (regra 53) ── */}
                {nfeForm.emite_nfse && (
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
                )}

                <div style={{ marginTop: 20 }}>
                  <Can permission="company:edit">
                    <button type="submit" className="btn btn-primary" disabled={nfeSaving}>
                      {nfeSaving ? t('c.saving') : t('c.save')}
                    </button>
                  </Can>
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
                <Can permission="company:edit">
                  <button type="submit" className="btn btn-primary" disabled={notifSaving}>
                    {notifSaving ? t('c.saving') : t('c.save')}
                  </button>
                </Can>
              </div>
            </form>
          </div>
        </div>
      )}

      {tab === 'integrations' && <IntegrationsTab />}
      {tab === 'modules' && <ModulesTab />}
    </div>
  );
}

// ── Integrações (Mercado Livre) ──────────────────────────────────────────────
// Uma conexão OAuth é por EMPRESA, não por tenant (regra 42) — cada CNPJ pode
// ter sua própria loja no Mercado Livre. Backend é sempre a autoridade
// (requireModule em cada rota gated); esta tela só existe para autoatendimento.
interface MlConnectionStatus {
  connected: boolean; status?: string; nickname?: string | null;
  ml_user_id?: string | null; connected_at?: string | null;
}

function IntegrationsTab() {
  const { t } = useI18n();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [mlEnabled, setMlEnabled] = useState(false);
  const [statusByCompany, setStatusByCompany] = useState<Record<string, MlConnectionStatus>>({});
  const [loading, setLoading]   = useState(true);
  const [busyCompanyId, setBusyCompanyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const urlStatus = new URLSearchParams(window.location.search).get('ml_status');
  const urlReason = new URLSearchParams(window.location.search).get('reason');

  async function load() {
    setLoading(true); setError('');
    try {
      const [compResp, modResp] = await Promise.all([
        api.get<{ data: Company[] }>('/v1/companies'),
        api.get<{ available: string[]; enabled: string[] }>('/v1/tenant/modules'),
      ]);
      setCompanies(compResp.data);
      setMlEnabled(modResp.enabled.includes('mercadolivre'));

      const statuses = await Promise.all(compResp.data.map(async c => {
        try {
          const s = await api.get<MlConnectionStatus>(`/v1/integrations/mercadolivre/status?company_id=${c.id}`);
          return [c.id, s] as const;
        } catch {
          return [c.id, { connected: false }] as const;
        }
      }));
      setStatusByCompany(Object.fromEntries(statuses));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('comp.integrations.errLoad'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function connect(companyId: string) {
    setBusyCompanyId(companyId); setError('');
    try {
      const r = await api.get<{ authorization_url: string }>(`/v1/integrations/mercadolivre/connect?company_id=${companyId}`);
      window.location.href = r.authorization_url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('comp.integrations.errConnect'));
      setBusyCompanyId(null);
    }
  }

  async function disconnect(companyId: string) {
    setBusyCompanyId(companyId); setError('');
    try {
      await api.delete(`/v1/integrations/mercadolivre?company_id=${companyId}`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('comp.integrations.errDisconnect'));
    } finally {
      setBusyCompanyId(null);
    }
  }

  if (loading) return <div className="spinner">{t('c.loading')}</div>;

  return (
    <div style={{ maxWidth: 680 }}>
      <h3 style={{ marginBottom: 4 }}>{t('comp.integrations.title')}</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>{t('comp.integrations.subtitle')}</p>

      {urlStatus === 'connected' && (
        <div role="alert" className="alert alert-success" style={{ marginBottom: 16 }}>{t('comp.integrations.connectedOk')}</div>
      )}
      {urlStatus === 'error' && (
        <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>
          {t('comp.integrations.connectError')} {urlReason ? `(${urlReason})` : ''}
        </div>
      )}
      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {!mlEnabled ? (
        <div className="card" style={{ padding: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{t('comp.integrations.moduleDisabled')}</p>
        </div>
      ) : (
        companies.map(c => {
          const status = statusByCompany[c.id];
          const connected = status?.connected ?? false;
          return (
            <div key={c.id} className="card" style={{ padding: 20, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <strong>{c.razao_social}</strong>
                    <span className={`badge ${connected ? 'badge-active' : 'badge-inactive'}`}>
                      {connected ? t('comp.integrations.connected') : t('comp.integrations.disconnected')}
                    </span>
                  </div>
                  {connected && status?.nickname && (
                    <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{t('comp.integrations.account')}: {status.nickname}</p>
                  )}
                </div>
                <button
                  className={`btn ${connected ? 'btn-secondary' : 'btn-primary'} btn-sm`}
                  style={{ width: 'auto', flex: 'none' }}
                  disabled={busyCompanyId === c.id}
                  onClick={() => connected ? void disconnect(c.id) : void connect(c.id)}
                >
                  {busyCompanyId === c.id ? t('c.saving') : connected ? t('comp.integrations.disconnect') : t('comp.integrations.connect')}
                </button>
              </div>
            </div>
          );
        })
      )}

      <WhatsAppIntegrationSection />
    </div>
  );
}

// ── WhatsApp — Cobranças e Notificações ────────────────────────────────────
// Conexão da conta (Account SID/Auth Token/número) vive aqui, mesmo padrão de
// "Integrações" já usado pro Mercado Livre. Configuração de automações e log
// de mensagens ficam na tela dedicada /whatsapp (WhatsAppPage.tsx) — a
// credencial é o único dado que faz sentido junto do resto de "Minha Empresa".
interface WhatsAppAccount {
  id: string; provider: string; whatsapp_number: string | null; display_name: string | null;
  status: 'pending' | 'connected' | 'disconnected';
}

function WhatsAppIntegrationSection() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [enabled, setEnabled]   = useState(false);
  const [account, setAccount]   = useState<WhatsAppAccount | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [form, setForm] = useState({ whatsapp_number: '', account_sid: '', auth_token: '' });

  async function load() {
    setLoading(true); setError('');
    try {
      const mod = await api.get<{ enabled: string[] }>('/v1/tenant/modules');
      const on = mod.enabled.includes('whatsapp');
      setEnabled(on);
      if (on) {
        const acc = await api.get<WhatsAppAccount | null>('/v1/whatsapp/account');
        setAccount(acc);
        if (acc) setForm(f => ({ ...f, whatsapp_number: acc.whatsapp_number ?? '' }));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('comp.integrations.errLoad'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function handleConnect() {
    setSaving(true); setError('');
    try {
      const acc = await api.patch<WhatsAppAccount>('/v1/whatsapp/account', form);
      setAccount(acc);
      setForm(f => ({ ...f, account_sid: '', auth_token: '' }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('comp.whatsapp.errSave'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setSaving(true); setError('');
    try {
      await api.delete('/v1/whatsapp/account');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('comp.whatsapp.errSave'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  if (!enabled) return null; // módulo desligado — nada a mostrar aqui (ativa em "Módulos")

  const connected = account?.status === 'connected';

  return (
    <div className="card" style={{ padding: 20, marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <strong>{t('comp.whatsapp.title')}</strong>
        <span className={`badge ${connected ? 'badge-active' : 'badge-inactive'}`}>
          {connected ? t('comp.integrations.connected') : t('comp.integrations.disconnected')}
        </span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px' }}>{t('comp.whatsapp.subtitle')}</p>

      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="field">
        <label>{t('comp.whatsapp.number')}</label>
        <input value={form.whatsapp_number} placeholder="+5511999999999"
          onChange={e => setForm(f => ({ ...f, whatsapp_number: e.target.value }))} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>{t('comp.whatsapp.accountSid')}</label>
          <input value={form.account_sid} placeholder={connected ? '••••••••' : 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
            onChange={e => setForm(f => ({ ...f, account_sid: e.target.value }))} />
        </div>
        <div className="field">
          <label>{t('comp.whatsapp.authToken')}</label>
          <input type="password" value={form.auth_token} placeholder={connected ? '••••••••' : ''}
            onChange={e => setForm(f => ({ ...f, auth_token: e.target.value }))} />
        </div>
      </div>

      <div className="flex-gap" style={{ marginTop: 12 }}>
        <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={saving} onClick={handleConnect}>
          {saving ? t('c.saving') : connected ? t('comp.whatsapp.update') : t('comp.integrations.connect')}
        </button>
        {connected && (
          <>
            <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => navigate('/whatsapp')}>
              {t('comp.whatsapp.manage')}
            </button>
            <button className="btn btn-danger btn-sm" style={{ width: 'auto' }} disabled={saving} onClick={handleDisconnect}>
              {t('comp.integrations.disconnect')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Módulos opcionais ─────────────────────────────────────────────────────────
// Backend é sempre a autoridade (requireModule em cada rota gated) — este
// toggle é só a interface de autoatendimento para o tenant ligar/desligar.
interface ModulesResponse { available: string[]; enabled: string[]; }

const MODULE_LABELS: Record<string, { titleKey: TKey; descKey: TKey }> = {
  service_orders: { titleKey: 'comp.modules.serviceOrders', descKey: 'comp.modules.serviceOrdersDesc' },
  multi_empresa:  { titleKey: 'comp.modules.multiEmpresa',  descKey: 'comp.modules.multiEmpresaDesc' },
  pos:            { titleKey: 'comp.modules.pos',           descKey: 'comp.modules.posDesc' },
  mercadolivre:   { titleKey: 'comp.modules.mercadolivre',   descKey: 'comp.modules.mercadolivreDesc' },
  sales_pipeline: { titleKey: 'comp.modules.salesPipeline',  descKey: 'comp.modules.salesPipelineDesc' },
  hr:             { titleKey: 'comp.modules.hr',              descKey: 'comp.modules.hrDesc' },
  scheduling:     { titleKey: 'comp.modules.scheduling',      descKey: 'comp.modules.schedulingDesc' },
  whatsapp:       { titleKey: 'comp.modules.whatsapp',        descKey: 'comp.modules.whatsappDesc' },
  fiscal:         { titleKey: 'comp.modules.fiscal',          descKey: 'comp.modules.fiscalDesc' },
  contabil:       { titleKey: 'comp.modules.contabil',        descKey: 'comp.modules.contabilDesc' },
  projects:       { titleKey: 'comp.modules.projects',        descKey: 'comp.modules.projectsDesc' },
};

// Módulos com um fluxo real (sequência de etapas) ganham o card cheio e o
// diagrama "Como funciona"; módulos de liga/desliga simples ficam compactos —
// a diferença de conteúdo é o que decide o layout, não um capricho visual.
const RICH_MODULES = new Set(['service_orders', 'pos']);

function ModuleToggleHeader({ labels, enabled, busy, onToggle }: {
  labels: { titleKey: TKey; descKey: TKey };
  enabled: boolean; busy: boolean; onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <strong>{t(labels.titleKey)}</strong>
          <span className={`badge ${enabled ? 'badge-active' : 'badge-inactive'}`}>
            {enabled ? t('comp.modules.enabled') : t('comp.modules.disabled')}
          </span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, maxWidth: 560 }}>{t(labels.descKey)}</p>
      </div>
      <Switch
        checked={enabled}
        disabled={busy}
        onChange={onToggle}
        label={`${t(labels.titleKey)}: ${enabled ? t('comp.modules.disable') : t('comp.modules.enable')}`}
      />
    </div>
  );
}

function ModulesSummary({ enabledCount, total }: { enabledCount: number; total: number }) {
  const { t } = useI18n();
  return (
    <div className="modules-summary">
      <span>{t('comp.modules.summary').replace('{n}', String(enabledCount)).replace('{total}', String(total))}</span>
      <div className="modules-summary__dots">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`modules-summary__dot${i < enabledCount ? ' is-on' : ''}`} />
        ))}
      </div>
    </div>
  );
}

function ModulesTab() {
  const { t } = useI18n();
  const [data, setData]       = useState<ModulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError]     = useState('');

  async function load() {
    setError('');
    try {
      const r = await api.get<ModulesResponse>('/v1/tenant/modules');
      setData(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar módulos');
    } finally {
      setLoading(false);
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

  if (loading) return <div className="spinner">{t('c.loading')}</div>;

  const available    = data?.available ?? [];
  const enabledCount = data?.enabled.length ?? 0;
  const richKeys      = available.filter(k => RICH_MODULES.has(k) && MODULE_LABELS[k]);
  const compactKeys   = available.filter(k => !RICH_MODULES.has(k) && MODULE_LABELS[k]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h3 style={{ marginBottom: 4 }}>{t('comp.modules.title')}</h3>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{t('comp.modules.subtitle')}</p>
        </div>
        {available.length > 0 && <ModulesSummary enabledCount={enabledCount} total={available.length} />}
      </div>

      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="modules-stack">
        {richKeys.map(key => {
          const enabled = data?.enabled.includes(key) ?? false;
          const labels  = MODULE_LABELS[key];
          return (
            <div key={key} className={`module-card${enabled ? ' module-card--on' : ''}`}>
              <ModuleToggleHeader
                labels={labels} enabled={enabled}
                busy={busyKey === key} onToggle={() => toggle(key, !enabled)}
              />
              {key === 'service_orders' && <ServiceOrderFlowDiagram />}
              {key === 'pos'            && <PdvFlowDiagram />}
            </div>
          );
        })}

        {compactKeys.length > 0 && (
          <div className="modules-grid">
            {compactKeys.map(key => {
              const enabled = data?.enabled.includes(key) ?? false;
              const labels  = MODULE_LABELS[key];
              return (
                <div key={key} className={`module-card${enabled ? ' module-card--on' : ''}`}>
                  <ModuleToggleHeader
                    labels={labels} enabled={enabled}
                    busy={busyKey === key} onToggle={() => toggle(key, !enabled)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Diagrama do fluxo de Ordem de Serviço / Visita Técnica ────────────────────
// Mostrado junto do módulo (mesmo antes de habilitar) para o tenant entender o
// processo de ponta a ponta antes de decidir ligar a chave.
type FlowStep = { icon: string; titleKey: TKey; descKey: TKey };

// Diagrama de etapas compartilhado — extraído porque Ordens de Serviço e PDV
// usavam a mesma estrutura byte-a-byte, só com dados de step diferentes.
// Largura do conteúdo é limitada a 560px mesmo dentro do card cheio: com o
// texto esticando até a borda do card fica difícil de ler numa linha só.
// Colapsado por padrão — o passo a passo é conteúdo de apoio, não essencial
// pra decidir se o módulo é útil; só aparece se o usuário clicar pra ver.
function ModuleFlowSteps({ steps }: { steps: FlowStep[] }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="module-flow">
      <button
        type="button"
        className="module-flow__trigger"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <span className="module-flow__eyebrow">{t('comp.modules.howItWorks')}</span>
        <svg
          className={`module-flow__chevron${expanded ? ' is-open' : ''}`}
          width="10" height="10" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M2 4l4 4 4-4"/>
        </svg>
      </button>
      {expanded && (
      <div className="module-flow__steps">
        {steps.map((s, i) => (
          <div key={s.titleKey} className="module-flow__step">
            <div className="module-flow__track">
              <div className="module-flow__icon">{s.icon}</div>
              {i < steps.length - 1 && <div className="module-flow__line" />}
            </div>
            <div className="module-flow__text" style={{ paddingBottom: i < steps.length - 1 ? 16 : 0 }}>
              <div className="module-flow__title">{t(s.titleKey)}</div>
              <div className="module-flow__desc">{t(s.descKey)}</div>
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

function ServiceOrderFlowDiagram() {
  const steps: FlowStep[] = [
    { icon: '📋', titleKey: 'so.flow.step1Title', descKey: 'so.flow.step1Desc' },
    { icon: '📅', titleKey: 'so.flow.step2Title', descKey: 'so.flow.step2Desc' },
    { icon: '🔐', titleKey: 'so.flow.step3Title', descKey: 'so.flow.step3Desc' },
    { icon: '📍', titleKey: 'so.flow.step4Title', descKey: 'so.flow.step4Desc' },
    { icon: '📷', titleKey: 'so.flow.step5Title', descKey: 'so.flow.step5Desc' },
    { icon: '✅', titleKey: 'so.flow.step6Title', descKey: 'so.flow.step6Desc' },
  ];
  return <ModuleFlowSteps steps={steps} />;
}

// ── Passo a passo do PDV (Ponto de Venda) ─────────────────────────────────────
// Mesmo padrão de ServiceOrderFlowDiagram: mostra o fluxo de ponta a ponta junto
// do card do módulo, para o tenant entender como operar o PDV antes de ligar a chave.
function PdvFlowDiagram() {
  const steps: FlowStep[] = [
    { icon: '🏪', titleKey: 'pdv.flow.step1Title', descKey: 'pdv.flow.step1Desc' },
    { icon: '🔓', titleKey: 'pdv.flow.step2Title', descKey: 'pdv.flow.step2Desc' },
    { icon: '🛒', titleKey: 'pdv.flow.step3Title', descKey: 'pdv.flow.step3Desc' },
    { icon: '💳', titleKey: 'pdv.flow.step4Title', descKey: 'pdv.flow.step4Desc' },
    { icon: '🧾', titleKey: 'pdv.flow.step5Title', descKey: 'pdv.flow.step5Desc' },
    { icon: '🔒', titleKey: 'pdv.flow.step6Title', descKey: 'pdv.flow.step6Desc' },
  ];
  return <ModuleFlowSteps steps={steps} />;
}
