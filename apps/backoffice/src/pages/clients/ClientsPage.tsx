import { useEffect, useRef, useState, FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { Can }      from '../../rbac';
import {
  maskCNPJ, maskCPF, maskPhone, maskCEP, digits, normalizeCNPJ,
  isValidCNPJ, isValidCPF, fetchAddressByCEP, UF_LIST,
} from '../../lib/brazil';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Client {
  id:            string;
  person_type:   'PJ' | 'PF';
  company_name:  string | null;
  trade_name:    string | null;
  cnpj:          string | null;
  state_reg:     string | null;
  full_name:     string | null;
  cpf:           string | null;
  email:         string | null;
  phone:         string | null;
  mobile:        string | null;
  zip_code:      string | null;
  street:        string | null;
  street_number: string | null;
  complement:    string | null;
  neighborhood:  string | null;
  city:          string | null;
  state:         string | null;
  icms_taxpayer: string;
  consumer_type: string;
  // Regra 61/74: travado no cadastro, nunca perguntado na tela de nota.
  tax_regime:    string | null;
  is_active:     boolean;
  notes:         string | null;
  whatsapp_opt_in: boolean;
  origin:        string;
}

interface ClientContact {
  id:           string;
  contact_type: string;
  name:         string | null;
  email:        string | null;
  phone:        string | null;
  notes:        string | null;
  is_active:    boolean;
}

interface ListResp { data: Client[]; total: number; page: number; per_page: number; }

interface ImportRow {
  person_type:   string;
  company_name?: string;
  trade_name?:   string;
  cnpj?:         string;
  state_reg?:    string;
  municipal_reg?:string;
  suframa?:      string;
  full_name?:    string;
  cpf?:          string;
  birth_date?:   string;
  email?:        string;
  phone?:        string;
  mobile?:       string;
  zip_code?:     string;
  street?:       string;
  street_number?:string;
  complement?:   string;
  neighborhood?: string;
  city?:         string;
  state?:        string;
  icms_taxpayer?:string;
  consumer_type?:string;
  notes?:        string;
}

interface ImportResult {
  imported: number;
  skipped:  number;
  errors:   { row: number; message: string }[];
}

type ImportPhase = 'idle' | 'preview' | 'importing' | 'done';

const XLSX_COLS = [
  'tipo_pessoa', 'razao_social', 'nome_fantasia', 'cnpj',
  'inscricao_estadual', 'inscricao_municipal', 'suframa',
  'nome_completo', 'cpf', 'data_nascimento',
  'email', 'telefone', 'celular',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
  'contribuinte_icms', 'tipo_consumidor', 'observacoes',
] as const;

const CONTACT_TYPES = ['comercial', 'juridico', 'compras', 'manutencao', 'comprador', 'outro'] as const;

function mapXlsxRow(raw: Record<string, unknown>): ImportRow {
  const s  = (v: unknown) => { const x = String(v ?? '').trim(); return x || undefined; };
  const d  = (v: unknown) => { const x = String(v ?? '').replace(/\D/g, ''); return x || undefined; };
  const dt = (v: unknown): string | undefined => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const x = String(v ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined;
  };
  return {
    person_type:   String(raw['tipo_pessoa']         ?? '').trim().toUpperCase(),
    company_name:  s(raw['razao_social']),
    trade_name:    s(raw['nome_fantasia']),
    cnpj:          d(raw['cnpj']),
    state_reg:     s(raw['inscricao_estadual']),
    municipal_reg: s(raw['inscricao_municipal']),
    suframa:       s(raw['suframa']),
    full_name:     s(raw['nome_completo']),
    cpf:           d(raw['cpf']),
    birth_date:    dt(raw['data_nascimento']),
    email:         s(raw['email']),
    phone:         d(raw['telefone']),
    mobile:        d(raw['celular']),
    zip_code:      d(raw['cep']),
    street:        s(raw['logradouro']),
    street_number: s(raw['numero']),
    complement:    s(raw['complemento']),
    neighborhood:  s(raw['bairro']),
    city:          s(raw['cidade']),
    state:         s(raw['uf']),
    icms_taxpayer: s(raw['contribuinte_icms']),
    consumer_type: s(raw['tipo_consumidor']),
    notes:         s(raw['observacoes']),
  };
}

function downloadTemplate() {
  const example_pj: (string | number)[] = [
    'PJ', 'ACME Materiais Ltda', 'ACME', '11444777000161',
    '123456789', '', '',
    '', '', '',
    'contato@acme.com.br', '1199990000', '',
    '01310100', 'Av Paulista', '1000', 'Sala 10', 'Bela Vista', 'São Paulo', 'SP',
    '9', '0', 'Exemplo PJ',
  ];
  const example_pf: (string | number)[] = [
    'PF', '', '', '',
    '', '', '',
    'Maria da Silva', '12345678901', '1985-06-15',
    'maria@email.com', '1188880000', '',
    '01310100', 'Rua das Flores', '200', '', 'Centro', 'São Paulo', 'SP',
    '9', '1', 'Exemplo PF',
  ];
  const ws = XLSX.utils.aoa_to_sheet([[...XLSX_COLS], example_pj, example_pf]);
  ws['!cols'] = [...XLSX_COLS].map((col) => ({
    wch: ['razao_social', 'nome_completo', 'logradouro', 'email'].includes(col) ? 30 : 18,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
  XLSX.writeFile(wb, 'modelo_importacao_clientes.xlsx');
}

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  person_type:   'PJ' as 'PJ' | 'PF',
  company_name: '', trade_name: '', cnpj: '', state_reg: '', municipal_reg: '', suframa: '',
  full_name: '', cpf: '', birth_date: '', rg: '', rg_issuer: '', rg_issue_date: '',
  email: '', phone: '', mobile: '',
  zip_code: '', street: '', street_number: '', complement: '',
  neighborhood: '', city: '', state: 'SP', country: 'BR',
  icms_taxpayer: '9' as string, consumer_type: '0' as string,
  tax_regime: '' as string,
  notes: '',
  whatsapp_opt_in: false,
};

const EMPTY_CONTACT = {
  contact_type: 'comercial' as string,
  name: '', email: '', phone: '', notes: '',
};

// ── Main component ─────────────────────────────────────────────────────────────

export function ClientsPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── List state ─────────────────────────────────────────────────────────────
  const [items,   setItems]   = useState<Client[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('');
  const [originFilter, setOriginFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // ── Drawer (create / edit) state ───────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Client | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');
  const [cepLoading, setCepLoading] = useState(false);

  // ── Contacts state (within drawer) ────────────────────────────────────────
  const [contacts,         setContacts]         = useState<ClientContact[]>([]);
  const [contactsLoading,  setContactsLoading]  = useState(false);
  const [showContactForm,  setShowContactForm]  = useState(false);
  const [editingContact,   setEditingContact]   = useState<ClientContact | null>(null);
  const [contactForm,      setContactForm]      = useState({ ...EMPTY_CONTACT });
  const [savingContact,    setSavingContact]    = useState(false);
  const [contactError,     setContactError]     = useState('');

  // ── History state (within drawer, edit mode only) ─────────────────────────
  const [history,        setHistory]        = useState<{ orders: any[]; invoices: any[]; receivables: any[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Import state ───────────────────────────────────────────────────────────
  const [importOpen,   setImportOpen]   = useState(false);
  const [importPhase,  setImportPhase]  = useState<ImportPhase>('idle');
  const [importRows,   setImportRows]   = useState<ImportRow[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError,  setImportError]  = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const perPage = 20;

  // ── Data loading ───────────────────────────────────────────────────────────

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        tenant_id: tenantId, page: String(page), per_page: String(perPage),
        ...(search ? { search } : {}),
        ...(filter ? { person_type: filter } : {}),
        ...(originFilter ? { origin: originFilter } : {}),
      });
      const resp = await api.get<ListResp>(`/v1/clients?${p}`);
      setItems(resp.data);
      setTotal(resp.total);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [tenantId, page, search, filter, originFilter]);

  // Load history when drawer opens for edit
  useEffect(() => {
    if (!drawerOpen || !editing) { setHistory(null); return; }
    setHistoryLoading(true);
    api.get<{ orders: any[]; invoices: any[]; receivables: any[] }>(`/v1/clients/${editing.id}/history`)
      .then(r => setHistory(r))
      .catch(() => setHistory(null))
      .finally(() => setHistoryLoading(false));
  }, [drawerOpen, editing?.id]);

  // Load contacts when drawer opens for edit
  useEffect(() => {
    if (!drawerOpen || !editing || !tenantId) {
      setContacts([]);
      setShowContactForm(false);
      setEditingContact(null);
      setContactForm({ ...EMPTY_CONTACT });
      setContactError('');
      return;
    }
    setContactsLoading(true);
    api.get<{ data: ClientContact[] }>(`/v1/clients/${editing.id}/contacts?tenant_id=${tenantId}`)
      .then(r => setContacts(r.data))
      .catch(() => {/**/})
      .finally(() => setContactsLoading(false));
  }, [drawerOpen, editing?.id, tenantId]);

  // ── Drawer helpers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({
      ...EMPTY_FORM,
      person_type:   c.person_type,
      company_name:  c.company_name  ?? '',
      trade_name:    c.trade_name    ?? '',
      cnpj:          c.cnpj ? maskCNPJ(c.cnpj) : '',
      state_reg:     c.state_reg     ?? '',
      full_name:     c.full_name     ?? '',
      cpf:           c.cpf  ? maskCPF(c.cpf)   : '',
      email:         c.email         ?? '',
      phone:         c.phone ? maskPhone(c.phone) : '',
      mobile:        c.mobile ? maskPhone(c.mobile) : '',
      zip_code:      c.zip_code ? maskCEP(c.zip_code) : '',
      street:        c.street        ?? '',
      street_number: c.street_number ?? '',
      complement:    c.complement    ?? '',
      neighborhood:  c.neighborhood  ?? '',
      city:          c.city          ?? '',
      state:         c.state         ?? 'SP',
      icms_taxpayer: c.icms_taxpayer ?? '9',
      consumer_type: c.consumer_type ?? '0',
      tax_regime:    c.tax_regime    ?? '',
      notes:         c.notes         ?? '',   // ← bug fix: preenche notes existentes
      whatsapp_opt_in: c.whatsapp_opt_in ?? false,
    });
    setFormError('');
    setDrawerOpen(true);
  }

  // Deep-link "?edit=<id>" (regra 61/74) — vem do link "Cadastrar" na tela de
  // NF-e quando o cliente selecionado ainda não tem regime tributário no
  // cadastro. Busca direto por id (não depende do cliente estar na página/
  // filtro atual da listagem), mesmo padrão de MaterialsPage.tsx.
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || !tenantId) return;
    (async () => {
      try {
        const c = await api.get<Client>(`/v1/clients/${editId}`);
        openEdit(c);
      } catch { /**/ } finally {
        const next = new URLSearchParams(searchParams);
        next.delete('edit');
        setSearchParams(next, { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, searchParams]);

  function setF(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      let val = e.target.value;
      if (field === 'cnpj')                        val = maskCNPJ(val);
      if (field === 'cpf')                         val = maskCPF(val);
      if (field === 'phone' || field === 'mobile') val = maskPhone(val);
      if (field === 'zip_code')                    val = maskCEP(val);
      if (field === 'person_type' && val === 'PF')
        setForm(f => ({ ...f, person_type: 'PF', icms_taxpayer: '9', consumer_type: '1' }));
      else if (field === 'person_type' && val === 'PJ')
        setForm(f => ({ ...f, person_type: 'PJ', icms_taxpayer: '9', consumer_type: '0' }));
      else
        setForm(f => ({ ...f, [field]: val }));
    };
  }

  async function handleCEP(cep: string) {
    setCepLoading(true);
    const addr = await fetchAddressByCEP(cep);
    if (addr) setForm(f => ({ ...f, ...addr }));
    setCepLoading(false);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setFormError('');

    if (form.person_type === 'PJ' && form.cnpj && !isValidCNPJ(form.cnpj)) {
      setFormError(t('cl.errCNPJ')); return;
    }
    if (form.person_type === 'PF' && form.cpf && !isValidCPF(form.cpf)) {
      setFormError(t('cl.errCPF')); return;
    }

    setSaving(true);
    try {
      const payload = {
        tenant_id:     tenantId,
        person_type:   form.person_type,
        company_name:  form.company_name  || undefined,
        trade_name:    form.trade_name    || undefined,
        cnpj:          form.cnpj   ? normalizeCNPJ(form.cnpj)   : undefined,
        state_reg:     form.state_reg     || undefined,
        municipal_reg: form.municipal_reg || undefined,
        suframa:       form.suframa       || undefined,
        full_name:     form.full_name     || undefined,
        cpf:           form.cpf    ? digits(form.cpf)    : undefined,
        birth_date:    form.birth_date    || undefined,
        rg:            form.rg            || undefined,
        rg_issuer:     form.rg_issuer     || undefined,
        email:         form.email         || undefined,
        phone:         form.phone  ? digits(form.phone)  : undefined,
        mobile:        form.mobile ? digits(form.mobile) : undefined,
        zip_code:      form.zip_code ? digits(form.zip_code) : undefined,
        street:        form.street        || undefined,
        street_number: form.street_number || undefined,
        complement:    form.complement    || undefined,
        neighborhood:  form.neighborhood  || undefined,
        city:          form.city          || undefined,
        state:         form.state         || undefined,
        country:       form.country       || 'BR',
        icms_taxpayer: form.icms_taxpayer,
        consumer_type: form.consumer_type,
        tax_regime:    form.tax_regime    || undefined,
        notes:         form.notes         || undefined,
        whatsapp_opt_in: form.whatsapp_opt_in,
      };
      if (editing) await api.patch(`/v1/clients/${editing.id}`, payload);
      else         await api.post('/v1/clients', payload);
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    const ok = await modal.confirm({ title: t('cl.deact'), message: t('cl.deactMsg'), confirmLabel: 'Desativar', danger: true });
    if (!ok) return;
    try { await api.delete(`/v1/clients/${id}`); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  // ── Contact handlers ───────────────────────────────────────────────────────

  function openAddContact() {
    setEditingContact(null);
    setContactForm({ ...EMPTY_CONTACT });
    setContactError('');
    setShowContactForm(true);
  }

  function openEditContact(c: ClientContact) {
    setEditingContact(c);
    setContactForm({
      contact_type: c.contact_type,
      name:         c.name  ?? '',
      email:        c.email ?? '',
      phone:        c.phone ? maskPhone(c.phone) : '',
      notes:        c.notes ?? '',
    });
    setContactError('');
    setShowContactForm(true);
  }

  async function handleSaveContact() {
    if (!tenantId || !editing) return;
    setContactError('');
    setSavingContact(true);
    try {
      const payload = {
        tenant_id:    tenantId,
        contact_type: contactForm.contact_type,
        name:         contactForm.name  || undefined,
        email:        contactForm.email || undefined,
        phone:        contactForm.phone ? digits(contactForm.phone) : undefined,
        notes:        contactForm.notes || undefined,
      };
      if (editingContact) {
        await api.patch(`/v1/clients/${editing.id}/contacts/${editingContact.id}`, payload);
      } else {
        await api.post(`/v1/clients/${editing.id}/contacts`, payload);
      }
      setShowContactForm(false);
      // Reload contacts
      const r = await api.get<{ data: ClientContact[] }>(`/v1/clients/${editing.id}/contacts?tenant_id=${tenantId}`);
      setContacts(r.data);
    } catch (err: unknown) {
      setContactError(err instanceof Error ? err.message : t('cl.errSave'));
    } finally { setSavingContact(false); }
  }

  async function handleDeleteContact(cid: string) {
    if (!editing) return;
    const ok = await modal.confirm({ title: t('cl.delContact'), message: t('cl.delContactMsg'), confirmLabel: 'Remover', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/v1/clients/${editing.id}/contacts/${cid}`);
      setContacts(prev => prev.filter(c => c.id !== cid));
    } catch (err: unknown) { modal.error(err); }
  }

  // ── Import handlers ────────────────────────────────────────────────────────

  function closeImport() {
    setImportOpen(false);
    setImportPhase('idle');
    setImportRows([]);
    setImportResult(null);
    setImportError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      const mapped  = rawRows
        .map(mapXlsxRow)
        .filter(r => r.person_type === 'PJ' || r.person_type === 'PF');
      if (mapped.length === 0) { setImportError(t('cl.importEmpty')); return; }
      setImportRows(mapped);
      setImportPhase('preview');
    } catch { setImportError(t('cl.importParseErr')); }
  }

  async function runImport() {
    if (!tenantId || importRows.length === 0) return;
    setImportPhase('importing');
    try {
      const result = await api.post<ImportResult>('/v1/clients/import', { tenant_id: tenantId, clients: importRows });
      setImportResult(result);
      setImportPhase('done');
      void load();
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : t('cl.errSave'));
      setImportPhase('preview');
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / perPage);
  const isPJ = form.person_type === 'PJ';
  const PREVIEW_LIMIT = 5;

  const contactTypeLabel = (type: string) =>
    t(`cl.contact.${type}` as Parameters<typeof t>[0]) || type;

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <h1>{t('cl.title')}</h1>
        <div className="flex-gap">
          <Can permission="clients:export">
            <button className="btn btn-secondary btn-cta" style={{ width: 'auto' }}
              onClick={() => {
                const ws = XLSX.utils.json_to_sheet(items.map((c: Client) => ({ company_name: c.company_name, full_name: c.full_name, cnpj: c.cnpj, cpf: c.cpf, email: c.email, phone: c.phone, city: c.city, state: c.state, is_active: c.is_active })));
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Dados');
                XLSX.writeFile(wb, `clientes-${new Date().toISOString().slice(0,10)}.xlsx`);
              }}>
              ↓ Exportar
            </button>
          </Can>
          <Can permission="clients:import">
            <button className="btn btn-secondary btn-cta" style={{ width: 'auto' }}
              onClick={() => { setImportOpen(true); setImportPhase('idle'); }}>
              ↑ {t('cl.import')}
            </button>
          </Can>
          <Can permission="clients:create">
            <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
              + {t('cl.new')}
            </button>
          </Can>
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="flex-gap" style={{ marginBottom: 16 }}>
        <input placeholder={t('cl.searchPH')} value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 280 }} />
        <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
          <option value="">{t('cl.allTypes')}</option>
          <option value="PJ">{t('cl.pj')}</option>
          <option value="PF">{t('cl.pf')}</option>
        </select>
        <select value={originFilter} onChange={e => { setOriginFilter(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
          <option value="">{t('cl.allOrigins')}</option>
          <option value="erp">{t('cl.originErp')}</option>
          <option value="landing_page">{t('cl.originLanding')}</option>
        </select>
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            {t('cl.empty')}{' '}
            <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('cl.addFirst')}</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('c.type')}</th>
                <th>{t('cl.name')}</th>
                <th>{t('cl.doc')}</th>
                <th>{t('cl.city')}</th>
                <th>{t('cl.fiscal')}</th>
                <th>{t('cl.contact')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id}>
                  <td>
                    <span className={`badge badge-${c.person_type === 'PJ' ? 'product' : 'service'}`}>
                      {c.person_type}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 500 }}>{c.company_name ?? c.full_name}</span>
                      {c.origin === 'landing_page' && (
                        <span className="badge badge-service" style={{ fontSize: 10 }} title={t('cl.originLanding')}>
                          {t('cl.originLanding')}
                        </span>
                      )}
                    </div>
                    {c.trade_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.trade_name}</div>}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {c.person_type === 'PJ' ? (c.cnpj ? maskCNPJ(c.cnpj) : '—') : (c.cpf ? maskCPF(c.cpf) : '—')}
                  </td>
                  <td>{c.city && c.state ? `${c.city} / ${c.state}` : '—'}</td>
                  <td>
                    <span title={c.icms_taxpayer === '1' ? t('cl.icms1') : c.icms_taxpayer === '2' ? t('cl.icms2') : t('cl.icms9')}
                      style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {c.icms_taxpayer === '1' ? t('cl.contrib') : c.icms_taxpayer === '2' ? t('cl.exempt') : t('cl.nonC')}
                    </span>
                    {c.consumer_type === '1' && (
                      <span className="badge badge-raw_material" style={{ marginLeft: 4, fontSize: 10 }}>CF</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{c.email ?? '—'}</td>
                  <td>
                    <div className="flex-gap">
                      {/* Central de agendamento do cliente (pacotes, portal,
                          histórico) — página antes órfã (fix de auditoria) */}
                      <Can permission="scheduling:view">
                        <Link to={`/scheduling/clients/${c.id}`} className="btn btn-secondary btn-sm">Agenda</Link>
                      </Can>
                      <Can permission="clients:edit">
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>{t('c.edit')}</button>
                      </Can>
                      <Can permission="clients:delete">
                        <button className="btn btn-danger btn-sm"    onClick={() => handleDelete(c.id)}>{t('c.del')}</button>
                      </Can>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex-gap mt-16" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            {t('c.prev')}
          </button>
          <span className="text-muted" style={{ fontSize: 13 }}>
            {t('c.page')} {page} {t('c.of')} {totalPages}
          </span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            {t('c.next')}
          </button>
        </div>
      )}

      {/* ── Drawer — create / edit ────────────────────────────────────── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{editing ? t('cl.edit') : t('cl.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                <div className="field">
                  <label>{t('cl.personType')} *</label>
                  <div className="flex-gap">
                    {(['PJ','PF'] as const).map(tp => (
                      <label key={tp} style={{
                        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                        flex: 1, padding: '8px 12px',
                        border: `1.5px solid ${form.person_type === tp ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: 6,
                        background: form.person_type === tp ? '#eef2ff' : '#fff',
                        fontWeight: 500,
                      }}>
                        <input type="radio" name="person_type" value={tp}
                          checked={form.person_type === tp} onChange={setF('person_type')}
                          style={{ width: 'auto', margin: 0 }} />
                        {tp === 'PJ' ? t('cl.pjShort') : t('cl.pfShort')}
                      </label>
                    ))}
                  </div>
                </div>

                {isPJ ? (
                  <>
                    <div className="field">
                      <label>{t('cl.rsocial')} *</label>
                      <input value={form.company_name} onChange={setF('company_name')} required={isPJ} />
                    </div>
                    <div className="field">
                      <label>{t('cl.trade')}</label>
                      <input value={form.trade_name} onChange={setF('trade_name')} />
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>CNPJ</label>
                        <input value={form.cnpj} onChange={setF('cnpj')} placeholder="00.000.000/0001-00" maxLength={18} />
                      </div>
                      <div className="field">
                        <label>{t('cl.ie')}</label>
                        <input value={form.state_reg} onChange={setF('state_reg')} placeholder="IE" />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>{t('cl.im')}</label>
                        <input value={form.municipal_reg} onChange={setF('municipal_reg')} placeholder="IM" />
                      </div>
                      <div className="field">
                        <label>SUFRAMA</label>
                        <input value={form.suframa} onChange={setF('suframa')} placeholder="Zona Franca" />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="field">
                      <label>{t('cl.fullName')} *</label>
                      <input value={form.full_name} onChange={setF('full_name')} required={!isPJ} />
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>CPF</label>
                        <input value={form.cpf} onChange={setF('cpf')} placeholder="000.000.000-00" maxLength={14} />
                      </div>
                      <div className="field">
                        <label>{t('cl.birth')}</label>
                        <input type="date" value={form.birth_date} onChange={setF('birth_date')} />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>{t('cl.rg')}</label>
                        <input value={form.rg} onChange={setF('rg')} />
                      </div>
                      <div className="field">
                        <label>{t('cl.rgIssuer')}</label>
                        <input value={form.rg_issuer} onChange={setF('rg_issuer')} placeholder="SSP/SP" />
                      </div>
                    </div>
                  </>
                )}

                <SectionLabel label={t('cl.contact')} />
                <div className="field-row">
                  <div className="field">
                    <label>{t('c.email')}</label>
                    <input type="email" value={form.email} onChange={setF('email')} />
                  </div>
                  <div className="field">
                    <label>{t('cl.phone')}</label>
                    <input value={form.phone} onChange={setF('phone')} placeholder="(11) 99999-0000" maxLength={15} />
                  </div>
                </div>

                <SectionLabel label={t('cl.address')} />
                <div className="field-row">
                  <div className="field">
                    <label>
                      {t('cl.zip')}
                      {cepLoading && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>{t('cl.searching')}</span>}
                    </label>
                    <input value={form.zip_code} onChange={setF('zip_code')} placeholder="00000-000" maxLength={9}
                      onBlur={e => { if (digits(e.target.value).length === 8) void handleCEP(e.target.value); }} />
                  </div>
                  <div className="field" style={{ flex: '0 0 90px' }}>
                    <label>{t('cl.uf')}</label>
                    <select value={form.state} onChange={setF('state')}>
                      {UF_LIST.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>{t('cl.street')}</label>
                    <input value={form.street} onChange={setF('street')} />
                  </div>
                  <div className="field" style={{ flex: '0 0 100px' }}>
                    <label>{t('cl.number')}</label>
                    <input value={form.street_number} onChange={setF('street_number')} />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>{t('cl.nbhd')}</label>
                    <input value={form.neighborhood} onChange={setF('neighborhood')} />
                  </div>
                  <div className="field">
                    <label>{t('cl.city2')}</label>
                    <input value={form.city} onChange={setF('city')} />
                  </div>
                </div>

                <SectionLabel label={t('cl.nfe')} />
                <div className="field-row">
                  <div className="field">
                    <label>{t('cl.icms')}</label>
                    <select value={form.icms_taxpayer} onChange={setF('icms_taxpayer')} disabled={!isPJ}>
                      <option value="1">{t('cl.icms1')}</option>
                      <option value="2">{t('cl.icms2')}</option>
                      <option value="9">{t('cl.icms9')}</option>
                    </select>
                    {!isPJ && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('cl.pfIcms')}</span>}
                  </div>
                  <div className="field">
                    <label>{t('cl.consumer')}</label>
                    <select value={form.consumer_type} onChange={setF('consumer_type')} disabled={!isPJ}>
                      <option value="0">{t('cl.cons0')}</option>
                      <option value="1">{t('cl.cons1')}</option>
                    </select>
                    {!isPJ && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('cl.pfCons')}</span>}
                  </div>
                </div>
                {/* Regra 61/74: travado aqui no cadastro, nunca mais
                    perguntado na tela de emissão de NF-e. */}
                <div className="field">
                  <label>{t('tax.regime')}</label>
                  <select value={form.tax_regime} onChange={setF('tax_regime')}>
                    <option value="">{t('cl.taxRegimeNone')}</option>
                    <option value="lucro_presumido">{t('tax.regimeLLP')}</option>
                    <option value="lucro_real">{t('tax.regimeLR')}</option>
                    <option value="simples_nacional">{t('tax.regimeSN')}</option>
                    <option value="mei">{t('tax.regimeMEI')}</option>
                  </select>
                </div>

                <div className="field">
                  <label>{t('cl.notes')}</label>
                  <textarea value={form.notes} onChange={setF('notes')} rows={3} />
                </div>

                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={form.whatsapp_opt_in}
                      onChange={e => setForm(f => ({ ...f, whatsapp_opt_in: e.target.checked }))}
                      style={{ width: 'auto' }}
                    />
                    {t('cl.whatsappOptIn')}
                  </label>
                </div>

                {/* ── Contatos (somente no modo edição) ─────────────── */}
                {editing && (
                  <>
                    <SectionLabel label={t('cl.contacts')} />

                    {contactsLoading ? (
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('c.loading')}</div>
                    ) : (
                      <>
                        {contacts.length === 0 && !showContactForm && (
                          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>{t('cl.noContacts')}</div>
                        )}

                        {/* Lista de contatos */}
                        {contacts.map(ct => (
                          <div key={ct.id} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '10px 12px', marginBottom: 6,
                            border: '1px solid var(--border)', borderRadius: 8,
                            background: 'var(--surface)',
                          }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                                <span className="badge badge-product" style={{ fontSize: 10, textTransform: 'capitalize' }}>
                                  {contactTypeLabel(ct.contact_type)}
                                </span>
                                {ct.name && <strong style={{ fontSize: 13 }}>{ct.name}</strong>}
                              </div>
                              {ct.email && <div style={{ fontSize: 12, color: 'var(--muted)' }}>✉ {ct.email}</div>}
                              {ct.phone && <div style={{ fontSize: 12, color: 'var(--muted)' }}>📞 {maskPhone(ct.phone)}</div>}
                              {ct.notes && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{ct.notes}</div>}
                            </div>
                            <div className="flex-gap" style={{ flexShrink: 0 }}>
                              <button type="button" className="btn btn-secondary btn-sm"
                                onClick={() => openEditContact(ct)}>{t('c.edit')}</button>
                              <button type="button" className="btn btn-danger btn-sm"
                                onClick={() => void handleDeleteContact(ct.id)}>{t('c.del')}</button>
                            </div>
                          </div>
                        ))}

                        {/* Formulário de contato (adicionar / editar) */}
                        {showContactForm ? (
                          <div style={{ border: '1px solid var(--primary)', borderRadius: 8, padding: 14, marginTop: 8, background: '#f8f9ff' }}>
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
                              {editingContact ? t('cl.editContact') : t('cl.addContact')}
                            </div>
                            {contactError && <div className="alert alert-error" role="alert" style={{ marginBottom: 10 }}>{contactError}</div>}
                            <div>
                              <div className="field-row">
                                <div className="field">
                                  <label>{t('cl.contactType')}</label>
                                  <select value={contactForm.contact_type}
                                    onChange={e => setContactForm(f => ({ ...f, contact_type: e.target.value }))}>
                                    {CONTACT_TYPES.map(type => (
                                      <option key={type} value={type}>{contactTypeLabel(type)}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="field">
                                  <label>{t('cl.contactName')}</label>
                                  <input value={contactForm.name}
                                    onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))} />
                                </div>
                              </div>
                              <div className="field-row">
                                <div className="field">
                                  <label>{t('c.email')}</label>
                                  <input type="email" value={contactForm.email}
                                    onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} />
                                </div>
                                <div className="field">
                                  <label>{t('cl.phone')}</label>
                                  <input value={contactForm.phone} maxLength={15}
                                    onChange={e => setContactForm(f => ({ ...f, phone: maskPhone(e.target.value) }))} />
                                </div>
                              </div>
                              <div className="field">
                                <label>{t('cl.notes')}</label>
                                <input value={contactForm.notes}
                                  onChange={e => setContactForm(f => ({ ...f, notes: e.target.value }))} />
                              </div>
                              <div className="flex-gap" style={{ marginTop: 8 }}>
                                <button type="button" className="btn btn-secondary btn-sm"
                                  onClick={() => setShowContactForm(false)}>{t('c.cancel')}</button>
                                <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={savingContact}
                                  onClick={() => void handleSaveContact()}>
                                  {savingContact ? t('c.saving') : t('cl.saveContact')}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8, width: 'auto' }}
                            onClick={openAddContact}>
                            + {t('cl.addContact')}
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
                {/* ── Histórico 360° (somente no modo edição) ───────── */}
                {editing && (
                  <>
                    <SectionLabel label={t('cl.history')} />
                    {historyLoading ? (
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('c.loading')}</div>
                    ) : history ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* Pedidos */}
                        {history.orders.length > 0 && (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>{t('nav.orders')}</div>
                            {history.orders.map((o: any) => (
                              <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                                <span>#{o.number} <span className={`badge badge-${o.status}`} style={{ fontSize: 10, marginLeft: 4 }}>{o.status}</span></span>
                                <span style={{ fontWeight: 600 }}>
                                  {Number(o.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Notas Fiscais */}
                        {history.invoices.length > 0 && (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>{t('nav.invoices')}</div>
                            {history.invoices.map((inv: any) => (
                              <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                                <span>NF-e {inv.number ?? '—'} <span className={`badge badge-${inv.status}`} style={{ fontSize: 10, marginLeft: 4 }}>{inv.status}</span></span>
                                <span style={{ fontWeight: 600 }}>
                                  {Number(inv.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Contas a Receber */}
                        {history.receivables.length > 0 && (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>{t('nav.receivables')}</div>
                            {history.receivables.map((r: any) => (
                              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                                <span>
                                  {r.description}
                                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>
                                    {new Date(r.due_date + 'T12:00:00Z').toLocaleDateString('pt-BR')}
                                  </span>
                                  <span className={`badge badge-${r.status === 'paid' ? 'service' : r.status === 'overdue' ? 'raw_material' : 'product'}`} style={{ fontSize: 10, marginLeft: 4 }}>{r.status}</span>
                                </span>
                                <span style={{ fontWeight: 600 }}>
                                  {Number(r.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {history.orders.length === 0 && history.invoices.length === 0 && history.receivables.length === 0 && (
                          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('cl.historyEmpty')}</div>
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  {t('c.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : editing ? t('cl.save') : t('cl.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Import modal ──────────────────────────────────────────────── */}
      {importOpen && (
        <div className="overlay" onClick={closeImport}>
          <div onClick={e => e.stopPropagation()} style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white', borderRadius: 12,
            width: 'min(680px, 95vw)', maxHeight: '90vh',
            overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div className="drawer-header">
              <h2>{t('cl.importTitle')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={closeImport}>✕</button>
            </div>
            <div className="drawer-body">
              {importPhase === 'idle' && (
                <>
                  <p style={{ color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>{t('cl.importDesc')}</p>
                  <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                    <table style={{ fontSize: 12, minWidth: 400 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 28, textAlign: 'center' }}>#</th>
                          <th>{t('cl.importColHeader')}</th>
                          <th>{t('cl.importColReq')}</th>
                          <th>{t('cl.importColExample')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {IMPORT_LAYOUT.map((row, i) => (
                          <tr key={row.col}>
                            <td style={{ textAlign: 'center', color: 'var(--muted)' }}>{i + 1}</td>
                            <td><code style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.col}</code></td>
                            <td style={{ color: row.req ? 'var(--primary)' : 'var(--muted)' }}>{row.req ? '✓' : '—'}</td>
                            <td style={{ color: 'var(--muted)' }}>{row.ex}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex-gap" style={{ marginBottom: 20 }}>
                    <button className="btn btn-secondary" style={{ width: 'auto' }} onClick={downloadTemplate}>
                      ↓ {t('cl.importTemplate')}
                    </button>
                  </div>
                  {importError && <div role="alert" className="alert alert-error" style={{ marginBottom: 12 }}>{importError}</div>}
                  <div className="field">
                    <label>{t('cl.importFile')}</label>
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileChange} style={{ padding: '8px 0' }} />
                  </div>
                </>
              )}
              {importPhase === 'preview' && (
                <>
                  <p style={{ marginBottom: 12 }}><strong>{importRows.length}</strong> {t('cl.importRows')}</p>
                  <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                    <table style={{ fontSize: 12, minWidth: 400 }}>
                      <thead><tr><th>{t('c.type')}</th><th>{t('cl.name')}</th><th>{t('cl.doc')}</th><th>{t('c.email')}</th><th>{t('cl.city')}</th></tr></thead>
                      <tbody>
                        {importRows.slice(0, PREVIEW_LIMIT).map((r, i) => (
                          <tr key={i}>
                            <td><span className={`badge badge-${r.person_type === 'PJ' ? 'product' : 'service'}`}>{r.person_type}</span></td>
                            <td>{r.company_name ?? r.full_name ?? '—'}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
                              {r.person_type === 'PJ' ? (r.cnpj ? maskCNPJ(r.cnpj) : '—') : (r.cpf ? maskCPF(r.cpf) : '—')}
                            </td>
                            <td>{r.email ?? '—'}</td>
                            <td>{r.city && r.state ? `${r.city}/${r.state}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importRows.length > PREVIEW_LIMIT && (
                    <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                      {t('cl.importMore')} {importRows.length - PREVIEW_LIMIT} {t('cl.importMoreRows')}
                    </p>
                  )}
                  {importError && <div role="alert" className="alert alert-error" style={{ marginBottom: 12 }}>{importError}</div>}
                </>
              )}
              {importPhase === 'importing' && <div className="spinner" style={{ margin: '32px auto' }}>{t('cl.importDoing')}</div>}
              {importPhase === 'done' && importResult && (
                <>
                  <div className="alert alert-success" role="alert" style={{ marginBottom: 16 }}>
                    <strong>{importResult.imported}</strong> {t('cl.importSuccess')}
                    {importResult.skipped > 0 && (
                      <span style={{ marginLeft: 12, color: 'var(--muted)' }}>· {importResult.skipped} {t('cl.importSkipped')}</span>
                    )}
                  </div>
                  {importResult.errors.length > 0 && (
                    <>
                      <p style={{ fontWeight: 600, marginBottom: 8 }}>{t('cl.importErrors')}</p>
                      <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 12, lineHeight: 1.8 }}>
                        {importResult.errors.map((e, i) => (
                          <div key={i} style={{ color: 'var(--danger)' }}>
                            <strong>{t('cl.importErrRow')} {e.row}:</strong> {e.message}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="drawer-footer">
              {importPhase === 'idle' && <button className="btn btn-secondary" onClick={closeImport}>{t('c.cancel')}</button>}
              {importPhase === 'preview' && (
                <>
                  <button className="btn btn-secondary" onClick={() => { setImportPhase('idle'); setImportRows([]); setImportError(''); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                    ← {t('c.cancel')}
                  </button>
                  <button className="btn btn-primary" style={{ width: 'auto' }} onClick={() => void runImport()}>
                    {t('cl.importBtn')} {importRows.length} {t('cl.importClients')}
                  </button>
                </>
              )}
              {importPhase === 'importing' && <span style={{ color: 'var(--muted)', fontSize: 13 }}>{t('cl.importDoing')}</span>}
              {importPhase === 'done' && <button className="btn btn-primary" style={{ width: 'auto' }} onClick={closeImport}>{t('cl.importClose')}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <p style={{
      fontSize: 11, fontWeight: 700, color: 'var(--muted)',
      letterSpacing: '.06em', textTransform: 'uppercase',
      margin: '20px 0 12px', borderTop: '1px solid var(--border)', paddingTop: 16,
    }}>
      {label}
    </p>
  );
}

// ── Import column layout ─────────────────────────────────────────────────────

const IMPORT_LAYOUT: { col: string; req: boolean; ex: string }[] = [
  { col: 'tipo_pessoa',        req: true,  ex: 'PJ ou PF' },
  { col: 'razao_social',       req: false, ex: 'ACME Ltda  (obrigatório para PJ)' },
  { col: 'nome_fantasia',      req: false, ex: 'ACME' },
  { col: 'cnpj',               req: false, ex: '11444777000161' },
  { col: 'inscricao_estadual', req: false, ex: '123456789' },
  { col: 'inscricao_municipal',req: false, ex: '987654' },
  { col: 'suframa',            req: false, ex: '123456789' },
  { col: 'nome_completo',      req: false, ex: 'Maria Silva  (obrigatório para PF)' },
  { col: 'cpf',                req: false, ex: '12345678901' },
  { col: 'data_nascimento',    req: false, ex: '1985-06-15' },
  { col: 'email',              req: false, ex: 'contato@acme.com.br' },
  { col: 'telefone',           req: false, ex: '1199990000' },
  { col: 'celular',            req: false, ex: '11999990001' },
  { col: 'cep',                req: false, ex: '01310100' },
  { col: 'logradouro',         req: false, ex: 'Av Paulista' },
  { col: 'numero',             req: false, ex: '1000' },
  { col: 'complemento',        req: false, ex: 'Sala 10' },
  { col: 'bairro',             req: false, ex: 'Bela Vista' },
  { col: 'cidade',             req: false, ex: 'São Paulo' },
  { col: 'uf',                 req: false, ex: 'SP' },
  { col: 'contribuinte_icms',  req: false, ex: '9  (1=Contrib · 2=Isento · 9=Não Contrib)' },
  { col: 'tipo_consumidor',    req: false, ex: '0  (0=B2B · 1=Consumidor Final)' },
  { col: 'observacoes',        req: false, ex: 'texto livre' },
];
