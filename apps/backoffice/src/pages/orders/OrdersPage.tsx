import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import type { TKey } from '../../i18n/pt-BR';

/* ── Types ─────────────────────────────────────────────────────────────── */
interface Order {
  id: string; number: string; status: string; client_name: string;
  subtotal: number; discount: number; shipping: number; total: number;
  notes: string | null; created_at: string; client_id: string;
}
interface OrderDetail extends Order {
  items: OrderItemRow[];
}
interface OrderItemRow {
  id: string; material_id: string | null; name: string; sku: string | null;
  unit: string; quantity: number; unit_price: number; total: number; notes: string | null;
}
interface ClientOption   { id: string; company_name: string | null; full_name: string | null; }
interface MaterialOption { id: string; sku: string; name: string; unit: string; sale_price: number | null; }
interface FormItem {
  _key: string; material_id: string; name: string; sku: string;
  unit: string; quantity: string; unit_price: string;
}
interface ListResp { data: Order[]; total: number; page: number; per_page: number; }

/* ── Helpers ────────────────────────────────────────────────────────────── */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_TABS = ['all', 'draft', 'confirmed', 'invoiced', 'delivered', 'cancelled'] as const;
type StatusTab = typeof STATUS_TABS[number];

function statusBadge(s: string) {
  return ({ draft: 'badge-service', confirmed: 'badge-product', invoiced: 'badge-raw_material',
            delivered: 'badge-active', cancelled: 'badge-inactive' }[s] ?? 'badge-service');
}
function newItem(): FormItem {
  return { _key: Math.random().toString(36).slice(2), material_id: '', name: '', sku: '', unit: 'UN', quantity: '1', unit_price: '0' };
}

