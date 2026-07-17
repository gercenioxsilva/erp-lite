import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { ProductPicker } from '../../ds/components/ProductPicker';
import { Can }      from '../../rbac';
import type { TKey } from '../../i18n/pt-BR';

interface Proposal {
  id: string; number: string; title: string; status: string;
  total: number; valid_until: string | null;
  public_token: string | null;
  client_name: string | null; client_email: string | null;
  accepted_at: string | null; rejected_at: string | null;
  converted_to_order_id: string | null;
  created_at: string;
}
interface ProposalDetail extends Proposal {
  subtotal: number; discount: number; shipping: number;
  notes: string | null; terms_text: string | null; commercial_message: string | null;
  delivery_time: string | null; payment_method: string | null;
  client_id: string | null;
  items: ProposalItemRow[];
}
interface ProposalItemRow {
  id: string; material_id: string | null; name: string; sku: string | null;
  unit: string; quantity: number; unit_price: number; discount_pct: number; total: number; notes: string | null;
}
interface ClientOption   { id: string; company_name: string | null; full_name: string | null; }
interface MaterialOption { id: string; sku: string; name: string; unit: string; sale_price: number | null; description?: string | null; type?: string | null; }
interface KitComponentRow { component_id: string; quantity: string; sku: string | null; name: string; unit: string; sale_price: string | null; }
interface FormItem {
  _key: string; material_id: string; name: string; sku: string;
  unit: string; quantity: string; unit_price: string; discount_pct: string;
}
interface ListResp { data: Proposal[]; total: number; page: number; per_page: number; }

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_TABS = ['all', 'draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'cancelled'] as const;
type StatusTab = typeof STATUS_TABS[number];

function statusBadge(s: string) {
  const map: Record<string, string> = {
    draft: 'badge-service', sent: 'badge-raw_material', viewed: 'badge-product',
    accepted: 'badge-active', rejected: 'badge-inactive', expired: 'badge-inactive', cancelled: 'badge-inactive',
  };
  return map[s] ?? 'badge-service';
}

function newItem(): FormItem {
  return { _key: Math.random().toString(36).slice(2), material_id: '', name: '', sku: '', unit: 'UN', quantity: '1', unit_price: '0', discount_pct: '0' };
}

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR');
}

