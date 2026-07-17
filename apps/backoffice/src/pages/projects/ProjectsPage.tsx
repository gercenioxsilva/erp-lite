import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import type { TKey } from '../../i18n/pt-BR';
import { Can } from '../../rbac';

interface Project {
  id: string; number: string; name: string; total_value: number; status: string;
  created_at: string; client_name: string | null; consumed_value: number;
}
interface ProfessionalRow {
  id: string; professional_type: 'technician' | 'seller';
  technician_id: string | null; seller_id: string | null;
  commission_pct: number; professional_name: string | null;
}
interface LinkedOrderRow { id: string; number: string; status: string; total: number; client_name: string | null; }
interface LinkedServiceOrderRow { id: string; number: string; title: string; status: string; total: number; client_name: string | null; }
interface ProjectReport {
  goodsServicesConsumed: number; goodsServicesInvoiced: number;
  budgetConsumedPct: number; budgetInvoicedPct: number;
}
interface ProjectDetail extends Project {
  description: string | null; client_id: string | null; cost_center_id: string | null;
  start_date: string | null; end_date: string | null;
  professionals: ProfessionalRow[]; orders: LinkedOrderRow[]; service_orders: LinkedServiceOrderRow[];
  report: ProjectReport;
}
interface ClientOption      { id: string; company_name: string | null; full_name: string | null; }
interface CostCenterOption  { id: string; code: string; name: string; }
interface TechnicianOption  { id: string; name: string; is_active: boolean; }
interface SellerOption      { id: string; name: string; }
interface OrderOption       { id: string; number: string; status: string; client_name: string | null; }
interface ServiceOrderOption { id: string; number: string; title: string; status: string; client_name: string | null; }
interface ListResp { data: Project[]; total: number; page: number; per_page: number; }

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_TABS = ['all', 'draft', 'in_progress', 'completed', 'cancelled'] as const;
type StatusTab = typeof STATUS_TABS[number];

function statusBadge(s: string) {
  const map: Record<string, string> = {
    draft: 'badge-service', in_progress: 'badge-product',
    completed: 'badge-active', cancelled: 'badge-inactive',
  };
  return map[s] ?? 'badge-service';
}
function fmtPct(n: number) { return `${n.toFixed(1).replace('.', ',')}%`; }

