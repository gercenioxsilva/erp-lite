import { useEffect, useState, FormEvent } from 'react';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';
import type { TKey } from '../../i18n/pt-BR';

/* ── Types ─────────────────────────────────────────────────────────────── */
interface Invoice {
  id: string; number: string; serie: string; status: string;
  client_name: string; order_id: string | null; order_number: string | null;
  subtotal: number; total: number; notes: string | null;
  issue_date: string | null; created_at: string;
}
interface ClientOption  { id: string; company_name: string | null; full_name: string | null; }
interface MaterialOption { id: string; sku: string; name: string; ncm_code: string | null; sale_price: number | null; }
interface OrderOption   { id: string; number: string; client_id: string; client_name: string; }
interface FormItem {
  _key: string; material_id: string; name: string;
  ncm_code: string; cfop: string; quantity: string; unit_price: string;
}
interface ListResp { data: Invoice[]; total: number; page: number; per_page: number; }

/* ── Helpers ────────────────────────────────────────────────────────────── */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_TABS = ['all', 'draft', 'issued', 'cancelled'] as const;
type StatusTab = typeof STATUS_TABS[number];

function statusBadge(s: string) {
  return ({ draft: 'badge-service', issued: 'badge-active', cancelled: 'badge-inactive' }[s] ?? 'badge-service');
}
function newItem(): FormItem {
  return { _key: Math.random().toString(36).slice(2), material_id: '', name: '', ncm_code: '', cfop: '', quantity: '1', unit_price: '0' };
}

