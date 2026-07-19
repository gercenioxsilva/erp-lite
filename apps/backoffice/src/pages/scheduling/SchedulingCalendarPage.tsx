import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useModal } from '../../contexts/ModalContext';
import { Can, usePermissions } from '../../rbac';
import { Badge, CalendarWeekGrid, Drawer } from '../../ds';
import type { CalendarSession } from '../../ds';
import { addDaysISO, formatDateBR, todayISO, weekOf } from '../../lib/schedulingTime';
import {
  SessionFormDrawer, SESSION_STATUS_BADGE, SESSION_STATUS_LABEL, conflictMessage,
} from './SessionFormDrawer';
import type { SessionFormInitial, SessionRow } from './SessionFormDrawer';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ProfessionalOpt {
  id:        string;
  name:      string;
  is_active: boolean;
  area_ids:  string[];
}

interface AreaOpt {
  id:        string;
  name:      string;
  is_active: boolean;
}

// ── Componente ────────────────────────────────────────────────────────────────

export function SchedulingCalendarPage() {
  const modal = useModal();
  const { can } = usePermissions();

  const [professionals,  setProfessionals]  = useState<ProfessionalOpt[]>([]);
  const [professionalId, setProfessionalId] = useState('');
  const [myProfessionalId, setMyProfessionalId] = useState<string | null>(null);
  const [view,           setView]           = useState<'week' | 'day'>('week');
  const [loadError,      setLoadError]      = useState('');
  const [areas,          setAreas]          = useState<AreaOpt[]>([]);
  const [anchor,         setAnchor]         = useState(todayISO());
  const [sessions,       setSessions]       = useState<SessionRow[]>([]);
  const [loading,        setLoading]        = useState(true);

  // Drawer de criação/edição
  const [formOpen,    setFormOpen]    = useState(false);
  const [formInitial, setFormInitial] = useState<SessionFormInitial | undefined>(undefined);
  const [formSession, setFormSession] = useState<SessionRow | null>(null);

  // Drawer de detalhe + fluxo de recusa
  const [detail,        setDetail]        = useState<SessionRow | null>(null);
  const [declining,     setDeclining]     = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declineError,  setDeclineError]  = useState('');
  const [acting,        setActing]        = useState(false);

  const week = weekOf(anchor);
  const from = view === 'day' ? anchor : week[0];
  const to   = view === 'day' ? anchor : week[6];

  // ── Carregamento base: profissionais + áreas ─────────────────────────────
  useEffect(() => {
    Promise.all([
      api.get<{ data: ProfessionalOpt[] }>('/v1/scheduling/professionals'),
      // /professionals/me devolve o objeto DIRETO; 404 = usuário sem vínculo.
      api.get<{ id: string } | null>('/v1/scheduling/professionals/me').catch(() => null),
    ])
      .then(([r, me]) => {
        const active = r.data.filter(p => p.is_active);
        const mine = me?.id ?? null;
        setMyProfessionalId(mine);
        // Sem manage_all o backend só devolve a própria agenda — ancorar nela.
        const anchored = !can('scheduling:manage_all') && mine ? active.filter(p => p.id === mine) : active;
        setProfessionals(anchored);
        setProfessionalId(prev => prev || mine || (anchored[0]?.id ?? ''));
      })
      .catch(() => setProfessionals([]));
    api.get<{ data: AreaOpt[] }>('/v1/scheduling/areas?include_inactive=true')
      .then(r => setAreas(r.data))
      .catch(() => setAreas([]));
  }, []);

  // ── Sessões da semana (todos os status) ──────────────────────────────────
  const loadSessions = useCallback(async () => {
    if (!professionalId) { setSessions([]); setLoading(false); return; }
    setLoading(true);
    setLoadError('');
    try {
      const p = new URLSearchParams({
        professional_id: professionalId, from, to, per_page: '100',
      });
      const resp = await api.get<{ data: SessionRow[] }>(`/v1/scheduling/sessions?${p}`);
      setSessions(resp.data);
    } catch (err) {
      // Fix de auditoria: 403 not_own_agenda era engolido e virava grade
      // vazia sem explicação — agora o erro aparece.
      setSessions([]);
      setLoadError(err instanceof Error ? err.message : 'Falha ao carregar a agenda.');
    } finally { setLoading(false); }
  }, [professionalId, from, to]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const areaName = useMemo(() => new Map(areas.map(a => [a.id, a.name])), [areas]);

  const calendarSessions: CalendarSession[] = useMemo(() => sessions.map(s => ({
    id:          s.id,
    date:        s.date,
    start_time:  s.start_time,
    end_time:    s.end_time,
    status:      s.status,
    client_name: s.client_name,
    area_name:   areaName.get(s.area_id),
  })), [sessions, areaName]);

  // ── Handlers do grid ─────────────────────────────────────────────────────

  function handleSlotClick(date: string, time: string) {
    setFormSession(null);
    setFormInitial({ date, start_time: time, professional_id: professionalId });
    setFormOpen(true);
  }

  function handleSessionClick(cs: CalendarSession) {
    const row = sessions.find(s => s.id === cs.id);
    if (!row) return;
    setDeclining(false);
    setDeclineReason('');
    setDeclineError('');
    setDetail(row);
  }

  // ── Ações de status ──────────────────────────────────────────────────────

  async function runAction(fn: () => Promise<unknown>, onConflict?: string) {
    setActing(true);
    try {
      await fn();
      setDetail(null);
      void loadSessions();
    } catch (err: unknown) {
      const conflict = conflictMessage(err);
      if (conflict) modal.error(new Error(`${onConflict ?? 'Não foi possível concluir a ação.'} ${conflict}`));
      else modal.error(err);
    } finally { setActing(false); }
  }

  function approve(s: SessionRow) {
    void runAction(
      () => api.post(`/v1/scheduling/sessions/${s.id}/approve`, {}),
      'Não foi possível aprovar.',
    );
  }

  async function decline(s: SessionRow) {
    if (!declineReason.trim()) { setDeclineError('Informe o motivo da recusa — o cliente verá esta mensagem.'); return; }
    await runAction(() => api.post(`/v1/scheduling/sessions/${s.id}/decline`, { reason: declineReason.trim() }));
  }

  async function complete(s: SessionRow) {
    const ok = await modal.confirm({
      title:        'Concluir sessão',
      message:      s.package_id
        ? `Concluir a sessão de ${s.client_name}? 1 sessão será debitada do saldo do pacote.`
        : `Marcar a sessão de ${s.client_name} como concluída?`,
      confirmLabel: 'Concluir',
    });
    if (!ok) return;
    void runAction(() => api.post(`/v1/scheduling/sessions/${s.id}/complete`, {}));
  }

  async function markNoShow(s: SessionRow) {
    const ok = await modal.confirm({
      title:        'Registrar falta',
      message:      `Registrar que ${s.client_name} FALTOU à sessão de ${formatDateBR(s.date)} às ${s.start_time}? Nenhuma sessão é debitada do pacote.`,
      confirmLabel: 'Registrar falta',
      danger:       true,
    });
    if (!ok) return;
    void runAction(() => api.post(`/v1/scheduling/sessions/${s.id}/no-show`, {}));
  }

  async function cancel(s: SessionRow) {
    const ok = await modal.confirm({
      title:        'Cancelar sessão',
      message:      `Cancelar a sessão de ${s.client_name} em ${formatDateBR(s.date)} às ${s.start_time}? O horário volta a ficar livre.`,
      confirmLabel: 'Cancelar sessão',
      danger:       true,
    });
    if (!ok) return;
    void runAction(() => api.post(`/v1/scheduling/sessions/${s.id}/cancel`, {}));
  }

  async function remove(s: SessionRow) {
    const ok = await modal.confirm({
      title:        'Excluir sessão',
      message:      `Excluir definitivamente a sessão de ${s.client_name}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger:       true,
    });
    if (!ok) return;
    void runAction(() => api.delete(`/v1/scheduling/sessions/${s.id}`));
  }

  const canManage = can('scheduling:manage');

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <h1>Calendário</h1>
        <Can permission="scheduling:manage">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }}
            onClick={() => { setFormSession(null); setFormInitial({ professional_id: professionalId }); setFormOpen(true); }}>
            + Agendar sessão
          </button>
        </Can>
      </div>

      {/* ── Filtros: profissional + navegação de semana ──────────────── */}
      <div className="flex-gap" style={{ marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={professionalId} onChange={e => setProfessionalId(e.target.value)}
          style={{ width: 'auto', minWidth: 220 }} aria-label="Profissional"
          disabled={!can('scheduling:manage_all') && myProfessionalId !== null}>
          {professionals.length === 0 && <option value="">Nenhum profissional ativo</option>}
          {professionals.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === myProfessionalId ? ' (você)' : ''}</option>)}
        </select>

        <div className="flex-gap" style={{ alignItems: 'center' }}>
          <div role="group" aria-label="Visão" style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {(['week', 'day'] as const).map(v => (
              <button key={v} className="btn btn-sm" style={{
                width: 'auto', border: 'none', borderRadius: 0,
                background: view === v ? 'var(--primary)' : 'transparent',
                color: view === v ? '#fff' : undefined,
              }} onClick={() => setView(v)}>
                {v === 'week' ? 'Semana' : 'Dia'}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setAnchor(a => addDaysISO(a, view === 'day' ? -1 : -7))}
            aria-label={view === 'day' ? 'Dia anterior' : 'Semana anterior'}>‹</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setAnchor(todayISO())}>Hoje</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setAnchor(a => addDaysISO(a, view === 'day' ? 1 : 7))}
            aria-label={view === 'day' ? 'Próximo dia' : 'Próxima semana'}>›</button>
          <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 4 }}>
            {view === 'day' ? formatDateBR(anchor) : `${formatDateBR(from)} – ${formatDateBR(to)}`}
          </span>
        </div>
      </div>

      {loadError && (
        <div role="alert" style={{ marginBottom: 12, color: 'var(--danger, #b91c1c)', fontSize: 13 }}>{loadError}</div>
      )}

      {/* ── Grade semanal ────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        {loading ? (
          <div className="spinner" style={{ margin: '48px auto' }}>Carregando…</div>
        ) : !professionalId ? (
          <div className="empty-state">
            Cadastre um profissional para começar a usar o calendário.
          </div>
        ) : (
          <CalendarWeekGrid
            anchorDate={anchor}
            days={view === 'day' ? [anchor] : undefined}
            sessions={calendarSessions}
            onSessionClick={handleSessionClick}
            onSlotClick={canManage ? handleSlotClick : undefined}
          />
        )}
      </div>

      {/* ── Drawer de detalhe da sessão ──────────────────────────────── */}
      <Drawer
        open={detail !== null}
        onClose={() => setDetail(null)}
        title="Sessão"
        subTitle={detail ? `${formatDateBR(detail.date)} · ${detail.start_time}–${detail.end_time}` : undefined}
      >
        {detail && !declining && (
          <>
            <div className="drawer-body">
              <div className="flex-gap" style={{ marginBottom: 14, alignItems: 'center' }}>
                <Badge variant={SESSION_STATUS_BADGE[detail.status]}>
                  {SESSION_STATUS_LABEL[detail.status]}
                </Badge>
                {detail.requested_by === 'client' && <Badge variant="product">Portal</Badge>}
              </div>

              {/* Nome vira link p/ a central do cliente (pacotes, portal, histórico) */}
              <DetailRow label="Cliente" value={
                <Link to={`/scheduling/clients/${detail.client_id}`}>{detail.client_name}</Link>
              } />
              <DetailRow label="Data"         value={formatDateBR(detail.date)} />
              <DetailRow label="Horário"      value={`${detail.start_time} – ${detail.end_time}`} />
              <DetailRow label="Área"         value={areaName.get(detail.area_id) ?? '—'} />
              <DetailRow label="Pacote"       value={detail.package_id ? 'Vinculada a pacote' : 'Avulsa (sem pacote)'} />
              {detail.notes && <DetailRow label="Observações" value={detail.notes} />}
              {detail.status === 'declined' && detail.decline_reason && (
                <DetailRow label="Motivo da recusa" value={detail.decline_reason} />
              )}
              {detail.status === 'canceled' && detail.cancel_reason && (
                <DetailRow label="Motivo do cancelamento" value={detail.cancel_reason} />
              )}

              {detail.status === 'completed' && (
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
                  Sessão concluída — o registro é imutável.
                </div>
              )}
            </div>

            <div className="drawer-footer" style={{ flexWrap: 'wrap' }}>
              {detail.status === 'pending' && (
                <Can permission="scheduling:manage">
                  <button className="btn btn-danger" style={{ width: 'auto' }} disabled={acting}
                    onClick={() => { setDeclining(true); setDeclineError(''); }}>
                    Recusar
                  </button>
                  <button className="btn btn-primary" style={{ width: 'auto' }} disabled={acting}
                    onClick={() => approve(detail)}>
                    {acting ? 'Aprovando…' : 'Aprovar'}
                  </button>
                </Can>
              )}

              {detail.status === 'confirmed' && (
                <>
                  <Can permission="scheduling:manage">
                    <button className="btn btn-secondary btn-sm" disabled={acting}
                      onClick={() => { setFormSession(detail); setFormInitial(undefined); setDetail(null); setFormOpen(true); }}>
                      Editar
                    </button>
                    <button className="btn btn-secondary btn-sm" disabled={acting}
                      onClick={() => void cancel(detail)}>
                      Cancelar
                    </button>
                    <button className="btn btn-danger btn-sm" disabled={acting}
                      onClick={() => void remove(detail)}>
                      Excluir
                    </button>
                  </Can>
                  <Can permission="scheduling:complete">
                    <button className="btn btn-secondary btn-sm" disabled={acting}
                      onClick={() => void markNoShow(detail)}>
                      Faltou
                    </button>
                    <button className="btn btn-primary" style={{ width: 'auto' }} disabled={acting}
                      onClick={() => void complete(detail)}>
                      Concluir
                    </button>
                  </Can>
                </>
              )}

              {(detail.status === 'canceled' || detail.status === 'declined') && (
                <Can permission="scheduling:manage">
                  <button className="btn btn-danger" style={{ width: 'auto' }} disabled={acting}
                    onClick={() => void remove(detail)}>
                    Excluir
                  </button>
                </Can>
              )}

              {detail.status === 'completed' && (
                <button className="btn btn-secondary" onClick={() => setDetail(null)}>Fechar</button>
              )}
            </div>
          </>
        )}

        {detail && declining && (
          <>
            <div className="drawer-body">
              {declineError && <div className="alert alert-error" role="alert">{declineError}</div>}
              <div className="field">
                <label>Motivo da recusa *</label>
                <textarea value={declineReason} rows={4} autoFocus
                  onChange={e => setDeclineReason(e.target.value)}
                  placeholder="Ex.: horário indisponível — sugerimos reagendar para outro dia" />
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  O motivo é obrigatório e será exibido ao cliente.
                </span>
              </div>
            </div>
            <div className="drawer-footer">
              <button className="btn btn-secondary" onClick={() => setDeclining(false)} disabled={acting}>
                Voltar
              </button>
              <button className="btn btn-danger" style={{ width: 'auto' }} disabled={acting}
                onClick={() => void decline(detail)}>
                {acting ? 'Recusando…' : 'Confirmar recusa'}
              </button>
            </div>
          </>
        )}
      </Drawer>

      {/* ── Drawer de criação/edição ─────────────────────────────────── */}
      <SessionFormDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => void loadSessions()}
        initial={formInitial}
        session={formSession}
      />
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
      <span style={{ flex: '0 0 150px', color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}
