import { useEffect, useState, FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Seller {
  id:                      string;
  name:                    string;
  email:                   string | null;
  phone:                   string | null;
  document:                string | null;
  default_commission_pct:  string;
  commission_base:         'subtotal' | 'total';
  is_active:               boolean;
}

interface CommissionEntry {
  id:                 string;
  invoice_id:         string;
  invoice_number:     string | null;
  issue_date:         string | null;
  client_name:        string | null;
  base_amount:        string;
  rate:               string;
  commission_amount:  string;
  status:             'accrued' | 'cancelled';
  created_at:          string;
  cancelled_at:        string | null;
}

interface CommissionsResp {
  data:     CommissionEntry[];
  total:    number;
  page:     number;
  per_page: number;
  summary:  { total_accrued: number; total_cancelled: number };
}

const EMPTY_EDIT = {
  name: '', email: '', phone: '', document: '',
  default_commission_pct: '', commission_base: 'subtotal' as 'subtotal' | 'total',
  is_active: true,
};

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function SellerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const { t } = useI18n();

  const [seller,        setSeller]        = useState<Seller | null>(null);
  const [headerLoading, setHeaderLoading] = useState(true);
  const [headerError,   setHeaderError]   = useState('');

  const [editOpen,   setEditOpen]   = useState(false);
  const [editForm,   setEditForm]   = useState({ ...EMPTY_EDIT });
  const [editSaving, setEditSaving] = useState(false);
  const [editError,  setEditError]  = useState('');

  const [entries,    setEntries]    = useState<CommissionEntry[]>([]);
  const [summary,    setSummary]    = useState({ total_accrued: 0, total_cancelled: 0 });
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [listError,   setListError]   = useState('');

  const PER_PAGE = 20;

  async function loadSeller() {
    if (!tenantId || !id) return;
    setHeaderLoading(true);
    setHeaderError('');
    try {
      const resp = await api.get<Seller>(`/v1/sellers/${id}`);
      setSeller(resp);
    } catch (err: unknown) {
      setHeaderError(err instanceof Error ? err.message : 'Erro ao carregar vendedor.');
    } finally {
      setHeaderLoading(false);
    }
  }

  async function loadCommissions() {
    if (!tenantId || !id) return;
    setListLoading(true);
    setListError('');
    try {
      const p = new URLSearchParams({
        page:     String(page),
        per_page: String(PER_PAGE),
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      const resp = await api.get<CommissionsResp>(`/v1/sellers/${id}/commissions?${p}`);
      setEntries(resp.data ?? []);
      setTotal(resp.total ?? 0);
      setSummary(resp.summary ?? { total_accrued: 0, total_cancelled: 0 });
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Erro ao carregar extrato.');
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => { void loadSeller(); }, [tenantId, id]);
  useEffect(() => { void loadCommissions(); }, [tenantId, id, page, statusFilter]);

  function openEdit() {
    if (!seller) return;
    setEditForm({
      name:                    seller.name,
      email:                   seller.email ?? '',
      phone:                   seller.phone ?? '',
      document:                seller.document ?? '',
      default_commission_pct: seller.default_commission_pct,
      commission_base:         seller.commission_base,
      is_active:               seller.is_active,
    });
    setEditError('');
    setEditOpen(true);
  }

  async function handleEditSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !id) return;
    if (!editForm.name.trim()) { setEditError(t('sel.name') + ' é obrigatório.'); return; }
    const rate = editForm.default_commission_pct ? Number(editForm.default_commission_pct) : 0;
    if (Number.isNaN(rate) || rate < 0 || rate > 100) {
      setEditError(t('sel.commissionPct') + ' deve estar entre 0 e 100.');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      await api.patch(`/v1/sellers/${id}`, {
        name:                    editForm.name.trim(),
        email:                   editForm.email.trim()    || undefined,
        phone:                   editForm.phone.trim()    || undefined,
        document:                editForm.document.trim() || undefined,
        default_commission_pct: rate,
        commission_base:         editForm.commission_base,
        is_active:               editForm.is_active,
      });
      setEditOpen(false);
      void loadSeller();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setEditSaving(false);
    }
  }

  const totalPages = Math.ceil(total / PER_PAGE);

  if (headerLoading) {
    return (
      <div>
        <div className="page-header">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/sellers')}>← {t('sel.title')}</button>
        </div>
        <div className="spinner">{t('c.loading')}</div>
      </div>
    );
  }

  if (headerError || !seller) {
    return (
      <div>
        <div className="page-header">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/sellers')}>← {t('sel.title')}</button>
        </div>
        <div className="alert alert-error">{headerError || 'Vendedor não encontrado.'}</div>
      </div>
    );
  }

  return (
    <div>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/sellers')} aria-label={`Voltar para ${t('sel.title')}`}>
            ← {t('sel.title')}
          </button>
          <h1 style={{ margin: 0, fontSize: 20 }}>{seller.name}</h1>
          <span className={`badge badge-${seller.is_active ? 'service' : 'raw_material'}`}>
            {seller.is_active ? t('c.active') : t('c.inactive')}
          </span>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={openEdit}>{t('c.edit')}</button>
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 24 }}>
        {seller.email ?? '—'} · {Number(seller.default_commission_pct).toFixed(2)}% ·{' '}
        {seller.commission_base === 'total' ? t('sel.commissionBase.total') : t('sel.commissionBase.subtotal')}
      </p>

      {/* ── Summary cards ────────────────────────────────────────────── */}
      <div className="flex-gap" style={{ marginBottom: 24, flexWrap: 'wrap' }}>
        <div className="card" style={{ padding: 16, minWidth: 200 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('sel.totalAccrued')}</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{fmtBRL(summary.total_accrued)}</div>
        </div>
        <div className="card" style={{ padding: 16, minWidth: 200 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('sel.totalCancelled')}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--muted)' }}>{fmtBRL(summary.total_cancelled)}</div>
        </div>
      </div>

      {/* ── Extrato ──────────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>{t('sel.extract')}</h2>

      <div className="flex-gap" style={{ marginBottom: 16 }}>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} style={{ maxWidth: 200 }}>
          <option value="">{t('c.active')} / {t('c.inactive')}</option>
          <option value="accrued">{t('sel.status.accrued')}</option>
          <option value="cancelled">{t('sel.status.cancelled')}</option>
        </select>
      </div>

      {listLoading ? (
        <div className="spinner">{t('c.loading')}</div>
      ) : listError ? (
        <div className="alert alert-error">{listError}</div>
      ) : (
        <div className="card">
          {entries.length === 0 ? (
            <div className="empty-state">{t('sel.emptyCommissions')}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('sel.date')}</th>
                  <th>{t('sel.invoiceNumber')}</th>
                  <th>{t('sel.client')}</th>
                  <th style={{ textAlign: 'right' }}>{t('sel.baseAmount')}</th>
                  <th style={{ textAlign: 'right' }}>{t('sel.rate')}</th>
                  <th style={{ textAlign: 'right' }}>{t('sel.commissionAmount')}</th>
                  <th>{t('sel.status')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(en => (
                  <tr key={en.id}>
                    <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDate(en.created_at)}</td>
                    <td>{en.invoice_number ?? '—'}</td>
                    <td>{en.client_name ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(Number(en.base_amount))}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(en.rate).toFixed(2)}%</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {fmtBRL(Number(en.commission_amount))}
                    </td>
                    <td>
                      <span className={`badge badge-${en.status === 'accrued' ? 'service' : 'raw_material'}`}>
                        {en.status === 'accrued' ? t('sel.status.accrued') : t('sel.status.cancelled')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex-gap mt-16" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('c.prev')}</button>
          <span className="text-muted" style={{ fontSize: 13 }}>{t('c.page')} {page} {t('c.of')} {totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t('c.next')}</button>
        </div>
      )}

      {/* ── Edit drawer ──────────────────────────────────────────────── */}
      {editOpen && (
        <div className="overlay" onClick={() => setEditOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{t('c.edit')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleEditSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {editError && <div className="alert alert-error" role="alert">{editError}</div>}

                <div className="field">
                  <label>{t('sel.name')} *</label>
                  <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required />
                </div>
                <div className="field">
                  <label>{t('sel.email')}</label>
                  <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="field">
                  <label>{t('sel.phone')}</label>
                  <input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="field">
                  <label>{t('sel.document')}</label>
                  <input value={editForm.document} onChange={e => setEditForm(f => ({ ...f, document: e.target.value }))} />
                </div>
                <div className="field">
                  <label>{t('sel.commissionPct')}</label>
                  <input
                    type="number" min={0} max={100} step="0.01"
                    value={editForm.default_commission_pct}
                    onChange={e => setEditForm(f => ({ ...f, default_commission_pct: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>{t('sel.commissionBase')}</label>
                  <select
                    value={editForm.commission_base}
                    onChange={e => setEditForm(f => ({ ...f, commission_base: e.target.value as 'subtotal' | 'total' }))}
                  >
                    <option value="subtotal">{t('sel.commissionBase.subtotal')}</option>
                    <option value="total">{t('sel.commissionBase.total')}</option>
                  </select>
                </div>
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={editForm.is_active}
                      onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))}
                      style={{ width: 'auto', margin: 0 }}
                    />
                    {t('c.active')}
                  </label>
                </div>
              </div>
              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(false)}>{t('c.cancel')}</button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={editSaving}>
                  {editSaving ? t('c.saving') : t('c.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
