import { useEffect, useState, FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useModal } from '../../contexts/ModalContext';
import { Drawer, SlotPicker } from '../../ds';
import type { Slot, BadgeVariant } from '../../ds';
import { todayISO } from '../../lib/schedulingTime';

// ── Tipos compartilhados do módulo de sessões ─────────────────────────────────

export type SessionStatus = 'pending' | 'confirmed' | 'completed' | 'canceled' | 'declined';

export interface SessionRow {
  id:              string;
  professional_id: string;
  client_id:       string;
  client_name:     string;
  area_id:         string;
  package_id:      string | null;
  date:            string; // 'YYYY-MM-DD'
  start_time:      string; // 'HH:mm'
  end_time:        string;
  status:          SessionStatus;
  requested_by:    string | null;
  decline_reason:  string | null;
  cancel_reason:   string | null;
  notes:           string | null;
}

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  pending:   'Pendente',
  confirmed: 'Confirmada',
  completed: 'Concluída',
  canceled:  'Cancelada',
  declined:  'Recusada',
};

export const SESSION_STATUS_BADGE: Record<SessionStatus, BadgeVariant> = {
  pending:   'pending',
  confirmed: 'confirmed',
  completed: 'issued',
  canceled:  'cancelled',
  declined:  'inactive',
};

/** Mensagem exigida pela UX para 422 session_conflict — cita cliente e horário. */
export function conflictMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status !== 422 || err.body?.error !== 'session_conflict') return null;
  const c = err.body?.conflicting as
    | { client_name?: string; start_time?: string; end_time?: string }
    | undefined;
  return `Conflita com ${c?.client_name ?? 'outra sessão'} das ${c?.start_time ?? '—'} às ${c?.end_time ?? '—'}.`;
}

// ── Tipos internos do formulário ──────────────────────────────────────────────

interface AreaOpt {
  id:                       string;
  name:                     string;
  default_duration_minutes: number;
  is_active:                boolean;
}

interface ProfessionalOpt {
  id:        string;
  name:      string;
  is_active: boolean;
  area_ids:  string[];
}

interface ClientOpt {
  id:           string;
  company_name: string | null;
  full_name:    string | null;
}

interface ClientPackageOpt {
  id:                 string;
  name:               string;
  area_id:            string | null;
  total_sessions:     number;
  used_sessions:      number;
  remaining_sessions: number;
  payment_status:     string;
  status:             string;
  valid_until:        string | null;
}

export interface SessionFormInitial {
  date?:            string;
  start_time?:      string;
  professional_id?: string;
  client_id?:       string;
}

type SessionFormDrawerProps = {
  open:     boolean;
  onClose:  () => void;
  onSaved:  () => void;
  /** Pré-preenchimento para criação (clique no calendário, página do cliente…). */
  initial?: SessionFormInitial;
  /** Sessão existente → modo edição (PATCH). */
  session?: SessionRow | null;
};

const EMPTY_FORM = {
  client_id:       '',
  area_id:         '',
  professional_id: '',
  date:            '',
  start_time:      '',
  end_time:        '',
  package_id:      '',
  notes:           '',
};

function clientLabel(c: ClientOpt): string {
  return c.company_name ?? c.full_name ?? '—';
}

// ── Componente ────────────────────────────────────────────────────────────────

