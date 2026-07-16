import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { ProductPicker } from '../../ds/components/ProductPicker';
import type { TKey } from '../../i18n/pt-BR';
import { Can } from '../../rbac';

interface ServiceOrder {
  id: string; number: string; title: string; type: string; status: string;
  total: number; created_at: string; client_name: string | null;
}
interface ServiceOrderItemRow { id: string; material_id: string | null; description: string; quantity: number; unit_price: number; total: number; }
interface VisitRow {
  id: string; status: string; scheduled_at: string; checked_in_at: string | null; checked_out_at: string | null;
  technician_name: string | null; technician_current_name: string | null; report_notes: string | null;
  signed_by_name: string | null; signed_at: string | null;
  visit_link: string | null; link_valid: boolean;
}
interface ServiceOrderDetail extends ServiceOrder {
  description: string | null; client_id: string | null;
  items: ServiceOrderItemRow[]; visits: VisitRow[];
  receivable_id: string | null; receivable_status: string | null;
  receivable_due_date: string | null; receivable_amount: number | null;
  receivable_paid_amount: number | null;
  boleto_status: string | null; brcode: string | null; pix_qr_code: string | null; boleto_url: string | null;
  nfse_id: string | null; nfse_status: string | null;
}
interface ClientOption { id: string; company_name: string | null; full_name: string | null; }
interface TechnicianOption { id: string; name: string; is_active: boolean; }
// Filtrado por emite_nfse=true (regra 53) — faturamento de OS só oferece
// empresas responsáveis por NFS-e quando "Emitir NFS-e" está marcado.
interface CompanyOption { id: string; razao_social: string; is_default: boolean; emite_nfse: boolean; }
interface MaterialOption { id: string; sku: string; name: string; unit: string; sale_price: number | null; description?: string | null; type?: string | null; }
interface FormItem { _key: string; material_id: string; description: string; quantity: string; unit_price: string; }
interface ListResp { data: ServiceOrder[]; total: number; page: number; per_page: number; }

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_TABS = ['all', 'draft', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const;
type StatusTab = typeof STATUS_TABS[number];

function statusBadge(s: string) {
  const map: Record<string, string> = {
    draft: 'badge-service', scheduled: 'badge-raw_material', in_progress: 'badge-product',
    completed: 'badge-active', cancelled: 'badge-inactive',
  };
  return map[s] ?? 'badge-service';
}
function newItem(): FormItem {
  return { _key: Math.random().toString(36).slice(2), material_id: '', description: '', quantity: '1', unit_price: '0' };
}
function fmtDateTime(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function ServiceOrdersPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();

  const [orders, setOrders]         = useState<ServiceOrder[]>([]);
  const [total, setTotal]           = useState(0);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [loading, setLoading]       = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing]       = useState<ServiceOrderDetail | null>(null);
  const [editMode, setEditMode]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');

  const [formTitle, setFormTitle]       = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formType, setFormType]         = useState('maintenance');
  const [formClientId, setFormClientId] = useState('');
  const [formItems, setFormItems]       = useState<FormItem[]>([]);

  const [clients, setClients]         = useState<ClientOption[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [materials, setMaterials]     = useState<MaterialOption[]>([]);
  const [companies, setCompanies]     = useState<CompanyOption[]>([]);

  const [visitTechId, setVisitTechId] = useState('');
  const [visitAt, setVisitAt]         = useState('');
  const [schedulingVisit, setSchedulingVisit] = useState(false);
  const [copiedVisitId, setCopiedVisitId] = useState('');

  const [billingDueDate, setBillingDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [billingEmitNfse, setBillingEmitNfse] = useState(true);
  const [billingCompanyId, setBillingCompanyId] = useState('');
  const [billingLoading, setBillingLoading]   = useState(false);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        per_page: '20',
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(search ? { search } : {}),
      });
      const r = await api.get<ListResp>(`/v1/service-orders?${p}`);
      setOrders(r.data); setTotal(r.total);
    } catch { /**/ } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [tenantId, statusFilter, search]);

  useEffect(() => {
    if (!drawerOpen || !tenantId) return;
    Promise.all([
      api.get<{ data: ClientOption[] }>(`/v1/clients?per_page=100&tenant_id=${tenantId}`),
      api.get<{ data: TechnicianOption[] }>(`/v1/technicians?per_page=100`),
      api.get<{ data: MaterialOption[] }>(`/v1/materials?per_page=500&tenant_id=${tenantId}`),
      api.get<{ data: CompanyOption[] }>('/v1/companies').catch(() => ({ data: [] })),
    ]).then(([cl, tc, mt, comp]) => {
      setClients(cl.data ?? []);
      setTechnicians((tc.data ?? []).filter(x => x.is_active));
      setMaterials(mt.data ?? []);
      const nfseCompanies = (comp.data ?? []).filter(c => c.emite_nfse);
      setCompanies(nfseCompanies);
      setBillingCompanyId(prev => prev || nfseCompanies.find(c => c.is_default)?.id || '');
    }).catch((err: unknown) => {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    });
  }, [drawerOpen, tenantId]);

  function openCreate() {
    setEditing(null);
    setEditMode(false);
    setFormTitle(''); setFormDescription(''); setFormType('maintenance'); setFormClientId('');
    setFormItems([newItem()]);
    setFormError('');
    setVisitTechId(''); setVisitAt('');
    setDrawerOpen(true);
  }

  async function openView(o: ServiceOrder) {
    setFormError('');
    setDrawerOpen(true);
    setEditing(null);
    setEditMode(false);
    try {
      const detail = await api.get<ServiceOrderDetail>(`/v1/service-orders/${o.id}`);
      setEditing(detail);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('c.loading'));
    }
  }

  // Só entra em modo de edição a partir de uma OS já carregada em 'draft'
  // (regra 52-like: assertServiceOrderEditable no backend) — pré-preenche o
  // mesmo formulário usado na criação.
  function startEdit() {
    if (!editing) return;
    setFormTitle(editing.title);
    setFormDescription(editing.description ?? '');
    setFormType(editing.type);
    setFormClientId(editing.client_id ?? '');
    setFormItems(
      editing.items.length > 0
        ? editing.items.map(it => ({
            _key: Math.random().toString(36).slice(2),
            material_id: it.material_id ?? '',
            description: it.description,
            quantity: String(it.quantity),
            unit_price: String(it.unit_price),
          }))
        : [newItem()],
    );
    setFormError('');
    setEditMode(true);
  }

  function addItem() { setFormItems(prev => [...prev, newItem()]); }
  function removeItem(idx: number) { setFormItems(prev => prev.filter((_, i) => i !== idx)); }
  function updateItem(idx: number, field: keyof FormItem, val: string) {
    setFormItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  }
  function handlePickMaterial(idx: number, id: string) {
    if (!id) { updateItem(idx, 'material_id', ''); return; }
    const mat = materials.find(m => m.id === id);
    setFormItems(prev => prev.map((it, i) => i !== idx ? it : {
      ...it, material_id: id,
      description: mat?.name ?? it.description,
      unit_price: mat?.sale_price != null ? String(mat.sale_price) : it.unit_price,
    }));
  }

  const totalCalc = formItems.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!formTitle.trim()) { setFormError(t('so.errNoTitle')); return; }
    setSaving(true); setFormError('');
    const payload = {
      title: formTitle.trim(),
      description: formDescription || undefined,
      type: formType,
      client_id: formClientId || undefined,
      items: formItems.filter(it => it.description.trim()).map(it => ({
        materialId: it.material_id || undefined,
        description: it.description.trim(),
        quantity: Number(it.quantity), unit_price: Number(it.unit_price),
      })),
    };
    try {
      if (editMode && editing) {
        await api.patch(`/v1/service-orders/${editing.id}`, payload);
        const detail = await api.get<ServiceOrderDetail>(`/v1/service-orders/${editing.id}`);
        setEditing(detail);
        setEditMode(false);
      } else {
        await api.post('/v1/service-orders', payload);
        setDrawerOpen(false);
      }
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    } finally { setSaving(false); }
  }

  async function scheduleVisit() {
    if (!editing) return;
    if (!visitTechId) { setFormError(t('so.selectTechnician')); return; }
    if (!visitAt)     { setFormError(t('so.scheduledAt') + ' *'); return; }
    setSchedulingVisit(true); setFormError('');
    try {
      await api.post(`/v1/service-orders/${editing.id}/visits`, {
        technician_id: visitTechId, scheduled_at: new Date(visitAt).toISOString(),
      });
      const detail = await api.get<ServiceOrderDetail>(`/v1/service-orders/${editing.id}`);
      setEditing(detail);
      setVisitTechId(''); setVisitAt('');
      void load();
    } catch (err: unknown) { modal.error(err); }
    finally { setSchedulingVisit(false); }
  }

  async function copyVisitLink(visitId: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedVisitId(visitId);
      setTimeout(() => setCopiedVisitId(id => id === visitId ? '' : id), 2000);
    } catch { /* clipboard indisponível — o link ainda pode ser copiado manualmente do campo */ }
  }

  async function cancelOrder(id: string) {
    const ok = await modal.confirm({ title: t('so.cancel'), message: t('so.cancelConfirm'), danger: true });
    if (!ok) return;
    try {
      await api.post(`/v1/service-orders/${id}/cancel`, {});
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) { modal.error(err); }
  }

  async function handleBillServiceOrder() {
    if (!editing) return;
    setBillingLoading(true);
    try {
      await api.post(`/v1/service-orders/${editing.id}/billing`, {
        due_date: billingDueDate || undefined,
        emit_nfse: billingEmitNfse,
        company_id: billingEmitNfse ? (billingCompanyId || undefined) : undefined,
      });
      const detail = await api.get<ServiceOrderDetail>(`/v1/service-orders/${editing.id}`);
      setEditing(detail);
    } catch (err: unknown) { modal.error(err); }
    finally { setBillingLoading(false); }
  }

  async function handleEmitBoleto() {
    if (!editing?.receivable_id) return;
    setBillingLoading(true);
    try {
      await api.post(`/v1/receivables/${editing.receivable_id}/emit-boleto`, {});
      const detail = await api.get<ServiceOrderDetail>(`/v1/service-orders/${editing.id}`);
      setEditing(detail);
      modal.success(t('so.billingBoletoQueued'));
    } catch (err: unknown) { modal.error(err); }
    finally { setBillingLoading(false); }
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t('so.title')}</h1>
        <Can permission="service_orders:create">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
            + {t('so.new')}
          </button>
        </Can>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {STATUS_TABS.map(s => (
          <button key={s} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto' }} onClick={() => setStatusFilter(s)}>
            {s === 'all' ? t('o.all') : t(`so.status.${s}` as TKey)}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <input placeholder={t('c.search')} value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : orders.length === 0 ? (
          <div className="empty-state">{t('so.empty')}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 90 }}>{t('so.number')}</th>
                <th>{t('so.osTitle')}</th>
                <th>{t('so.client')}</th>
                <th className="text-right" style={{ width: 110 }}>{t('so.total')}</th>
                <th style={{ width: 110 }}>{t('so.status')}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} onClick={() => openView(o)} style={{ cursor: 'pointer' }}>
                  <td><code style={{ fontSize: 12 }}>#{o.number}</code></td>
                  <td style={{ fontWeight: 500 }}>{o.title}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{o.client_name ?? '—'}</td>
                  <td className="text-right">{BRL.format(Number(o.total))}</td>
                  <td><span className={`badge ${statusBadge(o.status)}`}>{t(`so.status.${o.status}` as TKey)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {total > orders.length && orders.length > 0 && (
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>{orders.length} / {total}</p>
      )}

      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()} style={{ width: 'min(760px, 96vw)' }}>
            <div className="drawer-header">
              <h2>
                {editMode && editing ? `${t('so.editTitle')} — #${editing.number}`
                  : editing ? `#${editing.number} — ${editing.title}` : t('so.new')}
              </h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>

            {editing && !editMode ? (
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
                  <span className={`badge ${statusBadge(editing.status)}`}>{t(`so.status.${editing.status}` as TKey)}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>{t(`so.type.${editing.type}` as TKey)}</span>
                </div>
                {editing.description && <p style={{ fontSize: 14, marginBottom: 16 }}>{editing.description}</p>}

                {editing.items.length > 0 && (
                  <div className="card" style={{ padding: 0, marginBottom: 20 }}>
                    <table>
                      <thead><tr><th>{t('so.itemDesc')}</th><th>{t('so.itemQty')}</th><th className="text-right">{t('so.itemTotal')}</th></tr></thead>
                      <tbody>
                        {editing.items.map(it => (
                          <tr key={it.id}><td>{it.description}</td><td>{Number(it.quantity)}</td><td className="text-right">{BRL.format(Number(it.total))}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <h3 style={{ fontSize: 15, marginBottom: 10 }}>{t('so.visits')}</h3>
                {editing.visits.length === 0 ? (
                  <p className="empty-state" style={{ padding: '16px' }}>{t('so.noVisits')}</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {editing.visits.map(v => (
                      <div key={v.id} className="card" style={{ padding: 14, fontSize: 13 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <strong>{v.technician_name ?? v.technician_current_name ?? '—'}</strong>
                          <span className={`badge ${statusBadge(v.status)}`}>{v.status}</span>
                        </div>
                        <div style={{ color: 'var(--muted)' }}>{fmtDateTime(v.scheduled_at)}</div>
                        {v.signed_by_name && <div style={{ color: 'var(--muted)', marginTop: 4 }}>Assinado por {v.signed_by_name}</div>}
                        {v.report_notes && <div style={{ marginTop: 6 }}>{v.report_notes}</div>}

                        {v.visit_link && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                            {v.link_valid ? (
                              <>
                                <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                                  onClick={() => void copyVisitLink(v.id, v.visit_link!)}>
                                  {copiedVisitId === v.id ? t('so.linkCopied') : t('so.copyLink')}
                                </button>
                                <a href={`https://wa.me/?text=${encodeURIComponent(t('so.whatsappMsg') + ' ' + v.visit_link)}`}
                                  target="_blank" rel="noreferrer"
                                  className="btn btn-secondary btn-sm" style={{ width: 'auto', textDecoration: 'none', textAlign: 'center' }}>
                                  {t('so.sendWhatsapp')}
                                </a>
                              </>
                            ) : (
                              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('so.linkExpired')}</span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {editing.status !== 'completed' && editing.status !== 'cancelled' && (
                  <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                    <strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>{t('so.scheduleVisit')}</strong>
                    <div className="field-row">
                      <div className="field">
                        <label>{t('so.technician')}</label>
                        <select value={visitTechId} onChange={e => setVisitTechId(e.target.value)}>
                          <option value="">{t('so.selectTechnician')}</option>
                          {technicians.map(tc => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label>{t('so.scheduledAt')}</label>
                        <input type="datetime-local" value={visitAt} onChange={e => setVisitAt(e.target.value)} />
                      </div>
                    </div>
                    <Can permission="service_orders:assign">
                      <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                        disabled={schedulingVisit} onClick={scheduleVisit}>
                        {schedulingVisit ? t('c.saving') : t('so.scheduleVisit')}
                      </button>
                    </Can>
                  </div>
                )}

                {editing.status === 'completed' && (
                  <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                    <strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>{t('so.billingTitle')}</strong>
                    {!editing.receivable_id ? (
                      <>
                        <div className="field-row">
                          <div className="field">
                            <label>{t('so.billingDueDate')}</label>
                            <input type="date" value={billingDueDate} onChange={e => setBillingDueDate(e.target.value)} />
                          </div>
                          <div className="field" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, fontSize: 13 }}>
                              <input type="checkbox" checked={billingEmitNfse} onChange={e => setBillingEmitNfse(e.target.checked)} />
                              {t('so.billingEmitNfse')}
                            </label>
                          </div>
                        </div>
                        <Can permission="service_orders:edit">
                          {billingEmitNfse && companies.length > 1 && (
                            <div className="field" style={{ marginBottom: 8 }}>
                              <label>{t('comp.companies.emittingCompany')}</label>
                              <select value={billingCompanyId} onChange={e => setBillingCompanyId(e.target.value)}>
                                <option value="">{t('comp.companies.default')}</option>
                                {companies.map(c => (
                                  <option key={c.id} value={c.id}>{c.razao_social}{c.is_default ? ` (${t('comp.companies.default')})` : ''}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                            disabled={billingLoading} onClick={() => void handleBillServiceOrder()}>
                            {billingLoading ? t('c.saving') : t('so.billingEmit')}
                          </button>
                        </Can>
                      </>
                    ) : (
                      <div style={{ fontSize: 13 }}>
                        <div>
                          {t('so.billingAmount')}: <strong>{BRL.format(Number(editing.receivable_amount))}</strong>
                          {' — '}{t('so.billingDueDate')}: {editing.receivable_due_date ? new Date(editing.receivable_due_date).toLocaleDateString('pt-BR') : '—'}
                        </div>
                        <div style={{ marginTop: 4 }}>
                          {t('so.billingStatus')}: <span className={`badge ${statusBadge(editing.receivable_status ?? '')}`}>{editing.receivable_status}</span>
                        </div>
                        {editing.nfse_id && (
                          <div style={{ marginTop: 4 }}>NFS-e: {editing.nfse_status ?? t('so.billingNfsePending')}</div>
                        )}
                        {!editing.boleto_status ? (
                          <Can permission="service_orders:edit">
                            <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto', marginTop: 10 }}
                              disabled={billingLoading} onClick={() => void handleEmitBoleto()}>
                              {billingLoading ? t('c.saving') : t('so.billingEmitBoleto')}
                            </button>
                          </Can>
                        ) : (
                          <div style={{ marginTop: 10 }}>
                            <div>{t('so.billingBoletoStatus')}: {editing.boleto_status}</div>
                            {editing.boleto_url && (
                              <a href={editing.boleto_url} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 4 }}>
                                {t('so.billingViewBoleto')}
                              </a>
                            )}
                            {editing.brcode && (
                              <div style={{ marginTop: 6, wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)' }}>
                                {editing.brcode}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="drawer-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>{t('c.close')}</button>
                  <button type="button" className="btn btn-secondary" style={{ width: 'auto' }}
                    onClick={() => window.open(`/service-orders/${editing.id}/print`, '_blank', 'noopener')}>
                    {t('so.printView')}
                  </button>
                  {editing.status === 'draft' && (
                    <Can permission="service_orders:edit">
                      <button type="button" className="btn btn-secondary" style={{ width: 'auto' }} onClick={startEdit}>
                        {t('so.edit')}
                      </button>
                    </Can>
                  )}
                  {editing.status !== 'cancelled' && editing.status !== 'completed' && (
                    <Can permission="service_orders:edit">
                      <button type="button" className="btn btn-danger" onClick={() => cancelOrder(editing.id)}>{t('so.cancel')}</button>
                    </Can>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
                <div className="drawer-body">
                  {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                  <div className="field">
                    <label htmlFor="so-title">{t('so.osTitle')} *</label>
                    <input id="so-title" value={formTitle} onChange={e => setFormTitle(e.target.value)} required />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="so-client">{t('so.client')}</label>
                      <select id="so-client" value={formClientId} onChange={e => setFormClientId(e.target.value)}>
                        <option value="">{t('so.selectClient')}</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.company_name ?? c.full_name}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="so-type">{t('so.type')}</label>
                      <select id="so-type" value={formType} onChange={e => setFormType(e.target.value)}>
                        {(['installation', 'maintenance', 'repair', 'inspection'] as const).map(k => (
                          <option key={k} value={k}>{t(`so.type.${k}` as TKey)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="so-desc">{t('so.description')}</label>
                    <textarea id="so-desc" value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={3} />
                  </div>

                  <div className="card" style={{ padding: 0, marginBottom: 16 }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{t('so.items')}</strong>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={addItem}>{t('so.addItem')}</button>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr><th>{t('so.itemDesc')}</th><th>{t('so.itemQty')}</th><th>{t('so.itemPrice')}</th><th style={{ textAlign: 'right' }}>{t('so.itemTotal')}</th><th aria-hidden></th></tr>
                        </thead>
                        <tbody>
                          {formItems.map((it, idx) => {
                            const lineTotal = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
                            return (
                              <tr key={it._key}>
                                <td>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <ProductPicker
                                      options={materials}
                                      value={it.material_id}
                                      onChange={id => handlePickMaterial(idx, id)}
                                      placeholder={t('o.selectMat')}
                                      emptyLabel={t('o.noMatch')}
                                      ariaLabel={t('o.material')}
                                    />
                                    <input
                                      placeholder={t('so.itemDesc')}
                                      value={it.description}
                                      onChange={e => updateItem(idx, 'description', e.target.value)}
                                    />
                                  </div>
                                </td>
                                <td><input type="number" min="0.001" step="0.001" value={it.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} /></td>
                                <td><input type="number" min="0" step="0.01" value={it.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)} /></td>
                                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{BRL.format(lineTotal)}</td>
                                <td style={{ textAlign: 'center' }}>
                                  <button type="button" onClick={() => removeItem(idx)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18 }}>×</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="card" style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span>{t('so.total')}</span>
                      <span style={{ color: 'var(--primary)' }}>{BRL.format(totalCalc)}</span>
                    </div>
                  </div>
                </div>

                <div className="drawer-footer">
                  <button type="button" className="btn btn-secondary"
                    onClick={() => editMode ? setEditMode(false) : setDrawerOpen(false)}>
                    {t('c.cancel')}
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                    {saving ? t('c.saving') : editMode ? t('so.save') : t('so.new')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
