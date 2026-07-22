import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { Can }      from '../../rbac';

// Transportadora (migration 0089) — catálogo core por tenant, usado no
// grupo transporta da NF-e/Simples Remessa. Mesmo molde CRUD de
// SellersPage.tsx.

interface Transportadora {
  id:            string;
  person_type:   'PJ' | 'PF';
  name:          string;
  document:      string | null;
  state_reg:     string | null;
  rntc:          string | null;
  street:        string | null;
  street_number: string | null;
  complement:    string | null;
  neighborhood:  string | null;
  city:          string | null;
  state:         string | null;
  zip_code:      string | null;
  phone:         string | null;
  email:         string | null;
  is_active:     boolean;
}

interface ListResp { data: Transportadora[]; total: number; page: number; per_page: number; }

const EMPTY_FORM = {
  person_type:   'PJ' as 'PJ' | 'PF',
  name:          '',
  document:      '',
  state_reg:     '',
  rntc:          '',
  street:        '',
  street_number: '',
  complement:    '',
  neighborhood:  '',
  city:          '',
  state:         '',
  zip_code:      '',
  phone:         '',
  email:         '',
};

export function TransportadorasPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();

  const [items,   setItems]   = useState<Transportadora[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Transportadora | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  const perPage = 20;

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        page: String(page), per_page: String(perPage),
        ...(search ? { search } : {}),
      });
      const resp = await api.get<ListResp>(`/v1/transportadoras?${p}`);
      setItems(resp.data);
      setTotal(resp.total);
    } catch { /**/ } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [tenantId, page, search]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(tr: Transportadora) {
    setEditing(tr);
    setForm({
      person_type:   tr.person_type,
      name:          tr.name,
      document:      tr.document ?? '',
      state_reg:     tr.state_reg ?? '',
      rntc:          tr.rntc ?? '',
      street:        tr.street ?? '',
      street_number: tr.street_number ?? '',
      complement:    tr.complement ?? '',
      neighborhood:  tr.neighborhood ?? '',
      city:          tr.city ?? '',
      state:         tr.state ?? '',
      zip_code:      tr.zip_code ?? '',
      phone:         tr.phone ?? '',
      email:         tr.email ?? '',
    });
    setFormError('');
    setDrawerOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setFormError('');
    if (!form.name.trim()) { setFormError(t('transp.errName')); return; }

    setSaving(true);
    try {
      const payload = {
        person_type:   form.person_type,
        name:          form.name.trim(),
        document:      form.document.trim()      || undefined,
        state_reg:     form.state_reg.trim()      || undefined,
        rntc:          form.rntc.trim()           || undefined,
        street:        form.street.trim()         || undefined,
        street_number: form.street_number.trim()  || undefined,
        complement:    form.complement.trim()     || undefined,
        neighborhood:  form.neighborhood.trim()   || undefined,
        city:          form.city.trim()           || undefined,
        state:         form.state.trim()          || undefined,
        zip_code:      form.zip_code.trim()       || undefined,
        phone:         form.phone.trim()          || undefined,
        email:         form.email.trim()          || undefined,
      };
      if (editing) await api.patch(`/v1/transportadoras/${editing.id}`, payload);
      else         await api.post('/v1/transportadoras', payload);
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('transp.errSave'));
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    const ok = await modal.confirm({
      title: t('transp.deactivateTitle'), message: t('transp.deactivateMsg'),
      confirmLabel: t('transp.deactivate'), danger: true,
    });
    if (!ok) return;
    try { await api.delete(`/v1/transportadoras/${id}`); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="page-header">
        <h1>{t('transp.title')}</h1>
        <Can permission="transportadoras:create">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
            + {t('transp.new')}
          </button>
        </Can>
      </div>

      <div className="flex-gap" style={{ marginBottom: 16 }}>
        <input placeholder={t('transp.search')} value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 320 }} />
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            {t('c.empty')}{' '}
            <Can permission="transportadoras:create">
              <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('transp.new')}</button>
            </Can>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('transp.name')}</th>
                <th>{t('transp.document')}</th>
                <th>{t('transp.city')}/{t('transp.state')}</th>
                <th>{t('c.active')}</th>
                <th>{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(tr => (
                <tr key={tr.id}>
                  <td style={{ fontWeight: 500 }}>{tr.name}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{tr.document ?? '—'}</td>
                  <td style={{ fontSize: 13 }}>{[tr.city, tr.state].filter(Boolean).join('/') || '—'}</td>
                  <td>
                    <span className={`badge badge-${tr.is_active ? 'service' : 'raw_material'}`}>
                      {tr.is_active ? t('c.active') : t('c.inactive')}
                    </span>
                  </td>
                  <td>
                    <div className="flex-gap">
                      <Can permission="transportadoras:edit">
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(tr)}>{t('c.edit')}</button>
                      </Can>
                      <Can permission="transportadoras:delete">
                        <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(tr.id)}>{t('c.del')}</button>
                      </Can>
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
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('c.prev')}</button>
          <span className="text-muted" style={{ fontSize: 13 }}>{t('c.page')} {page} {t('c.of')} {totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t('c.next')}</button>
        </div>
      )}

      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{editing ? t('c.edit') : t('transp.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                <div className="field-row">
                  <div className="field">
                    <label>{t('transp.personType')}</label>
                    <select value={form.person_type} onChange={e => setForm(f => ({ ...f, person_type: e.target.value as 'PJ' | 'PF' }))}>
                      <option value="PJ">{t('transp.personType.PJ')}</option>
                      <option value="PF">{t('transp.personType.PF')}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>{t('transp.document')}</label>
                    <input value={form.document} onChange={e => setForm(f => ({ ...f, document: e.target.value }))}
                      placeholder={form.person_type === 'PJ' ? 'CNPJ' : 'CPF'} />
                  </div>
                </div>

                <div className="field">
                  <label>{t('transp.name')} *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>{t('transp.stateReg')}</label>
                    <input value={form.state_reg} onChange={e => setForm(f => ({ ...f, state_reg: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{t('transp.rntc')}</label>
                    <input value={form.rntc} onChange={e => setForm(f => ({ ...f, rntc: e.target.value }))} />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field" style={{ flex: 2 }}>
                    <label>{t('transp.street')}</label>
                    <input value={form.street} onChange={e => setForm(f => ({ ...f, street: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{t('transp.streetNumber')}</label>
                    <input value={form.street_number} onChange={e => setForm(f => ({ ...f, street_number: e.target.value }))} />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>{t('transp.city')}</label>
                    <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{t('transp.state')}</label>
                    <input maxLength={2} value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value.toUpperCase() }))} />
                  </div>
                  <div className="field">
                    <label>{t('transp.zipCode')}</label>
                    <input value={form.zip_code} onChange={e => setForm(f => ({ ...f, zip_code: e.target.value }))} />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>{t('transp.phone')}</label>
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{t('transp.email')}</label>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>{t('c.cancel')}</button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : editing ? t('c.save') : t('transp.new')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
