import { useEffect, useMemo, useState, FormEvent } from 'react';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { usePermissions, Can } from '../../rbac';

interface PermissionDef { key: string; module: string; action: string; description: string; }
interface CatalogResp   { modules: Record<string, string>; permissions: PermissionDef[]; }
interface RoleItem {
  id: string; key: string; name: string; description: string | null;
  is_system: boolean; is_custom: boolean; permissions: string[];
}

const EMPTY_CREATE = { key: '', name: '', description: '' };

export function RolesPage() {
  const { t } = useI18n();
  const modal = useModal();
  const { can } = usePermissions();
  const canManage = can('roles:manage');

  const [catalog, setCatalog]   = useState<PermissionDef[]>([]);
  const [modules, setModules]   = useState<Record<string, string>>({});
  const [roles, setRoles]       = useState<RoleItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft]       = useState<Set<string>>(new Set());
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE });
  const [createError, setCreateError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [cat, rolesResp] = await Promise.all([
        api.get<CatalogResp>('/v1/rbac/permissions'),
        api.get<{ data: RoleItem[] }>('/v1/rbac/roles'),
      ]);
      setCatalog(cat.permissions);
      setModules(cat.modules);
      setRoles(rolesResp.data);
      setSelectedId(prev => prev ?? rolesResp.data[0]?.id ?? null);
    } catch (err) { modal.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const selected = useMemo(() => roles.find(r => r.id === selectedId) ?? null, [roles, selectedId]);

  // Sincroniza o rascunho de permissões quando troca o papel selecionado.
  useEffect(() => { setDraft(new Set(selected?.permissions ?? [])); }, [selected]);

  const grouped = useMemo(() => {
    const g: Record<string, PermissionDef[]> = {};
    for (const p of catalog) (g[p.module] ??= []).push(p);
    return g;
  }, [catalog]);

  const editable = canManage && !!selected && !selected.is_system;

  function toggle(key: string) {
    if (!editable) return;
    setDraft(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function savePermissions() {
    if (!selected || !editable) return;
    setSaving(true);
    try {
      await api.put(`/v1/rbac/roles/${selected.id}/permissions`, { permissions: [...draft] });
      await load();
      modal.success(t('roles.saved'));
    } catch (err) { modal.error(err); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!selected || !selected.is_custom) return;
    const ok = await modal.confirm({ title: t('roles.delete'), message: t('roles.deleteConfirm'), danger: true });
    if (!ok) return;
    try {
      await api.delete(`/v1/rbac/roles/${selected.id}`);
      setSelectedId(null);
      await load();
    } catch (err) { modal.error(err); }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    try {
      const created = await api.post<{ id: string }>('/v1/rbac/roles', {
        key: createForm.key.trim().toLowerCase(),
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
      });
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_CREATE });
      await load();
      setSelectedId(created.id);
      modal.success(t('roles.created'));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Erro');
    }
  }

  const dirty = useMemo(() => {
    if (!selected) return false;
    const orig = new Set(selected.permissions);
    if (orig.size !== draft.size) return true;
    for (const k of draft) if (!orig.has(k)) return true;
    return false;
  }, [selected, draft]);

  return (
    <div>
      <div className="page-header">
        <h1>{t('roles.title')}</h1>
        <Can permission="roles:manage">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={() => setCreateOpen(true)}>
            + {t('roles.new')}
          </button>
        </Can>
      </div>
      <p className="text-muted" style={{ marginBottom: 16 }}>{t('roles.subtitle')}</p>

      {loading ? (
        <div className="card"><div className="spinner">{t('c.loading')}</div></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 260px) 1fr', gap: 16, alignItems: 'start' }}>
          {/* ── Lista de papéis ─────────────────────────────────────── */}
          <div className="card" style={{ padding: 8 }}>
            {roles.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`btn btn-sm ${r.id === selectedId ? 'btn-primary' : 'btn-secondary'}`}
                style={{ width: '100%', justifyContent: 'space-between', display: 'flex', marginBottom: 6, textAlign: 'left' }}
              >
                <span>{r.name}</span>
                <span className={`badge badge-${r.is_system ? 'service' : 'active'}`} style={{ fontSize: 10 }}>
                  {r.is_system ? t('roles.system') : t('roles.custom')}
                </span>
              </button>
            ))}
          </div>

          {/* ── Permissões do papel selecionado ─────────────────────── */}
          <div className="card">
            {!selected ? (
              <div className="empty-state">{t('roles.selectHint')}</div>
            ) : (
              <>
                <div className="flex-gap" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <h2 style={{ margin: 0 }}>{selected.name}</h2>
                    {selected.description && <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{selected.description}</p>}
                  </div>
                  {selected.is_custom && canManage && (
                    <button className="btn btn-danger btn-sm" onClick={handleDelete}>{t('roles.delete')}</button>
                  )}
                </div>

                {selected.is_system && (
                  <div className="alert" style={{ marginBottom: 12 }}>{t('roles.systemReadonly')}</div>
                )}

                {Object.entries(grouped).map(([mod, perms]) => (
                  <fieldset key={mod} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                    <legend style={{ fontWeight: 600, fontSize: 13, padding: '0 6px' }}>{modules[mod] ?? mod}</legend>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                      {perms.map(p => (
                        <label key={p.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: editable ? 'pointer' : 'default' }}>
                          <input
                            type="checkbox"
                            checked={draft.has(p.key)}
                            disabled={!editable}
                            onChange={() => toggle(p.key)}
                          />
                          <span>{p.description}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}

                {editable && (
                  <div className="flex-gap mt-16" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-primary" style={{ width: 'auto' }} disabled={saving || !dirty} onClick={savePermissions}>
                      {saving ? t('c.saving') : t('roles.savePerms')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Drawer: novo perfil ────────────────────────────────────── */}
      {createOpen && (
        <div className="overlay" onClick={() => setCreateOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{t('roles.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setCreateOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate} style={{ display: 'contents' }}>
              <div className="drawer-body">
                {createError && <div className="alert alert-error">{createError}</div>}
                <div className="field">
                  <label>{t('roles.name')} *</label>
                  <input value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} required />
                </div>
                <div className="field">
                  <label>{t('roles.key')} *</label>
                  <input
                    value={createForm.key}
                    onChange={e => setCreateForm(f => ({ ...f, key: e.target.value }))}
                    placeholder="ex.: auditor"
                    required
                  />
                </div>
                <div className="field">
                  <label>{t('roles.description')}</label>
                  <input value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} />
                </div>
              </div>
              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>{t('c.cancel')}</button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>{t('roles.create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
