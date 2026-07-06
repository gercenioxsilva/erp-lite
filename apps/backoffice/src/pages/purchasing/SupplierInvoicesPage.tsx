import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import type { TKey } from '../../i18n/pt-BR';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface SI {
  id: string; nfe_number: string | null; nfe_series: string | null; nfe_key: string | null;
  status: string; supplier_id: string | null; supplier_name: string | null;
  issue_date: string | null; due_date: string | null; total: string;
  purchase_order_id: string | null; payable_id: string | null; created_at: string;
}
interface SupplierOption { id: string; company_name: string | null; full_name: string | null; }
interface POOption { id: string; number: string; }
interface ListResp { data: SI[]; total: number; page: number; per_page: number; }

interface UnmatchedSupplier {
  matched: false; cnpj: string; name: string;
  street: string | null; street_number: string | null; neighborhood: string | null;
  city: string | null; state: string | null; zip_code: string | null;
}
interface LookupResp {
  found: boolean;
  reason?: string;
  supplier?: { matched: true; id: string; name: string | null } | UnmatchedSupplier;
  nfe?: { chave: string; numero: string; serie: string; data_emissao: string | null; valor_total: number };
  items?: Array<{ name: string; ncm_code: string | null; cfop: string | null; unit: string; quantity: number; unit_price: number }>;
}

const STATUS_TABS = ['all', 'draft', 'confirmed', 'divergence', 'cancelled'] as const;
type StatusTab = typeof STATUS_TABS[number];

function statusBadge(s: string) {
  return ({ draft: 'badge-service', confirmed: 'badge-active', divergence: 'badge-product', cancelled: 'badge-inactive' }[s] ?? 'badge-service');
}

function newItem() {
  return { _key: Math.random().toString(36).slice(2), material_id: '', name: '', unit: 'UN', quantity: '1', unit_price: '0' };
}