export function SessionFormDrawer({ open, onClose, onSaved, initial, session }: SessionFormDrawerProps) {
  const { tenantId } = useAuth();
  const modal = useModal();

  const [form,      setForm]      = useState({ ...EMPTY_FORM });
  const [formError, setFormError] = useState('');
  const [saving,    setSaving]    = useState(false);

  const [areas,         setAreas]         = useState<AreaOpt[]>([]);
  const [professionals, setProfessionals] = useState<ProfessionalOpt[]>([]);
  const [clients,       setClients]       = useState<ClientOpt[]>([]);
  const [clientSearch,  setClientSearch]  = useState('');
  const [slots,         setSlots]         = useState<Slot[]>([]);
  const [slotsLoading,  setSlotsLoading]  = useState(false);
  const [packages,      setPackages]      = useState<ClientPackageOpt[]>([]);

  const isEdit = !!session;

  // ── Inicialização a cada abertura ────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setFormError('');
    setClientSearch('');
    if (session) {
      setForm({
        client_id:       session.client_id,
        area_id:         session.area_id,
        professional_id: session.professional_id,
        date:            session.date,
        start_time:      session.start_time,
        end_time:        session.end_time,
        package_id:      session.package_id ?? '',
        notes:           session.notes ?? '',
      });
    } else {
      setForm({
        ...EMPTY_FORM,
        date:            initial?.date ?? todayISO(),
        start_time:      initial?.start_time ?? '',
        professional_id: initial?.professional_id ?? '',
        client_id:       initial?.client_id ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session?.id]);

  // ── Áreas ativas ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    api.get<{ data: AreaOpt[] }>('/v1/scheduling/areas')
      .then(r => setAreas(r.data.filter(a => a.is_active)))
      .catch(() => setAreas([]));
  }, [open]);

  // ── Clientes (busca com debounce) — só na criação; na edição o cliente é fixo
  useEffect(() => {
    if (!open || isEdit || !tenantId) return;
    const t = setTimeout(() => {
      const p = new URLSearchParams({
        tenant_id: tenantId, page: '1', per_page: '50',
        ...(clientSearch ? { search: clientSearch } : {}),
      });
      api.get<{ data: ClientOpt[] }>(`/v1/clients?${p}`)
        .then(r => setClients(r.data))
        .catch(() => { /**/ });
    }, 300);
    return () => clearTimeout(t);
  }, [open, isEdit, tenantId, clientSearch]);

  // ── Profissionais da área selecionada ────────────────────────────────────
  useEffect(() => {
    if (!open || !form.area_id) { setProfessionals([]); return; }
    api.get<{ data: ProfessionalOpt[] }>(`/v1/scheduling/professionals?area_id=${form.area_id}`)
      .then(r => {
        const active = r.data.filter(p => p.is_active);
        setProfessionals(active);
        // Profissional que não atende a nova área sai da seleção.
        setForm(f => (f.professional_id && !active.some(p => p.id === f.professional_id))
          ? { ...f, professional_id: '' }
          : f);
      })
      .catch(() => setProfessionals([]));
  }, [open, form.area_id]);

  // ── Slots disponíveis (área + profissional + data prontos) ───────────────
  useEffect(() => {
    if (!open || !form.professional_id || !form.area_id || !form.date) { setSlots([]); return; }
    setSlotsLoading(true);
    const p = new URLSearchParams({
      professional_id: form.professional_id, area_id: form.area_id, date: form.date,
    });
    api.get<{ data: Slot[] }>(`/v1/scheduling/slots?${p}`)
      .then(r => setSlots(r.data))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [open, form.professional_id, form.area_id, form.date]);

  // ── Pacotes ativos do cliente ────────────────────────────────────────────
  useEffect(() => {
    if (!open || !form.client_id) { setPackages([]); return; }
    api.get<{ data: ClientPackageOpt[] }>(`/v1/scheduling/client-packages?client_id=${form.client_id}&status=active`)
      .then(r => setPackages(r.data))
      .catch(() => setPackages([]));
  }, [open, form.client_id]);

  // Pacotes usáveis: área compatível (null = qualquer área) e com saldo.
  const usablePackages = packages.filter(p =>
    (p.area_id === null || p.area_id === form.area_id) && p.remaining_sessions > 0);

  // Auto-preseleção: exatamente 1 pacote usável → já vem escolhido (criação).
  useEffect(() => {
    if (!open || isEdit) return;
    setForm(f => {
      if (f.package_id && !usablePackages.some(p => p.id === f.package_id)) {
        return { ...f, package_id: '' };
      }
      if (!f.package_id && usablePackages.length === 1) {
        return { ...f, package_id: usablePackages[0].id };
      }
      return f;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, packages, form.area_id]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function setF(field: keyof typeof EMPTY_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setFormError('');

    if (!form.client_id)       { setFormError('Selecione o cliente.'); return; }
    if (!form.area_id)         { setFormError('Selecione a área.'); return; }
    if (!form.professional_id) { setFormError('Selecione o profissional.'); return; }
    if (!form.date)            { setFormError('Informe a data.'); return; }
    if (!form.start_time)      { setFormError('Escolha um horário disponível ou informe o horário de início.'); return; }

    setSaving(true);
    try {
      if (session) {
        // PATCH não aceita client_id; package_id/notes aceitam null para limpar.
        await api.patch(`/v1/scheduling/sessions/${session.id}`, {
          professional_id: form.professional_id,
          area_id:         form.area_id,
          date:            form.date,
          start_time:      form.start_time,
          end_time:        form.end_time || undefined,
          package_id:      form.package_id || null,
          notes:           form.notes.trim() || null,
        });
      } else {
        await api.post('/v1/scheduling/sessions', {
          professional_id: form.professional_id,
          client_id:       form.client_id,
          area_id:         form.area_id,
          date:            form.date,
          start_time:      form.start_time,
          end_time:        form.end_time || undefined,
          package_id:      form.package_id || undefined,
          notes:           form.notes.trim() || undefined,
        });
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      const conflict = conflictMessage(err);
      if (conflict) setFormError(conflict);
      else modal.error(err);
    } finally { setSaving(false); }
  }

  // ── Derivados de render ──────────────────────────────────────────────────

  const selectedClientKnown = clients.some(c => c.id === form.client_id);
  const packageOptions = usablePackages.slice();
  // Na edição, o pacote atual pode não ser mais "usável" (saldo já debitado) —
  // ainda assim precisa aparecer para não sumir da seleção.
  if (form.package_id && !packageOptions.some(p => p.id === form.package_id)) {
    const current = packages.find(p => p.id === form.package_id);
    if (current) packageOptions.push(current);
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar sessão' : 'Agendar sessão'}
      subTitle={isEdit ? session?.client_name : undefined}
    >
      <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
        <div className="drawer-body">
          {formError && <div className="alert alert-error" role="alert">{formError}</div>}

          {/* ── Cliente ─────────────────────────────────────────────── */}
          {isEdit ? (
            <div className="field">
              <label>Cliente</label>
              <input value={session?.client_name ?? ''} disabled />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                O cliente não pode ser trocado — cancele e crie uma nova sessão se precisar.
              </span>
            </div>
          ) : (
            <div className="field">
              <label>Cliente *</label>
              <input
                placeholder="Buscar cliente…"
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                style={{ marginBottom: 6 }}
              />
              <select value={form.client_id} onChange={setF('client_id')} required>
                <option value="">Selecione o cliente…</option>
                {form.client_id && !selectedClientKnown && (
                  <option value={form.client_id}>Cliente selecionado</option>
                )}
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{clientLabel(c)}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── Área e profissional ─────────────────────────────────── */}
          <div className="field-row">
            <div className="field">
              <label>Área *</label>
              <select value={form.area_id} onChange={setF('area_id')} required>
                <option value="">Selecione…</option>
                {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Profissional *</label>
              <select value={form.professional_id} onChange={setF('professional_id')}
                disabled={!form.area_id} required>
                <option value="">{form.area_id ? 'Selecione…' : 'Escolha a área antes'}</option>
                {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          {/* ── Data e horário ───────────────────────────────────────── */}
          <div className="field">
            <label>Data *</label>
            <input type="date" value={form.date} onChange={setF('date')} required />
          </div>

          <div className="field">
            <label>Horários disponíveis</label>
            {slotsLoading ? (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Buscando horários…</div>
            ) : form.professional_id && form.area_id && form.date ? (
              <SlotPicker
                slots={slots}
                value={form.start_time || null}
                onChange={slot => setForm(f => ({ ...f, start_time: slot.start, end_time: slot.end }))}
                emptyMessage="Nenhum horário livre neste dia — ajuste a data ou informe o horário manualmente."
              />
            ) : (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                Escolha cliente, área, profissional e data para ver os horários livres.
              </div>
            )}
          </div>

          <div className="field-row">
            <div className="field">
              <label>Início *</label>
              <input type="time" value={form.start_time} onChange={setF('start_time')} required />
            </div>
            <div className="field">
              <label>Fim</label>
              <input type="time" value={form.end_time} onChange={setF('end_time')} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                Em branco = duração padrão da área.
              </span>
            </div>
          </div>

          {/* ── Pacote ───────────────────────────────────────────────── */}
          <div className="field">
            <label>Pacote</label>
            <select value={form.package_id} onChange={setF('package_id')} disabled={!form.client_id}>
              <option value="">Sem pacote (avulsa)</option>
              {packageOptions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.remaining_sessions} de {p.total_sessions} {p.remaining_sessions === 1 ? 'restante' : 'restantes'}
                </option>
              ))}
            </select>
            {form.client_id && usablePackages.length === 0 && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                O cliente não tem pacote ativo com saldo para esta área.
              </span>
            )}
          </div>

          {/* ── Observações ──────────────────────────────────────────── */}
          <div className="field">
            <label>Observações</label>
            <textarea value={form.notes} onChange={setF('notes')} rows={3}
              placeholder="Anotações internas sobre a sessão" />
          </div>
        </div>

        <div className="drawer-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
            {saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Agendar'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
