import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { ProductPicker } from '../../ds/components/ProductPicker';
import type { TKey } from '../../i18n/pt-BR';
import { Can } from '../../rbac';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface PO {
  id: string; number: string; status: string;
  supplier_id: string | null; supplier_name: string | null; supplier_company_name: string | null;
  subtotal: string; total: string; expected_date: string | null;
  cost_center_id: string | null; created_at: string;
}
interface SupplierOption { id: string; company_name: string | null; full_name: string | null; }
interface MaterialOption { id: string; sku: string; name: string; unit: string; sale_price: number | null; description?: string | null; type?: string | null; }
interface FormItem { _key: string; material_id: string; name: string; sku: string; unit: string; quantity: string; unit_price: string; }
interface ListResp { data: PO[]; total: number; page: number; per_page: number; }

interface POItemDetail {
  id: string; material_id: string | null; name: string; sku: string | null; unit: string;
  quantity: number; unit_price: number; total: number; material_name: string | null;
}
interface POFullDetail {
  id: string; number: string; status: string;
  supplier_id: string | null; supplier_name: string | null; supplier_company_name: string | null;
  expected_date: string | null; subtotal: number; discount: number; shipping: number; total: number;
  notes: string | null; cost_center_id: string | null;
  created_by_name: string | null; approved_by_name: string | null; approved_at: string | null;
  items: POItemDetail[];
}

const STATUS_TABS = ['all', 'draft', 'approved', 'received', 'cancelled'] as const;
type StatusTab = typeof STATUS_TABS[number];

function statusBadge(s: string) {
  return ({ draft: 'badge-service', approved: 'badge-product', received: 'badge-active', cancelled: 'badge-inactive' }[s] ?? 'badge-service');
}

function newItem(): FormItem {
  return { _key: Math.random().toString(36).slice(2), material_id: '', name: '', sku: '', unit: 'UN', quantity: '1', unit_price: '0' };
}

