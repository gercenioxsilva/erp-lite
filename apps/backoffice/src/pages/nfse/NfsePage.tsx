import { useEffect, useState } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { KPICard, StatusPill, Drawer, Timeline } from '../../ds';
import type { FiscalStatus } from '../../ds';
import type { TKey } from '../../i18n/pt-BR';

/* ── Types ─────────────────────────────────────────────────────────────── */
interface Nfse {
  id:                 string;
  client_name:        string | null;
  description:        string;
  amount:             string;
  iss_rate:           string;
  iss_value:          string;
  service_code:       string;
  nfse_status:        string | null;
  nfse_number:        string | null;
  nfse_verify_code:   string | null;
  nfse_protocol:      string | null;
  nfse_auth_date:     string | null;
  nfse_reject_reason: string | null;
  nfse_pdf_url:       string | null;
  nfse_attempts:      number;
  period_start:       string | null;
  period_end:         string | null;
  created_at:         string;
}

interface NfseEvent {
  event_type:  string;
  status_code: string | null;
  protocol:    string | null;
  payload:     Record<string, unknown> | null;
  created_at:  string;
}

interface NfseDetail extends Nfse {
  events: NfseEvent[];
}

interface ListResp { data: Nfse[]; total: number; page: number; per_page: number; }

const STATUSES = ['pending', 'processing', 'authorized', 'rejected'] as const;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtDate(d: string | null) {
  if (!d) return '—';
  const [y, m, dd] = d.slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}

function fmtDateTime(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR');
}

