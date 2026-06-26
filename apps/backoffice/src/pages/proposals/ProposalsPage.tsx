import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
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
  notes: string | null; terms_text: string | null;
  client_id: string | null;
  items: ProposalItemRow[];
}
interface ProposalItemRow {
  id: string; material_id: string | null; name: string; sku: string | null;
  unit: string; quantity: number; unit_price: number; discount_pct: number; total: number; notes: string | null;
}
interface ClientOption   { id: string; company_name: string | null; full_name: string | null; }
interface MaterialOption { id: string; sku: string; name: string; unit: string; sale_price: number | null; }
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
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  const [formTitle,     setFormTitle]    = useState('');
  const [formClientId,  setFormClientId] = useState('');
  const [formValidUntil,setFormValidUntil] = useState('');
  const [formNotes,     setFormNotes]    = useState('');
  const [formTerms,     setFormTerms]    = useState('');
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
      api.get<{ data: MaterialOption[] }>(`/v1/materials?per_page=100&tenant_id=${tenantId}`),
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
    setFormTitle(''); setFormClientId(''); setFormValidUntil('');
    setFormNotes(''); setFormTerms(''); setFormDiscount('0'); setFormShipping('0');
    setFormItems([newItem()]);
    setFormError('');
    setDrawerOpen(true);
  }

  async function openEdit(p: Proposal) {
    setFormError('');
    setDrawerOpen(true);
    try {
      const detail = await api.get<ProposalDetail>(`/v1/proposals/${p.id}`);
      setEditing(detail);
      setFormTitle(detail.title);
      setFormClientId(detail.client_id ?? '');
      setFormValidUntil(detail.valid_until ?? '');
      setFormNotes(detail.notes ?? '');
      setFormTerms(detail.terms_text ?? '');
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
      modal.error(new Error(t('prop.convertSuccess') + ' #' + r.order_number));
      void load();
    } catch (err: unknown) {
      modal.error(err);
    }
  }

  async function duplicateProposal(id: string) {
    try {
      const r = await api.post<{ id: string; number: string }>(`/v1/proposals/${id}/duplicate`, {});
      modal.error(new Error(t('prop.duplicateSuccess') + ' #' + r.number));
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
        <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
          + {t('prop.new')}
        </button>
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
            <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('prop.new')}</button>
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
                <tr key={p.id}>
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
                  <td>
                    <div className="flex-gap">
                      {p.status === 'draft' && (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>
                            {t('c.edit')}
                          </button>
                          <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                            onClick={() => sendProposal(p.id)}>
                            {t('prop.send')}
                          </button>
                          <button className="btn btn-danger btn-sm"
                            onClick={() => cancelProposal(p.id)}>
                            {t('prop.cancel')}
                          </button>
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
                            <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                              onClick={() => convertToOrder(p.id)}>
                              {t('prop.convert')}
                            </button>
                          )}
                          <button className="btn btn-secondary btn-sm"
                            onClick={() => duplicateProposal(p.id)}>
                            {t('prop.duplicate')}
                          </button>
                        </>
                      )}
                      {p.status === 'accepted' && (
                        <>
                          {!p.converted_to_order_id ? (
                            <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                              onClick={() => convertToOrder(p.id)}>
                              {t('prop.convert')}
                            </button>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--success)' }}>
                              {t('prop.converted')}
                            </span>
                          )}
                          <button className="btn btn-secondary btn-sm"
                            onClick={() => duplicateProposal(p.id)}>
                            {t('prop.duplicate')}
                          </button>
                        </>
                      )}
                      {(p.status === 'rejected' || p.status === 'expired') && (
                        <button className="btn btn-secondary btn-sm"
                          onClick={() => duplicateProposal(p.id)}>
                          {t('prop.duplicate')}
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
              <h2>{editing ? t('c.edit') + ' ' + t('prop.title') : t('prop.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
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
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 4 }}>
                  <div style={{ padding: '10px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 13 }}>{t('o.items')}</strong>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={addItem}>
                      {t('prop.addItem')}
                    </button>
                  </div>
                  {formItems.length === 0 ? (
                    <p style={{ padding: '14px 16px', color: 'var(--muted)', fontSize: 13, margin: 0 }}>{t('o.noItems')}</p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: 'var(--surface)' }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left', width: '30%' }}>{t('prop.itemName')}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', width: '10%' }}>{t('prop.itemQty')}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', width: '16%' }}>{t('prop.itemPrice')}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', width: '10%' }}>{t('prop.itemDisc')}</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', width: '16%' }}>{t('prop.itemTotal')}</th>
                            <th style={{ width: '8%' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {formItems.map((item, idx) => {
                            const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0) * (1 - (Number(item.discount_pct) || 0) / 100);
                            return (
                              <tr key={item._key} style={{ borderTop: '1px solid var(--border)' }}>
                                <td style={{ padding: '6px 10px' }}>
                                  <select
                                    value={item.material_id}
                                    onChange={e => updateItem(idx, 'material_id', e.target.value)}
                                    style={{ width: '100%', fontSize: 11, marginBottom: 2 }}
                                    aria-label={t('o.material')}
                                  >
                                    <option value="">{t('o.selectMat')}</option>
                                    {materials.map(m => (
                                      <option key={m.id} value={m.id}>{m.sku} — {m.name}</option>
                                    ))}
                                  </select>
                                  <input
                                    placeholder={t('prop.itemName')}
                                    value={item.name}
                                    onChange={e => updateItem(idx, 'name', e.target.value)}
                                    style={{ fontSize: 11 }}
                                  />
                                </td>
                                <td style={{ padding: '6px 8px' }}>
                                  <input type="number" min="0.001" step="0.001" value={item.quantity}
                                    onChange={e => updateItem(idx, 'quantity', e.target.value)}
                                    style={{ fontSize: 11 }} aria-label={t('prop.itemQty')} />
                                </td>
                                <td style={{ padding: '6px 8px' }}>
                                  <input type="number" min="0" step="0.01" value={item.unit_price}
                                    onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                                    style={{ fontSize: 11 }} aria-label={t('prop.itemPrice')} />
                                </td>
                                <td style={{ padding: '6px 8px' }}>
                                  <input type="number" min="0" max="100" step="0.1" value={item.discount_pct}
                                    onChange={e => updateItem(idx, 'discount_pct', e.target.value)}
                                    style={{ fontSize: 11 }} aria-label={t('prop.itemDisc')} />
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, fontSize: 11 }}>
                                  {BRL.format(lineTotal)}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <button type="button" onClick={() => removeItem(idx)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18, lineHeight: 1, padding: '0 8px' }}
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

                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
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
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  {t('c.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : editing ? t('c.save') : t('prop.new')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
