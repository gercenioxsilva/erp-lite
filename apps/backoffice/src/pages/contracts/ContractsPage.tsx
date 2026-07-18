import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { Can }      from '../../rbac';
import { ProductPicker } from '../../ds/components/ProductPicker';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Client {
  id:   string;
  name: string;
}

interface Material {
  id:   string;
  name: string;
  sku:  string;
  description?: string | null;
}

interface Contract {
  id:                string;
  contract_number:   string;
  client_id:         string;
  client_name:       string;
  material_id:       string | null;
  material_name:     string | null;
  type:              string;
  contact_name:      string | null;
  description:       string;
  start_date:        string;
  end_date:          string | null;
  billing_frequency: string;
  billing_day:       number;
  amount:            string;
  status:            string;
  notes:             string | null;
  nfse_enabled:      boolean;
  codigo_servico:    string | null;
  aliquota_iss:      string | null;
  company_id:        string | null;
  custom_fields?:    ContractFieldValue[];
}

interface FieldDefinition {
  id:          string;
  field_key:   string;
  label:       string;
  field_type:  'text' | 'decimal' | 'integer' | 'date' | 'boolean';
  required:    boolean;
  sort_order:  number;
}

interface ContractFieldValue {
  field_definition_id: string;
  label:      string;
  field_type: FieldDefinition['field_type'];
  required:   boolean;
  value:      string | null;
}

const FIELD_TYPES: FieldDefinition['field_type'][] = ['text', 'decimal', 'integer', 'date', 'boolean'];

interface Billing {
  id:               string;
  period_start:     string;
  period_end:       string;
  due_date:         string;
  amount:           string;
  status:           string;
  receivable_status?: string;
  nfse_id?:         string | null;
  document_number?: string | null;
}

interface NfseLite {
  id:                 string;
  nfse_status:        string | null;
  nfse_number:        string | null;
}

interface ListResp { data: Contract[]; total: number; page: number; per_page: number; }

const FREQUENCIES = ['monthly', 'quarterly', 'semiannual', 'annual'] as const;
const STATUSES    = ['active', 'paused', 'cancelled', 'expired'] as const;

