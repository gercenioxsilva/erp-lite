import { useEffect, useState, FormEvent } from 'react';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';
import type { TKey } from '../../i18n/pt-BR';

/* ── Types ─────────────────────────────────────────────────────────────── */
interface Invoice {
  id: string; number: string; serie: string; status: string;
  client_name: string; order_id: string | null; order_number: string | null;
  subtotal: number; tax_total: number; total: number; notes: string | null;
  issue_date: string | null; created_at: string;
}
interface ClientOption   { id: string; company_name: string | null; full_name: string | null; }
interface MaterialOption { id: string; sku: string; name: string; ncm_code: string | null; sale_price: number | null; }
interface OrderOption    { id: string; number: string; client_id: string; client_name: string; }

interface FormItem {
  _key: string; material_id: string; name: string;
  ncm_code: string; cfop: string; quantity: string; unit_price: string;
  // tax values populated after calculateTaxes
  icms_cst?: string;    icms_rate?: number;    icms_value?: number;
  pis_cst?: string;     pis_rate?: number;     pis_value?: number;
  cofins_cst?: string;  cofins_rate?: number;  cofins_value?: number;
  ipi_rate?: string;    ipi_value?: number;
}

interface TaxTotals {
  subtotal: number; icms_total: number; pis_total: number;
  cofins_total: number; ipi_total: number; embedded_tax_total: number; grand_total: number;
}
interface TaxApplied { icms: number; pis: number; cofins: number; }
interface TaxResult {
  lines: Array<{
    icms_cst: string; icms_base: number; icms_rate: number; icms_value: number;
    pis_cst: string;  pis_base: number;  pis_rate: number;  pis_value: number;
    cofins_cst: string; cofins_base: number; cofins_rate: number; cofins_value: number;
    ipi_base: number; ipi_rate: number; ipi_value: number;
  }>;
  totals: TaxTotals;
  applied_rates: TaxApplied;
}

interface ListResp { data: Invoice[]; total: number; page: number; per_page: number; }

