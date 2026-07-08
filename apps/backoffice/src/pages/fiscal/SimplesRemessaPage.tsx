import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { ProductPicker, type ProductPickerOption } from '../../ds/components/ProductPicker';
import type { TKey } from '../../i18n/pt-BR';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const MOTIVOS = ['conserto', 'demonstracao', 'comodato', 'industrializacao', 'amostra_gratis', 'devolucao'] as const;
type Motivo = typeof MOTIVOS[number];

interface SR {
  id: string; motivo: Motivo; cfop: string; status: string; total: string;
  nfe_chave: string | null; parent_remessa_id: string | null; client_name: string | null; created_at: string;
}
interface SRItemDetail {
  id: string; material_id: string | null; name: string; material_name: string | null;
  quantity: string; unit_price: string; total: string;
}
interface SRRetorno { id: string; status: string; total: string; created_at: string; }
interface SRDetail extends SR {
  natureza_operacao: string; notes: string | null;
  nfe_protocol: string | null; nfe_auth_date: string | null; nfe_reject_reason: string | null;
  nfe_danfe_url: string | null;
  items: SRItemDetail[]; retornos: SRRetorno[];
}
interface ClientOption { id: string; company_name: string | null; full_name: string | null; }
interface MaterialOption { id: string; sku: string; name: string; unit: string; sale_price: number | null; ncm_code: string | null; description?: string | null; type?: string | null; }
interface CompanyOption { id: string; razao_social: string; is_default: boolean; }
interface ListResp { data: SR[]; total: number; page: number; per_page: number; }

const STATUS_TABS = ['all', 'draft', 'processing', 'authorized', 'rejected', 'cancelled'] as const;
type StatusTab = typeof STATUS_TABS[number];

function statusBadge(s: string) {
  return ({
    draft: 'badge-service', pending: 'badge-service', processing: 'badge-product',
    authorized: 'badge-active', rejected: 'badge-inactive', cancelled: 'badge-inactive',
  }[s] ?? 'badge-service');
}

// Retorno só se aplica a alguns motivos — mesma tabela do domínio puro
// (simplesRemessaDomain.ts), reproduzida aqui só pra UX (habilitar/ocultar
// o botão "Registrar Retorno" sem precisar de uma chamada extra ao backend).
const MOTIVOS_COM_RETORNO = new Set<Motivo>(['conserto', 'demonstracao', 'comodato', 'industrializacao']);

function newItem() {
  return { _key: Math.random().toString(36).slice(2), material_id: '', name: '', ncm_code: '', quantity: '1', unit_price: '0' };
}

