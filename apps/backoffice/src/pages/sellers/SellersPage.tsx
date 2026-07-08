import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { Can }      from '../../rbac';

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface ListResp { data: Seller[]; total: number; page: number; per_page: number; }

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name:                   '',
  email:                  '',
  phone:                  '',
  document:               '',
  default_commission_pct: '',
  commission_base:        'subtotal' as 'subtotal' | 'total',
};

// ── Main component ─────────────────────────────────────────────────────────────

export function SellersPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();
  const navigate = useNavigate();

  // ── List state ─────────────────────────────────────────────────────────────
  const [items,   setItems]   = useState<Seller[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);

  // ── Drawer (create / edit) state ───────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Seller | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  const perPage = 20;

  // ── Data loading ───────────────────────────────────────────────────────────

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({
        page:     String(page),
        per_page: String(perPage),
        ...(search ? { search } : {}),
      });
      const resp = await api.get<ListResp>(`/v1/sellers?${p}`);
      setItems(resp.data);
      setTotal(resp.total);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [tenantId, page, search]);

  // ── Drawer helpers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(s: Seller) {
    setEditing(s);
    setForm({
      name:                    s.name,
      email:                   s.email ?? '',
      phone:                   s.phone ?? '',
      document:                s.document ?? '',
      default_commission_pct: s.default_commission_pct,
      commission_base:         s.commission_base,
    });
    setFormError('');
    setDrawerOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setFormError('');

    if (!form.name.trim()) { setFormError(t('sel.name') + ' é obrigatório.'); return; }
    const rate = form.default_commission_pct ? Number(form.default_commission_pct) : 0;
    if (Number.isNaN(rate) || rate < 0 || rate > 100) {
      setFormError(t('sel.commissionPct') + ' deve estar entre 0 e 100.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name:                    form.name.trim(),
        email:                   form.email.trim()    || undefined,
        phone:                   form.phone.trim()    || undefined,
        document:                form.document.trim() || undefined,
        default_commission_pct: rate,
        commission_base:         form.commission_base,
      };
      if (editing) await api.patch(`/v1/sellers/${editing.id}`, payload);
      else         await api.post('/v1/sellers', payload);
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    const ok = await modal.confirm({
      title:        'Desativar este vendedor?',
      message:      'O vendedor será desativado e deixará de aparecer nas listagens. Esta ação pode ser revertida.',
      confirmLabel: 'Desativar',
      danger:       true,
    });
    if (!ok) return;
    try { await api.delete(`/v1/sellers/${id}`); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / perPage);

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <h1>{t('sel.title')}</h1>
        <Can permission="sellers:create">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
            + {t('sel.new')}
          </button>
        </Can>
      </div>

      {/* ── Search ───────────────────────────────────────────────────── */}
      <div className="flex-gap" style={{ marginBottom: 16 }}>
        <input
          placeholder={t('sel.search')}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ maxWidth: 320 }}
        />
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            {t('c.empty')}{' '}
            <Can permission="sellers:create">
              <button className="btn btn-secondary btn-sm" onClick={openCreate}>
                {t('sel.new')}
              </button>
            </Can>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('sel.name')}</th>
                <th>{t('sel.email')}</th>
                <th>{t('sel.commissionPct')}</th>
                <th>{t('c.active')}</th>
                <th>{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(s => (
                <tr
                  key={s.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/sellers/${s.id}`)}
                >
                  <td style={{ fontWeight: 500 }}>{s.name}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{s.email ?? '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(s.default_commission_pct).toFixed(2)}%</td>
                  <td>
                    <span className={`badge badge-${s.is_active ? 'service' : 'raw_material'}`}>
                      {s.is_active ? t('c.active') : t('c.inactive')}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex-gap">
                      <Can permission="sellers:edit">
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}>
                          {t('c.edit')}
                        </button>
                      </Can>
                      <Can permission="sellers:delete">
                        <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(s.id)}>
                          {t('c.del')}
                        </button>
                      </Can>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────── */}
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

      {/* ── Drawer — create / edit ────────────────────────────────────── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{editing ? t('c.edit') : t('sel.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                <div className="field">
                  <label>{t('sel.name')} *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ex.: João Silva"
                    required
                  />
                </div>

                <div className="field">
                  <label>{t('sel.email')}</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label>{t('sel.phone')}</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label>{t('sel.document')}</label>
                  <input
                    value={form.document}
                    onChange={e => setForm(f => ({ ...f, document: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label>{t('sel.commissionPct')}</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={form.default_commission_pct}
                    onChange={e => setForm(f => ({ ...f, default_commission_pct: e.target.value }))}
                    placeholder="Ex.: 5"
                  />
                </div>

                <div className="field">
                  <label>{t('sel.commissionBase')}</label>
                  <select
                    value={form.commission_base}
                    onChange={e => setForm(f => ({ ...f, commission_base: e.target.value as 'subtotal' | 'total' }))}
                  >
                    <option value="subtotal">{t('sel.commissionBase.subtotal')}</option>
                    <option value="total">{t('sel.commissionBase.total')}</option>
                  </select>
                </div>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  {t('c.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : editing ? t('c.save') : t('sel.new')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
