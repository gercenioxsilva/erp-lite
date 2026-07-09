import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';

interface User {
  id:                 string;
  email:              string;
  name:               string;
  role:               string;
  status:             string;
  access_profile_id:  string | null;
  created_at:         string;
}

interface AccessProfile { id: string; name: string; description: string | null; }

interface ListResp { data: User[]; total: number; page: number; per_page: number; }

const EMPTY_FORM = { name: '', email: '', password: '', status: 'active', access_profile_id: '' };

export function UsersPage() {
  const { tenantId, user: me } = useAuth();
  const { t }        = useI18n();
  const modal        = useModal();
  const isOwner       = me?.role === 'owner';
  const [items,      setItems]      = useState<User[]>([]);
  const [profiles,   setProfiles]   = useState<AccessProfile[]>([]);
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
        page: String(page), per_page: String(perPage),
        ...(search ? { search } : {}),
      });
      const resp = await api.get<ListResp>(`/v1/users?${params}`);
      setItems(resp.data);
      setTotal(resp.total);
    } catch { /**/ } finally { setLoading(false); }
  }

  // Perfis de acesso alimentam o seletor do drawer e a coluna da lista — só
  // o owner realmente usa o seletor, mas qualquer usuário pode VER a coluna
  // (leitura é aberta, mutação é que é owner-only — mesmo espírito de
  // GET /v1/users hoje).
  async function loadProfiles() {
    try {
      const resp = await api.get<{ data: AccessProfile[] }>('/v1/access-profiles');
      setProfiles(resp.data);
    } catch { /**/ }
  }

  useEffect(() => { void load(); }, [tenantId, page, search]);
  useEffect(() => { void loadProfiles(); }, [tenantId]);

  function profileName(id: string | null): string {
    if (!id) return t('u.noProfile');
    return profiles.find(p => p.id === id)?.name ?? t('u.noProfile');
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(u: User) {
    setEditing(u);
    setForm({ name: u.name, email: u.email, password: '', status: u.status, access_profile_id: u.access_profile_id ?? '' });
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
        const payload: Record<string, unknown> = { name: form.name, status: form.status };
        if (form.password) payload.password = form.password;
        // owner não usa perfil — o campo nem aparece no drawer nesse caso.
        if (editing.role !== 'owner') payload.access_profile_id = form.access_profile_id || null;
        await api.patch(`/v1/users/${editing.id}`, payload);
      } else {
        await api.post('/v1/users', {
          email:    form.email,
          name:     form.name,
          password: form.password,
          access_profile_id: form.access_profile_id || undefined,
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
    owner: t('u.role.owner'), technician: t('u.role.technician'), user: t('u.role.user'),
  }[role] ?? role);

  return (
    <div>
      <div className="page-header">
        <h1>{t('u.title')}</h1>
        {isOwner && (
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
            + {t('u.new')}
          </button>
        )}
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
            {isOwner && <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('u.new')}</button>}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('u.name')}</th>
                <th>{t('u.email')}</th>
                <th>{t('u.role')}</th>
                <th>{t('u.accessProfile')}</th>
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
                    <span className={`badge badge-${u.role === 'owner' ? 'product' : u.role === 'technician' ? 'raw_material' : 'service'}`}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td>
                    {u.role === 'owner' ? (
                      <span style={{ fontSize: 13, color: 'var(--muted)' }}>—</span>
                    ) : (
                      <span className={`badge badge-${u.access_profile_id ? 'confirmed' : 'pending'}`}>
                        {profileName(u.access_profile_id)}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`badge badge-${u.status === 'active' ? 'active' : 'inactive'}`}>
                      {u.status === 'active' ? t('c.active') : t('c.disabled')}
                    </span>
                  </td>
                  <td>
                    {isOwner && (
                      <div className="flex-gap">
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(u)}>
                          {t('c.edit')}
                        </button>
                        {u.status === 'active' && u.role !== 'owner' && (
                          <button className="btn btn-danger btn-sm" onClick={() => handleDisable(u)}>
                            {t('c.del')}
                          </button>
                        )}
                      </div>
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
                  {(!editing || editing.role !== 'owner') && (
                    <div className="field">
                      <label>{t('u.accessProfile')}</label>
                      <select value={form.access_profile_id} onChange={setF('access_profile_id')}>
                        <option value="">{t('u.noProfile')}</option>
                        {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  )}
                  {editing && (
                    <div className="field">
                      <label>{t('u.status')}</label>
                      <select value={form.status} onChange={setF('status')} disabled={editing.role === 'owner'}>
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
