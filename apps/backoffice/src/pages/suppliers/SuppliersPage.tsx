import { useEffect, useState } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import {
  maskCNPJ, maskCPF, maskPhone, maskCEP, digits, normalizeCNPJ,
  fetchAddressByCEP, UF_LIST,
} from '../../lib/brazil';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Supplier {
  id:           string;
  person_type:  'PJ' | 'PF';
  company_name: string | null;
  trade_name:   string | null;
  cnpj:         string | null;
  full_name:    string | null;
  cpf:          string | null;
  email:        string | null;
  phone:        string | null;
  city:         string | null;
  state:        string | null;
  category:     string;
  is_active:    boolean;
  created_at:   string;
}

interface SupplierDetail extends Supplier {
  zip_code:      string | null;
  street:        string | null;
  street_number: string | null;
  complement:    string | null;
  neighborhood:  string | null;
  bank_code:     string | null;
  agency:        string | null;
  account:       string | null;
  account_digit: string | null;
  pix_key:       string | null;
  notes:         string | null;
}

interface SupplierPayable {
  id:          string;
  description: string;
  amount:      string;
  due_date:    string;
  status:      string;
}

interface SupplierContact {
  id:           string;
  contact_type: string;
  name:         string | null;
  email:        string | null;
  phone:        string | null;
  notes:        string | null;
  is_active:    boolean;
}

// Papéis do lado do fornecedor — não reaproveita os rótulos de client_contacts
// ('comprador'/'compras' descreve quem compra DE nós, não do fornecedor).
const SUPPLIER_CONTACT_TYPES = ['comercial', 'financeiro', 'suporte', 'logistica', 'outro'] as const;

const EMPTY_SUPPLIER_CONTACT = {
  contact_type: 'comercial' as string,
  name: '', email: '', phone: '', notes: '',
};

const EMPTY_FORM = {
  person_type:   'PJ' as 'PJ' | 'PF',
  company_name:  '',
  trade_name:    '',
  cnpj:          '',
  full_name:     '',
  cpf:           '',
  email:         '',
  phone:         '',
  zip_code:      '',
  street:        '',
  street_number: '',
  complement:    '',
  neighborhood:  '',
  city:          '',
  state:         '',
  bank_code:     '',
  agency:        '',
  account:       '',
  account_digit: '',
  pix_key:       '',
  category:      'services',
  notes:         '',
  is_active:     true,
};

const CATEGORIES = [
  { value: 'services',  labelKey: 'sup.catServices'  as const },
  { value: 'supplies',  labelKey: 'sup.catSupplies'  as const },
  { value: 'utilities', labelKey: 'sup.catUtilities' as const },
  { value: 'rent',      labelKey: 'sup.catRent'      as const },
  { value: 'payroll',   labelKey: 'sup.catPayroll'   as const },
  { value: 'taxes',     labelKey: 'sup.catTaxes'     as const },
  { value: 'other',     labelKey: 'sup.catOther'     as const },
];

const STATUS_COLORS: Record<string, string> = {
  pending: '#d97706', partial: '#2563eb', paid: '#16a34a',
  overdue: '#dc2626', cancelled: '#6b7280',
};

