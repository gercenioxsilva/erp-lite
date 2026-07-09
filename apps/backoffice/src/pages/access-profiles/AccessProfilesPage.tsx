import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { Drawer }    from '../../ds/components/Drawer';
import { DataTable, type Column } from '../../ds/components/DataTable';
import { Switch }    from '../../ds/components/Switch';
import { Badge }     from '../../ds/components/Badge';

interface AccessProfile {
  id: string; name: string; description: string | null; is_system: boolean; created_at: string;
}

interface PermissionGrant { resource: string; action: 'view' | 'manage'; }

type GrantMap = Record<string, { view: boolean; manage: boolean }>;

function emptyGrantMap(resources: string[]): GrantMap {
  const map: GrantMap = {};
  for (const r of resources) map[r] = { view: false, manage: false };
  return map;
}

const EMPTY_FORM = { name: '', description: '' };

export function AccessProfilesPage() {
  const { t }  = useI18n();
  const modal  = useModal();

  const [profiles,  setProfiles]  = useState<AccessProfile[]>([]);
  const [resources, setResources] = useState<string[]>([]);
  const [loading,   setLoading]   = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<AccessProfile | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [grants,     setGrants]     = useState<GrantMap>({});
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  async function load() {
    setLoading(true);
    try {
      const resp = await api.get<{ data: AccessProfile[] }>('/v1/access-profiles');
      setProfiles(resp.data);
    } catch { /**/ } finally { setLoading(false); }
  }

  async function loadCatalog() {
    try {
      const resp = await api.get<{ resources: string[] }>('/v1/access-profiles/catalog');
      setResources(resp.resources);
    } catch { /**/ }
  }

  useEffect(() => { void load(); void loadCatalog(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setGrants(emptyGrantMap(resources));
    setFormError('');
    setDrawerOpen(true);
  }

  async function openEdit(profile: AccessProfile) {
    setEditing(profile);
    setForm({ name: profile.name, description: profile.description ?? '' });
    setFormError('');
    setDrawerOpen(true);
    try {
      const resp = await api.get<{ data: PermissionGrant[] }>(`/v1/access-profiles/${profile.id}/permissions`);
      const map = emptyGrantMap(resources);
      for (const g of resp.data) {
        if (!map[g.resource]) map[g.resource] = { view: false, manage: false };
        map[g.resource][g.action] = true;
      }
      setGrants(map);
    } catch { setGrants(emptyGrantMap(resources)); }
  }

  // "Gerenciar" sempre implica "Visualizar" (mesma regra do domínio,
  // accessControlDomain.ts#resolveEffectivePermissions) — a matriz nunca
  // deixa a UI mostrar um estado que o backend resolveria diferente.
  function toggleView(resource: string) {
    setGrants(g => {
      const cur = g[resource] ?? { view: false, manage: false };
      const nextView = !cur.view;
      return { ...g, [resource]: { view: nextView, manage: nextView ? cur.manage : false } };
    });
  }
  function toggleManage(resource: string) {
    setGrants(g => {
      const cur = g[resource] ?? { view: false, manage: false };
      const nextManage = !cur.manage;
      return { ...g, [resource]: { view: nextManage ? true : cur.view, manage: nextManage } };
    });
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const profile = editing
        ? await api.patch<AccessProfile>(`/v1/access-profiles/${editing.id}`, form)
        : await api.post<AccessProfile>('/v1/access-profiles', form);

      const grantList: PermissionGrant[] = [];
      for (const [resource, actions] of Object.entries(grants)) {
        if (actions.view)   grantList.push({ resource, action: 'view' });
        if (actions.manage) grantList.push({ resource, action: 'manage' });
      }
      await api.put(`/v1/access-profiles/${profile.id}/permissions`, { grants: grantList });

      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('ap.errSave'));
    } finally { setSaving(false); }
  }

  async function handleDelete(profile: AccessProfile) {
    const ok = await modal.confirm({ title: t('ap.delete'), message: t('ap.deleteMsg'), confirmLabel: t('c.del'), danger: true });
    if (!ok) return;
    try {
      await api.delete(`/v1/access-profiles/${profile.id}`);
      void load();
    } catch (err: unknown) { modal.error(err); }
  }

  const columns: Column<AccessProfile>[] = [
    { key: 'name', header: t('ap.name'), render: p => <span style={{ fontWeight: 500 }}>{p.name}</span> },
    { key: 'description', header: t('ap.description'), render: p => <span style={{ fontSize: 13, color: 'var(--muted)' }}>{p.description || '—'}</span> },
    { key: 'origin', header: t('ap.origin'), render: p => (
      <Badge variant={p.is_system ? 'draft' : 'confirmed'}>{p.is_system ? t('ap.originSeeded') : t('ap.originCustom')}</Badge>
    ) },
    { key: 'actions', header: '', align: 'right', render: p => (
      <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>{t('c.edit')}</button>
        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p)}>{t('c.del')}</button>
      </div>
    ) },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>{t('ap.title')}</h1>
        <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
          + {t('ap.new')}
        </button>
      </div>
      <p className="text-muted" style={{ marginTop: -8, marginBottom: 16 }}>{t('ap.pageHint')}</p>

      <div className="card">
        <DataTable
          columns={columns}
          rows={profiles}
          loading={loading}
          emptyState={<div className="empty-state">{t('ap.empty')}</div>}
        />
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width="min(680px, 96vw)"
        title={editing ? t('ap.edit') : t('ap.new')}
      >
        <form onSubmit={handleSave} style={{ display: 'contents' }}>
          <Drawer.Body>
            {formError && <div className="alert alert-error">{formError}</div>}

            <div className="field">
              <label>{t('ap.name')} *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>

            <div className="field">
              <label>{t('ap.description')}</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <h3 style={{ marginTop: 20, marginBottom: 4 }}>{t('ap.matrixTitle')}</h3>
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>{t('ap.matrixHint')}</p>

            <table>
              <thead>
                <tr>
                  <th>{t('ap.resource')}</th>
                  <th style={{ textAlign: 'center' }}>{t('ap.actionView')}</th>
                  <th style={{ textAlign: 'center' }}>{t('ap.actionManage')}</th>
                </tr>
              </thead>
              <tbody>
                {resources.map(resource => (
                  <tr key={resource}>
                    <td>{t(`ap.resource.${resource}` as any)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <Switch
                        label={`${t('ap.actionView')} — ${resource}`}
                        checked={grants[resource]?.view ?? false}
                        onChange={() => toggleView(resource)}
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <Switch
                        label={`${t('ap.actionManage')} — ${resource}`}
                        checked={grants[resource]?.manage ?? false}
                        onChange={() => toggleManage(resource)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Drawer.Body>

          <Drawer.Footer>
            <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
              {t('c.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
              {saving ? t('c.saving') : editing ? t('ap.save') : t('ap.create')}
            </button>
          </Drawer.Footer>
        </form>
      </Drawer>
    </div>
  );
}