export function NfsePage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();

  const [items,   setItems]   = useState<Nfse[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [search,  setSearch]  = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail,     setDetail]     = useState<NfseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reemitting, setReemitting] = useState(false);

  const perPage = 20;
  const totalPages = Math.ceil(total / perPage);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        tenant_id: tenantId, page: String(page), per_page: String(perPage),
        ...(filterStatus ? { status: filterStatus } : {}),
      });
      const resp = await api.get<ListResp>(`/v1/nfse?${p}`);
      const rows = search
        ? resp.data.filter(n =>
            (n.client_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
            n.description.toLowerCase().includes(search.toLowerCase()))
        : resp.data;
      setItems(rows);
      setTotal(resp.total);
    } catch { /**/ } finally { setLoading(false); }
  }

  async function loadDetail(id: string) {
    if (!tenantId) return;
    setDetailLoading(true);
    try {
      const data = await api.get<NfseDetail>(`/v1/nfse/${id}?tenant_id=${tenantId}`);
      setDetail(data);
    } catch { setDetail(null); } finally { setDetailLoading(false); }
  }

  useEffect(() => { void load(); }, [tenantId, page, search, filterStatus]);

  // Poll list while any row is pending/processing
  useEffect(() => {
    if (!items.some(n => ['pending', 'processing'].includes(n.nfse_status ?? ''))) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Poll the open drawer detail while pending/processing
  useEffect(() => {
    if (!drawerOpen || !detail) return;
    if (!['pending', 'processing'].includes(detail.nfse_status ?? '')) return;
    let cancelled = false;
    const timer = setInterval(() => { if (!cancelled) void loadDetail(detail.id); }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen, detail?.id, detail?.nfse_status]);

  function openDetail(n: Nfse) {
    setDrawerOpen(true);
    void loadDetail(n.id);
  }

  async function handleReemit() {
    if (!detail || !tenantId) return;
    setReemitting(true);
    try {
      await api.post(`/v1/nfse/${detail.id}/emit?tenant_id=${tenantId}`, {});
      await loadDetail(detail.id);
      void load();
    } catch (err: unknown) {
      modal.error(err);
    } finally { setReemitting(false); }
  }

  const statusLabel = (s: string | null) =>
    s ? (t(`nfse.status.${s}` as TKey) || s) : t('nfse.status.processing');

  const kpiAuthorized = items.filter(n => n.nfse_status === 'authorized').length;
  const kpiPending    = items.filter(n => n.nfse_status === 'pending' || n.nfse_status === 'processing').length;
  const kpiRejected   = items.filter(n => n.nfse_status === 'rejected').length;
  const kpiTotal      = items.reduce((s, n) => s + Number(n.amount), 0);

  return (
    <div>
      <div className="page-header">
        <h1>{t('nfse.title')}</h1>
      </div>

      {/* KPI bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KPICard label="Autorizadas"   value={String(kpiAuthorized)} icon="✓"  iconVariant="green" />
        <KPICard label="Em andamento"  value={String(kpiPending)}    icon="⏳" iconVariant="amber" />
        <KPICard label="Rejeitadas"    value={String(kpiRejected)}   icon="✗"  iconVariant="red" />
        <KPICard label="Total emitido" value={BRL.format(kpiTotal)}  icon="R$" iconVariant="blue" />
      </div>

      <div className="flex-gap" style={{ marginBottom: 16 }}>
        <input placeholder={t('nfse.searchPH')} value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 300 }} />
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
          <option value="">{t('nfse.allStatus')}</option>
          {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">{t('nfse.empty')}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('nfse.client')}</th>
                <th>{t('nfse.description')}</th>
                <th>{t('nfse.amount')}</th>
                <th>{t('nfse.iss')}</th>
                <th>{t('nfse.number')}</th>
                <th>{t('nfse.status')}</th>
                <th>{t('nfse.date')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(n => (
                <tr key={n.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(n)}>
                  <td style={{ fontWeight: 500 }}>{n.client_name ?? '—'}</td>
                  <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.description}
                  </td>
                  <td style={{ fontWeight: 600 }}>{BRL.format(Number(n.amount))}</td>
                  <td style={{ fontSize: 12 }}>{BRL.format(Number(n.iss_value))} ({n.iss_rate}%)</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{n.nfse_number ?? '—'}</td>
                  <td>
                    {n.nfse_status
                      ? <StatusPill status={n.nfse_status as FiscalStatus} />
                      : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>{fmtDate(n.created_at)}</td>
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

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={t('nfse.detailTitle')}
        subTitle={detail ? `${detail.client_name ?? '—'} · ${t('nfse.number')} ${detail.nfse_number ?? t('nfse.status.pending')}` : ''}
      >
        <Drawer.Body>
          {detailLoading || !detail ? (
            <div className="spinner">{t('c.loading')}</div>
          ) : (
            <>
              {/* Status card */}
              <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {detail.nfse_status
                    ? <StatusPill status={detail.nfse_status as FiscalStatus} />
                    : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                  {detail.nfse_number && (
                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                      {t('nfse.number')}: {detail.nfse_number}
                    </span>
                  )}
                </div>
                {detail.nfse_reject_reason && (
                  <div className="alert alert-error" style={{ marginTop: 12 }}>{detail.nfse_reject_reason}</div>
                )}
              </div>

              <div className="field-row">
                <div className="field">
                  <label>{t('nfse.client')}</label>
                  <div>{detail.client_name ?? '—'}</div>
                </div>
                <div className="field">
                  <label>{t('nfse.serviceCode')}</label>
                  <div>{detail.service_code}</div>
                </div>
              </div>

              <div className="field">
                <label>{t('nfse.description')}</label>
                <div>{detail.description}</div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label>{t('nfse.amount')}</label>
                  <div>{BRL.format(Number(detail.amount))}</div>
                </div>
                <div className="field">
                  <label>{t('nfse.iss')}</label>
                  <div>{BRL.format(Number(detail.iss_value))} ({detail.iss_rate}%)</div>
                </div>
              </div>

              {(detail.period_start || detail.period_end) && (
                <div className="field">
                  <label>{t('nfse.period')}</label>
                  <div>{fmtDate(detail.period_start)} – {fmtDate(detail.period_end)}</div>
                </div>
              )}

              {detail.nfse_verify_code && (
                <div className="field">
                  <label>{t('nfse.verifyCode')}</label>
                  <div style={{ fontFamily: 'monospace' }}>{detail.nfse_verify_code}</div>
                </div>
              )}

              {detail.nfse_auth_date && (
                <div className="field">
                  <label>{t('nfse.authDate')}</label>
                  <div>{fmtDateTime(detail.nfse_auth_date)}</div>
                </div>
              )}

              {detail.nfse_pdf_url && (
                <div style={{ margin: '12px 0' }}>
                  <a className="btn btn-secondary btn-sm" href={detail.nfse_pdf_url} target="_blank" rel="noreferrer noopener">
                    {t('nfse.viewPdf')}
                  </a>
                </div>
              )}

              {/* Events timeline */}
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', margin: '20px 0 12px', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                {t('nfse.events')}
              </p>
              {detail.events.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('nfse.noEvents')}</div>
              ) : (
                <Timeline events={detail.events} />
              )}
            </>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          {detail?.nfse_status === 'rejected' && (
            <button type="button" className="btn btn-primary" style={{ marginRight: 'auto' }}
              disabled={reemitting} onClick={() => void handleReemit()}>
              {reemitting ? t('c.saving') : t('nfse.reemit')}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
            {t('c.close')}
          </button>
        </Drawer.Footer>
      </Drawer>
    </div>
  );
}
