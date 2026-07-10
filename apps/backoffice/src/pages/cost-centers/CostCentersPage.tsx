import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { Can }      from '../../rbac';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CostCenter {
  id:             string;
  code:           string;
  name:           string;
  description:    string | null;
  allow_negative: boolean;
  is_active:      boolean;
}

interface ListResp { data: CostCenter[]; total: number; page: number; per_page: number; }

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  code:           '',
  name:           '',
  description:    '',
  allow_negative: false,
};

// ── Main component ─────────────────────────────────────────────────────────────

export function CostCentersPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();
  const navigate = useNavigate();

  // ── List state ─────────────────────────────────────────────────────────────
  const [items,   setItems]   = useState<CostCenter[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);

  // ── Drawer (create / edit) state ───────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<CostCenter | null>(null);
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
        tenant_id: tenantId,
        page:      String(page),
        per_page:  String(perPage),
        ...(search ? { search } : {}),
      });
      const resp = await api.get<ListResp>(`/v1/cost-centers?${p}`);
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

  function openEdit(cc: CostCenter) {
    setEditing(cc);
    setForm({
      code:           cc.code,
      name:           cc.name,
      description:    cc.description ?? '',
      allow_negative: cc.allow_negative,
    });
    setFormError('');
    setDrawerOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setFormError('');

    if (!form.code.trim()) { setFormError(t('cc.code') + ' é obrigatório.'); return; }
    if (!form.name.trim()) { setFormError(t('cc.name') + ' é obrigatório.'); return; }

    setSaving(true);
    try {
      const payload = {
        tenant_id:      tenantId,
        code:           form.code.trim(),
        name:           form.name.trim(),
        description:    form.description.trim() || undefined,
        allow_negative: form.allow_negative,
      };
      if (editing) await api.patch(`/v1/cost-centers/${editing.id}`, payload);
      else         await api.post('/v1/cost-centers', payload);
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    const ok = await modal.confirm({
      title:        'Desativar este centro de custo?',
      message:      'O centro de custo será desativado e deixará de aparecer nas listagens. Esta ação pode ser revertida.',
      confirmLabel: 'Desativar',
      danger:       true,
    });
    if (!ok) return;
    try { await api.delete(`/v1/cost-centers/${id}`); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / perPage);

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <h1>{t('cc.title')}</h1>
        <Can permission="cost_centers:create">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
            + {t('cc.new')}
          </button>
        </Can>
      </div>

      {/* ── Search ───────────────────────────────────────────────────── */}
      <div className="flex-gap" style={{ marginBottom: 16 }}>
        <input
          placeholder={t('cc.search')}
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
            <Can permission="cost_centers:create">
              <button className="btn btn-secondary btn-sm" onClick={openCreate}>
                {t('cc.new')}
              </button>
            </Can>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('cc.code')}</th>
                <th>{t('cc.name')}</th>
                <th>{t('cc.description')}</th>
                <th>{t('c.active')}</th>
                <th>{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(cc => (
                <tr
                  key={cc.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/cost-centers/${cc.id}`)}
                >
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{cc.code}</td>
                  <td style={{ fontWeight: 500 }}>{cc.name}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{cc.description ?? '—'}</td>
                  <td>
                    <span className={`badge badge-${cc.is_active ? 'service' : 'raw_material'}`}>
                      {cc.is_active ? t('c.active') : t('c.inactive')}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex-gap">
                      <Can permission="cost_centers:edit">
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(cc)}>
                          {t('c.edit')}
                        </button>
                      </Can>
                      <Can permission="cost_centers:delete">
                        <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(cc.id)}>
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
              <h2>{editing ? 'Editar Centro de Custo' : t('cc.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                <div className="field">
                  <label>{t('cc.code')} *</label>
                  <input
                    value={form.code}
                    onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                    placeholder="Ex.: CC-001"
                    required
                  />
                </div>

                <div className="field">
                  <label>{t('cc.name')} *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ex.: Administração"
                    required
                  />
                </div>

                <div className="field">
                  <label>{t('cc.description')}</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={3}
                    placeholder="Descrição opcional…"
                  />
                </div>

                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={form.allow_negative}
                      onChange={e => setForm(f => ({ ...f, allow_negative: e.target.checked }))}
                      style={{ width: 'auto', margin: 0 }}
                    />
                    {t('cc.allowNegative')}
                  </label>
                </div>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  {t('c.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : editing ? t('c.save') : t('cc.new')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
