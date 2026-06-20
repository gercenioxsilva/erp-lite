import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';

interface User {
  id:         string;
  email:      string;
  name:       string;
  role:       string;
  status:     string;
  created_at: string;
}

interface ListResp { data: User[]; total: number; page: number; per_page: number; }

const EMPTY_FORM = { name: '', email: '', role: 'user', password: '', status: 'active' };

export function UsersPage() {
  const { tenantId } = useAuth();
  const { t }        = useI18n();
  const modal        = useModal();
  const [items,      setItems]      = useState<User[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [loading,    setLoading]    = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<User | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  const perPage = 20;

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tenant_id: tenantId, page: String(page), per_page: String(perPage),
        ...(search ? { search } : {}),
      });
      const resp = await api.get<ListResp>(`/v1/users?${params}`);
      setItems(resp.data);
      setTotal(resp.total);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [tenantId, page, search]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(u: User) {
    setEditing(u);
    setForm({ name: u.name, email: u.email, role: u.role, password: '', status: u.status });
    setFormError('');
    setDrawerOpen(true);
  }

  function setF(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm(f => ({ ...f, [field]: e.target.value }));
    };
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setFormError('');
    setSaving(true);
    try {
      if (editing) {
        const payload: Record<string, string> = { name: form.name, role: form.role, status: form.status };
        if (form.password) payload.password = form.password;
        await api.patch(`/v1/users/${editing.id}`, payload);
      } else {
        await api.post('/v1/users', {
          tenant_id: tenantId,
          email:     form.email,
          name:      form.name,
          role:      form.role,
          password:  form.password,
        });
      }
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally { setSaving(false); }
  }

  async function handleDisable(u: User) {
    const ok = await modal.confirm({ title: t('u.disable'), message: t('u.disableMsg'), confirmLabel: 'Desabilitar', danger: true });
    if (!ok) return;
    try { await api.delete(`/v1/users/${u.id}`); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  const totalPages = Math.ceil(total / perPage);

  const roleLabel = (role: string) => ({
    owner: t('u.role.owner'), admin: t('u.role.admin'),
    manager: t('u.role.manager'), user: t('u.role.user'),
  }[role] ?? role);

  return (
    <div>
      <div className="page-header">
        <h1>{t('u.title')}</h1>
        <button className="btn btn-primary" style={{ width: 'auto' }} onClick={openCreate}>
          + {t('u.new')}
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          placeholder={t('u.searchPH')}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ maxWidth: 320 }}
        />
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            {t('u.empty')}{' '}
            <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('u.new')}</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('u.name')}</th>
                <th>{t('u.email')}</th>
                <th>{t('u.role')}</th>
                <th>{t('u.status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>{u.name}</td>
                  <td style={{ fontSize: 13, color: 'var(--muted)' }}>{u.email}</td>
                  <td>
                    <span className={`badge badge-${u.role === 'owner' ? 'product' : u.role === 'admin' ? 'raw_material' : 'service'}`}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge-${u.status === 'active' ? 'active' : 'inactive'}`}>
                      {u.status === 'active' ? t('c.active') : t('c.disabled')}
                    </span>
                  </td>
                  <td>
                    <div className="flex-gap">
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(u)}>
                        {t('c.edit')}
                      </button>
                      {u.status === 'active' && (
                        <button className="btn btn-danger btn-sm" onClick={() => handleDisable(u)}>
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

      {/* ── Drawer ─────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{editing ? t('u.edit') : t('u.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSave} style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error">{formError}</div>}

                <div className="field">
                  <label>{t('u.name')}</label>
                  <input value={form.name} onChange={setF('name')} />
                </div>

                <div className="field">
                  <label>{t('u.email')} {!editing && '*'}</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={setF('email')}
                    required={!editing}
                    disabled={!!editing}
                    style={editing ? { background: '#f1f5f9', color: 'var(--muted)' } : {}}
                  />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>{t('u.role')}</label>
                    <select value={form.role} onChange={setF('role')}>
                      <option value="owner">{t('u.role.owner')}</option>
                      <option value="admin">{t('u.role.admin')}</option>
                      <option value="manager">{t('u.role.manager')}</option>
                      <option value="user">{t('u.role.user')}</option>
                    </select>
                  </div>
                  {editing && (
                    <div className="field">
                      <label>{t('u.status')}</label>
                      <select value={form.status} onChange={setF('status')}>
                        <option value="active">{t('c.active')}</option>
                        <option value="disabled">{t('c.disabled')}</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="field">
                  <label>{editing ? t('u.newPwd') : `${t('u.pwd')} *`}</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={setF('password')}
                    required={!editing}
                    minLength={8}
                    placeholder={editing ? '••••••••' : ''}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  {t('c.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : editing ? t('u.save') : t('u.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
