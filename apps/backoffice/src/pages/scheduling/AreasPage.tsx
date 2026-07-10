import { useEffect, useState, FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { useModal } from '../../contexts/ModalContext';
import { Can } from '../../rbac';
import { Badge } from '../../ds';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Area {
  id:                       string;
  name:                     string;
  description:              string | null;
  default_duration_minutes: number;
  default_price:            string | null;
  rules_text:               string | null;
  is_active:                boolean;
}

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: '',
  description: '',
  default_duration_minutes: '60',
  default_price: '',
  rules_text: '',
};

function fmtBRL(v: string | null): string {
  if (v === null || v === '') return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AreasPage() {
  const modal = useModal();

  // ── List state ─────────────────────────────────────────────────────────────
  const [items,        setItems]        = useState<Area[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // ── Drawer (create / edit) state ───────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Area | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  // ── Data loading ───────────────────────────────────────────────────────────

  async function load() {
    setLoading(true);
    try {
      const resp = await api.get<{ data: Area[] }>('/v1/scheduling/areas?include_inactive=true');
      setItems(resp.data);
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

  function openEdit(a: Area) {
    setEditing(a);
    setForm({
      name:                     a.name,
      description:              a.description ?? '',
      default_duration_minutes: String(a.default_duration_minutes),
      default_price:            a.default_price ?? '',
      rules_text:               a.rules_text ?? '',
    });
    setFormError('');
    setDrawerOpen(true);
  }

  function setF(field: keyof typeof EMPTY_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setFormError('');

    const duration = parseInt(form.default_duration_minutes, 10);
    if (!form.name.trim())                          { setFormError('Informe o nome da área.'); return; }
    if (!Number.isInteger(duration) || duration < 1) { setFormError('A duração padrão deve ser de pelo menos 1 minuto.'); return; }

    setSaving(true);
    try {
      const payload = {
        name:                     form.name.trim(),
        default_duration_minutes: duration,
        description:              form.description.trim()  || undefined,
        default_price:            form.default_price !== '' ? Number(form.default_price) : undefined,
        rules_text:               form.rules_text.trim()   || undefined,
      };
      if (editing) await api.patch(`/v1/scheduling/areas/${editing.id}`, payload);
      else         await api.post('/v1/scheduling/areas', payload);
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar a área.');
    } finally { setSaving(false); }
  }

  async function toggleActive(a: Area) {
    try {
      await api.patch(`/v1/scheduling/areas/${a.id}`, { is_active: !a.is_active });
      void load();
    } catch (err: unknown) { modal.error(err); }
  }

  async function handleDelete(a: Area) {
    const ok = await modal.confirm({
      title:        'Excluir área',
      message:      `Excluir definitivamente "${a.name}"? Vínculos existentes perdem a referência.`,
      confirmLabel: 'Excluir',
      danger:       true,
    });
    if (!ok) return;
    try {
      await api.delete(`/v1/scheduling/areas/${a.id}`);
      void load();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409 && err.body?.error === 'area_in_use') {
        modal.error(new Error('Esta área possui sessões no histórico e não pode ser excluída definitivamente. Desative-a — assim ela deixa de aparecer para novas marcações sem perder o histórico.'));
      } else {
        modal.error(err);
      }
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const visible = items
    .filter(a => showInactive || a.is_active)
    .filter(a => !search || a.name.toLowerCase().includes(search.toLowerCase()));

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <h1>Áreas de Atuação</h1>
        <Can permission="scheduling_areas:create">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
            + Nova área
          </button>
        </Can>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="flex-gap" style={{ marginBottom: 16, alignItems: 'center' }}>
        <input placeholder="Buscar área…" value={search}
          onChange={e => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
          Mostrar inativas
        </label>
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div className="spinner">Carregando…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            Nenhuma área de atuação cadastrada.{' '}
            <Can permission="scheduling_areas:create">
              <button className="btn btn-secondary btn-sm" onClick={openCreate}>Cadastrar a primeira</button>
            </Can>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Duração padrão</th>
                <th>Valor padrão</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(a => (
                <tr key={a.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{a.name}</div>
                    {a.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{a.description}</div>}
                  </td>
                  <td>{a.default_duration_minutes} min</td>
                  <td>{fmtBRL(a.default_price)}</td>
                  <td>
                    {a.is_active
                      ? <Badge variant="active">Ativa</Badge>
                      : <Badge variant="inactive">Inativa</Badge>}
                  </td>
                  <td>
                    <div className="flex-gap">
                      <Can permission="scheduling_areas:edit">
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(a)}>Editar</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => void toggleActive(a)}>
                          {a.is_active ? 'Desativar' : 'Reativar'}
                        </button>
                      </Can>
                      <Can permission="scheduling_areas:delete">
                        <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(a)}>Excluir</button>
                      </Can>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Drawer — create / edit ────────────────────────────────────── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{editing ? 'Editar área' : 'Nova área'}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                <div className="field">
                  <label>Nome *</label>
                  <input value={form.name} onChange={setF('name')} required placeholder="Ex.: Fisioterapia" />
                </div>

                <div className="field">
                  <label>Descrição</label>
                  <textarea value={form.description} onChange={setF('description')} rows={2}
                    placeholder="Descrição interna da área" />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>Duração padrão (minutos) *</label>
                    <input type="number" min={1} value={form.default_duration_minutes}
                      onChange={setF('default_duration_minutes')} required />
                  </div>
                  <div className="field">
                    <label>Valor padrão (R$)</label>
                    <input type="number" min={0} step="0.01" value={form.default_price}
                      onChange={setF('default_price')} placeholder="0,00" />
                  </div>
                </div>

                <div className="field">
                  <label>Regras para o cliente</label>
                  <textarea value={form.rules_text} onChange={setF('rules_text')} rows={4}
                    placeholder="Ex.: chegue 10 minutos antes; traga roupa confortável…" />
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    Este texto é exibido ao cliente no portal de agendamento.
                  </span>
                </div>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? 'Salvando…' : editing ? 'Salvar' : 'Criar área'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
