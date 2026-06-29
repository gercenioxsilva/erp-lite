import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

interface PosTerminal {
  id: string;
  code: string;
  name: string;
  location: string | null;
  is_active: boolean;
  created_at: string;
}

interface TerminalForm {
  code: string;
  name: string;
  location: string;
}

const EMPTY_FORM: TerminalForm = { code: '', name: '', location: '' };

// ── Component ──────────────────────────────────────────────────────────────

export function PosTerminalsPage() {
  const [terminals, setTerminals] = useState<PosTerminal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TerminalForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<PosTerminal[]>('/v1/pos/terminals');
      setTerminals(data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar terminais.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setModalOpen(true);
  }

  function openEdit(t: PosTerminal) {
    setEditingId(t.id);
    setForm({ code: t.code, name: t.name, location: t.location ?? '' });
    setFormError('');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
  }

  async function handleSave() {
    if (!form.code.trim()) { setFormError('Código é obrigatório.'); return; }
    if (!form.name.trim()) { setFormError('Nome é obrigatório.'); return; }

    setSaving(true);
    setFormError('');
    try {
      if (editingId) {
        await api.patch(`/v1/pos/terminals/${editingId}`, {
          name: form.name.trim(),
          location: form.location.trim() || null,
        });
      } else {
        await api.post('/v1/pos/terminals', {
          code: form.code.trim(),
          name: form.name.trim(),
          location: form.location.trim() || null,
        });
      }
      closeModal();
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar terminal.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(terminal: PosTerminal) {
    try {
      await api.patch(`/v1/pos/terminals/${terminal.id}`, {
        is_active: !terminal.is_active,
      });
      void load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar terminal.');
    }
  }

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header">
        <h1>Terminais PDV</h1>
        <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
          + Novo Terminal
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div role="alert" className="alert alert-error" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="card">
        {loading ? (
          <div className="spinner">Carregando…</div>
        ) : terminals.length === 0 ? (
          <div className="empty-state">
            Nenhum terminal cadastrado.{' '}
            <button className="btn btn-secondary btn-sm" onClick={openCreate}>
              Criar terminal
            </button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Código</th>
                <th>Nome</th>
                <th>Localização</th>
                <th style={{ width: 90 }}>Ativo</th>
                <th style={{ width: 160 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {terminals.map(t => (
                <tr key={t.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{t.code}</td>
                  <td style={{ fontWeight: 500 }}>{t.name}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                    {t.location ?? '—'}
                  </td>
                  <td>
                    <span className={`badge ${t.is_active ? 'badge-active' : 'badge-inactive'}`}>
                      {t.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td>
                    <div className="flex-gap">
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ width: 'auto' }}
                        onClick={() => openEdit(t)}
                      >
                        Editar
                      </button>
                      <button
                        className={`btn btn-sm ${t.is_active ? 'btn-danger' : 'btn-secondary'}`}
                        style={{ width: 'auto' }}
                        onClick={() => void handleToggleActive(t)}
                      >
                        {t.is_active ? 'Desativar' : 'Ativar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modal ── */}
      {modalOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="terminal-modal-title"
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="modal-box" style={{ maxWidth: 420 }}>
            <h2 id="terminal-modal-title" style={{ marginBottom: 20 }}>
              {editingId ? 'Editar Terminal' : 'Novo Terminal'}
            </h2>

            {formError && (
              <div role="alert" className="alert alert-error" style={{ marginBottom: 14 }}>
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label>
                <span style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
                  Código <span aria-hidden="true" style={{ color: 'var(--danger)' }}>*</span>
                </span>
                <input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                  disabled={!!editingId}
                  placeholder="ex: PDV-01"
                  style={{ width: '100%' }}
                />
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
                  Nome <span aria-hidden="true" style={{ color: 'var(--danger)' }}>*</span>
                </span>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="ex: Caixa Principal"
                  style={{ width: '100%' }}
                />
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
                  Localização
                </span>
                <input
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="ex: Loja Centro"
                  style={{ width: '100%' }}
                />
              </label>
            </div>

            <div className="flex-gap" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={closeModal} disabled={saving}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