/* ── Helpers ────────────────────────────────────────────────────────────── */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const PCT = (n: number) => `${n.toFixed(2).replace('.', ',')}%`;
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
  const [formClientId,   setFormClientId]   = useState('');
  const [formOrderId,    setFormOrderId]    = useState('');
  const [formNotes,      setFormNotes]      = useState('');
  const [formSerie,      setFormSerie]      = useState('1');
  const [formItems,      setFormItems]      = useState<FormItem[]>([]);
  const [formTaxRegime,  setFormTaxRegime]  = useState('lucro_presumido');
  const [formDestState,  setFormDestState]  = useState('SP');

  /* dropdown data */
  const [clients,   setClients]   = useState<ClientOption[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [orders,    setOrders]    = useState<OrderOption[]>([]);

  /* tax calculation */
  const [taxResult,    setTaxResult]    = useState<TaxResult | null>(null);
  const [calcTaxLoad,  setCalcTaxLoad]  = useState(false);
  const [calcTaxError, setCalcTaxError] = useState('');

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

  /* ── Load dropdown data when drawer opens ── */
  useEffect(() => {
    if (!drawerOpen || !tenantId) return;
    let cancelled = false;
    setFormError('');
    Promise.all([
      api.get<{ data: ClientOption[] }>(`/v1/clients?tenant_id=${tenantId}&per_page=100`),
      api.get<{ data: MaterialOption[] }>(`/v1/materials?tenant_id=${tenantId}&per_page=100`),
      api.get<{ data: OrderOption[] }>(`/v1/orders?tenant_id=${tenantId}&per_page=100`),
    ])
      .then(([cl, mt, or]) => {
        if (cancelled) return;
        setClients(cl.data ?? []);
        setMaterials(mt.data ?? []);
        setOrders((or.data ?? []).filter(o => !['cancelled', 'delivered'].includes((o as any).status)));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFormError(err instanceof Error ? err.message : t('cl.errSave'));
      });
    return () => { cancelled = true; };
  }, [drawerOpen, tenantId]);

  /* ── When order is selected, auto-fill client + items ── */
  async function handleOrderChange(orderId: string) {
    setFormOrderId(orderId);
    setTaxResult(null);
    if (!orderId) { setFormClientId(''); setFormItems([newItem()]); return; }
    try {
      const detail = await api.get<{
        client_id: string;
        items: Array<{ material_id: string | null; name: string; quantity: number; unit_price: number; }>;
      }>(`/v1/orders/${orderId}`);
      setFormClientId(detail.client_id);
      setFormItems(
        detail.items.length > 0
          ? detail.items.map(it => ({
              _key: Math.random().toString(36).slice(2),
              material_id: it.material_id ?? '',
              name: it.name, ncm_code: '', cfop: '',
              quantity: String(it.quantity),
              unit_price: String(it.unit_price),
            }))
          : [newItem()],
      );
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    }
  }

  /* ── Drawer open helper ── */
  function openCreate() {
    setFormClientId(''); setFormOrderId(''); setFormNotes(''); setFormSerie('1');
    setFormItems([newItem()]); setFormTaxRegime('lucro_presumido'); setFormDestState('SP');
    setTaxResult(null); setCalcTaxError(''); setFormError('');
    setDrawerOpen(true);
  }

  /* ── Item helpers ── */
  function addItem()               { setFormItems(prev => [...prev, newItem()]); setTaxResult(null); }
  function removeItem(idx: number) { setFormItems(prev => prev.filter((_, i) => i !== idx)); setTaxResult(null); }

  function updateItem(idx: number, field: string, val: string) {
    setTaxResult(null);
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

  /* ── Tax calculation ── */
  async function handleCalculateTaxes() {
    const validItems = formItems.filter(it => it.name && Number(it.quantity) > 0);
    if (!validItems.length) { setCalcTaxError(t('o.errNoItems')); return; }

    setCalcTaxLoad(true); setCalcTaxError('');
    try {
      const result = await api.post<TaxResult>('/v1/tax/calculate', {
        origin_state:      'SP',
        destination_state: formDestState.toUpperCase() || 'SP',
        tax_regime:        formTaxRegime,
        lines: validItems.map(it => ({
          ncm_code:   it.ncm_code || undefined,
          quantity:   Number(it.quantity),
          unit_price: Number(it.unit_price),
          ipi_rate:   it.ipi_rate ? Number(it.ipi_rate) : 0,
        })),
      });

      // Merge tax values back into form items (aligned by valid item index)
      let ri = 0;
      setFormItems(prev => prev.map(item => {
        if (!item.name || !(Number(item.quantity) > 0)) return item;
        const line = result.lines[ri++];
        if (!line) return item;
        return {
          ...item,
          icms_cst: line.icms_cst, icms_rate: line.icms_rate, icms_value: line.icms_value,
          pis_cst:  line.pis_cst,  pis_rate:  line.pis_rate,  pis_value:  line.pis_value,
          cofins_cst: line.cofins_cst, cofins_rate: line.cofins_rate, cofins_value: line.cofins_value,
          ipi_value: line.ipi_value,
        };
      }));
      setTaxResult(result);
    } catch (err: unknown) {
      setCalcTaxError(err instanceof Error ? err.message : 'Erro ao calcular impostos');
    } finally { setCalcTaxLoad(false); }
  }

  /* ── Computed subtotal ── */
  const subtotalCalc = formItems.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);

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
        tax_regime:   formTaxRegime,
        origin_state: 'SP',
        items: formItems.filter(it => it.name).map(it => ({
          material_id: it.material_id || undefined, name: it.name,
          ncm_code: it.ncm_code || undefined, cfop: it.cfop || undefined,
          quantity: Number(it.quantity), unit_price: Number(it.unit_price),
          icms_cst: it.icms_cst,   icms_base: (Number(it.quantity)||0) * (Number(it.unit_price)||0),
          icms_rate: it.icms_rate  ?? 0, icms_value:   it.icms_value   ?? 0,
          pis_cst:  it.pis_cst,    pis_base:  (Number(it.quantity)||0) * (Number(it.unit_price)||0),
          pis_rate: it.pis_rate    ?? 0, pis_value:    it.pis_value    ?? 0,
          cofins_cst: it.cofins_cst, cofins_base: (Number(it.quantity)||0) * (Number(it.unit_price)||0),
          cofins_rate: it.cofins_rate ?? 0, cofins_value: it.cofins_value ?? 0,
          ipi_rate: it.ipi_rate ? Number(it.ipi_rate) : 0,
          ipi_value: it.ipi_value ?? 0,
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
          <button key={s}
            className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto' }}
            onClick={() => { setStatusFilter(s); setPage(1); }}>
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
                        <button className="btn btn-danger btn-sm" onClick={() => handleCancel(inv.id)}>
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
               style={{ width: 640, maxWidth: '95vw' }}>
            <div className="drawer-header">
              <h2>{t('inv.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && (
                  <div role="alert" className="alert alert-error">{formError}</div>
                )}

                {/* Order + Serie */}
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="inv-order">{t('inv.fromOrder')}</label>
                    <select id="inv-order" value={formOrderId}
                            onChange={e => void handleOrderChange(e.target.value)}>
                      <option value="">{t('inv.selectOrder')}</option>
                      {orders.map(o => (
                        <option key={o.id} value={o.id}>#{o.number} — {o.client_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ flex: '0 0 100px' }}>
                    <label htmlFor="inv-serie">{t('inv.serie')}</label>
                    <input id="inv-serie" value={formSerie}
                           onChange={e => setFormSerie(e.target.value)} maxLength={10} />
                  </div>
                </div>

                {/* Client */}
                <div className="field">
                  <label htmlFor="inv-client">{t('inv.client')} *</label>
                  <select id="inv-client" value={formClientId}
                          onChange={e => setFormClientId(e.target.value)}>
                    <option value="">{t('o.selectClient')}</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.company_name ?? c.full_name}</option>
                    ))}
                  </select>
                </div>

                {/* Tax regime + Destination state */}
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="inv-regime">{t('tax.regime')}</label>
                    <select id="inv-regime" value={formTaxRegime}
                            onChange={e => { setFormTaxRegime(e.target.value); setTaxResult(null); }}>
                      <option value="lucro_presumido">{t('tax.regimeLLP')}</option>
                      <option value="lucro_real">{t('tax.regimeLR')}</option>
                      <option value="simples_nacional">{t('tax.regimeSN')}</option>
                      <option value="mei">{t('tax.regimeMEI')}</option>
                    </select>
                  </div>
                  <div className="field" style={{ flex: '0 0 130px' }}>
                    <label htmlFor="inv-dest">{t('tax.destState')}</label>
                    <input id="inv-dest" value={formDestState} maxLength={2}
                           onChange={e => { setFormDestState(e.target.value.toUpperCase()); setTaxResult(null); }}
                           placeholder="SP" />
                  </div>
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
                                <select aria-label={t('o.material')} value={item.material_id}
                                        onChange={e => updateItem(idx, 'material_id', e.target.value)}
                                        style={{ width: '100%', fontSize: 12 }}>
                                  <option value="">{t('o.selectMat')}</option>
                                  {materials.map(m => (
                                    <option key={m.id} value={m.id}>{m.sku} — {m.name}</option>
                                  ))}
                                </select>
                                {!item.material_id && (
                                  <input aria-label={t('o.namePH')} placeholder={t('o.namePH')}
                                         value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)}
                                         style={{ marginTop: 4, fontSize: 12 }} />
                                )}
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <input aria-label={t('o.qty')} type="number" min="0.001" step="0.001"
                                       value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)}
                                       style={{ fontSize: 12 }} />
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <input aria-label={t('o.unitPrice')} type="number" min="0" step="0.01"
                                       value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                                       style={{ fontSize: 12 }} />
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <input aria-label={t('inv.ncm')} placeholder="0000.00.00"
                                       value={item.ncm_code} onChange={e => updateItem(idx, 'ncm_code', e.target.value)}
                                       style={{ fontSize: 12 }} />
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <input aria-label={t('inv.cfop')} placeholder="5102"
                                       value={item.cfop} onChange={e => updateItem(idx, 'cfop', e.target.value)}
                                       style={{ fontSize: 12 }} />
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, fontSize: 12 }}>
                                {BRL.format((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button type="button" aria-label={`remove-item-${idx}`}
                                        data-testid={`inv-remove-item-${idx}`}
                                        onClick={() => removeItem(idx)}
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

                {/* Notes */}
                <div className="field">
                  <label htmlFor="inv-notes">{t('o.notes')}</label>
                  <textarea id="inv-notes" value={formNotes}
                            onChange={e => setFormNotes(e.target.value)} rows={2} />
                </div>

                {/* Tax breakdown + totals */}
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
                  {/* Calculate button */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: taxResult ? 10 : 0 }}>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t('tax.breakdown')}</span>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                            disabled={calcTaxLoad} onClick={handleCalculateTaxes}>
                      {calcTaxLoad ? t('tax.calculating') : `⊕ ${t('tax.calculate')}`}
                    </button>
                  </div>

                  {calcTaxError && (
                    <p style={{ color: 'var(--danger)', fontSize: 12, margin: '6px 0 0' }}>{calcTaxError}</p>
                  )}

                  {/* Embedded tax breakdown */}
                  {taxResult && (
                    <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 10, marginTop: 6, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: 4 }}>
                        <span>{t('tax.icms')} {PCT(taxResult.applied_rates.icms)} <em style={{ fontSize: 11 }}>({t('tax.embedded')})</em></span>
                        <span>{BRL.format(taxResult.totals.icms_total)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: 4 }}>
                        <span>{t('tax.pis')} {PCT(taxResult.applied_rates.pis)} <em style={{ fontSize: 11 }}>({t('tax.embedded')})</em></span>
                        <span>{BRL.format(taxResult.totals.pis_total)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: 10 }}>
                        <span>{t('tax.cofins')} {PCT(taxResult.applied_rates.cofins)} <em style={{ fontSize: 11 }}>({t('tax.embedded')})</em></span>
                        <span>{BRL.format(taxResult.totals.cofins_total)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)', paddingTop: 6, marginBottom: 8 }}>
                        <span>Carga tributária total embutida</span>
                        <span>{BRL.format(taxResult.totals.embedded_tax_total)}</span>
                      </div>
                    </div>
                  )}

                  {/* Subtotal + total line */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: taxResult ? '1px solid var(--border)' : 'none', paddingTop: taxResult ? 8 : 0 }}>
                    <span>{taxResult ? t('tax.grandTotal') : t('inv.total')}</span>
                    <span data-testid="inv-total-value" style={{ color: 'var(--primary)' }}>
                      {BRL.format(taxResult ? taxResult.totals.grand_total : subtotalCalc)}
                    </span>
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
