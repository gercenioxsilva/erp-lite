import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { Can } from '../../rbac';
import { Badge } from '../../ds';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Professional {
  id:        string;
  name:      string;
  email:     string | null;
  phone:     string | null;
  bio:       string | null;
  is_active: boolean;
  user_id:   string | null;
  area_ids:  string[];
}

interface Area {
  id:        string;
  name:      string;
  is_active: boolean;
}

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name:  '',
  email: '',
  phone: '',
  bio:   '',
};

// ── Main component ─────────────────────────────────────────────────────────────

export function ProfessionalsPage() {
  const navigate = useNavigate();

  // ── List state ─────────────────────────────────────────────────────────────
  const [items,        setItems]        = useState<Professional[]>([]);
  const [areas,        setAreas]        = useState<Area[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // ── Drawer (create) state ──────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [areaIds,    setAreaIds]    = useState<string[]>([]);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  // ── Data loading ───────────────────────────────────────────────────────────

  async function load() {
    setLoading(true);
    try {
      const [profs, areasResp] = await Promise.all([
        api.get<{ data: Professional[] }>('/v1/scheduling/professionals?include_inactive=true'),
        api.get<{ data: Area[] }>('/v1/scheduling/areas'),
      ]);
      setItems(profs.data);
      setAreas(areasResp.data);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  // ── Drawer helpers ─────────────────────────────────────────────────────────

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setAreaIds([]);
    setFormError('');
    setDrawerOpen(true);
  }

  function setF(field: keyof typeof EMPTY_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }));
  }

  function toggleArea(id: string) {
    setAreaIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setFormError('');

    if (!form.name.trim()) { setFormError('Informe o nome do profissional.'); return; }

    setSaving(true);
    try {
      await api.post('/v1/scheduling/professionals', {
        name:     form.name.trim(),
        email:    form.email.trim() || undefined,
        phone:    form.phone.trim() || undefined,
        bio:      form.bio.trim()   || undefined,
        area_ids: areaIds.length > 0 ? areaIds : undefined,
      });
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar o profissional.');
    } finally { setSaving(false); }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const areaNameById = new Map(areas.map(a => [a.id, a.name]));

  function areaNames(p: Professional): string {
    const names = p.area_ids.map(id => areaNameById.get(id)).filter(Boolean);
    return names.length > 0 ? names.join(', ') : '—';
  }

  const visible = items
    .filter(p => showInactive || p.is_active)
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  const activeAreas = areas.filter(a => a.is_active);

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <h1>Profissionais</h1>
        <Can permission="scheduling_professionals:create">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
            + Novo profissional
          </button>
        </Can>
      </div>

      <Can
        permission="scheduling_professionals:view"
        fallback={(
          <div className="card">
            <div className="empty-state">Você não tem permissão para visualizar profissionais.</div>
          </div>
        )}
      >
        {/* ── Filters ──────────────────────────────────────────────────── */}
        <div className="flex-gap" style={{ marginBottom: 16, alignItems: 'center' }}>
          <input placeholder="Buscar profissional…" value={search}
            onChange={e => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
            Mostrar inativos
          </label>
        </div>

        {/* ── Table ────────────────────────────────────────────────────── */}
        <div className="card">
          {loading ? (
            <div className="spinner">Carregando…</div>
          ) : visible.length === 0 ? (
            <div className="empty-state">
              Nenhum profissional cadastrado.{' '}
              <Can permission="scheduling_professionals:create">
                <button className="btn btn-secondary btn-sm" onClick={openCreate}>Cadastrar o primeiro</button>
              </Can>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Áreas atendidas</th>
                  <th>Status</th>
                  <th>Acesso</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(p => (
                  <tr key={p.id} style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/scheduling/professionals/${p.id}`)}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{p.name}</div>
                      {p.email && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.email}</div>}
                    </td>
                    <td style={{ fontSize: 13 }}>{areaNames(p)}</td>
                    <td>
                      {p.is_active
                        ? <Badge variant="active">Ativo</Badge>
                        : <Badge variant="inactive">Inativo</Badge>}
                    </td>
                    <td>
                      {p.user_id
                        ? <Badge variant="confirmed">Com acesso</Badge>
                        : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Can>

      {/* ── Drawer — create ───────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>Novo profissional</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                <div className="field">
                  <label>Nome *</label>
                  <input value={form.name} onChange={setF('name')} required placeholder="Ex.: Ana Souza" />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>E-mail</label>
                    <input type="email" value={form.email} onChange={setF('email')} placeholder="ana@exemplo.com" />
                  </div>
                  <div className="field">
                    <label>Telefone</label>
                    <input value={form.phone} onChange={setF('phone')} placeholder="(11) 99999-0000" />
                  </div>
                </div>

                <div className="field">
                  <label>Bio</label>
                  <textarea value={form.bio} onChange={setF('bio')} rows={3}
                    placeholder="Breve apresentação exibida ao cliente" />
                </div>

                <div className="field">
                  <label>Áreas atendidas</label>
                  {activeAreas.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      Nenhuma área ativa cadastrada. Cadastre áreas de atuação primeiro.
                    </span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {activeAreas.map(a => (
                        <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                          <input type="checkbox" checked={areaIds.includes(a.id)}
                            onChange={() => toggleArea(a.id)} style={{ width: 'auto', margin: 0 }} />
                          {a.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? 'Salvando…' : 'Criar profissional'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
