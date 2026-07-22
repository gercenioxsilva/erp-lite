import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { StatusPill, Drawer, Timeline } from '../../ds';
import { Can }      from '../../rbac';
import type { FiscalStatus } from '../../ds';
import type { TKey } from '../../i18n/pt-BR';

function exportToXlsx(rows: any[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dados');
  XLSX.writeFile(wb, filename);
}

/* ── Types ─────────────────────────────────────────────────────────────── */
interface Invoice {
  id: string; number: string; serie: string; status: string;
  client_name: string; order_id: string | null; order_number: string | null;
  subtotal: number; tax_total: number; total: number; notes: string | null;
  issue_date: string | null; created_at: string;
  nfe_status: string | null;
  nfe_chave: string | null;
  nfe_reject_reason: string | null;
}

interface NfeStatusDetail {
  nfe_status: string | null;
  nfe_chave: string | null;
  nfe_protocol: string | null;
  nfe_auth_date: string | null;
  nfe_reject_reason: string | null;
  nfe_attempts: number;
  nfe_danfe_url: string | null;
}

interface NfeEvent {
  event_type: string;
  status_code: string | null;
  protocol: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}
interface CceItem {
  id: string; sequencia: number; correction_text: string; status: string;
  protocol: string | null; reject_reason: string | null; created_at: string;
}
interface ClientOption   { id: string; company_name: string | null; full_name: string | null; }

interface ListResp { data: Invoice[]; total: number; page: number; per_page: number; }

/* ── Helpers ────────────────────────────────────────────────────────────── */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_TABS = ['all', 'draft', 'issued', 'cancelled'] as const;
type StatusTab = typeof STATUS_TABS[number];

function statusBadge(s: string) {
  return ({ draft: 'badge-service', issued: 'badge-active', cancelled: 'badge-inactive' }[s] ?? 'badge-service');
}

// Focus returns caminho_danfe as a relative path (/arquivos_development/... or /arquivos/...).
// Records saved before the lambda fix may still have the relative form — resolve here.
function toDanfeAbsoluteUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  const base = url.includes('_development') || url.startsWith('/demo')
    ? 'https://homologacao.focusnfe.com.br'
    : 'https://api.focusnfe.com.br';
  return base + url;
}
/* ── Component ──────────────────────────────────────────────────────────── */
export function InvoicesPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();
  const navigate = useNavigate();

  /* list */
  const [invoices,     setInvoices]     = useState<Invoice[]>([]);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [nfeStatusF,   setNfeStatusF]   = useState('');
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');
  const [clientF,      setClientF]      = useState('');
  const [valueMin,     setValueMin]     = useState('');
  const [valueMax,     setValueMax]     = useState('');
  const [loading,      setLoading]      = useState(true);
  const [nfeAmbiente,  setNfeAmbiente]  = useState<number | null>(null);
  const [clients,      setClients]      = useState<ClientOption[]>([]);
  const [costCenterFilter, setCostCenterFilter] = useState('');
  const [costCenters, setCostCenters] = useState<{ id: string; code: string; name: string }[]>([]);

  /* NF-e status panel */
  const pollRef                           = useRef<ReturnType<typeof setInterval> | null>(null);
  const [nfePanelOpen,  setNfePanelOpen] = useState(false);
  const [nfePanelInv,   setNfePanelInv] = useState<Invoice | null>(null);
  const [nfeDetail,     setNfeDetail]   = useState<NfeStatusDetail | null>(null);
  const [nfeEvents,     setNfeEvents]   = useState<NfeEvent[]>([]);
  const [nfeLoading,    setNfeLoading]  = useState(false);
  const [nfeEmitting,   setNfeEmitting] = useState(false);
  const [nfeError,      setNfeError]    = useState('');

  /* Cancelamento junto à SEFAZ (regra 0089) — só quando nfe_status='authorized' */
  const [showCancelForm,      setShowCancelForm]      = useState(false);
  const [cancelJustificativa, setCancelJustificativa] = useState('');
  const [cancelSaving,        setCancelSaving]        = useState(false);
  const [cancelError,         setCancelError]         = useState('');

  /* Carta de Correção Eletrônica (regra 0089) */
  const [cceList,     setCceList]     = useState<CceItem[]>([]);
  const [showCceForm, setShowCceForm] = useState(false);
  const [cceText,     setCceText]     = useState('');
  const [cceSaving,   setCceSaving]   = useState(false);
  const [cceError,    setCceError]    = useState('');

  const perPage = 20;

  /* ── Load list ── */
  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        tenant_id: tenantId, page: String(page), per_page: String(perPage),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(search     ? { search }                  : {}),
        ...(nfeStatusF ? { nfe_status: nfeStatusF }  : {}),
        ...(clientF    ? { client_id: clientF }      : {}),
        ...(dateFrom   ? { issue_date_from: dateFrom } : {}),
        ...(dateTo     ? { issue_date_to: dateTo }   : {}),
        ...(valueMin   ? { total_min: valueMin }     : {}),
        ...(valueMax   ? { total_max: valueMax }     : {}),
        ...(costCenterFilter ? { cost_center_id: costCenterFilter } : {}),
      });
      const r = await api.get<ListResp>(`/v1/invoices?${p}`);
      setInvoices(r.data); setTotal(r.total);
    } catch { /**/ } finally { setLoading(false); }
  }
  useEffect(() => { void load(); },
    [tenantId, page, statusFilter, search, nfeStatusF, clientF, dateFrom, dateTo, valueMin, valueMax, costCenterFilter]);

  /* ── Load clients (filtro) + ambiente NF-e (badge/trava) + cost centers por tenant ── */
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    api.get<{ data: ClientOption[] }>(`/v1/clients?tenant_id=${tenantId}&per_page=100`)
      .then(r => { if (!cancelled) setClients(r.data ?? []); })
      .catch(() => { /* filtro de cliente fica vazio se falhar */ });
    api.get<{ focus_ambiente: number }>(`/v1/nfe-config?tenant_id=${tenantId}`)
      .then(c => { if (!cancelled) setNfeAmbiente(c.focus_ambiente ?? null); })
      .catch(() => { if (!cancelled) setNfeAmbiente(null); /* NF-e não configurada */ });
    api.get<{ data: { id: string; code: string; name: string }[] }>(`/v1/cost-centers/active?tenant_id=${tenantId}`)
      .then(d => { if (!cancelled) setCostCenters(d.data ?? []); })
      .catch(() => { /* filtro de CC fica vazio se falhar */ });
    return () => { cancelled = true; };
  }, [tenantId]);

  /* ── NF-e panel ── */
  function stopNfePoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  // Cleanup on unmount
  useEffect(() => () => { stopNfePoll(); }, []);

  async function loadNfeData(invoiceId: string): Promise<NfeStatusDetail> {
    const [detail, evts] = await Promise.all([
      api.get<NfeStatusDetail>(`/v1/invoices/${invoiceId}/nfe`),
      api.get<NfeEvent[]>(`/v1/invoices/${invoiceId}/nfe-events`),
    ]);
    setNfeDetail(detail);
    setNfeEvents(evts);
    return detail;
  }

  function startNfePoll(invoiceId: string) {
    stopNfePoll();
    pollRef.current = setInterval(async () => {
      try {
        const detail = await api.get<NfeStatusDetail>(`/v1/invoices/${invoiceId}/nfe`);
        setNfeDetail(detail);
        if (detail.nfe_status !== 'pending' && detail.nfe_status !== 'processing') {
          stopNfePoll();
          const evts = await api.get<NfeEvent[]>(`/v1/invoices/${invoiceId}/nfe-events`);
          setNfeEvents(evts);
          void load();
        }
      } catch { stopNfePoll(); }
    }, 3000);
  }

  async function loadCceList(invoiceId: string) {
    try {
      const r = await api.get<{ data: CceItem[] }>(`/v1/invoices/${invoiceId}/cce`);
      setCceList(r.data);
    } catch { setCceList([]); }
  }

  function openNfePanel(inv: Invoice) {
    stopNfePoll();
    setNfePanelInv(inv);
    setNfePanelOpen(true);
    setNfeDetail(null);
    setNfeEvents([]);
    setNfeError('');
    setCceList([]);
    setShowCancelForm(false); setCancelJustificativa(''); setCancelError('');
    setShowCceForm(false); setCceText(''); setCceError('');
    setNfeLoading(true);
    loadNfeData(inv.id)
      .then(detail => {
        if (detail.nfe_status === 'pending' || detail.nfe_status === 'processing') {
          startNfePoll(inv.id);
        }
        if (detail.nfe_status === 'authorized') {
          void loadCceList(inv.id);
        }
      })
      .catch(() => {})
      .finally(() => setNfeLoading(false));
  }

  function closeNfePanel() {
    stopNfePoll();
    setNfePanelOpen(false);
    setNfePanelInv(null);
    setNfeDetail(null);
    setNfeEvents([]);
    setNfeError('');
    setCceList([]);
    setShowCancelForm(false); setCancelJustificativa(''); setCancelError('');
    setShowCceForm(false); setCceText(''); setCceError('');
  }

  /* ── Cancelamento junto à SEFAZ (regra 0089) ─────────────────────────── */
  async function submitCancelSefaz() {
    if (!nfePanelInv) return;
    if (cancelJustificativa.trim().length < 15) { setCancelError(t('nfe.cancelJustificativaTooShort')); return; }
    setCancelSaving(true); setCancelError('');
    try {
      await api.post(`/v1/invoices/${nfePanelInv.id}/cancel`, { justificativa: cancelJustificativa.trim() });
      closeNfePanel();
      void load();
    } catch (err: unknown) {
      setCancelError(err instanceof Error ? err.message : t('nfe.cancelSefazErr'));
    } finally { setCancelSaving(false); }
  }

  /* ── Carta de Correção Eletrônica (regra 0089) ───────────────────────── */
  async function submitCce() {
    if (!nfePanelInv) return;
    if (cceText.trim().length < 15) { setCceError(t('nfe.cceTextTooShort')); return; }
    setCceSaving(true); setCceError('');
    try {
      await api.post(`/v1/invoices/${nfePanelInv.id}/cce`, { correction_text: cceText.trim() });
      setCceText(''); setShowCceForm(false);
      await loadCceList(nfePanelInv.id);
    } catch (err: unknown) {
      setCceError(err instanceof Error ? err.message : t('nfe.cceErr'));
    } finally { setCceSaving(false); }
  }

  async function emitNfe(invoiceId: string) {
    // Trava: emitir em produção tem valor fiscal real — pede confirmação explícita
    if (nfeAmbiente === 1) {
      const ok = await modal.confirm({
        title: t('nfe.prodConfirmTitle'), message: t('nfe.prodConfirmMsg'),
        confirmLabel: t('nfe.prodConfirmBtn'), danger: true,
      });
      if (!ok) return;
    }
    setNfeEmitting(true);
    setNfeError('');
    try {
      await api.post(`/v1/invoices/${invoiceId}/emit?tenant_id=${tenantId}`, {});
      const detail = await api.get<NfeStatusDetail>(`/v1/invoices/${invoiceId}/nfe`);
      setNfeDetail(detail);
      startNfePoll(invoiceId);
    } catch (err: unknown) {
      setNfeError(err instanceof Error ? err.message : t('nfe.errEmit'));
    } finally { setNfeEmitting(false); }
  }

  /* ── Cancel ── */
  // Nota autorizada exige justificativa (SEFAZ) — abre o painel de NF-e com
  // o formulário pronto em vez do confirm genérico (que não tem campo de
  // texto). Nota nunca autorizada continua no fluxo simples de sempre.
  async function handleCancel(inv: Invoice) {
    if (inv.nfe_status === 'authorized') {
      openNfePanel(inv);
      setShowCancelForm(true);
      return;
    }
    const ok = await modal.confirm({
      title: t('inv.cancel'), message: t('inv.cancelMsg'),
      confirmLabel: t('inv.cancel'), danger: true,
    });
    if (!ok) return;
    try { await api.post(`/v1/invoices/${inv.id}/cancel`, {}); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1>{t('inv.title')}</h1>
          {nfeAmbiente === 1 && <span className="env-badge env-badge--prod">{t('nfe.envBadge.prod')}</span>}
          {nfeAmbiente === 2 && <span className="env-badge env-badge--homo">{t('nfe.envBadge.homo')}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => exportToXlsx(
            invoices.map(i => ({ number: i.number, client_name: i.client_name, total: i.total, issue_date: i.issue_date, status: i.status, nfe_status: i.nfe_status })),
            `notas-fiscais-${new Date().toISOString().slice(0,10)}.xlsx`
          )}>↓ Exportar</button>
          <Can permission="invoices:create">
            <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={() => navigate('/invoices/new')}>
              + {t('inv.new')}
            </button>
          </Can>
        </div>
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

      {/* ── Filtros ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder={t('inv.searchPH')}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ width: 240 }}
        />
        <select value={nfeStatusF} onChange={e => { setNfeStatusF(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
          <option value="">{t('flt.allNfe')}</option>
          <option value="none">{t('flt.noSefaz')}</option>
          <option value="pending">{t('flt.nfe.pending')}</option>
          <option value="processing">{t('flt.nfe.processing')}</option>
          <option value="authorized">{t('flt.nfe.authorized')}</option>
          <option value="rejected">{t('flt.nfe.rejected')}</option>
        </select>
        <select value={clientF} onChange={e => { setClientF(e.target.value); setPage(1); }} style={{ width: 'auto', maxWidth: 220 }}>
          <option value="">{t('flt.allClients')}</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.company_name ?? c.full_name ?? '—'}</option>
          ))}
        </select>
        <input type="date" title={t('flt.from')} value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setPage(1); }} style={{ width: 'auto' }} />
        <input type="date" title={t('flt.to')} value={dateTo}
          onChange={e => { setDateTo(e.target.value); setPage(1); }} style={{ width: 'auto' }} />
        <input type="number" inputMode="decimal" placeholder={t('flt.min')} value={valueMin}
          onChange={e => { setValueMin(e.target.value); setPage(1); }} style={{ width: 110 }} />
        <input type="number" inputMode="decimal" placeholder={t('flt.max')} value={valueMax}
          onChange={e => { setValueMax(e.target.value); setPage(1); }} style={{ width: 110 }} />
        <select className="btn btn-secondary" value={costCenterFilter}
          onChange={e => { setCostCenterFilter(e.target.value); setPage(1); }}>
          <option value="">{t('cc.costCenter')}: {t('cc.none')}</option>
          {costCenters.map(c => (
            <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
          ))}
        </select>
        {(search || nfeStatusF || clientF || dateFrom || dateTo || valueMin || valueMax || costCenterFilter) && (
          <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
            onClick={() => { setSearch(''); setNfeStatusF(''); setClientF(''); setDateFrom(''); setDateTo(''); setValueMin(''); setValueMax(''); setCostCenterFilter(''); setPage(1); }}>
            {t('flt.clear')}
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : invoices.length === 0 ? (
          <div className="empty-state">
            {t('inv.empty')}{' '}
            <Can permission="invoices:create">
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/invoices/new')}>{t('inv.new')}</button>
            </Can>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 100 }}>{t('inv.number')}</th>
                <th style={{ width: 80 }}>{t('inv.order')}</th>
                <th>{t('inv.client')}</th>
                <th style={{ width: 90 }}>{t('inv.status')}</th>
                <th style={{ width: 120 }}>{t('nfe.col')}</th>
                <th className="text-right" style={{ width: 110 }}>{t('inv.total')}</th>
                <th style={{ width: 100 }}>{t('inv.issueDate')}</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} onClick={() => openNfePanel(inv)} style={{ cursor: 'pointer' }}>
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
                  <td>
                    {inv.nfe_status ? (
                      <StatusPill
                        status={inv.nfe_status as FiscalStatus}
                        onClick={() => openNfePanel(inv)}
                        title={inv.nfe_reject_reason ?? undefined}
                      />
                    ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                  </td>
                  <td className="text-right">{BRL.format(Number(inv.total))}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {inv.issue_date ? new Date(inv.issue_date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex-gap">
                      {/* Único caminho de emissão: o painel de NF-e, que fala
                          de verdade com o SEFAZ (regra 61) — o antigo botão
                          de linha ("Emitir NF-e" → POST /invoices/:id/issue)
                          nunca chamava o SEFAZ, só marcava local como
                          emitido, e coexistir com este aqui confundia qual
                          dos dois era o real. */}
                      <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                        onClick={() => openNfePanel(inv)}>
                        {t('nfe.viewPanel')}
                      </button>
                      {inv.status !== 'cancelled' && (
                        <Can permission="invoices:cancel">
                          <button className="btn btn-danger btn-sm" onClick={() => handleCancel(inv)}>
                            {t('inv.cancel')}
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

      {/* ── NF-e Status Panel ─────────────────────────────────────────────── */}
      <Drawer
        open={nfePanelOpen && !!nfePanelInv}
        onClose={closeNfePanel}
        title={t('nfe.panelTitle')}
        subTitle={nfePanelInv ? `${nfePanelInv.client_name} · NF-e ${nfePanelInv.serie}/${nfePanelInv.number || t('nfe.pending')}` : ''}
      >
        <Drawer.Body>
          {nfeError && <div role="alert" className="alert alert-error" style={{ marginBottom: 14 }}>{nfeError}</div>}
          {nfeLoading ? (
            <div className="spinner">{t('c.loading')}</div>
          ) : nfePanelInv && (
            <>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ padding: '14px 16px', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  {nfeDetail?.nfe_status && <StatusPill status={nfeDetail.nfe_status as FiscalStatus} />}
                  <div style={{ flex: 1, fontSize: 13, color: 'var(--muted)' }}>
                    {nfeDetail?.nfe_attempts != null && nfeDetail.nfe_attempts > 0
                      ? `${nfeDetail.nfe_attempts} ${t('nfe.attempts')}` : t('nfe.notEmitted')}
                  </div>
                  {!nfeDetail?.nfe_status && nfePanelInv.status === 'draft' && (
                    <Can permission="invoices:emit">
                      <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                        disabled={nfeEmitting} onClick={() => void emitNfe(nfePanelInv.id)}>
                        {nfeEmitting ? t('c.saving') : t('nfe.emitSefaz')}
                      </button>
                    </Can>
                  )}
                  {nfeDetail?.nfe_status === 'rejected' && (
                    <Can permission="invoices:emit">
                      <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                        disabled={nfeEmitting} onClick={() => void emitNfe(nfePanelInv.id)}>
                        {nfeEmitting ? t('c.saving') : t('nfe.retry')}
                      </button>
                    </Can>
                  )}
                </div>
                {nfeDetail && (
                  <div style={{ padding: '12px 16px' }}>
                    {nfeDetail.nfe_status === 'rejected' && nfeDetail.nfe_reject_reason && (
                      <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#991b1b', lineHeight: 1.6 }}>
                        <strong style={{ display: 'block', marginBottom: 4 }}>{t('nfe.rejectReason')}:</strong>
                        {nfeDetail.nfe_reject_reason}
                      </div>
                    )}
                    {nfeDetail.nfe_status === 'authorized' && (
                      <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                        {nfeDetail.nfe_chave && (
                          <div>
                            <span style={{ color: 'var(--muted)', fontSize: 11 }}>{t('nfe.key')}</span>
                            <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', marginTop: 2 }}>{nfeDetail.nfe_chave}</div>
                          </div>
                        )}
                        {nfeDetail.nfe_protocol && (
                          <div style={{ display: 'flex', gap: 20 }}>
                            <div>
                              <span style={{ color: 'var(--muted)', fontSize: 11 }}>{t('nfe.protocol')}</span>
                              <div style={{ fontFamily: 'monospace' }}>{nfeDetail.nfe_protocol}</div>
                            </div>
                            {nfeDetail.nfe_auth_date && (
                              <div>
                                <span style={{ color: 'var(--muted)', fontSize: 11 }}>{t('nfe.authDate')}</span>
                                <div>{new Date(nfeDetail.nfe_auth_date).toLocaleString('pt-BR')}</div>
                              </div>
                            )}
                          </div>
                        )}
                        {nfeDetail.nfe_danfe_url && (
                          <a href={toDanfeAbsoluteUrl(nfeDetail.nfe_danfe_url) ?? '#'} target="_blank" rel="noopener noreferrer"
                            className="btn btn-secondary btn-sm" style={{ width: 'auto', display: 'inline-flex' }}>
                            {t('nfe.danfe')}
                          </a>
                        )}
                        <div className="flex-gap" style={{ marginTop: 4 }}>
                          <Can permission="invoices:cancel">
                            <button className="btn btn-danger btn-sm" style={{ width: 'auto' }}
                              onClick={() => setShowCancelForm(v => !v)}>
                              {t('nfe.cancelSefaz')}
                            </button>
                          </Can>
                          <Can permission="invoices:correct">
                            <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                              onClick={() => setShowCceForm(v => !v)}>
                              {t('nfe.cceNew')}
                            </button>
                          </Can>
                        </div>

                        {showCancelForm && (
                          <div className="card" style={{ padding: 12, background: '#fff5f5', border: '1px solid #fecaca' }}>
                            {cancelError && <div role="alert" className="alert alert-error" style={{ marginBottom: 10 }}>{cancelError}</div>}
                            <div className="field">
                              <label>{t('nfe.cancelJustificativa')} *</label>
                              <textarea rows={3} value={cancelJustificativa}
                                onChange={e => setCancelJustificativa(e.target.value)}
                                placeholder={t('nfe.cancelJustificativaPH')} />
                            </div>
                            <div className="flex-gap">
                              <button className="btn btn-danger btn-sm" style={{ width: 'auto' }}
                                disabled={cancelSaving} onClick={() => void submitCancelSefaz()}>
                                {cancelSaving ? t('c.saving') : t('nfe.cancelSefazConfirm')}
                              </button>
                              <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                                onClick={() => setShowCancelForm(false)}>
                                {t('c.cancel')}
                              </button>
                            </div>
                          </div>
                        )}

                        {(showCceForm || cceList.length > 0) && (
                          <div className="card" style={{ padding: 12 }}>
                            {cceList.length > 0 && (
                              <table style={{ marginBottom: showCceForm ? 12 : 0 }}>
                                <thead>
                                  <tr>
                                    <th>{t('nfe.cceSeq')}</th>
                                    <th>{t('nfe.cceStatus')}</th>
                                    <th>{t('nfe.cceText')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {cceList.map(c => (
                                    <tr key={c.id}>
                                      <td>{c.sequencia}</td>
                                      <td>
                                        <span className={`badge ${c.status === 'registered' ? 'badge-active' : c.status === 'rejected' ? 'badge-inactive' : 'badge-service'}`}>
                                          {t(`nfe.cceStatus.${c.status}` as TKey)}
                                        </span>
                                      </td>
                                      <td style={{ fontSize: 12, maxWidth: 260 }}>{c.correction_text}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {showCceForm && (
                              <>
                                {cceError && <div role="alert" className="alert alert-error" style={{ marginBottom: 10 }}>{cceError}</div>}
                                <div className="field">
                                  <label>{t('nfe.cceTextLabel')} *</label>
                                  <textarea rows={3} value={cceText}
                                    onChange={e => setCceText(e.target.value)}
                                    placeholder={t('nfe.cceTextPH')} />
                                </div>
                                <div className="flex-gap">
                                  <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                                    disabled={cceSaving} onClick={() => void submitCce()}>
                                    {cceSaving ? t('c.saving') : t('nfe.cceSubmit')}
                                  </button>
                                  <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                                    onClick={() => setShowCceForm(false)}>
                                    {t('c.cancel')}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {nfeEvents.length > 0 && (
                <>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', margin: '0 0 12px' }}>
                    {t('nfe.events')}
                  </p>
                  <Timeline events={nfeEvents} />
                </>
              )}
            </>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <button className="btn btn-secondary" onClick={closeNfePanel}>{t('c.close')}</button>
        </Drawer.Footer>
      </Drawer>
    </div>
  );
}