export function SupplierInvoicesPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();

  const [invoices,    setInvoices]    = useState<SI[]>([]);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(1);
  const [search,      setSearch]      = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [loading,     setLoading]     = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  const [formSupplier, setFormSupplier] = useState('');
  const [formPO,       setFormPO]       = useState('');
  const [formNfeKey,   setFormNfeKey]   = useState('');
  const [formNfeNum,   setFormNfeNum]   = useState('');
  const [formSeries,   setFormSeries]   = useState('1');
  const [formIssue,    setFormIssue]    = useState('');
  const [formDue,      setFormDue]      = useState('');
  const [formTotal,    setFormTotal]    = useState('');
  const [formItems,    setFormItems]    = useState([newItem()]);
  const [suppliers,    setSuppliers]    = useState<SupplierOption[]>([]);
  const [pos,          setPOs]          = useState<POOption[]>([]);

  const [keyLookupLoading, setKeyLookupLoading] = useState(false);
  const [keyLookupMsg, setKeyLookupMsg] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [keySupplierSuggestion, setKeySupplierSuggestion] = useState<UnmatchedSupplier | null>(null);
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  const perPage = 20;

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), per_page: String(perPage), ...(statusFilter !== 'all' ? { status: statusFilter } : {}), ...(search ? { search } : {}) });
      const r = await api.get<ListResp>(`/v1/supplier-invoices?${p}`);
      setInvoices(r.data); setTotal(r.total);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [tenantId, page, statusFilter, search]);

  useEffect(() => {
    if (!drawerOpen || !tenantId) return;
    let cancelled = false;
    Promise.all([
      api.get<{ data: SupplierOption[] }>(`/v1/suppliers?tenant_id=${tenantId}&per_page=100`),
      api.get<{ data: POOption[] }>(`/v1/purchase-orders?per_page=100&status=approved`),
    ]).then(([su, po]) => {
      if (cancelled) return;
      setSuppliers(su.data ?? []);
      setPOs(po.data ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [drawerOpen, tenantId]);

  function openCreate() {
    setFormSupplier(''); setFormPO(''); setFormNfeKey(''); setFormNfeNum('');
    setFormSeries('1'); setFormIssue(''); setFormDue(''); setFormTotal('');
    setFormItems([newItem()]); setFormError(''); setDrawerOpen(true);
    setKeyLookupMsg(null); setKeySupplierSuggestion(null);
  }

  async function handleLookupByKey() {
    const chave = formNfeKey.trim();
    if (chave.length !== 44) return;
    setKeyLookupLoading(true); setKeyLookupMsg(null); setKeySupplierSuggestion(null);
    try {
      const r = await api.post<LookupResp>('/v1/supplier-invoices/lookup-by-key', { chave_acesso: chave });
      if (!r.found) {
        setKeyLookupMsg({ type: 'info', text: r.reason ?? t('si.lookupNotFound') });
        return;
      }
      if (r.nfe) {
        if (r.nfe.numero) setFormNfeNum(r.nfe.numero);
        if (r.nfe.serie)  setFormSeries(r.nfe.serie);
        if (r.nfe.data_emissao) setFormIssue(r.nfe.data_emissao.slice(0, 10));
        if (r.nfe.valor_total) setFormTotal(String(r.nfe.valor_total));
      }
      if (r.items?.length) {
        setFormItems(r.items.map(it => ({
          _key: Math.random().toString(36).slice(2), material_id: '',
          name: it.name, unit: it.unit || 'UN',
          quantity: String(it.quantity), unit_price: String(it.unit_price),
        })));
      }
      if (r.supplier?.matched) {
        setFormSupplier(r.supplier.id);
        setKeyLookupMsg({ type: 'info', text: `${t('si.lookupFilled')} ${t('si.lookupSupplierMatched')} ${r.supplier.name ?? ''}` });
      } else if (r.supplier) {
        setKeySupplierSuggestion(r.supplier);
        setKeyLookupMsg({ type: 'info', text: t('si.lookupFilled') });
      }
    } catch (err: unknown) {
      setKeyLookupMsg({ type: 'error', text: err instanceof Error ? err.message : t('si.lookupError') });
    } finally {
      setKeyLookupLoading(false);
    }
  }

  async function handleCreateSuggestedSupplier() {
    if (!keySupplierSuggestion) return;
    setCreatingSupplier(true);
    try {
      const created = await api.post<{ id: string; company_name: string | null }>('/v1/suppliers', {
        person_type:   'PJ',
        company_name:  keySupplierSuggestion.name,
        cnpj:          keySupplierSuggestion.cnpj,
        street:        keySupplierSuggestion.street,
        street_number: keySupplierSuggestion.street_number,
        neighborhood:  keySupplierSuggestion.neighborhood,
        city:          keySupplierSuggestion.city,
        state:         keySupplierSuggestion.state,
        zip_code:      keySupplierSuggestion.zip_code,
      });
      setSuppliers(prev => [...prev, { id: created.id, company_name: created.company_name, full_name: null }]);
      setFormSupplier(created.id);
      setKeySupplierSuggestion(null);
      setKeyLookupMsg({ type: 'info', text: t('si.lookupSupplierCreated') });
    } catch (err: unknown) {
      modal.error(err);
    } finally {
      setCreatingSupplier(false);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    if (!formTotal || Number(formTotal) <= 0) { setFormError('Total é obrigatório e deve ser maior que zero.'); return; }
    const namedItems = formItems.filter(it => it.name.trim());
    if (!namedItems.length) { setFormError(t('o.errNoItems')); return; }
    setSaving(true); setFormError('');
    try {
      const sup = suppliers.find(s => s.id === formSupplier);
      await api.post('/v1/supplier-invoices', {
        supplier_id:      formSupplier || null,
        supplier_name:    sup ? (sup.company_name ?? sup.full_name) : null,
        purchase_order_id: formPO || null,
        nfe_key:          formNfeKey.trim() || null,
        nfe_number:       formNfeNum.trim() || null,
        nfe_series:       formSeries || '1',
        issue_date:       formIssue || null,
        due_date:         formDue   || null,
        subtotal:         Number(formTotal),
        total:            Number(formTotal),
        items: namedItems.map(it => ({ name: it.name, unit: it.unit, quantity: Number(it.quantity), unit_price: Number(it.unit_price) })),
      });
      setDrawerOpen(false); void load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Erro ao salvar.'); }
    finally { setSaving(false); }
  }

  async function handleConfirm(id: string) {
    const ok = await modal.confirm({ title: t('si.confirm'), message: t('si.confirmMsg'), confirmLabel: t('si.confirm') });
    if (!ok) return;
    try {
      const result = await api.post<{ status: string; message: string }>(`/v1/supplier-invoices/${id}/confirm`, {});
      if (result.status === 'divergence') modal.success(result.message, 'Divergência detectada');
      else modal.success(result.message);
      void load();
    } catch (err: unknown) { modal.error(err); }
  }

  async function handleCancel(id: string) {
    const ok = await modal.confirm({ title: 'Cancelar NF-e de entrada?', message: t('si.cancelMsg'), confirmLabel: 'Cancelar NF-e', danger: true });
    if (!ok) return;
    try { await api.post(`/v1/supplier-invoices/${id}/cancel`, {}); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="page-header">
        <h1>{t('si.title')}</h1>
        <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
          + {t('si.new')}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {STATUS_TABS.map(s => (
          <button key={s} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto' }} onClick={() => { setStatusFilter(s); setPage(1); }}>
            {s === 'all' ? 'Todas' : t(`si.status.${s}` as TKey)}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <input placeholder={t('si.search')} value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 360 }} />
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : invoices.length === 0 ? (
          <div className="empty-state">
            {t('si.empty')}{' '}
            <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('si.new')}</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('si.nfeNumber')}</th>
                <th>{t('po.supplier')}</th>
                <th style={{ width: 110 }}>{t('si.issueDate')}</th>
                <th style={{ width: 110 }}>{t('si.dueDate')}</th>
                <th className="text-right" style={{ width: 120 }}>{t('si.total')}</th>
                <th style={{ width: 110 }}>{t('si.status')}</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id}>
                  <td>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{inv.nfe_number ? `NF ${inv.nfe_number}/${inv.nfe_series}` : '—'}</div>
                    {inv.nfe_key && <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{inv.nfe_key.slice(0, 22)}…</div>}
                  </td>
                  <td style={{ fontSize: 13 }}>{inv.supplier_name ?? '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {inv.due_date ? new Date(inv.due_date).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="text-right" style={{ fontWeight: 500 }}>{BRL.format(Number(inv.total))}</td>
                  <td>
                    <span className={`badge ${statusBadge(inv.status)}`}>
                      {t(`si.status.${inv.status}` as TKey)}
                    </span>
                  </td>
                  <td>
                    <div className="flex-gap">
                      {(inv.status === 'draft' || inv.status === 'divergence') && (
                        <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => void handleConfirm(inv.id)}>
                          Confirmar
                        </button>
                      )}
                      {(inv.status === 'draft' || inv.status === 'confirmed' || inv.status === 'divergence') && (
                        <button className="btn btn-danger btn-sm" onClick={() => void handleCancel(inv.id)}>
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

      {totalPages > 1 && (
        <div className="flex-gap mt-16" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('c.prev')}</button>
          <span style={{ fontSize: 13 }}>{t('c.page')} {page} {t('c.of')} {totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t('c.next')}</button>
        </div>
      )}

      {/* Drawer */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" style={{ width: 'min(720px, 96vw)' }} onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{t('si.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
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
                  <div className="field">
                    <label>{t('si.purchaseOrder')}</label>
                    <select value={formPO} onChange={e => setFormPO(e.target.value)}>
                      <option value="">Sem pedido de compra</option>
                      {pos.map(p => <option key={p.id} value={p.id}>#{p.number}</option>)}
                    </select>
                  </div>
                </div>

                <div className="field-row">
                  <div className="field" style={{ flex: 3 }}>
                    <label>{t('si.nfeKey')}</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input value={formNfeKey} maxLength={44}
                        onChange={e => { setFormNfeKey(e.target.value); setKeyLookupMsg(null); setKeySupplierSuggestion(null); }}
                        placeholder="44 dígitos" style={{ fontFamily: 'monospace', fontSize: 12 }} />
                      <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto', whiteSpace: 'nowrap' }}
                        disabled={formNfeKey.trim().length !== 44 || keyLookupLoading}
                        onClick={() => void handleLookupByKey()}>
                        {keyLookupLoading ? t('si.lookupLoading') : t('si.lookupButton')}
                      </button>
                    </div>
                  </div>
                  <div className="field" style={{ flex: '0 0 100px' }}>
                    <label>{t('si.nfeSeries')}</label>
                    <input value={formSeries} maxLength={5} onChange={e => setFormSeries(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>{t('si.nfeNumber')}</label>
                    <input value={formNfeNum} maxLength={20} onChange={e => setFormNfeNum(e.target.value)} />
                  </div>
                </div>

                {keyLookupMsg && (
                  <div className={`alert ${keyLookupMsg.type === 'error' ? 'alert-error' : 'alert-info'}`} style={{ marginBottom: 8 }}>
                    {keyLookupMsg.text}
                  </div>
                )}

                {keySupplierSuggestion && (
                  <div className="alert alert-info" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span>
                      {t('si.lookupSupplierNotFound')}{' '}
                      <strong>{keySupplierSuggestion.name}</strong> ({keySupplierSuggestion.cnpj})
                    </span>
                    <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                      disabled={creatingSupplier} onClick={() => void handleCreateSuggestedSupplier()}>
                      {creatingSupplier ? t('c.saving') : t('si.lookupCreateSupplier')}
                    </button>
                  </div>
                )}

                <div className="field-row">
                  <div className="field">
                    <label>{t('si.issueDate')}</label>
                    <input type="date" value={formIssue} onChange={e => setFormIssue(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>{t('si.dueDate')}</label>
                    <input type="date" value={formDue} onChange={e => setFormDue(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>{t('si.total')} *</label>
                    <input type="number" min="0" step="0.01" value={formTotal}
                      onChange={e => setFormTotal(e.target.value)} required />
                  </div>
                </div>

                {/* Items */}
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ padding: '10px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: 13 }}>Itens da NF-e</strong>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                      onClick={() => setFormItems(prev => [...prev, newItem()])}>+ Adicionar item</button>
                  </div>
                  {formItems.map((item, idx) => (
                    <div key={item._key} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input placeholder="Descrição do item" value={item.name}
                        onChange={e => setFormItems(prev => prev.map((it, i) => i === idx ? { ...it, name: e.target.value } : it))}
                        style={{ flex: '2 1 160px', fontSize: 13 }} />
                      <input type="number" min="0.001" step="0.001" placeholder="Qtd" value={item.quantity}
                        onChange={e => setFormItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))}
                        style={{ flex: '0 1 80px', fontSize: 13 }} />
                      <input type="number" min="0" step="0.01" placeholder="Preço" value={item.unit_price}
                        onChange={e => setFormItems(prev => prev.map((it, i) => i === idx ? { ...it, unit_price: e.target.value } : it))}
                        style={{ flex: '0 1 100px', fontSize: 13 }} />
                      <button type="button" onClick={() => setFormItems(prev => prev.filter((_, i) => i !== idx))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18 }}>×</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>{t('c.cancel')}</button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : t('si.new')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