const EMPTY_FORM = {
  client_id:         '',
  material_id:       '',
  type:              'service' as string,
  contact_name:      '',
  description:       '',
  start_date:        '',
  end_date:          '',
  billing_frequency: 'monthly' as string,
  billing_day:       5,
  amount:            '',
  status:            'active' as string,
  notes:             '',
  nfse_enabled:      false,
  codigo_servico:    '',
  aliquota_iss:      '',
  company_id:        '',
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtDate(d: string) {
  if (!d) return '—';
  const [y, m, dd] = d.slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ContractsPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();

  // List
  const [items,   setItems]   = useState<Contract[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [search,  setSearch]  = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);

  // Clients and materials for dropdowns
  const [clients,   setClients]   = useState<Client[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  // Multi-empresa (regra 40) — seletor só aparece com mais de 1 CNPJ cadastrado.
  // Filtrado por emite_nfse=true (regra 53) — só oferece empresas responsáveis
  // por NFS-e; contratos de serviço nunca emitem NF-e de venda.
  const [companies, setCompanies] = useState<{ id: string; razao_social: string; is_default: boolean; emite_nfse: boolean }[]>([]);

  // Campos personalizados (migration 0072) — schema definido pelo tenant,
  // aplicado a todo contrato. fieldModalOpen abre o gerenciamento das
  // definições (não confundir com os valores preenchidos no form abaixo).
  const [fieldDefinitions, setFieldDefinitions] = useState<FieldDefinition[]>([]);
  const [fieldModalOpen,   setFieldModalOpen]   = useState(false);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Contract | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');
  const [sending,    setSending]    = useState(false);

  // Billings panel (within drawer)
  const [billings,        setBillings]        = useState<Billing[]>([]);
  const [billingsLoading, setBillingsLoading] = useState(false);
  const [generatingBill,  setGeneratingBill]  = useState(false);
  const [nfseMap,         setNfseMap]         = useState<Record<string, NfseLite>>({});

  const perPage = 20;

  // ── Load helpers ───────────────────────────────────────────────────────────

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        tenant_id: tenantId, page: String(page), per_page: String(perPage),
        ...(search       ? { search }              : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
      });
      const resp = await api.get<ListResp>(`/v1/service-contracts?${p}`);
      setItems(resp.data);
      setTotal(resp.total);
    } catch { /**/ } finally { setLoading(false); }
  }

  async function loadDropdowns() {
    if (!tenantId) return;
    const [cl, mt] = await Promise.all([
      api.get<{ data: { id: string; company_name: string | null; full_name: string | null }[] }>(
        `/v1/clients?tenant_id=${tenantId}&per_page=500`
      ).catch(() => ({ data: [] })),
      api.get<{ data: { id: string; name: string; sku: string; description: string | null }[] }>(
        `/v1/materials?tenant_id=${tenantId}&per_page=500`
      ).catch(() => ({ data: [] })),
    ]);
    setClients(cl.data.map(c => ({ id: c.id, name: c.company_name ?? c.full_name ?? c.id })));
    setMaterials(mt.data.map(m => ({ id: m.id, name: m.name, sku: m.sku, description: m.description })));

    const comp = await api.get<{ data: { id: string; razao_social: string; is_default: boolean; emite_nfse: boolean }[] }>('/v1/companies')
      .catch(() => ({ data: [] }));
    setCompanies(comp.data.filter(c => c.emite_nfse));

    await loadFieldDefinitions();
  }

  async function loadFieldDefinitions() {
    const resp = await api.get<{ data: FieldDefinition[] }>('/v1/contract-fields').catch(() => ({ data: [] }));
    setFieldDefinitions(resp.data);
  }

  async function loadBillings(contractId: string) {
    setBillingsLoading(true);
    try {
      const resp = await api.get<{ data: Billing[] }>(`/v1/service-contracts/${contractId}/billings`);
      setBillings(resp.data);
    } catch { setBillings([]); } finally { setBillingsLoading(false); }
  }

  useEffect(() => { void load(); }, [tenantId, page, search, filterStatus]);
  useEffect(() => { void loadDropdowns(); }, [tenantId]);
  useEffect(() => {
    if (drawerOpen && editing) void loadBillings(editing.id);
    else setBillings([]);
  }, [drawerOpen, editing?.id]);

  // Poll NFS-e status for billings while any of them is pending/processing
  useEffect(() => {
    if (!drawerOpen || !editing || !tenantId) return;
    const pending = billings.some(b => b.nfse_id && nfseMap[b.nfse_id]
      && ['pending', 'processing'].includes(nfseMap[b.nfse_id].nfse_status ?? ''));
    const unknown = billings.some(b => b.nfse_id && !nfseMap[b.nfse_id]);
    if (!pending && !unknown) return;

    let cancelled = false;
    const tick = async () => {
      const ids = billings.map(b => b.nfse_id).filter(Boolean) as string[];
      const results = await Promise.all(ids.map(id =>
        api.get<NfseLite>(`/v1/nfse/${id}?tenant_id=${tenantId}`).catch(() => null)
      ));
      if (cancelled) return;
      setNfseMap(prev => {
        const next = { ...prev };
        results.forEach(r => { if (r) next[r.id] = r; });
        return next;
      });
    };
    void tick();
    const timer = setInterval(() => void tick(), 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [drawerOpen, editing?.id, tenantId, billings, nfseMap]);

  // ── Drawer helpers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, company_id: companies.find(c => c.is_default)?.id ?? '' });
    setCustomFieldValues({});
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(c: Contract) {
    setEditing(c);
    setForm({
      client_id:         c.client_id,
      material_id:       c.material_id       ?? '',
      type:              c.type              ?? 'service',
      contact_name:      c.contact_name      ?? '',
      description:       c.description,
      start_date:        c.start_date.slice(0, 10),
      end_date:          c.end_date ? c.end_date.slice(0, 10) : '',
      billing_frequency: c.billing_frequency,
      billing_day:       c.billing_day,
      amount:            c.amount,
      status:            c.status,
      notes:             c.notes ?? '',
      nfse_enabled:      c.nfse_enabled ?? false,
      codigo_servico:    c.codigo_servico ?? '',
      aliquota_iss:      c.aliquota_iss != null ? String(c.aliquota_iss) : '',
      company_id:        c.company_id ?? '',
    });
    setCustomFieldValues(Object.fromEntries(
      (c.custom_fields ?? []).map(f => [f.field_definition_id, f.value ?? '']),
    ));
    setFormError('');
    setDrawerOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setFormError('');

    if (!form.client_id)    { setFormError(t('sc.errClient'));  return; }
    if (!form.description)  { setFormError(t('sc.errDesc'));    return; }
    if (!form.amount || Number(form.amount) <= 0) { setFormError(t('sc.errAmount')); return; }
    if (!form.start_date)   { setFormError(t('sc.errStart'));   return; }

    setSaving(true);
    try {
      const payload = {
        tenant_id:         tenantId,
        client_id:         form.client_id,
        material_id:       form.material_id   || undefined,
        type:              form.type,
        contact_name:      form.contact_name  || undefined,
        description:       form.description,
        start_date:        form.start_date,
        end_date:          form.end_date       || undefined,
        billing_frequency: form.billing_frequency,
        billing_day:       Number(form.billing_day),
        amount:            Number(form.amount),
        status:            form.status,
        notes:             form.notes          || undefined,
        nfse_enabled:      form.nfse_enabled,
        codigo_servico:    form.nfse_enabled ? (form.codigo_servico || undefined) : undefined,
        aliquota_iss:      form.nfse_enabled && form.aliquota_iss ? Number(form.aliquota_iss) : undefined,
        company_id:        form.company_id || undefined,
        custom_fields:     fieldDefinitions.map(def => ({
          field_definition_id: def.id,
          value: customFieldValues[def.id]?.trim() || null,
        })),
      };
      if (editing) await api.patch(`/v1/service-contracts/${editing.id}`, payload);
      else         await api.post('/v1/service-contracts', payload);
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('sc.errSave'));
    } finally { setSaving(false); }
  }

  async function handleCancel(id: string) {
    const ok = await modal.confirm({ title: t('sc.deact'), message: t('sc.deactMsg'), confirmLabel: 'Cancelar contrato', danger: true });
    if (!ok) return;
    try {
      await api.patch(`/v1/service-contracts/${id}`, { status: 'cancelled' });
      void load();
      setDrawerOpen(false);
    } catch (err: unknown) { modal.error(err); }
  }

  async function handleGenerateBilling() {
    if (!editing) return;
    setGeneratingBill(true);
    try {
      await api.post(`/v1/service-contracts/${editing.id}/billings`, {});
      await loadBillings(editing.id);
    } catch (err: unknown) {
      modal.error(err);
    } finally { setGeneratingBill(false); }
  }

  async function handleSendEmail() {
    if (!editing) return;
    setSending(true);
    try {
      await api.post(`/v1/service-contracts/${editing.id}/send`, {});
      modal.success(t('sc.sendSuccess'));
    } catch (err: unknown) {
      modal.error(err);
    } finally { setSending(false); }
  }

  async function handleReemitNfse(nfseId: string) {
    if (!tenantId) return;
    try {
      await api.post(`/v1/nfse/${nfseId}/emit?tenant_id=${tenantId}`, {});
      setNfseMap(prev => ({ ...prev, [nfseId]: { ...(prev[nfseId] ?? { id: nfseId, nfse_number: null }), nfse_status: 'processing' } }));
    } catch (err: unknown) {
      modal.error(err);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / perPage);

  const freqLabel = (f: string) => t(`sc.freq.${f}` as Parameters<typeof t>[0]) || f;
  const statusLabel = (s: string) => t(`sc.status.${s}` as Parameters<typeof t>[0]) || s;
  const billingStatusLabel = (s: string) => t(`sc.billing.${s}` as Parameters<typeof t>[0]) || s;

  const statusBadgeClass = (s: string) => {
    if (s === 'active')    return 'badge-product';
    if (s === 'paused')    return 'badge-raw_material';
    if (s === 'cancelled') return 'badge-service';
    return 'badge-asset';
  };

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="page-header">
        <h1>{t('sc.title')}</h1>
        <div className="flex-gap">
          <Can permission="contracts:edit">
            <button className="btn btn-secondary" style={{ width: 'auto' }} onClick={() => setFieldModalOpen(true)}>
              ⚙ {t('sc.customFields.manage')}
            </button>
          </Can>
          <Can permission="contracts:create">
            <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
              + {t('sc.new')}
            </button>
          </Can>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <div className="flex-gap" style={{ marginBottom: 16 }}>
        <input placeholder={t('sc.searchPH')} value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 300 }} />
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
          <option value="">Todos os status</option>
          {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </div>

      {/* ── Table ───────────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            {t('sc.empty')}{' '}
            <button className="btn btn-secondary btn-sm" onClick={openCreate}>+ {t('sc.new')}</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('sc.number')}</th>
                <th>{t('sc.client')}</th>
                <th>{t('sc.description')}</th>
                <th>{t('sc.billingFreq')}</th>
                <th>{t('sc.amount')}</th>
                <th>{t('sc.startDate')}</th>
                <th>{t('sc.status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>#{c.contract_number}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{c.client_name}</div>
                    {c.material_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.material_name}</div>}
                  </td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.description}
                  </td>
                  <td style={{ fontSize: 12 }}>{freqLabel(c.billing_frequency)} · dia {c.billing_day}</td>
                  <td style={{ fontWeight: 600 }}>{BRL.format(Number(c.amount))}</td>
                  <td style={{ fontSize: 12 }}>{fmtDate(c.start_date)}</td>
                  <td>
                    <span className={`badge ${statusBadgeClass(c.status)}`}>{statusLabel(c.status)}</span>
                  </td>
                  <td>
                    <Can permission="contracts:edit">
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>{t('c.edit')}</button>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ──────────────────────────────────────────────── */}
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

      {/* ── Drawer ──────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>
                {editing ? (
                  <span>{t('sc.edit')} <span style={{ fontFamily: 'monospace', fontSize: 14 }}>#{editing.contract_number}</span></span>
                ) : t('sc.new')}
              </h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                {/* Cliente */}
                <div className="field">
                  <label>{t('sc.client')} *</label>
                  <select value={form.client_id}
                    onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))} required>
                    <option value="">Selecione o cliente…</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                {/* Serviço / Produto */}
                <div className="field">
                  <label>{t('sc.service')}</label>
                  <ProductPicker
                    options={materials}
                    value={form.material_id}
                    onChange={id => setForm(f => ({ ...f, material_id: id }))}
                    placeholder="Nenhum (sem vínculo)"
                    emptyLabel="Nenhum produto encontrado"
                    ariaLabel={t('sc.service')}
                  />
                </div>

                {/* Tipo / Contato */}
                <div className="field-row">
                  <div className="field">
                    <label>{t('sc.type')}</label>
                    <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                      <option value="service">{t('sc.type.service')}</option>
                      <option value="rental">{t('sc.type.rental')}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>{t('sc.contactName')}</label>
                    <input value={form.contact_name}
                      onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
                  </div>
                </div>

                {/* Descrição */}
                <div className="field">
                  <label>{t('sc.description')} *</label>
                  <input value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Ex.: Manutenção preventiva de compressores" required />
                </div>

                {/* Datas */}
                <div className="field-row">
                  <div className="field">
                    <label>{t('sc.startDate')} *</label>
                    <input type="date" value={form.start_date}
                      onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} required />
                  </div>
                  <div className="field">
                    <label>{t('sc.endDate')}</label>
                    <input type="date" value={form.end_date}
                      onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                  </div>
                </div>

                {/* Cobrança */}
                <SectionLabel label="Cobrança recorrente" />
                <div className="field-row">
                  <div className="field">
                    <label>{t('sc.billingFreq')}</label>
                    <select value={form.billing_frequency}
                      onChange={e => setForm(f => ({ ...f, billing_frequency: e.target.value }))}>
                      {FREQUENCIES.map(f => (
                        <option key={f} value={f}>{freqLabel(f)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ flex: '0 0 120px' }}>
                    <label>{t('sc.billingDay')}</label>
                    <input type="number" min={1} max={28} value={form.billing_day}
                      onChange={e => setForm(f => ({ ...f, billing_day: Number(e.target.value) }))} />
                  </div>
                </div>

                <div className="field">
                  <label>{t('sc.amount')} *</label>
                  <input type="number" min={0.01} step={0.01} value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0,00" required />
                </div>

                {/* Status (só edição) */}
                {editing && (
                  <div className="field">
                    <label>{t('sc.status')}</label>
                    <select value={form.status}
                      onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                      {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </select>
                  </div>
                )}

                <div className="field">
                  <label>{t('sc.notes')}</label>
                  <textarea value={form.notes} rows={2}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>

                {/* ── Campos personalizados (migration 0072) ──────────── */}
                {fieldDefinitions.length > 0 && (
                  <>
                    <SectionLabel label={t('sc.customFields.title')} />
                    {fieldDefinitions.map(def => (
                      <div className="field" key={def.id}>
                        <label>{def.label}{def.required ? ' *' : ''}</label>
                        {def.field_type === 'boolean' ? (
                          <select
                            value={customFieldValues[def.id] ?? ''}
                            onChange={e => setCustomFieldValues(v => ({ ...v, [def.id]: e.target.value }))}>
                            <option value="">—</option>
                            <option value="true">{t('c.yes')}</option>
                            <option value="false">{t('c.no')}</option>
                          </select>
                        ) : (
                          <input
                            type={def.field_type === 'date' ? 'date' : (def.field_type === 'decimal' || def.field_type === 'integer') ? 'number' : 'text'}
                            step={def.field_type === 'decimal' ? '0.01' : undefined}
                            value={customFieldValues[def.id] ?? ''}
                            required={def.required}
                            onChange={e => setCustomFieldValues(v => ({ ...v, [def.id]: e.target.value }))} />
                        )}
                      </div>
                    ))}
                  </>
                )}

                {/* ── NFS-e ─────────────────────────────────────────── */}
                <SectionLabel label={t('sc.nfseSection')} />
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.nfse_enabled}
                      style={{ width: 'auto' }}
                      onChange={e => setForm(f => ({ ...f, nfse_enabled: e.target.checked }))} />
                    {t('sc.nfseEnabled')}
                  </label>
                </div>
                {form.nfse_enabled && (
                  <div className="field-row">
                    <div className="field">
                      <label>{t('sc.servicoCode')}</label>
                      <input value={form.codigo_servico} maxLength={10}
                        placeholder={t('sc.servicoCodePH')}
                        onChange={e => setForm(f => ({ ...f, codigo_servico: e.target.value }))} />
                    </div>
                    <div className="field" style={{ flex: '0 0 140px' }}>
                      <label>{t('sc.issRate')}</label>
                      <input type="number" min={0} step={0.01} value={form.aliquota_iss}
                        placeholder={t('sc.issRatePH')}
                        onChange={e => setForm(f => ({ ...f, aliquota_iss: e.target.value }))} />
                    </div>
                  </div>
                )}
                {form.nfse_enabled && companies.length > 1 && (
                  <div className="field">
                    <label>{t('comp.companies.emittingCompany')}</label>
                    <select value={form.company_id}
                      onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))}>
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.razao_social}{c.is_default ? ` (${t('comp.companies.default')})` : ''}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* ── Cobranças geradas ─────────────────────────────── */}
                {editing && (
                  <>
                    <SectionLabel label={t('sc.billings')} />
                    <div style={{ marginBottom: 10 }}>
                      <button type="button" className="btn btn-secondary btn-sm"
                        style={{ width: 'auto' }}
                        disabled={generatingBill || form.status !== 'active'}
                        onClick={() => void handleGenerateBilling()}>
                        {generatingBill ? t('c.saving') : t('sc.processBilling')}
                      </button>
                    </div>
                    {billingsLoading ? (
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('c.loading')}</div>
                    ) : billings.length === 0 ? (
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhuma cobrança gerada ainda.</div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ fontSize: 12 }}>
                          <thead>
                            <tr>
                              {editing?.type === 'rental' && <th>Nº</th>}
                              <th>Período</th>
                              <th>Vencimento</th>
                              <th>Valor</th>
                              <th>Status cobrança</th>
                              <th>Status recebível</th>
                              <th>NFS-e</th>
                              {editing?.type === 'rental' && <th aria-hidden />}
                            </tr>
                          </thead>
                          <tbody>
                            {billings.map(b => {
                              const nfse = b.nfse_id ? nfseMap[b.nfse_id] : undefined;
                              const ns = nfse?.nfse_status ?? null;
                              return (
                              <tr key={b.id}>
                                {editing?.type === 'rental' && (
                                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{b.document_number ?? '—'}</td>
                                )}
                                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
                                  {fmtDate(b.period_start)} – {fmtDate(b.period_end)}
                                </td>
                                <td>{fmtDate(b.due_date)}</td>
                                <td>{BRL.format(Number(b.amount))}</td>
                                <td>
                                  <span className={`badge ${b.status === 'billed' ? 'badge-product' : 'badge-service'}`}>
                                    {billingStatusLabel(b.status)}
                                  </span>
                                </td>
                                <td>
                                  {b.receivable_status ? (
                                    <span className={`badge ${b.receivable_status === 'paid' ? 'badge-product' : 'badge-raw_material'}`}>
                                      {b.receivable_status}
                                    </span>
                                  ) : '—'}
                                </td>
                                <td>
                                  {!b.nfse_id ? '—' : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span className={`badge ${ns === 'authorized' ? 'badge-product' : ns === 'rejected' ? 'badge-service' : 'badge-raw_material'}`}>
                                        {ns ? t(`nfse.status.${ns}` as Parameters<typeof t>[0]) || ns : t('nfse.status.processing')}
                                      </span>
                                      {ns === 'rejected' && (
                                        <button type="button" className="btn btn-secondary btn-sm"
                                          onClick={() => void handleReemitNfse(b.nfse_id!)}>
                                          {t('sc.retryNfse')}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </td>
                                {editing?.type === 'rental' && (
                                  <td>
                                    <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                                      title={t('sc.printReceipt')}
                                      onClick={() => window.open(`/contracts/${editing.id}/billings/${b.id}/receipt`, '_blank', 'noopener')}>
                                      🖨
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ); })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="drawer-footer">
                {editing && editing.status === 'active' && (
                  <Can permission="contracts:edit">
                    <button type="button" className="btn btn-danger"
                      style={{ marginRight: 'auto' }}
                      onClick={() => void handleCancel(editing.id)}>
                      Cancelar contrato
                    </button>
                  </Can>
                )}
                {editing && (
                  <>
                    <button type="button" className="btn btn-secondary" style={{ width: 'auto' }}
                      onClick={() => window.open(`/contracts/${editing.id}/print`, '_blank', 'noopener')}>
                      🖨 {t('sc.print')}
                    </button>
                    <Can permission="contracts:edit">
                      <button type="button" className="btn btn-secondary" style={{ width: 'auto' }}
                        disabled={sending} onClick={() => void handleSendEmail()}>
                        {sending ? t('c.saving') : `✉ ${t('sc.sendEmail')}`}
                      </button>
                    </Can>
                  </>
                )}
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  {t('c.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : editing ? t('sc.save') : t('sc.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {fieldModalOpen && (
        <FieldDefinitionsModal
          definitions={fieldDefinitions}
          onClose={() => setFieldModalOpen(false)}
          onChanged={() => void loadFieldDefinitions()}
        />
      )}
    </div>
  );
}

// ── Campos Personalizados — gerenciamento das definições (migration 0072) ──
// Schema por tenant: cada campo tem chave/tipo/obrigatoriedade, aplicado a
// todo contrato. Só rótulo/obrigatoriedade são editáveis depois de criado —
// o tipo nunca muda (corromperia a semântica de valores já salvos), mesma
// trava do backend (contractFieldService.ts).
function FieldDefinitionsModal({ definitions, onClose, onChanged }: {
  definitions: FieldDefinition[]; onClose: () => void; onChanged: () => void;
}) {
  const { t } = useI18n();
  const modal = useModal();
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<FieldDefinition['field_type']>('text');
  const [required, setRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) { setError(t('sc.customFields.errLabel')); return; }
    setSaving(true); setError('');
    try {
      await api.post('/v1/contract-fields', { label, field_type: fieldType, required, sort_order: definitions.length });
      setLabel(''); setFieldType('text'); setRequired(false);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('sc.customFields.errSave'));
    } finally { setSaving(false); }
  }

  async function handleRemove(id: string) {
    const ok = await modal.confirm({
      title: t('sc.customFields.remove'),
      message: t('sc.customFields.removeConfirm'),
      confirmLabel: t('sc.customFields.remove'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/v1/contract-fields/${id}`);
      onChanged();
    } catch (err: unknown) { modal.error(err); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="drawer-header">
          <h2>{t('sc.customFields.title')}</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{t('sc.customFields.hint')}</p>

          {definitions.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>{t('sc.customFields.empty')}</div>
          ) : (
            <table style={{ marginBottom: 20 }}>
              <thead>
                <tr>
                  <th>{t('sc.customFields.label')}</th>
                  <th>{t('sc.customFields.type')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {definitions.map(def => (
                  <tr key={def.id}>
                    <td>{def.label}{def.required ? ' *' : ''}</td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{t(`sc.customFields.fieldType.${def.field_type}` as Parameters<typeof t>[0])}</td>
                    <td>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => void handleRemove(def.id)}>
                        {t('c.del')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <SectionLabel label={t('sc.customFields.new')} />
          <form onSubmit={handleAdd} noValidate>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            <div className="field">
              <label>{t('sc.customFields.label')} *</label>
              <input value={label} onChange={e => setLabel(e.target.value)}
                placeholder={t('sc.customFields.labelPH')} required />
            </div>
            <div className="field-row">
              <div className="field">
                <label>{t('sc.customFields.type')}</label>
                <select value={fieldType} onChange={e => setFieldType(e.target.value as FieldDefinition['field_type'])}>
                  {FIELD_TYPES.map(ft => (
                    <option key={ft} value={ft}>{t(`sc.customFields.fieldType.${ft}` as Parameters<typeof t>[0])}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={required} style={{ width: 'auto' }}
                    onChange={e => setRequired(e.target.checked)} />
                  {t('sc.customFields.required')}
                </label>
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={saving}>
              {saving ? t('c.saving') : t('sc.customFields.add')}
            </button>
          </form>
        </div>
      </div>
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
