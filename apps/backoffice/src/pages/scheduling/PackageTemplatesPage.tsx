import { useEffect, useState, FormEvent } from 'react';
import { api } from '../../lib/api';
import { useModal } from '../../contexts/ModalContext';
import { Can } from '../../rbac';
import { Badge } from '../../ds';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PackageTemplate {
  id:            string;
  name:          string;
  area_id:       string | null;
  session_count: number;
  price:         string | null;
  validity_days: number | null;
  is_active:     boolean;
}

interface Area {
  id:        string;
  name:      string;
  is_active: boolean;
}

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name:          '',
  session_count: '10',
  area_id:       '',
  price:         '',
  validity_days: '',
};

function fmtBRL(v: string | null): string {
  if (v === null || v === '') return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PackageTemplatesPage() {
  const modal = useModal();

  // ── List state ─────────────────────────────────────────────────────────────
  const [items,        setItems]        = useState<PackageTemplate[]>([]);
  const [areas,        setAreas]        = useState<Area[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // ── Drawer (create / edit) state ───────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<PackageTemplate | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  // ── Data loading ───────────────────────────────────────────────────────────

  async function load() {
    setLoading(true);
    try {
      const [templates, areasResp] = await Promise.all([
        api.get<{ data: PackageTemplate[] }>('/v1/scheduling/package-templates?include_inactive=true'),
        api.get<{ data: Area[] }>('/v1/scheduling/areas'),
      ]);
      setItems(templates.data);
      setAreas(areasResp.data);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  // ── Drawer helpers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(p: PackageTemplate) {
    setEditing(p);
    setForm({
      name:          p.name,
      session_count: String(p.session_count),
      area_id:       p.area_id ?? '',
      price:         p.price ?? '',
      validity_days: p.validity_days !== null ? String(p.validity_days) : '',
    });
    setFormError('');
    setDrawerOpen(true);
  }

  function setF(field: keyof typeof EMPTY_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setFormError('');

    const sessions = parseInt(form.session_count, 10);
    const validity = form.validity_days !== '' ? parseInt(form.validity_days, 10) : undefined;
    if (!form.name.trim())                            { setFormError('Informe o nome do modelo.'); return; }
    if (!Number.isInteger(sessions) || sessions < 1)  { setFormError('O número de sessões deve ser de pelo menos 1.'); return; }
    if (validity !== undefined && (!Number.isInteger(validity) || validity < 1)) {
      setFormError('A validade deve ser de pelo menos 1 dia (ou deixe em branco para não expirar).'); return;
    }

    setSaving(true);
    try {
      const payload = {
        name:          form.name.trim(),
        session_count: sessions,
        area_id:       form.area_id !== '' ? form.area_id : null,
        price:         form.price !== '' ? Number(form.price) : undefined,
        validity_days: validity,
      };
      if (editing) await api.patch(`/v1/scheduling/package-templates/${editing.id}`, payload);
      else         await api.post('/v1/scheduling/package-templates', payload);
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar o modelo de pacote.');
    } finally { setSaving(false); }
  }

  async function handleReactivate(p: PackageTemplate) {
    try {
      await api.patch(`/v1/scheduling/package-templates/${p.id}`, { is_active: true });
      void load();
    } catch (err: unknown) { modal.error(err); }
  }

  async function handleDelete(p: PackageTemplate) {
    const ok = await modal.confirm({
      title:        'Excluir modelo de pacote',
      message:      `Excluir "${p.name}"? O modelo deixa de ser oferecido em novas vendas — concessões antigas mantêm o snapshot do que foi contratado.`,
      confirmLabel: 'Excluir',
      danger:       true,
    });
    if (!ok) return;
    try {
      await api.delete(`/v1/scheduling/package-templates/${p.id}`);
      void load();
    } catch (err: unknown) { modal.error(err); }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const areaNameById = new Map(areas.map(a => [a.id, a.name]));

  const areaLabel = (p: PackageTemplate) =>
    p.area_id ? (areaNameById.get(p.area_id) ?? '—') : 'Qualquer área';

  const visible = items
    .filter(p => showInactive || p.is_active)
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  const activeAreas = areas.filter(a => a.is_active);

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <h1>Modelos de Pacote</h1>
        <Can permission="scheduling_packages:manage">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
            + Novo modelo
          </button>
        </Can>
      </div>

      <Can
        permission="scheduling_packages:view"
        fallback={(
          <div className="card">
            <div className="empty-state">Você não tem permissão para visualizar modelos de pacote.</div>
          </div>
        )}
      >
        {/* ── Filters ──────────────────────────────────────────────────── */}
        <div className="flex-gap" style={{ marginBottom: 16, alignItems: 'center' }}>
          <input placeholder="Buscar modelo…" value={search}
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
              Nenhum modelo de pacote cadastrado.{' '}
              <Can permission="scheduling_packages:manage">
                <button className="btn btn-secondary btn-sm" onClick={openCreate}>Cadastrar o primeiro</button>
              </Can>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Sessões</th>
                  <th>Área</th>
                  <th>Preço</th>
                  <th>Validade</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td>{p.session_count}</td>
                    <td>{areaLabel(p)}</td>
                    <td>{fmtBRL(p.price)}</td>
                    <td>{p.validity_days !== null ? `${p.validity_days} dias` : 'Sem validade'}</td>
                    <td>
                      {p.is_active
                        ? <Badge variant="active">Ativo</Badge>
                        : <Badge variant="inactive">Inativo</Badge>}
                    </td>
                    <td>
                      <div className="flex-gap">
                        <Can permission="scheduling_packages:manage">
                          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>Editar</button>
                          {p.is_active ? (
                            <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(p)}>Excluir</button>
                          ) : (
                            <button className="btn btn-secondary btn-sm" onClick={() => void handleReactivate(p)}>Reativar</button>
                          )}
                        </Can>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Can>

      {/* ── Drawer — create / edit ────────────────────────────────────── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{editing ? 'Editar modelo' : 'Novo modelo de pacote'}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                <div className="field">
                  <label>Nome *</label>
                  <input value={form.name} onChange={setF('name')} required placeholder="Ex.: Pacote 10 sessões" />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>Número de sessões *</label>
                    <input type="number" min={1} value={form.session_count}
                      onChange={setF('session_count')} required />
                  </div>
                  <div className="field">
                    <label>Área</label>
                    <select value={form.area_id} onChange={setF('area_id')}>
                      <option value="">Qualquer área</option>
                      {activeAreas.map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>Preço (R$)</label>
                    <input type="number" min={0} step="0.01" value={form.price}
                      onChange={setF('price')} placeholder="0,00" />
                  </div>
                  <div className="field">
                    <label>Validade (dias)</label>
                    <input type="number" min={1} value={form.validity_days}
                      onChange={setF('validity_days')} placeholder="Sem validade" />
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      Deixe em branco para o pacote não expirar.
                    </span>
                  </div>
                </div>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? 'Salvando…' : editing ? 'Salvar' : 'Criar modelo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