export function ProjectsPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();

  const [projects, setProjects]     = useState<Project[]>([]);
  const [total, setTotal]           = useState(0);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [loading, setLoading]       = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing]       = useState<ProjectDetail | null>(null);
  const [editMode, setEditMode]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [formError, setFormError]   = useState('');

  const [formName, setFormName]           = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formTotalValue, setFormTotalValue] = useState('0');
  const [formClientId, setFormClientId]   = useState('');
  const [formCostCenterId, setFormCostCenterId] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate]     = useState('');

  const [clients, setClients]         = useState<ClientOption[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [sellers, setSellers]         = useState<SellerOption[]>([]);
  const [availableOrders, setAvailableOrders] = useState<OrderOption[]>([]);
  const [availableServiceOrders, setAvailableServiceOrders] = useState<ServiceOrderOption[]>([]);

  const [allocType, setAllocType]     = useState<'technician' | 'seller'>('technician');
  const [allocId, setAllocId]         = useState('');
  const [allocPct, setAllocPct]       = useState('0');
  const [allocating, setAllocating]   = useState(false);

  const [linkOrderId, setLinkOrderId]   = useState('');
  const [linkSoId, setLinkSoId]         = useState('');
  const [linking, setLinking]           = useState(false);

  const perPage = 20;

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        per_page: String(perPage),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(search ? { search } : {}),
      });
      const r = await api.get<ListResp>(`/v1/projects?${p}`);
      setProjects(r.data); setTotal(r.total);
    } catch { /**/ } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [tenantId, statusFilter, search]);

  useEffect(() => {
    if (!drawerOpen || !tenantId) return;
    Promise.all([
      api.get<{ data: ClientOption[] }>(`/v1/clients?per_page=100&tenant_id=${tenantId}`),
      api.get<{ data: CostCenterOption[] }>(`/v1/cost-centers/active?tenant_id=${tenantId}`).catch(() => ({ data: [] as CostCenterOption[] })),
      api.get<{ data: TechnicianOption[] }>(`/v1/technicians?per_page=100`).catch(() => ({ data: [] as TechnicianOption[] })),
      api.get<SellerOption[]>('/v1/sellers/active').catch(() => [] as SellerOption[]),
      api.get<{ data: OrderOption[] }>(`/v1/orders?per_page=100&tenant_id=${tenantId}`).catch(() => ({ data: [] as OrderOption[] })),
      api.get<{ data: ServiceOrderOption[] }>(`/v1/service-orders?per_page=100`).catch(() => ({ data: [] as ServiceOrderOption[] })),
    ]).then(([cl, cc, tc, sl, or, so]) => {
      setClients(cl.data ?? []);
      setCostCenters(cc.data ?? []);
      setTechnicians((tc.data ?? []).filter(x => x.is_active));
      setSellers(Array.isArray(sl) ? sl : []);
      setAvailableOrders(or.data ?? []);
      setAvailableServiceOrders(so.data ?? []);
    }).catch((err: unknown) => {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    });
  }, [drawerOpen, tenantId]);

  function openCreate() {
    setEditing(null); setEditMode(false);
    setFormName(''); setFormDescription(''); setFormTotalValue('0');
    setFormClientId(''); setFormCostCenterId(''); setFormStartDate(''); setFormEndDate('');
    setFormError('');
    setDrawerOpen(true);
  }

  async function reloadDetail(id: string) {
    const detail = await api.get<ProjectDetail>(`/v1/projects/${id}`);
    setEditing(detail);
    return detail;
  }

  async function openView(p: Project) {
    setFormError('');
    setDrawerOpen(true);
    setEditing(null);
    setEditMode(false);
    try {
      await reloadDetail(p.id);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('c.loading'));
    }
  }

  function startEdit() {
    if (!editing) return;
    setFormName(editing.name);
    setFormDescription(editing.description ?? '');
    setFormTotalValue(String(editing.total_value));
    setFormClientId(editing.client_id ?? '');
    setFormCostCenterId(editing.cost_center_id ?? '');
    setFormStartDate(editing.start_date ? editing.start_date.slice(0, 10) : '');
    setFormEndDate(editing.end_date ? editing.end_date.slice(0, 10) : '');
    setFormError('');
    setEditMode(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!formName.trim()) { setFormError(t('proj.errNoName')); return; }
    setSaving(true); setFormError('');
    const payload = {
      name: formName.trim(),
      description: formDescription || undefined,
      total_value: Number(formTotalValue) || 0,
      client_id: formClientId || undefined,
      cost_center_id: formCostCenterId || undefined,
      start_date: formStartDate || undefined,
      end_date: formEndDate || undefined,
    };
    try {
      if (editMode && editing) {
        await api.patch(`/v1/projects/${editing.id}`, payload);
        await reloadDetail(editing.id);
        setEditMode(false);
      } else {
        await api.post('/v1/projects', payload);
        setDrawerOpen(false);
      }
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    } finally { setSaving(false); }
  }

  async function handleTransition(action: 'start' | 'complete' | 'cancel') {
    if (!editing) return;
    setTransitioning(true);
    try {
      await api.post(`/v1/projects/${editing.id}/${action}`, {});
      await reloadDetail(editing.id);
      void load();
    } catch (err: unknown) { modal.error(err); }
    finally { setTransitioning(false); }
  }

  async function handleAllocate() {
    if (!editing || !allocId) return;
    setAllocating(true);
    try {
      await api.post(`/v1/projects/${editing.id}/professionals`, {
        professional_type: allocType,
        technician_id: allocType === 'technician' ? allocId : undefined,
        seller_id: allocType === 'seller' ? allocId : undefined,
        commission_pct: Number(allocPct) || 0,
      });
      await reloadDetail(editing.id);
      setAllocId(''); setAllocPct('0');
    } catch (err: unknown) { modal.error(err); }
    finally { setAllocating(false); }
  }

  async function handleRemoveProfessional(allocationId: string) {
    if (!editing) return;
    try {
      await api.delete(`/v1/projects/${editing.id}/professionals/${allocationId}`);
      await reloadDetail(editing.id);
    } catch (err: unknown) { modal.error(err); }
  }

  async function handleLinkOrder() {
    if (!editing || !linkOrderId) return;
    setLinking(true);
    try {
      await api.post(`/v1/projects/${editing.id}/orders`, { order_id: linkOrderId });
      await reloadDetail(editing.id);
      setLinkOrderId('');
    } catch (err: unknown) { modal.error(err); }
    finally { setLinking(false); }
  }

  async function handleUnlinkOrder(orderId: string) {
    if (!editing) return;
    try {
      await api.delete(`/v1/projects/${editing.id}/orders/${orderId}`);
      await reloadDetail(editing.id);
    } catch (err: unknown) { modal.error(err); }
  }

  async function handleLinkServiceOrder() {
    if (!editing || !linkSoId) return;
    setLinking(true);
    try {
      await api.post(`/v1/projects/${editing.id}/service-orders`, { service_order_id: linkSoId });
      await reloadDetail(editing.id);
      setLinkSoId('');
    } catch (err: unknown) { modal.error(err); }
    finally { setLinking(false); }
  }

  async function handleUnlinkServiceOrder(serviceOrderId: string) {
    if (!editing) return;
    try {
      await api.delete(`/v1/projects/${editing.id}/service-orders/${serviceOrderId}`);
      await reloadDetail(editing.id);
    } catch (err: unknown) { modal.error(err); }
  }

  const totalCalc = Number(formTotalValue) || 0;
  const linkableOrders = availableOrders.filter(o => !editing?.orders.some(lo => lo.id === o.id));
  const linkableServiceOrders = availableServiceOrders.filter(so => !editing?.service_orders.some(lso => lso.id === so.id));

  return (
    <div>
      <div className="page-header">
        <h1>{t('proj.title')}</h1>
        <Can permission="projects:create">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
            + {t('proj.new')}
          </button>
        </Can>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {STATUS_TABS.map(s => (
          <button key={s} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto' }} onClick={() => setStatusFilter(s)}>
            {s === 'all' ? t('o.all') : t(`proj.status.${s}` as TKey)}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <input placeholder={t('c.search')} value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : projects.length === 0 ? (
          <div className="empty-state">{t('proj.empty')}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 90 }}>{t('proj.number')}</th>
                <th>{t('proj.name')}</th>
                <th>{t('proj.client')}</th>
                <th className="text-right" style={{ width: 130 }}>{t('proj.totalValue')}</th>
                <th className="text-right" style={{ width: 110 }}>{t('proj.consumedPct')}</th>
                <th style={{ width: 110 }}>{t('proj.status')}</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p => {
                const pct = Number(p.total_value) > 0 ? (Number(p.consumed_value) / Number(p.total_value)) * 100 : 0;
                return (
                  <tr key={p.id} onClick={() => openView(p)} style={{ cursor: 'pointer' }}>
                    <td><code style={{ fontSize: 12 }}>#{p.number}</code></td>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>{p.client_name ?? '—'}</td>
                    <td className="text-right">{BRL.format(Number(p.total_value))}</td>
                    <td className="text-right" style={{ fontSize: 12, color: pct > 100 ? 'var(--danger)' : 'var(--muted)' }}>{fmtPct(pct)}</td>
                    <td><span className={`badge ${statusBadge(p.status)}`}>{t(`proj.status.${p.status}` as TKey)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {total > projects.length && projects.length > 0 && (
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>{projects.length} / {total}</p>
      )}

      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()} style={{ width: 'min(820px, 96vw)' }}>
            <div className="drawer-header">
              <h2>
                {editMode && editing ? `${t('proj.editTitle')} — #${editing.number}`
                  : editing ? `#${editing.number} — ${editing.name}` : t('proj.new')}
              </h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>

            {editing && !editMode ? (
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                  <span className={`badge ${statusBadge(editing.status)}`}>{t(`proj.status.${editing.status}` as TKey)}</span>
                  {editing.client_name && <span style={{ color: 'var(--muted)', fontSize: 13 }}>{editing.client_name}</span>}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <Can permission="projects:edit">
                      {editing.status === 'draft' && (
                        <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                          disabled={transitioning} onClick={() => void handleTransition('start')}>
                          {t('proj.start')}
                        </button>
                      )}
                      {editing.status === 'in_progress' && (
                        <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                          disabled={transitioning} onClick={() => void handleTransition('complete')}>
                          {t('proj.complete')}
                        </button>
                      )}
                      {(editing.status === 'draft' || editing.status === 'in_progress') && (
                        <button type="button" className="btn btn-danger btn-sm" style={{ width: 'auto' }}
                          disabled={transitioning} onClick={() => void handleTransition('cancel')}>
                          {t('proj.cancel')}
                        </button>
                      )}
                    </Can>
                  </span>
                </div>

                {editing.description && <p style={{ fontSize: 14, marginBottom: 16 }}>{editing.description}</p>}

                {/* Relatório de acompanhamento */}
                <div className="card" style={{ padding: 16, marginBottom: 20 }}>
                  <strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>{t('proj.report.title')}</strong>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                    <span>{t('proj.totalValue')}</span>
                    <span style={{ fontWeight: 700 }}>{BRL.format(Number(editing.total_value))}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                    <span>{t('proj.report.consumed')}</span>
                    <span>{BRL.format(editing.report.goodsServicesConsumed)} ({fmtPct(editing.report.budgetConsumedPct)})</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 10 }}>
                    <span>{t('proj.report.invoiced')}</span>
                    <span>{BRL.format(editing.report.goodsServicesInvoiced)} ({fmtPct(editing.report.budgetInvoicedPct)})</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${Math.min(editing.report.budgetConsumedPct, 100)}%`,
                      background: editing.report.budgetConsumedPct > 100 ? 'var(--danger)' : 'var(--primary)',
                    }} />
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, marginBottom: 0 }}>{t('proj.report.hint')}</p>
                </div>

                {/* Profissionais alocados */}
                <h3 style={{ fontSize: 15, marginBottom: 10 }}>{t('proj.professionals.title')}</h3>
                {editing.professionals.length === 0 ? (
                  <p className="empty-state" style={{ padding: 16 }}>{t('proj.professionals.empty')}</p>
                ) : (
                  <div className="card" style={{ padding: 0, marginBottom: 12 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>{t('proj.professionals.name')}</th>
                          <th>{t('proj.professionals.type')}</th>
                          <th className="text-right">{t('proj.professionals.commission')}</th>
                          <th aria-hidden />
                        </tr>
                      </thead>
                      <tbody>
                        {editing.professionals.map(p => (
                          <tr key={p.id}>
                            <td>{p.professional_name ?? '—'}</td>
                            <td>{p.professional_type === 'technician' ? t('proj.professionals.technician') : t('proj.professionals.seller')}</td>
                            <td className="text-right">{fmtPct(Number(p.commission_pct))}</td>
                            <td style={{ textAlign: 'center' }}>
                              <Can permission="projects:edit">
                                <button type="button" onClick={() => void handleRemoveProfessional(p.id)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 16 }}>×</button>
                              </Can>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <Can permission="projects:edit">
                  <div className="card" style={{ padding: 14, marginBottom: 20 }}>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="proj-alloc-type">{t('proj.professionals.type')}</label>
                        <select id="proj-alloc-type" value={allocType} onChange={e => { setAllocType(e.target.value as 'technician' | 'seller'); setAllocId(''); }}>
                          <option value="technician">{t('proj.professionals.technician')}</option>
                          <option value="seller">{t('proj.professionals.seller')}</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="proj-alloc-id">{t('proj.professionals.name')}</label>
                        <select id="proj-alloc-id" value={allocId} onChange={e => setAllocId(e.target.value)}>
                          <option value="">{t('proj.professionals.select')}</option>
                          {(allocType === 'technician' ? technicians : sellers).map(o => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field" style={{ flex: '0 0 110px' }}>
                        <label htmlFor="proj-alloc-pct">{t('proj.professionals.commission')}</label>
                        <input id="proj-alloc-pct" type="number" min="0" max="100" step="0.01" value={allocPct}
                          onChange={e => setAllocPct(e.target.value)} />
                      </div>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                      disabled={allocating || !allocId} onClick={() => void handleAllocate()}>
                      {allocating ? t('c.saving') : t('proj.professionals.add')}
                    </button>
                  </div>
                </Can>

                {/* Pedidos vinculados */}
                <h3 style={{ fontSize: 15, marginBottom: 10 }}>{t('proj.orders.title')}</h3>
                {editing.orders.length === 0 ? (
                  <p className="empty-state" style={{ padding: 16 }}>{t('proj.orders.empty')}</p>
                ) : (
                  <div className="card" style={{ padding: 0, marginBottom: 12 }}>
                    <table>
                      <thead><tr><th>{t('proj.number')}</th><th>{t('proj.client')}</th><th>{t('proj.status')}</th><th className="text-right">{t('proj.totalValue')}</th><th aria-hidden /></tr></thead>
                      <tbody>
                        {editing.orders.map(o => (
                          <tr key={o.id}>
                            <td><code style={{ fontSize: 12 }}>#{o.number}</code></td>
                            <td>{o.client_name ?? '—'}</td>
                            <td><span className={`badge ${statusBadge(o.status)}`}>{o.status}</span></td>
                            <td className="text-right">{BRL.format(Number(o.total))}</td>
                            <td style={{ textAlign: 'center' }}>
                              <Can permission="projects:edit">
                                <button type="button" onClick={() => void handleUnlinkOrder(o.id)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 16 }}>×</button>
                              </Can>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <Can permission="projects:edit">
                  <div className="flex-gap" style={{ marginBottom: 20 }}>
                    <select aria-label={t('proj.orders.title')} value={linkOrderId} onChange={e => setLinkOrderId(e.target.value)} style={{ flex: 1 }}>
                      <option value="">{t('proj.orders.select')}</option>
                      {linkableOrders.map(o => (
                        <option key={o.id} value={o.id}>#{o.number} — {o.client_name ?? '—'}</option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                      disabled={linking || !linkOrderId} onClick={() => void handleLinkOrder()}>
                      {t('proj.orders.link')}
                    </button>
                  </div>
                </Can>

                {/* Ordens de serviço vinculadas */}
                <h3 style={{ fontSize: 15, marginBottom: 10 }}>{t('proj.serviceOrders.title')}</h3>
                {editing.service_orders.length === 0 ? (
                  <p className="empty-state" style={{ padding: 16 }}>{t('proj.serviceOrders.empty')}</p>
                ) : (
                  <div className="card" style={{ padding: 0, marginBottom: 12 }}>
                    <table>
                      <thead><tr><th>{t('proj.number')}</th><th>{t('proj.osTitle')}</th><th>{t('proj.status')}</th><th className="text-right">{t('proj.totalValue')}</th><th aria-hidden /></tr></thead>
                      <tbody>
                        {editing.service_orders.map(so => (
                          <tr key={so.id}>
                            <td><code style={{ fontSize: 12 }}>#{so.number}</code></td>
                            <td>{so.title}</td>
                            <td><span className={`badge ${statusBadge(so.status)}`}>{so.status}</span></td>
                            <td className="text-right">{BRL.format(Number(so.total))}</td>
                            <td style={{ textAlign: 'center' }}>
                              <Can permission="projects:edit">
                                <button type="button" onClick={() => void handleUnlinkServiceOrder(so.id)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 16 }}>×</button>
                              </Can>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <Can permission="projects:edit">
                  <div className="flex-gap" style={{ marginBottom: 20 }}>
                    <select aria-label={t('proj.serviceOrders.title')} value={linkSoId} onChange={e => setLinkSoId(e.target.value)} style={{ flex: 1 }}>
                      <option value="">{t('proj.serviceOrders.select')}</option>
                      {linkableServiceOrders.map(so => (
                        <option key={so.id} value={so.id}>#{so.number} — {so.title}</option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                      disabled={linking || !linkSoId} onClick={() => void handleLinkServiceOrder()}>
                      {t('proj.serviceOrders.link')}
                    </button>
                  </div>
                </Can>

                <div className="drawer-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>{t('c.close')}</button>
                  {editing.status === 'draft' && (
                    <Can permission="projects:edit">
                      <button type="button" className="btn btn-secondary" style={{ width: 'auto' }} onClick={startEdit}>
                        {t('proj.edit')}
                      </button>
                    </Can>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
                <div className="drawer-body">
                  {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                  <div className="field">
                    <label htmlFor="proj-name">{t('proj.name')} *</label>
                    <input id="proj-name" value={formName} onChange={e => setFormName(e.target.value)} required />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="proj-client">{t('proj.client')}</label>
                      <select id="proj-client" value={formClientId} onChange={e => setFormClientId(e.target.value)}>
                        <option value="">{t('so.selectClient')}</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.company_name ?? c.full_name}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="proj-cc">{t('cc.costCenter')}</label>
                      <select id="proj-cc" value={formCostCenterId} onChange={e => setFormCostCenterId(e.target.value)}>
                        <option value="">{t('cc.none')}</option>
                        {costCenters.map(cc => <option key={cc.id} value={cc.id}>{cc.code} — {cc.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="proj-desc">{t('proj.description')}</label>
                    <textarea id="proj-desc" value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={3} />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="proj-total">{t('proj.totalValue')}</label>
                      <input id="proj-total" type="number" min="0" step="0.01" value={formTotalValue}
                        onChange={e => setFormTotalValue(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="proj-start">{t('proj.startDate')}</label>
                      <input id="proj-start" type="date" value={formStartDate} onChange={e => setFormStartDate(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="proj-end">{t('proj.endDate')}</label>
                      <input id="proj-end" type="date" value={formEndDate} onChange={e => setFormEndDate(e.target.value)} />
                    </div>
                  </div>

                  <div className="card" style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span>{t('proj.totalValue')}</span>
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
                    {saving ? t('c.saving') : editMode ? t('proj.save') : t('proj.new')}
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
