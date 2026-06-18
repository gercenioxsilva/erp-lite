import { useEffect, useState, FormEvent } from 'react';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';
import {
  maskCNPJ, maskCPF, maskPhone, maskCEP, digits,
  isValidCNPJ, isValidCPF, fetchAddressByCEP, UF_LIST,
} from '../../lib/brazil';

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
  city:          string | null;
  state:         string | null;
  icms_taxpayer: string;
  consumer_type: string;
  is_active:     boolean;
}

interface ListResp { data: Client[]; total: number; page: number; per_page: number; }

const EMPTY_FORM = {
  person_type:   'PJ' as 'PJ' | 'PF',
  company_name: '', trade_name: '', cnpj: '', state_reg: '', municipal_reg: '', suframa: '',
  full_name: '', cpf: '', birth_date: '', rg: '', rg_issuer: '', rg_issue_date: '',
  email: '', phone: '', mobile: '',
  zip_code: '', street: '', street_number: '', complement: '',
  neighborhood: '', city: '', state: 'SP', country: 'BR',
  icms_taxpayer: '9' as string, consumer_type: '0' as string,
  notes: '',
};

export function ClientsPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const [items,      setItems]      = useState<Client[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState('');
  const [loading,    setLoading]    = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Client | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');
  const [cepLoading, setCepLoading] = useState(false);

  const perPage = 20;

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        tenant_id: tenantId, page: String(page), per_page: String(perPage),
        ...(search ? { search } : {}),
        ...(filter ? { person_type: filter } : {}),
      });
      const resp = await api.get<ListResp>(`/v1/clients?${p}`);
      setItems(resp.data);
      setTotal(resp.total);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [tenantId, page, search, filter]);

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
      person_type:  c.person_type,
      company_name: c.company_name  ?? '',
      trade_name:   c.trade_name    ?? '',
      cnpj:         c.cnpj ? maskCNPJ(c.cnpj) : '',
      state_reg:    c.state_reg     ?? '',
      full_name:    c.full_name     ?? '',
      cpf:          c.cpf  ? maskCPF(c.cpf)   : '',
      email:        c.email         ?? '',
      phone:        c.phone ? maskPhone(c.phone) : '',
      city:         c.city          ?? '',
      state:        c.state         ?? 'SP',
      icms_taxpayer: c.icms_taxpayer ?? '9',
      consumer_type: c.consumer_type ?? '0',
    });
    setFormError('');
    setDrawerOpen(true);
  }

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
        cnpj:          form.cnpj   ? digits(form.cnpj)   : undefined,
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
        notes:         form.notes         || undefined,
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
    if (!confirm(t('cl.deact'))) return;
    try { await api.delete(`/v1/clients/${id}`); void load(); } catch { /**/ }
  }

  const totalPages = Math.ceil(total / perPage);
  const isPJ = form.person_type === 'PJ';

  return (
    <div>
      <div className="page-header">
        <h1>{t('cl.title')}</h1>
        <button className="btn btn-primary" style={{ width: 'auto' }} onClick={openCreate}>
          + {t('cl.new')}
        </button>
      </div>

      <div className="flex-gap" style={{ marginBottom: 16 }}>
        <input
          placeholder={t('cl.searchPH')}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ maxWidth: 280 }}
        />
        <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
          <option value="">{t('cl.allTypes')}</option>
          <option value="PJ">{t('cl.pj')}</option>
          <option value="PF">{t('cl.pf')}</option>
        </select>
      </div>

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
                    <div style={{ fontWeight: 500 }}>{c.company_name ?? c.full_name}</div>
                    {c.trade_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.trade_name}</div>}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {c.person_type === 'PJ'
                      ? (c.cnpj ? maskCNPJ(c.cnpj) : '—')
                      : (c.cpf  ? maskCPF(c.cpf)   : '—')}
                  </td>
                  <td>{c.city && c.state ? `${c.city} / ${c.state}` : '—'}</td>
                  <td>
                    <span
                      title={c.icms_taxpayer === '1' ? t('cl.icms1') : c.icms_taxpayer === '2' ? t('cl.icms2') : t('cl.icms9')}
                      style={{ fontSize: 11, color: 'var(--muted)' }}
                    >
                      {c.icms_taxpayer === '1' ? t('cl.contrib') : c.icms_taxpayer === '2' ? t('cl.exempt') : t('cl.nonC')}
                    </span>
                    {c.consumer_type === '1' && (
                      <span className="badge badge-raw_material" style={{ marginLeft: 4, fontSize: 10 }}>CF</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{c.email ?? '—'}</td>
                  <td>
                    <div className="flex-gap">
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>{t('c.edit')}</button>
                      <button className="btn btn-danger btn-sm"    onClick={() => handleDelete(c.id)}>{t('c.del')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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

      {/* ── Drawer ─────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{editing ? t('cl.edit') : t('cl.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSave} style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error">{formError}</div>}

                {/* Tipo de pessoa */}
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

                {/* Campos PJ */}
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
                  /* Campos PF */
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

                {/* Contato */}
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

                {/* Endereço */}
                <SectionLabel label={t('cl.address')} />
                <div className="field-row">
                  <div className="field">
                    <label>
                      {t('cl.zip')}
                      {cepLoading && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>{t('cl.searching')}</span>}
                    </label>
                    <input
                      value={form.zip_code}
                      onChange={setF('zip_code')}
                      placeholder="00000-000"
                      maxLength={9}
                      onBlur={e => { if (digits(e.target.value).length === 8) void handleCEP(e.target.value); }}
                    />
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

                {/* NF-e */}
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

                <div className="field">
                  <label>{t('cl.notes')}</label>
                  <textarea value={form.notes} onChange={setF('notes')} />
                </div>
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
    </div>
  );
}

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