export function SuppliersPage() {
  const { tenantId } = useAuth();
  const { t }        = useI18n();
  const { confirm }  = useModal();

  // List state
  const [items, setItems]           = useState<Supplier[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [search, setSearch]         = useState('');
  const [catFilter, setCatFilter]   = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading]       = useState(false);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SupplierDetail | null>(null);
  const [drawerTab, setDrawerTab]   = useState<'general' | 'banking' | 'contacts'>('general');
  const [form, setForm]             = useState({ ...EMPTY_FORM });
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');
  const [cepLoading, setCepLoading] = useState(false);

  // Contacts sub-panel (edit mode only)
  const [contacts,        setContacts]        = useState<SupplierContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContact,  setEditingContact]  = useState<SupplierContact | null>(null);
  const [contactForm,     setContactForm]     = useState({ ...EMPTY_SUPPLIER_CONTACT });
  const [savingContact,   setSavingContact]   = useState(false);
  const [contactError,    setContactError]    = useState('');

  // Payables sub-panel
  const [supPayables, setSupPayables]     = useState<SupplierPayable[]>([]);
  const [payablesLoading, setPayablesLoading] = useState(false);

  const PER_PAGE = 20;

  useEffect(() => {
    if (!tenantId) return;
    loadItems();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, page, search, catFilter, showInactive]);

  async function loadItems() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (search)      qs.set('search', search);
      if (catFilter)   qs.set('category', catFilter);
      qs.set('is_active', showInactive ? 'all' : 'true');
      const data = await api.get<any>(`/v1/suppliers?${qs}`);
      setItems(data.data); setTotal(data.total);
    } finally { setLoading(false); }
  }

  function openCreate() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setDrawerTab('general');
    setSupPayables([]);
    setContacts([]);
    setShowContactForm(false);
    setEditingContact(null);
    setContactForm({ ...EMPTY_SUPPLIER_CONTACT });
    setContactError('');
    setDrawerOpen(true);
  }

  async function openEdit(sup: Supplier) {
    const full = await api.get<SupplierDetail>(`/v1/suppliers/${sup.id}`);
    setEditTarget(full);
    setForm({
      person_type:   full.person_type,
      company_name:  full.company_name  || '',
      trade_name:    full.trade_name    || '',
      cnpj:          full.cnpj          ? maskCNPJ(full.cnpj) : '',
      full_name:     full.full_name     || '',
      cpf:           full.cpf           ? maskCPF(full.cpf) : '',
      email:         full.email         || '',
      phone:         full.phone         ? maskPhone(full.phone) : '',
      zip_code:      full.zip_code      ? maskCEP(full.zip_code) : '',
      street:        full.street        || '',
      street_number: full.street_number || '',
      complement:    full.complement    || '',
      neighborhood:  full.neighborhood  || '',
      city:          full.city          || '',
      state:         full.state         || '',
      bank_code:     full.bank_code     || '',
      agency:        full.agency        || '',
      account:       full.account       || '',
      account_digit: full.account_digit || '',
      pix_key:       '', // never prefill masked pix_key
      category:      full.category,
      notes:         full.notes         || '',
      is_active:     full.is_active,
    });
    setFormError('');
    setDrawerTab('general');
    setDrawerOpen(true);
    setShowContactForm(false);
    setEditingContact(null);
    setContactForm({ ...EMPTY_SUPPLIER_CONTACT });
    setContactError('');
    // Load payables + contacts for this supplier
    loadSupPayables(full.id);
    loadSupContacts(full.id);
  }

  async function loadSupPayables(supplierId: string) {
    setPayablesLoading(true);
    try {
      const data = await api.get<any>(`/v1/suppliers/${supplierId}/payables?per_page=10`);
      setSupPayables(data.data);
    } catch { setSupPayables([]); }
    finally { setPayablesLoading(false); }
  }

  async function loadSupContacts(supplierId: string) {
    setContactsLoading(true);
    try {
      const data = await api.get<{ data: SupplierContact[] }>(`/v1/suppliers/${supplierId}/contacts`);
      setContacts(data.data);
    } catch { setContacts([]); }
    finally { setContactsLoading(false); }
  }

  function openAddContact() {
    setEditingContact(null);
    setContactForm({ ...EMPTY_SUPPLIER_CONTACT });
    setContactError('');
    setShowContactForm(true);
  }

  function openEditContact(c: SupplierContact) {
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
    if (!editTarget) return;
    setContactError('');
    setSavingContact(true);
    try {
      const payload = {
        contact_type: contactForm.contact_type,
        name:         contactForm.name  || undefined,
        email:        contactForm.email || undefined,
        phone:        contactForm.phone ? digits(contactForm.phone) : undefined,
        notes:        contactForm.notes || undefined,
      };
      if (editingContact) {
        await api.patch(`/v1/suppliers/${editTarget.id}/contacts/${editingContact.id}`, payload);
      } else {
        await api.post(`/v1/suppliers/${editTarget.id}/contacts`, payload);
      }
      setShowContactForm(false);
      loadSupContacts(editTarget.id);
    } catch (err: unknown) {
      setContactError(err instanceof Error ? err.message : t('sup.errSaveContact'));
    } finally { setSavingContact(false); }
  }

  async function handleDeleteContact(cid: string) {
    if (!editTarget) return;
    const ok = await confirm({ title: t('sup.delContact'), message: t('sup.delContactMsg') });
    if (!ok) return;
    try {
      await api.delete(`/v1/suppliers/${editTarget.id}/contacts/${cid}`);
      setContacts(prev => prev.filter(c => c.id !== cid));
    } catch (err: any) { alert(err.message); }
  }

  const contactTypeLabel = (type: string) =>
    t(`sup.contact.${type}` as Parameters<typeof t>[0]) || type;

  async function handleCEP(cepValue: string) {
    const d = digits(cepValue);
    if (d.length !== 8) return;
    setCepLoading(true);
    const addr = await fetchAddressByCEP(d);
    setCepLoading(false);
    if (!addr) return;
    setForm(f => ({
      ...f,
      street:       addr.street       || f.street,
      neighborhood: addr.neighborhood || f.neighborhood,
      city:         addr.city         || f.city,
      state:        addr.state        || f.state,
    }));
  }

  async function handleSave() {
    setFormError('');
    if (form.person_type === 'PJ' && !form.company_name.trim()) {
      setFormError(t('sup.name') + ' é obrigatória'); return;
    }
    if (form.person_type === 'PF' && !form.full_name.trim()) {
      setFormError(t('sup.fullName') + ' é obrigatório'); return;
    }
    setSaving(true);
    try {
      const body = {
        person_type:   form.person_type,
        company_name:  form.person_type === 'PJ' ? form.company_name.trim() || null : null,
        trade_name:    form.person_type === 'PJ' ? form.trade_name.trim()   || null : null,
        cnpj:          form.person_type === 'PJ' ? normalizeCNPJ(form.cnpj) || null : null,
        full_name:     form.person_type === 'PF' ? form.full_name.trim()    || null : null,
        cpf:           form.person_type === 'PF' ? digits(form.cpf)         || null : null,
        email:         form.email.trim()         || null,
        phone:         digits(form.phone)        || null,
        zip_code:      digits(form.zip_code)     || null,
        street:        form.street.trim()        || null,
        street_number: form.street_number.trim() || null,
        complement:    form.complement.trim()    || null,
        neighborhood:  form.neighborhood.trim()  || null,
        city:          form.city.trim()          || null,
        state:         form.state.trim()         || null,
        bank_code:     form.bank_code.trim()     || null,
        agency:        form.agency.trim()        || null,
        account:       form.account.trim()       || null,
        account_digit: form.account_digit.trim() || null,
        pix_key:       form.pix_key.trim()       || null,
        category:      form.category,
        notes:         form.notes.trim()         || null,
        is_active:     form.is_active,
      };
      if (editTarget) {
        await api.patch(`/v1/suppliers/${editTarget.id}`, body);
      } else {
        await api.post('/v1/suppliers', body);
      }
      setDrawerOpen(false);
      loadItems();
    } catch (err: any) {
      setFormError(err.message || t('sup.saveOk'));
    } finally { setSaving(false); }
  }

  async function handleDeactivate(sup: Supplier) {
    const ok = await confirm({ title: t('sup.deleteConfirm'), message: displayName(sup) });
    if (!ok) return;
    try {
      await api.delete(`/v1/suppliers/${sup.id}`);
      loadItems();
    } catch (err: any) { alert(err.message); }
  }

  const pages    = Math.max(1, Math.ceil(total / PER_PAGE));
  const fmt      = (v: string) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtDate  = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
  const catLabel = (v: string) => {
    const found = CATEGORIES.find(c => c.value === v);
    return found ? t(found.labelKey) : v;
  };
  const displayName = (s: Supplier) => s.company_name || s.full_name || '—';

  return (
    <div>
      <div className="page-header">
        <h1>{t('sup.title')}</h1>
        <button className="btn btn-primary btn-cta" onClick={openCreate}>{t('sup.add')}</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="search-input" placeholder={t('sup.search')}
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select className="btn btn-secondary" value={catFilter}
          onChange={e => { setCatFilter(e.target.value); setPage(1); }}>
          <option value="">{t('flt.category')} — {t('flt.allTypes')}</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{t(c.labelKey)}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive}
            onChange={e => { setShowInactive(e.target.checked); setPage(1); }} />
          {t('sup.showInactive')}
        </label>
        {(search || catFilter) && (
          <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
            onClick={() => { setSearch(''); setCatFilter(''); setPage(1); }}>
            {t('flt.clear')}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">{t('sup.noResults')}</div>
        ) : (
          <table>
            <thead><tr>
              <th>{t('sup.name')}</th>
              <th>{t('sup.cnpj')}/{t('sup.cpf')}</th>
              <th>{t('sup.category')}</th>
              <th>{t('sup.city')}/{t('sup.state')}</th>
              <th>{t('c.status')}</th>
              <th>{t('c.actions')}</th>
            </tr></thead>
            <tbody>
              {items.map(sup => (
                <tr key={sup.id} style={{ opacity: sup.is_active ? 1 : 0.5 }}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{displayName(sup)}</div>
                    {sup.trade_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sup.trade_name}</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {sup.person_type === 'PJ'
                      ? (sup.cnpj ? maskCNPJ(sup.cnpj) : '—')
                      : (sup.cpf  ? maskCPF(sup.cpf)   : '—')}
                  </td>
                  <td style={{ fontSize: 12 }}>{catLabel(sup.category)}</td>
                  <td style={{ fontSize: 12 }}>{sup.city || '—'}{sup.state ? ` / ${sup.state}` : ''}</td>
                  <td>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                      background: sup.is_active ? '#dcfce7' : '#f3f4f6',
                      color:      sup.is_active ? '#16a34a' : '#6b7280',
                    }}>
                      {sup.is_active ? t('sup.active') : t('sup.inactive')}
                    </span>
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(sup)}>{t('c.edit')}</button>
                    {sup.is_active && (
                      <button className="btn btn-danger btn-sm" onClick={() => handleDeactivate(sup)}>{t('c.del')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}>{t('c.prev')}</button>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t('c.page')} {page} {t('c.of')} {pages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= pages}
            onClick={() => setPage(p => p + 1)}>{t('c.next')}</button>
        </div>
      )}

      {/* ── Drawer ── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()} style={{ minWidth: 520 }}>
            <div className="drawer-header">
              <h2>{editTarget ? t('sup.edit') : t('sup.add')}</h2>
              <button onClick={() => setDrawerOpen(false)}>{t('c.close')}</button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 4 }}>
              {(editTarget ? (['general', 'banking', 'contacts'] as const) : (['general', 'banking'] as const)).map(tab => (
                <button key={tab} type="button" onClick={() => setDrawerTab(tab)} style={{
                  background: 'none', border: 'none', padding: '8px 16px', cursor: 'pointer',
                  fontWeight: drawerTab === tab ? 700 : 400,
                  color: drawerTab === tab ? 'var(--primary)' : 'var(--muted)',
                  borderBottom: drawerTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
                  marginBottom: -2, fontSize: 13,
                }}>
                  {tab === 'general' ? t('sup.tabGeneral') : tab === 'banking' ? t('sup.tabBanking') : t('sup.tabContacts')}
                </button>
              ))}
            </div>

            <div className="drawer-body">
              {formError && <div role="alert" className="alert alert-error">{formError}</div>}

              {/* ── Tab: Dados Gerais ── */}
              {drawerTab === 'general' && (
                <>
                  {/* Tipo de Pessoa */}
                  <div className="field">
                    <label>{t('sup.personType')}</label>
                    <select value={form.person_type}
                      onChange={e => setForm(f => ({ ...f, person_type: e.target.value as 'PJ' | 'PF' }))}>
                      <option value="PJ">{t('sup.pj')}</option>
                      <option value="PF">{t('sup.pf')}</option>
                    </select>
                  </div>

                  {/* PJ fields */}
                  {form.person_type === 'PJ' && (
                    <>
                      <div className="field">
                        <label>{t('sup.name')} *</label>
                        <input type="text" value={form.company_name}
                          onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>{t('sup.tradeName')}</label>
                          <input type="text" value={form.trade_name}
                            onChange={e => setForm(f => ({ ...f, trade_name: e.target.value }))} />
                        </div>
                        <div className="field">
                          <label>{t('sup.cnpj')}</label>
                          <input type="text" value={form.cnpj} maxLength={18}
                            onChange={e => setForm(f => ({ ...f, cnpj: maskCNPJ(e.target.value) }))} />
                        </div>
                      </div>
                    </>
                  )}

                  {/* PF fields */}
                  {form.person_type === 'PF' && (
                    <div className="field-row">
                      <div className="field" style={{ flex: 2 }}>
                        <label>{t('sup.fullName')} *</label>
                        <input type="text" value={form.full_name}
                          onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
                      </div>
                      <div className="field">
                        <label>{t('sup.cpf')}</label>
                        <input type="text" value={form.cpf} maxLength={14}
                          onChange={e => setForm(f => ({ ...f, cpf: maskCPF(e.target.value) }))} />
                      </div>
                    </div>
                  )}

                  {/* Contact */}
                  <div className="field-row">
                    <div className="field">
                      <label>{t('sup.email')}</label>
                      <input type="email" value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div className="field">
                      <label>{t('sup.phone')}</label>
                      <input type="text" value={form.phone} maxLength={15}
                        onChange={e => setForm(f => ({ ...f, phone: maskPhone(e.target.value) }))} />
                    </div>
                  </div>

                  {/* Category */}
                  <div className="field">
                    <label>{t('sup.category')}</label>
                    <select value={form.category}
                      onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                      {CATEGORIES.map(c => (
                        <option key={c.value} value={c.value}>{t(c.labelKey)}</option>
                      ))}
                    </select>
                  </div>

                  {/* Address */}
                  <h4 style={{ margin: '16px 0 8px', fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {t('sup.address')}
                  </h4>

                  <div className="field">
                    <label>
                      {t('sup.zipCode')}
                      {cepLoading && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>{t('sup.searching')}</span>}
                    </label>
                    <input type="text" value={form.zip_code} maxLength={9}
                      onChange={e => setForm(f => ({ ...f, zip_code: maskCEP(e.target.value) }))}
                      onBlur={e => handleCEP(e.target.value)} />
                  </div>

                  <div className="field-row">
                    <div className="field" style={{ flex: 2 }}>
                      <label>{t('sup.street')}</label>
                      <input type="text" value={form.street}
                        onChange={e => setForm(f => ({ ...f, street: e.target.value }))} />
                    </div>
                    <div className="field">
                      <label>{t('sup.streetNumber')}</label>
                      <input type="text" value={form.street_number}
                        onChange={e => setForm(f => ({ ...f, street_number: e.target.value }))} />
                    </div>
                  </div>

                  <div className="field-row">
                    <div className="field">
                      <label>{t('sup.complement')}</label>
                      <input type="text" value={form.complement}
                        onChange={e => setForm(f => ({ ...f, complement: e.target.value }))} />
                    </div>
                    <div className="field">
                      <label>{t('sup.neighborhood')}</label>
                      <input type="text" value={form.neighborhood}
                        onChange={e => setForm(f => ({ ...f, neighborhood: e.target.value }))} />
                    </div>
                  </div>

                  <div className="field-row">
                    <div className="field" style={{ flex: 2 }}>
                      <label>{t('sup.city')}</label>
                      <input type="text" value={form.city}
                        onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                    </div>
                    <div className="field" style={{ flex: 0.5 }}>
                      <label>{t('sup.state')}</label>
                      <select value={form.state}
                        onChange={e => setForm(f => ({ ...f, state: e.target.value }))}>
                        <option value="">—</option>
                        {UF_LIST.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="field">
                    <label>{t('sup.notes')}</label>
                    <textarea value={form.notes} rows={3}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      style={{ resize: 'vertical' }} />
                  </div>
                </>
              )}

              {/* ── Tab: Dados Bancários ── */}
              {drawerTab === 'banking' && (
                <>
                  <div className="field-row">
                    <div className="field">
                      <label>{t('sup.bankCode')}</label>
                      <input type="text" value={form.bank_code} maxLength={10}
                        onChange={e => setForm(f => ({ ...f, bank_code: e.target.value }))} />
                    </div>
                    <div className="field">
                      <label>{t('sup.agency')}</label>
                      <input type="text" value={form.agency} maxLength={20}
                        onChange={e => setForm(f => ({ ...f, agency: e.target.value }))} />
                    </div>
                  </div>

                  <div className="field-row">
                    <div className="field" style={{ flex: 2 }}>
                      <label>{t('sup.account')}</label>
                      <input type="text" value={form.account} maxLength={20}
                        onChange={e => setForm(f => ({ ...f, account: e.target.value }))} />
                    </div>
                    <div className="field" style={{ flex: 0.5 }}>
                      <label>{t('sup.accountDigit')}</label>
                      <input type="text" value={form.account_digit} maxLength={5}
                        onChange={e => setForm(f => ({ ...f, account_digit: e.target.value }))} />
                    </div>
                  </div>

                  <div className="field">
                    <label>{t('sup.pixKey')}</label>
                    <input type="text" value={form.pix_key} maxLength={255}
                      placeholder={editTarget?.pix_key ? '(configurada — deixe em branco para manter)' : ''}
                      onChange={e => setForm(f => ({ ...f, pix_key: e.target.value }))} />
                  </div>
                </>
              )}

              {/* Payables sub-panel (edit mode only) */}
              {editTarget && drawerTab === 'general' && (
                <div style={{ marginTop: 24 }}>
                  <h4 style={{ fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                    {t('sup.payables')}
                  </h4>
                  {payablesLoading ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('c.loading')}</div>
                  ) : supPayables.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('sup.noPayables')}</div>
                  ) : (
                    <table style={{ fontSize: 12, width: '100%' }}>
                      <thead><tr>
                        <th>{t('pay.description')}</th>
                        <th style={{ textAlign: 'right' }}>{t('pay.amount')}</th>
                        <th>{t('pay.dueDate')}</th>
                        <th>{t('pay.status')}</th>
                      </tr></thead>
                      <tbody>
                        {supPayables.map(p => (
                          <tr key={p.id}>
                            <td>{p.description}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(p.amount)}</td>
                            <td>{fmtDate(p.due_date)}</td>
                            <td>
                              <span style={{
                                fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
                                background: (STATUS_COLORS[p.status] || '#6b7280') + '22',
                                color: STATUS_COLORS[p.status] || '#6b7280',
                              }}>{p.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* ── Tab: Contatos (somente no modo edição) ── */}
              {editTarget && drawerTab === 'contacts' && (
                <>
                  <h4 style={{ fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                    {t('sup.contacts')}
                  </h4>
                  {contactsLoading ? (
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('c.loading')}</div>
                  ) : (
                    <>
                      {contacts.length === 0 && !showContactForm && (
                        <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>{t('sup.noContacts')}</div>
                      )}

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

                      {showContactForm ? (
                        <div style={{ border: '1px solid var(--primary)', borderRadius: 8, padding: 14, marginTop: 8, background: '#f8f9ff' }}>
                          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
                            {editingContact ? t('sup.editContact') : t('sup.addContact')}
                          </div>
                          {contactError && <div className="alert alert-error" role="alert" style={{ marginBottom: 10 }}>{contactError}</div>}
                          <div>
                            <div className="field-row">
                              <div className="field">
                                <label>{t('sup.contactType')}</label>
                                <select value={contactForm.contact_type}
                                  onChange={e => setContactForm(f => ({ ...f, contact_type: e.target.value }))}>
                                  {SUPPLIER_CONTACT_TYPES.map(type => (
                                    <option key={type} value={type}>{contactTypeLabel(type)}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="field">
                                <label>{t('sup.contactName')}</label>
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
                                <label>{t('sup.phone')}</label>
                                <input value={contactForm.phone} maxLength={15}
                                  onChange={e => setContactForm(f => ({ ...f, phone: maskPhone(e.target.value) }))} />
                              </div>
                            </div>
                            <div className="field">
                              <label>{t('sup.notes')}</label>
                              <input value={contactForm.notes}
                                onChange={e => setContactForm(f => ({ ...f, notes: e.target.value }))} />
                            </div>
                            <div className="flex-gap" style={{ marginTop: 8 }}>
                              <button type="button" className="btn btn-secondary btn-sm"
                                onClick={() => setShowContactForm(false)}>{t('c.cancel')}</button>
                              <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={savingContact}
                                onClick={() => void handleSaveContact()}>
                                {savingContact ? t('c.saving') : t('sup.saveContact')}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8, width: 'auto' }}
                          onClick={openAddContact}>
                          + {t('sup.addContact')}
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="drawer-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>{t('c.cancel')}</button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? t('c.saving') : t('c.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