/* ── Component ──────────────────────────────────────────────────────────── */
export function InvoicesPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();

  /* list */
  const [invoices,     setInvoices]     = useState<Invoice[]>([]);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [loading,      setLoading]      = useState(true);

  /* drawer */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  /* form */
  const [formClientId, setFormClientId] = useState('');
  const [formOrderId,  setFormOrderId]  = useState('');
  const [formNotes,    setFormNotes]    = useState('');
  const [formSerie,    setFormSerie]    = useState('1');
  const [formItems,    setFormItems]    = useState<FormItem[]>([]);

  /* dropdown data */
  const [clients,   setClients]   = useState<ClientOption[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [orders,    setOrders]    = useState<OrderOption[]>([]);
  const [ddLoading, setDdLoading] = useState(false);

  const perPage = 20;

  /* ── Load list ── */
  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        tenant_id: tenantId, page: String(page), per_page: String(perPage),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(search ? { search } : {}),
      });
      const r = await api.get<ListResp>(`/v1/invoices?${p}`);
      setInvoices(r.data); setTotal(r.total);
    } catch { /**/ } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [tenantId, page, statusFilter, search]);

  /* ── Load dropdown data ── */
  async function loadDropdowns() {
    if (!tenantId || ddLoading) return;
    setDdLoading(true);
    try {
      const [cl, mt, or] = await Promise.all([
        api.get<{ data: ClientOption[] }>(`/v1/clients?tenant_id=${tenantId}&per_page=500`),
        api.get<{ data: MaterialOption[] }>(`/v1/materials?tenant_id=${tenantId}&per_page=500`),
        api.get<{ data: OrderOption[] }>(`/v1/orders?tenant_id=${tenantId}&status=confirmed&per_page=200`),
      ]);
      setClients(cl.data ?? []);
      setMaterials(mt.data ?? []);
      setOrders(or.data ?? []);
    } catch { /**/ } finally { setDdLoading(false); }
  }

  /* ── When order is selected, auto-fill client + items ── */
  async function handleOrderChange(orderId: string) {
    setFormOrderId(orderId);
    if (!orderId) return;
    try {
      const detail = await api.get<{ client_id: string; items: Array<{
        material_id: string | null; name: string; sku: string | null;
        quantity: number; unit_price: number;
      }> }>(`/v1/orders/${orderId}`);
      setFormClientId(detail.client_id);
      setFormItems(detail.items.map(it => ({
        _key: Math.random().toString(36).slice(2),
        material_id: it.material_id ?? '',
        name: it.name, ncm_code: '', cfop: '',
        quantity: String(it.quantity), unit_price: String(it.unit_price),
      })));
    } catch { /**/ }
  }

  /* ── Drawer open helpers ── */
  function openCreate() {
    setFormClientId(''); setFormOrderId(''); setFormNotes(''); setFormSerie('1');
    setFormItems([newItem()]);
    setFormError('');
    setDrawerOpen(true);
    void loadDropdowns();
  }

  /* ── Item helpers ── */
  function addItem() { setFormItems(prev => [...prev, newItem()]); }
  function removeItem(idx: number) { setFormItems(prev => prev.filter((_, i) => i !== idx)); }

  function updateItem(idx: number, field: string, val: string) {
    setFormItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      if (field === 'material_id') {
        const mat = materials.find(m => m.id === val);
        return { ...item, material_id: val, name: mat?.name ?? '',
                 ncm_code: mat?.ncm_code ?? '',
                 unit_price: mat?.sale_price ? String(mat.sale_price) : item.unit_price };
      }
      return { ...item, [field]: val };
    }));
  }

  /* ── Computed total ── */
  const totalCalc = formItems.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);

  /* ── Save ── */
  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    if (!formClientId) { setFormError(t('inv.errNoClient')); return; }
    if (!formItems.some(it => it.name)) { setFormError(t('o.errNoItems')); return; }
    setSaving(true); setFormError('');
    try {
      await api.post('/v1/invoices', {
        tenant_id: tenantId, client_id: formClientId,
        order_id: formOrderId || undefined, serie: formSerie,
        notes: formNotes || null,
        items: formItems.filter(it => it.name).map(it => ({
          material_id: it.material_id || undefined, name: it.name,
          ncm_code: it.ncm_code || undefined, cfop: it.cfop || undefined,
          quantity: Number(it.quantity), unit_price: Number(it.unit_price),
        })),
      });
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    } finally { setSaving(false); }
  }

  /* ── Issue / Cancel ── */
  async function handleIssue(id: string) {
    if (!confirm(t('inv.issueMsg'))) return;
    try { await api.post(`/v1/invoices/${id}/issue`, {}); void load(); }
    catch (err: unknown) { alert(err instanceof Error ? err.message : 'Erro'); }
  }
  async function handleCancel(id: string) {
    if (!confirm(t('inv.cancelMsg'))) return;
    try { await api.post(`/v1/invoices/${id}/cancel`, {}); void load(); }
    catch (err: unknown) { alert(err instanceof Error ? err.message : 'Erro'); }
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header">
        <h1>{t('inv.title')}</h1>
        <button className="btn btn-primary" style={{ width: 'auto' }} onClick={openCreate}>
          + {t('inv.new')}
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
            {s === 'all' ? t('o.all') : t(`inv.status.${s}` as TKey)}
          </button>
        ))}
      </div>

      {/* ── Search ── */}
      <div style={{ marginBottom: 14 }}>
        <input
          placeholder={t('inv.searchPH')}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ maxWidth: 320 }}
        />
      </div>

      {/* ── Table ── */}
      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : invoices.length === 0 ? (
          <div className="empty-state">
            {t('inv.empty')}{' '}
            <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('inv.new')}</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 100 }}>{t('inv.number')}</th>
                <th style={{ width: 80 }}>{t('inv.order')}</th>
                <th>{t('inv.client')}</th>
                <th style={{ width: 100 }}>{t('inv.status')}</th>
                <th className="text-right" style={{ width: 110 }}>{t('inv.total')}</th>
                <th style={{ width: 100 }}>{t('inv.issueDate')}</th>
                <th style={{ width: 130 }}></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id}>
                  <td>
                    <code style={{ fontSize: 12 }}>
                      {inv.status === 'issued' ? `${inv.serie}/${inv.number}` : '—'}
                    </code>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {inv.order_number ? `#${inv.order_number}` : '—'}
                  </td>
                  <td style={{ fontWeight: 500 }}>{inv.client_name}</td>
                  <td>
                    <span className={`badge ${statusBadge(inv.status)}`}>
                      {t(`inv.status.${inv.status}` as TKey)}
                    </span>
                  </td>
                  <td className="text-right">{BRL.format(Number(inv.total))}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {inv.issue_date ? new Date(inv.issue_date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td>
                    <div className="flex-gap">
                      {inv.status === 'draft' && (
                        <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                          onClick={() => handleIssue(inv.id)}>
                          {t('inv.issue')}
                        </button>
                      )}
                      {inv.status !== 'cancelled' && (
                        <button className="btn btn-danger btn-sm"
                          onClick={() => handleCancel(inv.id)}>
                          {t('inv.cancel')}
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
               style={{ width: 620, maxWidth: '95vw' }}>
            <div className="drawer-header">
              <h2>{t('inv.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error">{formError}</div>}

                <div className="field-row">
                  {/* Order (optional) */}
                  <div className="field">
                    <label>{t('inv.fromOrder')}</label>
                    <select value={formOrderId} onChange={e => handleOrderChange(e.target.value)}>
                      <option value="">{t('inv.selectOrder')}</option>
                      {orders.map(o => (
                        <option key={o.id} value={o.id}>
                          #{o.number} — {o.client_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* Serie */}
                  <div className="field" style={{ flex: '0 0 100px' }}>
                    <label>{t('inv.serie')}</label>
                    <input value={formSerie} onChange={e => setFormSerie(e.target.value)} maxLength={10} />
                  </div>
                </div>

                {/* Client */}
                <div className="field">
                  <label>{t('inv.client')} *</label>
                  <select value={formClientId} onChange={e => setFormClientId(e.target.value)} required>
                    <option value="">{t('o.selectClient')}</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.company_name ?? c.full_name}</option>
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
                            <th style={{ padding: '6px 10px', textAlign: 'left', width: '32%' }}>{t('o.material')}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', width: '12%' }}>{t('o.qty')}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', width: '16%' }}>{t('o.unitPrice')}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', width: '14%' }}>{t('inv.ncm')}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', width: '14%' }}>{t('inv.cfop')}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', width: '8%' }}>{t('o.lineTotal')}</th>
                            <th style={{ width: '4%' }}></th>
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
                                <input type="number" min="0.001" step="0.001" value={item.quantity}
                                  onChange={e => updateItem(idx, 'quantity', e.target.value)}
                                  style={{ fontSize: 12 }} />
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <input type="number" min="0" step="0.01" value={item.unit_price}
                                  onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                                  style={{ fontSize: 12 }} />
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <input placeholder="0000.00.00" value={item.ncm_code}
                                  onChange={e => updateItem(idx, 'ncm_code', e.target.value)}
                                  style={{ fontSize: 12 }} />
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <input placeholder="5102" value={item.cfop}
                                  onChange={e => updateItem(idx, 'cfop', e.target.value)}
                                  style={{ fontSize: 12 }} />
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, fontSize: 12 }}>
                                {BRL.format((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button type="button" onClick={() => removeItem(idx)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18, lineHeight: 1, padding: '0 8px' }}>
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

                {/* Notes + live total */}
                <div className="field">
                  <label>{t('o.notes')}</label>
                  <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2} />
                </div>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                    <span>{t('inv.total')}</span>
                    <span style={{ color: 'var(--primary)' }}>{BRL.format(totalCalc)}</span>
                  </div>
                </div>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  {t('c.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : t('inv.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