export function ProposalsPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();

  const [proposals,    setProposals]   = useState<Proposal[]>([]);
  const [total,        setTotal]       = useState(0);
  const [page,         setPage]        = useState(1);
  const [search,       setSearch]      = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [loading,      setLoading]     = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<ProposalDetail | null>(null);
  const [viewOnly,   setViewOnly]   = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  const [formTitle,     setFormTitle]    = useState('');
  const [formClientId,  setFormClientId] = useState('');
  const [formValidUntil,setFormValidUntil] = useState('');
  const [formNotes,     setFormNotes]    = useState('');
  const [formTerms,     setFormTerms]    = useState('');
  const [formCommercialMessage, setFormCommercialMessage] = useState('');
  const [formDelivery,  setFormDelivery] = useState('');
  const [formPayment,   setFormPayment]  = useState('');
  const [formDiscount,  setFormDiscount] = useState('0');
  const [formShipping,  setFormShipping] = useState('0');
  const [formItems,     setFormItems]    = useState<FormItem[]>([]);

  const [clients,   setClients]   = useState<ClientOption[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);

  const [copiedId,  setCopiedId]  = useState<string | null>(null);

  const perPage = 20;

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        page: String(page), per_page: String(perPage),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(search ? { search } : {}),
      });
      const r = await api.get<ListResp>(`/v1/proposals?${p}`);
      setProposals(r.data); setTotal(r.total);
    } catch { /**/ } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [tenantId, page, statusFilter, search]);

  useEffect(() => {
    if (!drawerOpen || !tenantId) return;
    let cancelled = false;
    setFormError('');
    Promise.all([
      api.get<{ data: ClientOption[] }>(`/v1/clients?per_page=100&tenant_id=${tenantId}`),
      api.get<{ data: MaterialOption[] }>(`/v1/materials?per_page=500&tenant_id=${tenantId}`),
    ]).then(([cl, mt]) => {
      if (cancelled) return;
      setClients(cl.data ?? []);
      setMaterials(mt.data ?? []);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    });
    return () => { cancelled = true; };
  }, [drawerOpen, tenantId]);

  function openCreate() {
    setEditing(null);
    setViewOnly(false);
    setFormTitle(''); setFormClientId(''); setFormValidUntil('');
    setFormNotes(''); setFormTerms(''); setFormCommercialMessage(''); setFormDelivery(''); setFormPayment('');
    setFormDiscount('0'); setFormShipping('0');
    setFormItems([newItem()]);
    setFormError('');
    setDrawerOpen(true);
  }

  async function openEdit(p: Proposal) {
    setFormError('');
    setViewOnly(!['draft', 'sent', 'viewed'].includes(p.status));
    setDrawerOpen(true);
    try {
      const detail = await api.get<ProposalDetail>(`/v1/proposals/${p.id}`);
      setEditing(detail);
      setFormTitle(detail.title);
      setFormClientId(detail.client_id ?? '');
      setFormValidUntil(detail.valid_until ?? '');
      setFormNotes(detail.notes ?? '');
      setFormTerms(detail.terms_text ?? '');
      setFormCommercialMessage(detail.commercial_message ?? '');
      setFormDelivery(detail.delivery_time ?? '');
      setFormPayment(detail.payment_method ?? '');
      setFormDiscount(String(detail.discount));
      setFormShipping(String(detail.shipping));
      setFormItems(detail.items.map(it => ({
        _key: Math.random().toString(36).slice(2),
        material_id: it.material_id ?? '', name: it.name, sku: it.sku ?? '',
        unit: it.unit, quantity: String(it.quantity), unit_price: String(it.unit_price),
        discount_pct: String(it.discount_pct),
      })));
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('c.loading'));
    }
  }

  function addItem() { setFormItems(prev => [...prev, newItem()]); }

  function handlePickMaterial(idx: number, id: string) {
    if (!id) { updateItem(idx, 'material_id', ''); return; }
    const mat = materials.find(m => m.id === id);
    if (mat?.type === 'kit') { void addKit(idx, id); return; }
    updateItem(idx, 'material_id', id);
  }

  async function addKit(idx: number, kitId: string) {
    let comps: KitComponentRow[] = [];
    try {
      const resp = await api.get<{ data: KitComponentRow[] }>(`/v1/materials/${kitId}/components`);
      comps = resp.data ?? [];
    } catch { comps = []; }

    const expand = comps.length > 0 && await modal.confirm({
      title:        t('o.kit.title'),
      message:      t('o.kit.message'),
      confirmLabel: t('o.kit.expand'),
      cancelLabel:  t('o.kit.closed'),
    });

    if (expand) {
      const lines: FormItem[] = comps.map(c => ({
        _key:         Math.random().toString(36).slice(2),
        material_id:  c.component_id,
        name:         c.name,
        sku:          c.sku ?? '',
        unit:         c.unit ?? 'UN',
        quantity:     String(Number(c.quantity) || 1),
        unit_price:   c.sale_price ? String(c.sale_price) : '0',
        discount_pct: '0',
      }));
      setFormItems(prev => [...prev.slice(0, idx), ...lines, ...prev.slice(idx + 1)]);
    } else {
      updateItem(idx, 'material_id', kitId);
    }
  }
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

  const subtotal  = formItems.reduce((s, it) => {
    const disc = 1 - (Number(it.discount_pct) || 0) / 100;
    return s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0) * disc;
  }, 0);
  const totalCalc = subtotal - (Number(formDiscount) || 0) + (Number(formShipping) || 0);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    if (!formTitle.trim()) { setFormError(t('prop.propTitle') + ' é obrigatório'); return; }
    const namedItems = formItems.filter(it => it.name.trim());
    if (!namedItems.length) { setFormError(t('o.errNoItems')); return; }
    setSaving(true); setFormError('');
    try {
      const payload = {
        client_id: formClientId || undefined,
        title: formTitle.trim(),
        valid_until: formValidUntil || undefined,
        notes: formNotes || undefined,
        terms_text: formTerms || undefined,
        commercial_message: formCommercialMessage || undefined,
        delivery_time: formDelivery || undefined,
        payment_method: formPayment || undefined,
        discount: Number(formDiscount) || 0,
        shipping: Number(formShipping) || 0,
        items: namedItems.map(it => ({
          material_id: it.material_id || undefined,
          name: it.name.trim(), sku: it.sku || undefined,
          unit: it.unit, quantity: Number(it.quantity), unit_price: Number(it.unit_price),
          discount_pct: Number(it.discount_pct) || 0,
        })),
      };
      if (editing) {
        await api.patch(`/v1/proposals/${editing.id}`, payload);
      } else {
        await api.post('/v1/proposals', payload);
      }
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    } finally { setSaving(false); }
  }

  async function sendProposal(id: string) {
    const ok = await modal.confirm({
      title: t('prop.send'),
      message: t('prop.sendConfirm'),
      confirmLabel: t('prop.send'),
    });
    if (!ok) return;
    try {
      await api.post(`/v1/proposals/${id}/send`, {});
      void load();
    } catch (err: unknown) {
      modal.error(err);
    }
  }

  async function convertToOrder(id: string) {
    const ok = await modal.confirm({
      title: t('prop.convert'),
      message: t('prop.convert') + '?',
      confirmLabel: t('prop.convert'),
    });
    if (!ok) return;
    try {
      const r = await api.post<{ order_id: string; order_number: string }>(`/v1/proposals/${id}/convert`, {});
      modal.success(t('prop.convertSuccess') + ' #' + r.order_number);
      void load();
    } catch (err: unknown) {
      modal.error(err);
    }
  }

  async function duplicateProposal(id: string) {
    try {
      const r = await api.post<{ id: string; number: string }>(`/v1/proposals/${id}/duplicate`, {});
      modal.success(t('prop.duplicateSuccess') + ' #' + r.number);
      void load();
    } catch (err: unknown) {
      modal.error(err);
    }
  }

  async function cancelProposal(id: string) {
    const ok = await modal.confirm({
      title: t('prop.cancel'),
      message: t('prop.cancelConfirm'),
      confirmLabel: t('prop.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/v1/proposals/${id}/cancel`, {});
      void load();
    } catch (err: unknown) {
      modal.error(err);
    }
  }

  async function copyLink(p: Proposal) {
    if (!p.public_token) return;
    const appUrl = window.location.origin;
    const link = `${appUrl}/p/${p.public_token}`;
    await navigator.clipboard.writeText(link);
    setCopiedId(p.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="page-header">
        <h1>{t('prop.title')}</h1>
        <Can permission="proposals:create">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
            + {t('prop.new')}
          </button>
        </Can>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {STATUS_TABS.map(s => (
          <button
            key={s}
            className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto' }}
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {s === 'all' ? t('o.all') : t(`prop.${s}` as TKey)}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <input
          placeholder={t('o.searchPH')}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ maxWidth: 320 }}
        />
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : proposals.length === 0 ? (
          <div className="empty-state">
            {t('o.empty')}{' '}
            <Can permission="proposals:create">
              <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('prop.new')}</button>
            </Can>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 90 }}>{t('prop.number')}</th>
                <th>{t('prop.propTitle')}</th>
                <th>{t('prop.client')}</th>
                <th className="text-right" style={{ width: 110 }}>{t('prop.total')}</th>
                <th style={{ width: 100 }}>{t('prop.validUntil')}</th>
                <th style={{ width: 110 }}>{t('prop.status')}</th>
                <th style={{ width: 260 }}></th>
              </tr>
            </thead>
            <tbody>
              {proposals.map(p => (
                <tr key={p.id} onClick={() => openEdit(p)} style={{ cursor: 'pointer' }}>
                  <td><code style={{ fontSize: 12 }}>#{p.number}</code></td>
                  <td style={{ fontWeight: 500 }}>{p.title}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{p.client_name ?? '—'}</td>
                  <td className="text-right">{BRL.format(Number(p.total))}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{fmt(p.valid_until)}</td>
                  <td>
                    <span className={`badge ${statusBadge(p.status)}`}>
                      {t(`prop.${p.status}` as TKey)}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex-gap">
                      <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                        onClick={() => window.open(`/proposals/${p.id}/print`, '_blank', 'noopener')}>
                        {t('prop.print')}
                      </button>
                      {p.status === 'draft' && (
                        <>
                          <Can permission="proposals:edit">
                            <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>
                              {t('c.edit')}
                            </button>
                          </Can>
                          <Can permission="proposals:send">
                            <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                              onClick={() => sendProposal(p.id)}>
                              {t('prop.send')}
                            </button>
                          </Can>
                          <Can permission="proposals:edit">
                            <button className="btn btn-danger btn-sm"
                              onClick={() => cancelProposal(p.id)}>
                              {t('prop.cancel')}
                            </button>
                          </Can>
                        </>
                      )}
                      {(p.status === 'sent' || p.status === 'viewed') && (
                        <>
                          {p.public_token && (
                            <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                              onClick={() => copyLink(p)}>
                              {copiedId === p.id ? t('prop.linkCopied') : t('prop.copyLink')}
                            </button>
                          )}
                          {!p.converted_to_order_id && (
                            <Can permission="proposals:edit">
                              <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                                onClick={() => convertToOrder(p.id)}>
                                {t('prop.convert')}
                              </button>
                            </Can>
                          )}
                          <Can permission="proposals:create">
                            <button className="btn btn-secondary btn-sm"
                              onClick={() => duplicateProposal(p.id)}>
                              {t('prop.duplicate')}
                            </button>
                          </Can>
                        </>
                      )}
                      {p.status === 'accepted' && (
                        <>
                          {!p.converted_to_order_id ? (
                            <Can permission="proposals:edit">
                              <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                                onClick={() => convertToOrder(p.id)}>
                                {t('prop.convert')}
                              </button>
                            </Can>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--success)' }}>
                              {t('prop.converted')}
                            </span>
                          )}
                          <Can permission="proposals:create">
                            <button className="btn btn-secondary btn-sm"
                              onClick={() => duplicateProposal(p.id)}>
                              {t('prop.duplicate')}
                            </button>
                          </Can>
                        </>
                      )}
                      {(p.status === 'rejected' || p.status === 'expired') && (
                        <Can permission="proposals:create">
                          <button className="btn btn-secondary btn-sm"
                            onClick={() => duplicateProposal(p.id)}>
                            {t('prop.duplicate')}
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

      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}
               style={{ width: 'min(860px, 96vw)' }}>
            <div className="drawer-header">
              <h2>{viewOnly ? `${t('c.view')} #${editing?.number ?? ''}` : editing ? t('c.edit') + ' ' + t('prop.title') : t('prop.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                <fieldset disabled={viewOnly} style={{ display: 'contents' }}>
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                <div className="field">
                  <label htmlFor="prop-title">{t('prop.propTitle')} *</label>
                  <input id="prop-title" value={formTitle} onChange={e => setFormTitle(e.target.value)} required />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label htmlFor="prop-client">{t('prop.client')}</label>
                    <select id="prop-client" value={formClientId} onChange={e => setFormClientId(e.target.value)}>
                      <option value="">{t('o.selectClient')}</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.company_name ?? c.full_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="prop-valid">{t('prop.validUntil')}</label>
                    <input id="prop-valid" type="date" value={formValidUntil} onChange={e => setFormValidUntil(e.target.value)} />
                  </div>
                </div>

                {/* Items */}
                <div className="card" style={{ padding: 0, marginBottom: 16 }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{t('o.items')}</strong>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={addItem}>
                      {t('prop.addItem')}
                    </button>
                  </div>
                  {formItems.length === 0 ? (
                    <div className="empty-state" style={{ padding: '28px 16px' }}>{t('o.noItems')}</div>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <colgroup>
                          <col />
                          <col style={{ width: 96 }} />
                          <col style={{ width: 132 }} />
                          <col style={{ width: 96 }} />
                          <col style={{ width: 132 }} />
                          <col style={{ width: 52 }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>{t('prop.itemName')}</th>
                            <th>{t('prop.itemQty')}</th>
                            <th>{t('prop.itemPrice')}</th>
                            <th>{t('prop.itemDisc')}</th>
                            <th style={{ textAlign: 'right' }}>{t('prop.itemTotal')}</th>
                            <th aria-hidden></th>
                          </tr>
                        </thead>
                        <tbody>
                          {formItems.map((item, idx) => {
                            const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0) * (1 - (Number(item.discount_pct) || 0) / 100);
                            return (
                              <tr key={item._key}>
                                <td>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <ProductPicker
                                      options={materials}
                                      value={item.material_id}
                                      onChange={id => handlePickMaterial(idx, id)}
                                      placeholder={t('o.selectMat')}
                                      emptyLabel={t('o.noMatch')}
                                      ariaLabel={t('o.material')}
                                      kitLabel={t('o.kit.badge')}
                                    />
                                    <input
                                      placeholder={t('prop.itemName')}
                                      value={item.name}
                                      onChange={e => updateItem(idx, 'name', e.target.value)}
                                    />
                                  </div>
                                </td>
                                <td>
                                  <input type="number" min="0.001" step="0.001" value={item.quantity}
                                    onChange={e => updateItem(idx, 'quantity', e.target.value)} aria-label={t('prop.itemQty')} />
                                </td>
                                <td>
                                  <input type="number" min="0" step="0.01" value={item.unit_price}
                                    onChange={e => updateItem(idx, 'unit_price', e.target.value)} aria-label={t('prop.itemPrice')} />
                                </td>
                                <td>
                                  <input type="number" min="0" max="100" step="0.1" value={item.discount_pct}
                                    onChange={e => updateItem(idx, 'discount_pct', e.target.value)} aria-label={t('prop.itemDisc')} />
                                </td>
                                <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                  {BRL.format(lineTotal)}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <button type="button" onClick={() => removeItem(idx)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18, lineHeight: 1, padding: '0 6px' }}
                                    aria-label={`${t('c.del')} item ${idx + 1}`}>×</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="field-row">
                  <div className="field">
                    <label htmlFor="prop-delivery">{t('prop.deliveryTime')}</label>
                    <input id="prop-delivery" value={formDelivery}
                      onChange={e => setFormDelivery(e.target.value)} placeholder={t('prop.deliveryPH')} />
                  </div>
                  <div className="field">
                    <label htmlFor="prop-payment">{t('prop.paymentMethod')}</label>
                    <select id="prop-payment" value={formPayment} onChange={e => setFormPayment(e.target.value)}>
                      <option value="">{t('prop.payChoose')}</option>
                      {(['cash', 'pix', 'boleto', 'card', 'card_installments', 'transfer', 'to_agree'] as const).map(k => (
                        <option key={k} value={k}>{t(`prop.pay.${k}` as TKey)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="prop-commercial-message">{t('prop.commercialMessage')}</label>
                  <textarea id="prop-commercial-message" value={formCommercialMessage}
                    onChange={e => setFormCommercialMessage(e.target.value)} rows={3}
                    placeholder={t('prop.commercialMessagePH')} />
                </div>

                <div className="field">
                  <label htmlFor="prop-notes">{t('prop.notes')}</label>
                  <textarea id="prop-notes" value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2} />
                </div>

                <div className="field">
                  <label htmlFor="prop-terms">{t('prop.termsText')}</label>
                  <textarea id="prop-terms" value={formTerms} onChange={e => setFormTerms(e.target.value)} rows={2} />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label htmlFor="prop-discount">{t('prop.discount')}</label>
                    <input id="prop-discount" type="number" min="0" step="0.01" value={formDiscount}
                      onChange={e => setFormDiscount(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="prop-shipping">{t('prop.shipping')}</label>
                    <input id="prop-shipping" type="number" min="0" step="0.01" value={formShipping}
                      onChange={e => setFormShipping(e.target.value)} />
                  </div>
                </div>

                <div className="card" style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--muted)' }}>
                    <span>{t('o.subtotal')}</span><span>{BRL.format(subtotal)}</span>
                  </div>
                  {Number(formDiscount) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--danger)' }}>
                      <span>{t('prop.discount')}</span><span>− {BRL.format(Number(formDiscount))}</span>
                    </div>
                  )}
                  {Number(formShipping) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--muted)' }}>
                      <span>{t('prop.shipping')}</span><span>+ {BRL.format(Number(formShipping))}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                    <span>{t('prop.total')}</span>
                    <span style={{ color: 'var(--primary)' }}>{BRL.format(totalCalc)}</span>
                  </div>
                </div>
                </fieldset>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  {viewOnly ? t('c.close') : t('c.cancel')}
                </button>
                {!viewOnly && (
                  <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                    {saving ? t('c.saving') : editing ? t('c.save') : t('prop.new')}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