export function PurchaseOrdersPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();

  const [orders,      setOrders]      = useState<PO[]>([]);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(1);
  const [search,      setSearch]      = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [loading,     setLoading]     = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  const [formSupplier, setFormSupplier] = useState('');
  const [formNotes,    setFormNotes]    = useState('');
  const [formDiscount, setFormDiscount] = useState('0');
  const [formShipping, setFormShipping] = useState('0');
  const [formExpected, setFormExpected] = useState('');
  const [formItems,    setFormItems]    = useState<FormItem[]>([newItem()]);

  const [suppliers,  setSuppliers]  = useState<SupplierOption[]>([]);
  const [materials,  setMaterials]  = useState<MaterialOption[]>([]);

  const [editingId, setEditingId]         = useState<string | null>(null);
  const [viewOnly, setViewOnly]           = useState(false);
  const [viewingDetail, setViewingDetail] = useState<POFullDetail | null>(null);

  const perPage = 20;

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), per_page: String(perPage), ...(statusFilter !== 'all' ? { status: statusFilter } : {}), ...(search ? { search } : {}) });
      const r = await api.get<ListResp>(`/v1/purchase-orders?${p}`);
      setOrders(r.data); setTotal(r.total);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [tenantId, page, statusFilter, search]);

  useEffect(() => {
    if (!drawerOpen || !tenantId) return;
    let cancelled = false;
    Promise.all([
      api.get<{ data: SupplierOption[] }>(`/v1/suppliers?tenant_id=${tenantId}&per_page=100`),
      api.get<{ data: MaterialOption[] }>(`/v1/materials?tenant_id=${tenantId}&per_page=500`),
    ]).then(([su, mt]) => {
      if (cancelled) return;
      setSuppliers(su.data ?? []);
      setMaterials(mt.data ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [drawerOpen, tenantId]);

  function openCreate() {
    setFormSupplier(''); setFormNotes(''); setFormDiscount('0'); setFormShipping('0'); setFormExpected('');
    setFormItems([newItem()]); setFormError('');
    setEditingId(null); setViewOnly(false); setViewingDetail(null);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditingId(null); setViewOnly(false); setViewingDetail(null);
  }

  async function openDetail(o: PO) {
    setFormError('');
    setEditingId(o.id); setViewOnly(o.status !== 'draft'); setViewingDetail(null);
    setDrawerOpen(true);
    try {
      const detail = await api.get<POFullDetail>(`/v1/purchase-orders/${o.id}`);
      if (detail.status === 'draft') {
        setFormSupplier(detail.supplier_id ?? '');
        setFormNotes(detail.notes ?? '');
        setFormDiscount(String(detail.discount ?? 0));
        setFormShipping(String(detail.shipping ?? 0));
        setFormExpected(detail.expected_date ? detail.expected_date.slice(0, 10) : '');
        setFormItems(detail.items.length ? detail.items.map(it => ({
          _key: Math.random().toString(36).slice(2),
          material_id: it.material_id ?? '', name: it.name, sku: it.sku ?? '',
          unit: it.unit, quantity: String(it.quantity), unit_price: String(it.unit_price),
        })) : [newItem()]);
        setViewOnly(false);
      } else {
        setViewingDetail(detail);
        setViewOnly(true);
      }
    } catch (err: unknown) {
      modal.error(err);
      closeDrawer();
    }
  }

  function updateItem(idx: number, field: string, val: string) {
    setFormItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      if (field === 'material_id') {
        const mat = materials.find(m => m.id === val);
        return { ...it, material_id: val, name: mat?.name ?? '', sku: mat?.sku ?? '', unit: mat?.unit ?? 'UN', unit_price: mat?.sale_price ? String(mat.sale_price) : it.unit_price };
      }
      return { ...it, [field]: val };
    }));
  }

  const subtotalCalc = formItems.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  const totalCalc    = subtotalCalc - (Number(formDiscount) || 0) + (Number(formShipping) || 0);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    const namedItems = formItems.filter(it => it.name);
    if (!namedItems.length) { setFormError(t('o.errNoItems')); return; }
    setSaving(true); setFormError('');
    try {
      const sup = suppliers.find(s => s.id === formSupplier);
      const payload = {
        supplier_id:   formSupplier || null,
        supplier_name: sup ? (sup.company_name ?? sup.full_name) : null,
        expected_date: formExpected || null,
        notes:         formNotes || null,
        discount:      Number(formDiscount) || 0,
        shipping:      Number(formShipping) || 0,
        items: namedItems.map(it => ({ material_id: it.material_id || undefined, name: it.name, sku: it.sku || undefined, unit: it.unit, quantity: Number(it.quantity), unit_price: Number(it.unit_price) })),
      };
      if (editingId) await api.patch(`/v1/purchase-orders/${editingId}`, payload);
      else await api.post('/v1/purchase-orders', payload);
      closeDrawer(); void load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Erro ao salvar.'); }
    finally { setSaving(false); }
  }

  async function transition(id: string, action: 'approve' | 'cancel') {
    const msgs: Record<string, TKey> = { approve: 'po.approveMsg', cancel: 'po.cancelMsg' };
    const titles: Record<string, TKey> = { approve: 'po.approve', cancel: 'c.cancel' };
    const ok = await modal.confirm({ title: t(titles[action]), message: t(msgs[action]), confirmLabel: t(titles[action]), danger: action === 'cancel' });
    if (!ok) return;
    try { await api.post(`/v1/purchase-orders/${id}/${action}`, {}); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="page-header">
        <h1>{t('po.title')}</h1>
        <Can permission="purchase_orders:create">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
            + {t('po.new')}
          </button>
        </Can>
      </div>

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {STATUS_TABS.map(s => (
          <button key={s} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto' }} onClick={() => { setStatusFilter(s); setPage(1); }}>
            {s === 'all' ? 'Todos' : t(`po.status.${s}` as TKey)}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 14 }}>
        <input placeholder={t('po.search')} value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 340 }} />
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            {t('po.empty')}{' '}
            <Can permission="purchase_orders:create">
              <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('po.new')}</button>
            </Can>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>{t('po.number')}</th>
                <th>{t('po.supplier')}</th>
                <th style={{ width: 100 }}>{t('po.status')}</th>
                <th className="text-right" style={{ width: 120 }}>{t('po.total')}</th>
                <th style={{ width: 110 }}>{t('po.expectedDate')}</th>
                <th style={{ width: 180 }}></th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} onClick={() => void openDetail(o)} style={{ cursor: 'pointer' }}>
                  <td><code style={{ fontSize: 12 }}>#{o.number}</code></td>
                  <td style={{ fontWeight: 500 }}>{o.supplier_company_name ?? o.supplier_name ?? '—'}</td>
                  <td>
                    <span className={`badge ${statusBadge(o.status)}`}>
                      {t(`po.status.${o.status}` as TKey)}
                    </span>
                  </td>
                  <td className="text-right">{BRL.format(Number(o.total))}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {o.expected_date ? new Date(o.expected_date).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td>
                    <div className="flex-gap">
                      {o.status === 'draft' && (
                        <Can permission="purchase_orders:edit">
                          <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                            onClick={e => { e.stopPropagation(); void transition(o.id, 'approve'); }}>
                            {t('po.approve')}
                          </button>
                        </Can>
                      )}
                      {(o.status === 'draft' || o.status === 'approved') && (
                        <Can permission="purchase_orders:delete">
                          <button className="btn btn-danger btn-sm"
                            onClick={e => { e.stopPropagation(); void transition(o.id, 'cancel'); }}>
                            {t('c.del')}
                          </button>
                        </Can>
                      )}
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

      {/* Drawer */}
      {drawerOpen && (
        <div className="overlay" onClick={closeDrawer}>
          <div className="drawer" style={{ width: 'min(780px, 96vw)' }} onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>
                {viewOnly
                  ? (viewingDetail ? `#${viewingDetail.number}` : t('c.loading'))
                  : (editingId ? t('po.edit') : t('po.new'))}
              </h2>
              <button className="btn btn-secondary btn-sm" onClick={closeDrawer}>✕</button>
            </div>

            {viewOnly ? (
              <div style={{ display: 'contents' }}>
                <div className="drawer-body">
                  {!viewingDetail ? (
                    <div className="spinner">{t('c.loading')}</div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
                        <span className={`badge ${statusBadge(viewingDetail.status)}`}>{t(`po.status.${viewingDetail.status}` as TKey)}</span>
                      </div>
                      <div className="field-row">
                        <div className="field"><label>{t('po.supplier')}</label><div>{viewingDetail.supplier_company_name ?? viewingDetail.supplier_name ?? '—'}</div></div>
                        <div className="field"><label>{t('po.expectedDate')}</label><div>{viewingDetail.expected_date ? new Date(viewingDetail.expected_date).toLocaleDateString('pt-BR') : '—'}</div></div>
                      </div>
                      <div className="field-row">
                        <div className="field"><label>{t('po.subtotal')}</label><div>{BRL.format(Number(viewingDetail.subtotal))}</div></div>
                        <div className="field"><label>{t('po.discount')}</label><div>{BRL.format(Number(viewingDetail.discount))}</div></div>
                        <div className="field"><label>{t('po.shipping')}</label><div>{BRL.format(Number(viewingDetail.shipping))}</div></div>
                        <div className="field"><label>{t('po.total')}</label><div><strong>{BRL.format(Number(viewingDetail.total))}</strong></div></div>
                      </div>
                      <div className="field-row">
                        <div className="field"><label>{t('po.createdBy')}</label><div>{viewingDetail.created_by_name ?? '—'}</div></div>
                        {viewingDetail.approved_by_name && (
                          <div className="field">
                            <label>{t('po.approvedBy')}</label>
                            <div>
                              {viewingDetail.approved_by_name}
                              {viewingDetail.approved_at && ` — ${t('po.approvedAt').toLowerCase()} ${new Date(viewingDetail.approved_at).toLocaleDateString('pt-BR')}`}
                            </div>
                          </div>
                        )}
                      </div>
                      {viewingDetail.notes && <p style={{ fontSize: 13, marginBottom: 16 }}>{viewingDetail.notes}</p>}

                      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
                        <div style={{ padding: '10px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                          <strong style={{ fontSize: 13 }}>{t('po.items')}</strong>
                        </div>
                        <table>
                          <thead><tr><th>{t('so.itemDesc')}</th><th>{t('so.itemQty')}</th><th className="text-right">{t('so.itemTotal')}</th></tr></thead>
                          <tbody>
                            {viewingDetail.items.map(it => (
                              <tr key={it.id}>
                                <td>{it.material_name ?? it.name}</td>
                                <td>{Number(it.quantity)}</td>
                                <td className="text-right">{BRL.format(Number(it.total))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
                <div className="drawer-footer">
                  <button type="button" className="btn btn-secondary" onClick={closeDrawer}>{t('c.close')}</button>
                </div>
              </div>
            ) : (
            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                <div className="field-row">
                  <div className="field">
                    <label>{t('po.supplier')}</label>
                    <select value={formSupplier} onChange={e => setFormSupplier(e.target.value)}>
                      <option value="">Selecionar fornecedor (opcional)</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.company_name ?? s.full_name}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ flex: '0 0 160px' }}>
                    <label>{t('po.expectedDate')}</label>
                    <input type="date" value={formExpected} onChange={e => setFormExpected(e.target.value)} />
                  </div>
                </div>

                {/* Items */}
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ padding: '10px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 13 }}>{t('po.items')}</strong>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => setFormItems(prev => [...prev, newItem()])}>
                      + {t('po.addItem')}
                    </button>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'var(--surface)' }}>
                          <th style={{ padding: '6px 10px', textAlign: 'left', width: '38%' }}>Produto</th>
                          <th style={{ padding: '6px 8px', width: '14%' }}>Qtd</th>
                          <th style={{ padding: '6px 8px', width: '18%' }}>Preço unit.</th>
                          <th style={{ padding: '6px 8px', textAlign: 'right', width: '22%' }}>Total</th>
                          <th style={{ width: '8%' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {formItems.map((item, idx) => (
                          <tr key={item._key} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '6px 10px' }}>
                              <ProductPicker options={materials} value={item.material_id}
                                onChange={id => updateItem(idx, 'material_id', id)}
                                placeholder="Selecionar produto" emptyLabel="Não encontrado" ariaLabel="Produto" />
                              {!item.material_id && (
                                <input placeholder="Nome do item" value={item.name}
                                  onChange={e => updateItem(idx, 'name', e.target.value)}
                                  style={{ marginTop: 4, fontSize: 12 }} />
                              )}
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <input type="number" min="0.001" step="0.001" value={item.quantity}
                                onChange={e => updateItem(idx, 'quantity', e.target.value)} style={{ fontSize: 12 }} />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <input type="number" min="0" step="0.01" value={item.unit_price}
                                onChange={e => updateItem(idx, 'unit_price', e.target.value)} style={{ fontSize: 12 }} />
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, fontSize: 12 }}>
                              {BRL.format((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button type="button" onClick={() => setFormItems(prev => prev.filter((_, i) => i !== idx))}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18, padding: '0 8px' }}>×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>{t('po.discount')}</label>
                    <input type="number" min="0" step="0.01" value={formDiscount} onChange={e => setFormDiscount(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>{t('po.shipping')}</label>
                    <input type="number" min="0" step="0.01" value={formShipping} onChange={e => setFormShipping(e.target.value)} />
                  </div>
                </div>

                <div className="field">
                  <label>{t('po.notes')}</label>
                  <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2} />
                </div>

                {/* Totals summary */}
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                    <span>{t('po.total')}</span>
                    <span style={{ color: 'var(--primary)' }}>{BRL.format(Math.max(0, totalCalc))}</span>
                  </div>
                </div>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={closeDrawer}>{t('c.cancel')}</button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : (editingId ? t('po.saveChanges') : t('po.new'))}
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