export function SimplesRemessaPage() {
  const { tenantId } = useAuth();
  const { t, lang } = useI18n();
  const modal = useModal();

  const [remessas,    setRemessas]    = useState<SR[]>([]);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(1);
  const [search,      setSearch]      = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [loading,     setLoading]     = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  const [viewingId, setViewingId]         = useState<string | null>(null);
  const [viewingDetail, setViewingDetail] = useState<SRDetail | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [formClient,   setFormClient]   = useState('');
  const [formMotivo,   setFormMotivo]   = useState<Motivo>('conserto');
  const [formCompany,  setFormCompany]  = useState('');
  const [formNotes,    setFormNotes]    = useState('');
  const [formItems,    setFormItems]    = useState([newItem()]);

  const [clients,   setClients]   = useState<ClientOption[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);

  const perPage = 20;

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), per_page: String(perPage), ...(statusFilter !== 'all' ? { status: statusFilter } : {}), ...(search ? { search } : {}) });
      const r = await api.get<ListResp>(`/v1/simples-remessas?${p}`);
      setRemessas(r.data); setTotal(r.total);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [tenantId, page, statusFilter, search]);

  useEffect(() => {
    if (!drawerOpen || !tenantId) return;
    Promise.all([
      api.get<{ data: ClientOption[] }>(`/v1/clients?per_page=200&tenant_id=${tenantId}`),
      api.get<{ data: MaterialOption[] }>(`/v1/materials?tenant_id=${tenantId}&per_page=500`),
      api.get<{ data: CompanyOption[] }>('/v1/companies').catch(() => ({ data: [] })),
    ]).then(([cl, mat, co]) => {
      setClients(cl.data ?? []);
      setMaterials(mat.data ?? []);
      setCompanies(co.data ?? []);
    }).catch(() => {});
  }, [drawerOpen, tenantId]);

  function openCreate() {
    setFormClient(''); setFormMotivo('conserto'); setFormCompany(''); setFormNotes('');
    setFormItems([newItem()]); setFormError('');
    setViewingId(null); setViewingDetail(null);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setViewingId(null); setViewingDetail(null);
  }

  async function openDetail(sr: SR) {
    setFormError(''); setViewingId(sr.id); setViewingDetail(null);
    setDrawerOpen(true);
    try {
      const detail = await api.get<SRDetail>(`/v1/simples-remessas/${sr.id}`);
      setViewingDetail(detail);
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
        return {
          ...it, material_id: val, name: mat?.name ?? it.name,
          ncm_code: mat?.ncm_code ?? it.ncm_code,
          unit_price: mat?.sale_price != null ? String(mat.sale_price) : it.unit_price,
        };
      }
      return { ...it, [field]: val };
    }));
  }

  const totalCalc = formItems.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    if (!formClient) { setFormError(t('sr.errNoClient')); return; }
    const namedItems = formItems.filter(it => it.name.trim());
    if (!namedItems.length) { setFormError(t('o.errNoItems')); return; }
    setSaving(true); setFormError('');
    try {
      await api.post('/v1/simples-remessas', {
        client_id:  formClient,
        motivo:     formMotivo,
        company_id: formCompany || undefined,
        notes:      formNotes || undefined,
        items: namedItems.map(it => ({
          material_id: it.material_id || undefined, name: it.name,
          ncm_code: it.ncm_code || undefined,
          quantity: Number(it.quantity), unit_price: Number(it.unit_price),
        })),
      });
      closeDrawer(); void load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : t('sr.errSave')); }
    finally { setSaving(false); }
  }

  async function handleEmit(id: string) {
    const ok = await modal.confirm({ title: t('sr.emit'), message: t('sr.emitConfirm'), confirmLabel: t('sr.emit') });
    if (!ok) return;
    setActionLoading(true);
    try {
      const result = await api.post<{ message: string }>(`/v1/simples-remessas/${id}/emit`, {});
      modal.success(result.message);
      void load();
      if (viewingId === id) { const detail = await api.get<SRDetail>(`/v1/simples-remessas/${id}`); setViewingDetail(detail); }
    } catch (err: unknown) { modal.error(err); }
    finally { setActionLoading(false); }
  }

  async function handleRetorno() {
    if (!viewingDetail) return;
    const ok = await modal.confirm({
      title: t('sr.registerRetorno'),
      message: t('sr.retornoConfirm'),
      confirmLabel: t('sr.registerRetorno'),
    });
    if (!ok) return;
    setActionLoading(true);
    try {
      const retorno = await api.post<{ id: string }>(`/v1/simples-remessas/${viewingDetail.id}/retorno`, {});
      modal.success(t('sr.retornoCreated'));
      void load();
      await openDetail({ id: retorno.id } as SR);
    } catch (err: unknown) { modal.error(err); }
    finally { setActionLoading(false); }
  }

  const totalPages = Math.ceil(total / perPage);
  const motivoHelp = (m: Motivo) => t(`sr.motivo.${m}.help` as TKey);

  return (
    <div>
      <div className="page-header">
        <h1>{t('sr.title')}</h1>
        <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
          + {t('sr.new')}
        </button>
      </div>

      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: -8, marginBottom: 16, maxWidth: 640 }}>
        {t('sr.pageHint')}
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {STATUS_TABS.map(s => (
          <button key={s} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto' }} onClick={() => { setStatusFilter(s); setPage(1); }}>
            {s === 'all' ? t('o.all') : t(`sr.status.${s}` as TKey)}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <input placeholder={t('sr.search')} value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 360 }} />
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : remessas.length === 0 ? (
          <div className="empty-state">
            {t('sr.empty')}{' '}
            <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('sr.new')}</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('sr.motivo')}</th>
                <th>{t('sr.client')}</th>
                <th style={{ width: 80 }}>{t('sr.cfop')}</th>
                <th className="text-right" style={{ width: 120 }}>{t('si.total')}</th>
                <th style={{ width: 110 }}>{t('si.status')}</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {remessas.map(sr => (
                <tr key={sr.id} onClick={() => void openDetail(sr)} style={{ cursor: 'pointer' }}>
                  <td>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>
                      {t(`sr.motivo.${sr.motivo}` as TKey)}
                      {sr.parent_remessa_id && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)' }}>({t('sr.isRetorno')})</span>}
                    </div>
                    {sr.nfe_chave && <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{sr.nfe_chave.slice(0, 22)}…</div>}
                  </td>
                  <td style={{ fontSize: 13 }}>{sr.client_name ?? '—'}</td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--muted)' }}>{sr.cfop}</td>
                  <td className="text-right" style={{ fontWeight: 500 }}>{BRL.format(Number(sr.total))}</td>
                  <td>
                    <span className={`badge ${statusBadge(sr.status)}`}>{t(`sr.status.${sr.status}` as TKey)}</span>
                  </td>
                  <td>
                    {sr.status === 'draft' && (
                      <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                        onClick={e => { e.stopPropagation(); void handleEmit(sr.id); }}>
                        {t('sr.emit')}
                      </button>
                    )}
                    {sr.status === 'rejected' && (
                      <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                        onClick={e => { e.stopPropagation(); void handleEmit(sr.id); }}>
                        {t('sr.retry')}
                      </button>
                    )}
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
        <div className="overlay" onClick={closeDrawer}>
          <div className="drawer" style={{ width: 'min(720px, 96vw)' }} onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{viewingId ? t('sr.detailTitle') : t('sr.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={closeDrawer}>✕</button>
            </div>

            {viewingId ? (
              <div style={{ display: 'contents' }}>
                <div className="drawer-body">
                  {!viewingDetail ? (
                    <div className="spinner">{t('c.loading')}</div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span className={`badge ${statusBadge(viewingDetail.status)}`}>{t(`sr.status.${viewingDetail.status}` as TKey)}</span>
                        <strong style={{ fontSize: 14 }}>{t(`sr.motivo.${viewingDetail.motivo}` as TKey)}</strong>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>{motivoHelp(viewingDetail.motivo)}</p>

                      {viewingDetail.parent_remessa_id && (
                        <div className="alert alert-info" style={{ marginBottom: 12, fontSize: 12 }}>{t('sr.isRetornoOf')}</div>
                      )}

                      <div className="field-row">
                        <div className="field"><label>{t('sr.client')}</label><div>{viewingDetail.client_name ?? '—'}</div></div>
                        <div className="field"><label>{t('sr.cfop')}</label><div style={{ fontFamily: 'monospace' }}>{viewingDetail.cfop} — {viewingDetail.natureza_operacao}</div></div>
                      </div>
                      <div className="field-row">
                        <div className="field"><label>{t('si.total')}</label><div><strong>{BRL.format(Number(viewingDetail.total))}</strong></div></div>
                        {viewingDetail.nfe_chave && (
                          <div className="field"><label>{t('si.nfeKey')}</label><div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{viewingDetail.nfe_chave}</div></div>
                        )}
                      </div>

                      {viewingDetail.status === 'processing' && (
                        <div className="alert alert-info" style={{ marginBottom: 16 }}>{t('sr.processingHint')}</div>
                      )}
                      {viewingDetail.status === 'rejected' && viewingDetail.nfe_reject_reason && (
                        <div className="alert alert-error" style={{ marginBottom: 16 }}>
                          <strong>{t('nfe.rejectReason')}:</strong> {viewingDetail.nfe_reject_reason}
                        </div>
                      )}

                      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
                        <div style={{ padding: '10px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                          <strong style={{ fontSize: 13 }}>{t('so.items')}</strong>
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

                      {viewingDetail.status === 'authorized' && (
                        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                          <strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>{t('sr.followUpTitle')}</strong>
                          <div className="flex-gap" style={{ flexWrap: 'wrap' }}>
                            {viewingDetail.nfe_danfe_url && (
                              <a href={viewingDetail.nfe_danfe_url} target="_blank" rel="noopener noreferrer"
                                className="btn btn-secondary btn-sm" style={{ width: 'auto' }}>
                                {t('nfe.danfe')}
                              </a>
                            )}
                            {!viewingDetail.parent_remessa_id && MOTIVOS_COM_RETORNO.has(viewingDetail.motivo) && (
                              <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                                disabled={actionLoading} onClick={() => void handleRetorno()}>
                                {actionLoading ? t('c.saving') : t('sr.registerRetorno')}
                              </button>
                            )}
                          </div>
                          {viewingDetail.retornos.length > 0 && (
                            <div style={{ marginTop: 12, fontSize: 12 }}>
                              <strong>{t('sr.retornosTitle')}</strong>
                              <ul style={{ marginTop: 6 }}>
                                {viewingDetail.retornos.map(r => (
                                  <li key={r.id}>
                                    {new Date(r.created_at).toLocaleDateString(lang)} — {BRL.format(Number(r.total))}
                                    {' '}<span className={`badge ${statusBadge(r.status)}`}>{t(`sr.status.${r.status}` as TKey)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {viewingDetail.status === 'draft' && (
                        <button type="button" className="btn btn-primary" style={{ width: 'auto' }}
                          disabled={actionLoading} onClick={() => void handleEmit(viewingDetail.id)}>
                          {actionLoading ? t('c.saving') : t('sr.emit')}
                        </button>
                      )}
                      {viewingDetail.status === 'rejected' && (
                        <button type="button" className="btn btn-secondary" style={{ width: 'auto' }}
                          disabled={actionLoading} onClick={() => void handleEmit(viewingDetail.id)}>
                          {actionLoading ? t('c.saving') : t('sr.retry')}
                        </button>
                      )}
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

                  <div className="field">
                    <label>{t('sr.motivo')} *</label>
                    <select value={formMotivo} onChange={e => setFormMotivo(e.target.value as Motivo)}>
                      {MOTIVOS.map(m => <option key={m} value={m}>{t(`sr.motivo.${m}` as TKey)}</option>)}
                    </select>
                    <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{motivoHelp(formMotivo)}</p>
                  </div>

                  <div className="field-row">
                    <div className="field">
                      <label>{t('sr.client')} *</label>
                      <select value={formClient} onChange={e => setFormClient(e.target.value)} required>
                        <option value="">{t('sr.selectClient')}</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.company_name ?? c.full_name}</option>)}
                      </select>
                    </div>
                    {companies.length > 1 && (
                      <div className="field">
                        <label>{t('comp.companies.emittingCompany')}</label>
                        <select value={formCompany} onChange={e => setFormCompany(e.target.value)}>
                          <option value="">{t('comp.companies.default')}</option>
                          {companies.map(c => <option key={c.id} value={c.id}>{c.razao_social}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="field">
                    <label>{t('sr.notes')}</label>
                    <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2} />
                  </div>

                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ padding: '10px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: 13 }}>{t('so.items')}</strong>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                        onClick={() => setFormItems(prev => [...prev, newItem()])}>+ {t('so.addItem')}</button>
                    </div>
                    {formItems.map((item, idx) => (
                      <div key={item._key} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ flex: '2 1 200px' }}>
                          <ProductPicker options={materials.map((m): ProductPickerOption => ({ id: m.id, sku: m.sku, name: m.name, description: m.description, type: m.type }))}
                            value={item.material_id}
                            onChange={id => updateItem(idx, 'material_id', id)}
                            placeholder={t('o.selectMat')} emptyLabel={t('o.noMatch')} ariaLabel={t('o.material')} />
                          {!item.material_id && (
                            <input placeholder={t('so.itemDesc')} value={item.name}
                              onChange={e => updateItem(idx, 'name', e.target.value)}
                              style={{ marginTop: 4, fontSize: 12 }} />
                          )}
                        </div>
                        <input placeholder="NCM" value={item.ncm_code}
                          onChange={e => updateItem(idx, 'ncm_code', e.target.value)}
                          style={{ flex: '0 1 90px', fontSize: 12, fontFamily: 'monospace' }} />
                        <input type="number" min="0.001" step="0.001" placeholder="Qtd" value={item.quantity}
                          onChange={e => updateItem(idx, 'quantity', e.target.value)}
                          style={{ flex: '0 1 80px', fontSize: 13 }} />
                        <input type="number" min="0" step="0.01" placeholder="Valor" value={item.unit_price}
                          onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                          style={{ flex: '0 1 100px', fontSize: 13 }} />
                        <button type="button" onClick={() => setFormItems(prev => prev.filter((_, i) => i !== idx))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18 }}>×</button>
                      </div>
                    ))}
                  </div>

                  <div className="card" style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span>{t('si.total')}</span>
                      <span style={{ color: 'var(--primary)' }}>{BRL.format(totalCalc)}</span>
                    </div>
                  </div>
                </div>

                <div className="drawer-footer">
                  <button type="button" className="btn btn-secondary" onClick={closeDrawer}>{t('c.cancel')}</button>
                  <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                    {saving ? t('c.saving') : t('sr.new')}
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