/* ── Component ──────────────────────────────────────────────────────────── */
export function OrdersPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();

  /* list */
  const [orders,       setOrders]       = useState<Order[]>([]);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [loading,      setLoading]      = useState(true);

  /* drawer */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Order | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  /* form */
  const [formClientId, setFormClientId] = useState('');
  const [formNotes,    setFormNotes]    = useState('');
  const [formDiscount, setFormDiscount] = useState('0');
  const [formShipping, setFormShipping] = useState('0');
  const [formItems,    setFormItems]    = useState<FormItem[]>([]);

  /* dropdown data */
  const [clients,   setClients]   = useState<ClientOption[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);

  const perPage = 20;

  /* ── Load orders list ── */
  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        tenant_id: tenantId, page: String(page), per_page: String(perPage),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(search ? { search } : {}),
      });
      const r = await api.get<ListResp>(`/v1/orders?${p}`);
      setOrders(r.data); setTotal(r.total);
    } catch { /**/ } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [tenantId, page, statusFilter, search]);

  /* ── Load dropdown data when drawer opens ──────────────────────────────
     Runs as a proper side-effect so it re-fires if tenantId resolves after
     the drawer is already open, and errors are always surfaced to the user. */
  useEffect(() => {
    if (!drawerOpen || !tenantId) return;

    let cancelled = false;
    setFormError('');

    Promise.all([
      api.get<{ data: ClientOption[] }>(`/v1/clients?tenant_id=${tenantId}&per_page=100`),
      api.get<{ data: MaterialOption[] }>(`/v1/materials?tenant_id=${tenantId}&per_page=100`),
    ])
      .then(([cl, mt]) => {
        if (cancelled) return;
        setClients(cl.data ?? []);
        setMaterials(mt.data ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFormError(err instanceof Error ? err.message : t('cl.errSave'));
      });

    return () => { cancelled = true; };
  }, [drawerOpen, tenantId]);

  /* ── Drawer open helpers ── */
  function openCreate() {
    setEditing(null);
    setFormClientId(''); setFormNotes(''); setFormDiscount('0'); setFormShipping('0');
    setFormItems([newItem()]);
    setFormError('');
    setDrawerOpen(true);
  }

  async function openEdit(o: Order) {
    setEditing(o);
    setFormClientId(o.client_id); setFormNotes(o.notes ?? '');
    setFormDiscount(String(o.discount)); setFormShipping(String(o.shipping));
    setFormItems([]);
    setFormError('');
    setDrawerOpen(true);
    try {
      const detail = await api.get<OrderDetail>(`/v1/orders/${o.id}`);
      setFormItems(detail.items.map(it => ({
        _key: Math.random().toString(36).slice(2),
        material_id: it.material_id ?? '', name: it.name, sku: it.sku ?? '',
        unit: it.unit, quantity: String(it.quantity), unit_price: String(it.unit_price),
      })));
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('c.loading'));
    }
  }

  /* ── Item helpers ── */
  function addItem() { setFormItems(prev => [...prev, newItem()]); }
  function removeItem(idx: number) { setFormItems(prev => prev.filter((_, i) => i !== idx)); }

  function updateItem(idx: number, field: string, val: string) {
    setFormItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      if (field === 'material_id') {
        const mat = materials.find(m => m.id === val);
        return { ...item, material_id: val, name: mat?.name ?? '', sku: mat?.sku ?? '',
                 unit: mat?.unit ?? 'UN', unit_price: mat?.sale_price ? String(mat.sale_price) : item.unit_price };
      }
      return { ...item, [field]: val };
    }));
  }

  /* ── Computed totals ── */
  const subtotal  = formItems.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  const totalCalc = subtotal - (Number(formDiscount) || 0) + (Number(formShipping) || 0);

  /* ── Save ── */
  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    if (!formClientId) { setFormError(t('o.errNoClient')); return; }
    const namedItems = formItems.filter(it => it.name);
    if (!namedItems.length) { setFormError(t('o.errNoItems')); return; }
    setSaving(true); setFormError('');
    try {
      const payload = {
        tenant_id: tenantId, client_id: formClientId, notes: formNotes || null,
        discount: Number(formDiscount) || 0, shipping: Number(formShipping) || 0,
        items: namedItems.map(it => ({
          material_id: it.material_id || undefined, name: it.name, sku: it.sku || undefined,
          unit: it.unit, quantity: Number(it.quantity), unit_price: Number(it.unit_price),
        })),
      };
      if (editing) {
        await api.patch(`/v1/orders/${editing.id}`, payload);
      } else {
        await api.post('/v1/orders', payload);
      }
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    } finally { setSaving(false); }
  }

  /* ── Status transitions ── */
  async function transition(id: string, action: 'confirm' | 'deliver' | 'cancel') {
    const msgs: Record<string, TKey>  = { confirm: 'o.confirmMsg', deliver: 'o.deliverMsg', cancel: 'o.cancelMsg' };
    const titles: Record<string, TKey> = { confirm: 'o.confirm',   deliver: 'o.deliver',    cancel: 'c.cancel' };
    const ok = await modal.confirm({
      title: t(titles[action]),
      message: t(msgs[action]),
      confirmLabel: t(titles[action]),
      danger: action === 'cancel',
    });
    if (!ok) return;
    try {
      await api.post(`/v1/orders/${id}/${action}`, {});
      void load();
    } catch (err: unknown) {
      modal.error(err);
    }
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header">
        <h1>{t('o.title')}</h1>
        <button className="btn btn-primary" style={{ width: 'auto' }} onClick={openCreate}>
          + {t('o.new')}
        </button>
      </div>

      {/* ── Status tabs ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {STATUS_TABS.map(s => (
          <button
            key={s}
            className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto' }}
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {s === 'all' ? t('o.all') : t(`o.status.${s}` as TKey)}
          </button>
        ))}
      </div>

      {/* ── Search ── */}
      <div style={{ marginBottom: 14 }}>
        <input
          placeholder={t('o.searchPH')}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ maxWidth: 320 }}
        />
      </div>

      {/* ── Table ── */}
      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            {t('o.empty')}{' '}
            <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('o.new')}</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 90 }}>{t('o.number')}</th>
                <th>{t('o.client')}</th>
                <th style={{ width: 110 }}>{t('o.status')}</th>
                <th className="text-right" style={{ width: 110 }}>{t('o.total')}</th>
                <th style={{ width: 100 }}>{t('o.date')}</th>
                <th style={{ width: 200 }}></th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id}>
                  <td><code style={{ fontSize: 12 }}>#{o.number}</code></td>
                  <td style={{ fontWeight: 500 }}>{o.client_name}</td>
                  <td>
                    <span className={`badge ${statusBadge(o.status)}`}>
                      {t(`o.status.${o.status}` as TKey)}
                    </span>
                  </td>
                  <td className="text-right">{BRL.format(Number(o.total))}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {new Date(o.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td>
                    <div className="flex-gap">
                      {o.status === 'draft' && (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(o)}>
                            {t('c.edit')}
                          </button>
                          <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                            onClick={() => transition(o.id, 'confirm')}>
                            {t('o.confirm')}
                          </button>
                        </>
                      )}
                      {(o.status === 'confirmed' || o.status === 'invoiced') && (
                        <button className="btn btn-secondary btn-sm"
                          onClick={() => transition(o.id, 'deliver')}>
                          {t('o.deliver')}
                        </button>
                      )}
                      {(o.status === 'draft' || o.status === 'confirmed' || o.status === 'invoiced') && (
                        <button className="btn btn-danger btn-sm"
                          onClick={() => transition(o.id, 'cancel')}>
                          {t('c.del')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
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

      {/* ── Drawer ── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}
               style={{ width: 'min(820px, 96vw)' }}>
            <div className="drawer-header">
              <h2>{editing ? t('o.edit') : t('o.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                {/* Client */}
                <div className="field">
                  <label htmlFor="order-client">{t('o.client')} *</label>
                  <select
                    id="order-client"
                    value={formClientId}
                    onChange={e => setFormClientId(e.target.value)}
                    required
                  >
                    <option value="">{t('o.selectClient')}</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.company_name ?? c.full_name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Items */}
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 4 }}>
                  <div style={{ padding: '10px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 13 }}>{t('o.items')}</strong>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={addItem}>
                      + {t('o.addItem')}
                    </button>
                  </div>

                  {formItems.length === 0 ? (
                    <p style={{ padding: '14px 16px', color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                      {t('o.noItems')}
                    </p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: 'var(--surface)' }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left', width: '36%' }}>{t('o.material')}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', width: '16%' }}>{t('o.qty')}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', width: '20%' }}>{t('o.unitPrice')}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', width: '20%' }}>{t('o.lineTotal')}</th>
                            <th style={{ width: '8%' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {formItems.map((item, idx) => (
                            <tr key={item._key} style={{ borderTop: '1px solid var(--border)' }}>
                              <td style={{ padding: '6px 10px' }}>
                                <select
                                  value={item.material_id}
                                  onChange={e => updateItem(idx, 'material_id', e.target.value)}
                                  style={{ width: '100%', fontSize: 12 }}
                                  aria-label={t('o.material')}
                                >
                                  <option value="">{t('o.selectMat')}</option>
                                  {materials.map(m => (
                                    <option key={m.id} value={m.id}>{m.sku} — {m.name}</option>
                                  ))}
                                </select>
                                {!item.material_id && (
                                  <input
                                    placeholder={t('o.namePH')}
                                    value={item.name}
                                    onChange={e => updateItem(idx, 'name', e.target.value)}
                                    style={{ marginTop: 4, fontSize: 12 }}
                                  />
                                )}
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <input
                                  type="number" min="0.001" step="0.001"
                                  value={item.quantity}
                                  onChange={e => updateItem(idx, 'quantity', e.target.value)}
                                  style={{ fontSize: 12 }}
                                  aria-label={t('o.qty')}
                                />
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <input
                                  type="number" min="0" step="0.01"
                                  value={item.unit_price}
                                  onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                                  style={{ fontSize: 12 }}
                                  aria-label={t('o.unitPrice')}
                                />
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, fontSize: 12 }}>
                                {BRL.format((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => removeItem(idx)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18, lineHeight: 1, padding: '0 8px' }}
                                  aria-label={`${t('c.del')} item ${idx + 1}`}
                                  data-testid={`remove-item-${idx}`}
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Notes + financial adjustments */}
                <div className="field">
                  <label htmlFor="order-notes">{t('o.notes')}</label>
                  <textarea id="order-notes" value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2} />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label htmlFor="order-discount">{t('o.discount')}</label>
                    <input id="order-discount" type="number" min="0" step="0.01" value={formDiscount}
                      onChange={e => setFormDiscount(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="order-shipping">{t('o.shipping')}</label>
                    <input id="order-shipping" type="number" min="0" step="0.01" value={formShipping}
                      onChange={e => setFormShipping(e.target.value)} />
                  </div>
                </div>

                {/* Live totals */}
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--muted)' }}>
                    <span>{t('o.subtotal')}</span><span>{BRL.format(subtotal)}</span>
                  </div>
                  {Number(formDiscount) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--danger)' }}>
                      <span>{t('o.discount')}</span><span>− {BRL.format(Number(formDiscount))}</span>
                    </div>
                  )}
                  {Number(formShipping) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--muted)' }}>
                      <span>{t('o.shipping')}</span><span>+ {BRL.format(Number(formShipping))}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                    <span>{t('o.total')}</span>
                    <span style={{ color: 'var(--primary)' }} data-testid="total-value">
                      {BRL.format(totalCalc)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  {t('c.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : editing ? t('o.save') : t('o.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
