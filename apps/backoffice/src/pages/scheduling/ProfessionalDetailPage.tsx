import { useEffect, useState, FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useModal } from '../../contexts/ModalContext';
import { Can, usePermissions } from '../../rbac';
import { Badge, AvailabilityWeekEditor } from '../../ds';
import type { WeeklyRule } from '../../ds';
import { Switch } from '../../ds/components/Switch';

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

interface AvailabilityException {
  id:         string;
  date:       string;
  kind:       'block' | 'open';
  start_time: string | null;
  end_time:   string | null;
  note:       string | null;
}

interface GcalStatus {
  connected: boolean;
  status?: string;
  google_account_email?: string | null;
  connected_at?: string | null;
}

interface AvailabilityResp {
  weekly:     { id: string; weekday: number; start_time: string; end_time: string }[];
  exceptions: AvailabilityException[];
}

type ExceptionMode = 'block_full' | 'block_partial' | 'open';

// ── Empty forms ────────────────────────────────────────────────────────────────

const EMPTY_DATA_FORM = { name: '', email: '', phone: '', bio: '' };

const EMPTY_EXCEPTION_FORM = {
  date:       '',
  mode:       'block_full' as ExceptionMode,
  start_time: '09:00',
  end_time:   '12:00',
  note:       '',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR');
}

function exceptionLabel(ex: AvailabilityException): string {
  if (ex.kind === 'open') return `Abertura extra ${ex.start_time ?? ''}–${ex.end_time ?? ''}`;
  if (ex.start_time && ex.end_time) return `Bloqueio ${ex.start_time}–${ex.end_time}`;
  return 'Bloqueio (dia inteiro)';
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ProfessionalDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate    = useNavigate();
  const modal       = useModal();
  const { can }     = usePermissions();

  const canEdit = can('scheduling_professionals:edit');

  // ── Load state ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [prof,    setProf]    = useState<Professional | null>(null);
  const [areas,   setAreas]   = useState<Area[]>([]);

  // ── (a) Dados ──────────────────────────────────────────────────────────────
  const [dataForm,   setDataForm]   = useState({ ...EMPTY_DATA_FORM });
  const [savingData, setSavingData] = useState(false);
  const [dataError,  setDataError]  = useState('');

  // ── (b) Áreas ──────────────────────────────────────────────────────────────
  const [areaIds,     setAreaIds]     = useState<string[]>([]);
  const [savingAreas, setSavingAreas] = useState(false);

  // ── (c) Grade semanal ──────────────────────────────────────────────────────
  const [weekly,       setWeekly]       = useState<WeeklyRule[]>([]);
  const [savingWeekly, setSavingWeekly] = useState(false);

  // ── (d) Exceções ───────────────────────────────────────────────────────────
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  const [exForm,     setExForm]     = useState({ ...EMPTY_EXCEPTION_FORM });
  const [savingEx,   setSavingEx]   = useState(false);
  const [exError,    setExError]    = useState('');

  // ── (e) Acesso ─────────────────────────────────────────────────────────────
  const [accessOpen,   setAccessOpen]   = useState(false);
  const [accessForm,   setAccessForm]   = useState({ email: '', password: '' });
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessError,  setAccessError]  = useState('');

  // ── (f) Google Calendar ────────────────────────────────────────────────────
  const [gcal, setGcal] = useState<GcalStatus | null>(null);
  const [gcalBusy, setGcalBusy] = useState(false);
  const [gcalMsg, setGcalMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function loadGcalStatus() {
    try {
      setGcal(await api.get<GcalStatus>(`/v1/integrations/google/status?professional_id=${id}`));
    } catch { setGcal(null); }
  }

  // Lê ?gcal_status do retorno do OAuth (uma vez), mostra alerta e recarrega status.
  useEffect(() => {
    if (!id) return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('gcal_status');
    if (status === 'connected') setGcalMsg({ kind: 'ok', text: 'Google Calendar conectado.' });
    else if (status === 'error') setGcalMsg({ kind: 'err', text: 'Não foi possível conectar ao Google Calendar. Tente novamente.' });
    if (status) window.history.replaceState({}, '', `/scheduling/professionals/${id}`);
    void loadGcalStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function connectGcal() {
    setGcalBusy(true);
    try {
      const r = await api.get<{ authorization_url: string }>(`/v1/integrations/google/connect?professional_id=${id}`);
      window.location.href = r.authorization_url;
    } catch (err) {
      modal.error(err);
      setGcalBusy(false);
    }
  }

  async function disconnectGcal() {
    const ok = await modal.confirm({ title: 'Desconectar Google Calendar?', message: 'As sessões deixarão de ser sincronizadas com a agenda do Google. Eventos já criados não são removidos.', danger: true });
    if (!ok) return;
    setGcalBusy(true);
    try {
      await api.delete(`/v1/integrations/google?professional_id=${id}`);
      await loadGcalStatus();
    } catch (err) { modal.error(err); }
    finally { setGcalBusy(false); }
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      try {
        const [profs, areasResp, avail] = await Promise.all([
          api.get<{ data: Professional[] }>('/v1/scheduling/professionals?include_inactive=true'),
          api.get<{ data: Area[] }>('/v1/scheduling/areas'),
          api.get<AvailabilityResp>(`/v1/scheduling/professionals/${id}/availability`),
        ]);
        if (cancelled) return;
        const found = profs.data.find(p => p.id === id) ?? null;
        setProf(found);
        if (found) {
          setDataForm({
            name:  found.name,
            email: found.email ?? '',
            phone: found.phone ?? '',
            bio:   found.bio   ?? '',
          });
          setAreaIds(found.area_ids);
        }
        setAreas(areasResp.data);
        setWeekly(avail.weekly.map(({ weekday, start_time, end_time }) => ({ weekday, start_time, end_time })));
        setExceptions(avail.exceptions);
      } catch { /**/ } finally { if (!cancelled) setLoading(false); }
    }

    void loadAll();
    return () => { cancelled = true; };
  }, [id]);

  // ── (a) Dados handlers ─────────────────────────────────────────────────────

  function setD(field: keyof typeof EMPTY_DATA_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDataForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSaveData(e: FormEvent) {
    e.preventDefault();
    setDataError('');
    if (!dataForm.name.trim()) { setDataError('Informe o nome do profissional.'); return; }

    setSavingData(true);
    try {
      await api.patch(`/v1/scheduling/professionals/${id}`, {
        name:  dataForm.name.trim(),
        email: dataForm.email.trim() || undefined,
        phone: dataForm.phone.trim() || undefined,
        bio:   dataForm.bio.trim()   || undefined,
      });
      setProf(p => (p ? { ...p, name: dataForm.name.trim() } : p));
      modal.success('Dados do profissional salvos.');
    } catch (err: unknown) {
      setDataError(err instanceof Error ? err.message : 'Erro ao salvar os dados.');
    } finally { setSavingData(false); }
  }

  async function toggleActive() {
    if (!prof) return;
    try {
      await api.patch(`/v1/scheduling/professionals/${id}`, { is_active: !prof.is_active });
      setProf(p => (p ? { ...p, is_active: !p.is_active } : p));
    } catch (err: unknown) { modal.error(err); }
  }

  // ── (b) Áreas handlers ─────────────────────────────────────────────────────

  function toggleArea(areaId: string) {
    setAreaIds(prev => prev.includes(areaId) ? prev.filter(a => a !== areaId) : [...prev, areaId]);
  }

  async function handleSaveAreas() {
    setSavingAreas(true);
    try {
      await api.put(`/v1/scheduling/professionals/${id}/areas`, { area_ids: areaIds });
      modal.success('Áreas atendidas atualizadas.');
    } catch (err: unknown) { modal.error(err); } finally { setSavingAreas(false); }
  }

  // ── (c) Grade semanal handlers ─────────────────────────────────────────────

  async function handleSaveWeekly() {
    setSavingWeekly(true);
    try {
      await api.put(`/v1/scheduling/professionals/${id}/availability/weekly`, { rules: weekly });
      modal.success('Grade semanal salva.');
    } catch (err: unknown) { modal.error(err); } finally { setSavingWeekly(false); }
  }

  // ── (d) Exceções handlers ──────────────────────────────────────────────────

  async function reloadExceptions() {
    try {
      const avail = await api.get<AvailabilityResp>(`/v1/scheduling/professionals/${id}/availability`);
      // Só as exceções: não sobrescreve edições não salvas da grade semanal.
      setExceptions(avail.exceptions);
    } catch { /**/ }
  }

  async function handleAddException(e: FormEvent) {
    e.preventDefault();
    setExError('');

    if (!exForm.date) { setExError('Informe a data da exceção.'); return; }
    const needsTimes = exForm.mode !== 'block_full';
    if (needsTimes && (!exForm.start_time || !exForm.end_time)) {
      setExError('Informe o horário de início e fim.'); return;
    }
    if (needsTimes && exForm.start_time >= exForm.end_time) {
      setExError('O horário de início deve ser antes do fim.'); return;
    }

    setSavingEx(true);
    try {
      await api.post(`/v1/scheduling/professionals/${id}/availability/exceptions`, {
        date:       exForm.date,
        kind:       exForm.mode === 'open' ? 'open' : 'block',
        start_time: needsTimes ? exForm.start_time : undefined,
        end_time:   needsTimes ? exForm.end_time   : undefined,
        note:       exForm.note.trim() || undefined,
      });
      setExForm({ ...EMPTY_EXCEPTION_FORM });
      void reloadExceptions();
    } catch (err: unknown) {
      setExError(err instanceof Error ? err.message : 'Erro ao adicionar a exceção.');
    } finally { setSavingEx(false); }
  }

  async function handleRemoveException(ex: AvailabilityException) {
    const ok = await modal.confirm({
      title:        'Remover exceção',
      message:      `Remover a exceção de ${fmtDate(ex.date)} (${exceptionLabel(ex)})?`,
      confirmLabel: 'Remover',
      danger:       true,
    });
    if (!ok) return;
    try {
      await api.delete(`/v1/scheduling/availability/exceptions/${ex.id}`);
      setExceptions(prev => prev.filter(x => x.id !== ex.id));
    } catch (err: unknown) { modal.error(err); }
  }

  // ── (e) Acesso handlers ────────────────────────────────────────────────────

  function openAccessDrawer() {
    setAccessForm({ email: prof?.email ?? '', password: '' });
    setAccessError('');
    setAccessOpen(true);
  }

  async function handleCreateAccess(e: FormEvent) {
    e.preventDefault();
    setAccessError('');

    if (!accessForm.email.trim())        { setAccessError('Informe o e-mail de acesso.'); return; }
    if (accessForm.password.length < 8)  { setAccessError('A senha deve ter pelo menos 8 caracteres.'); return; }

    setSavingAccess(true);
    try {
      await api.post(`/v1/scheduling/professionals/${id}/user`, {
        email:    accessForm.email.trim(),
        password: accessForm.password,
      });
      // O valor exato de user_id não é exibido — só a presença importa aqui.
      setProf(p => (p ? { ...p, user_id: 'created' } : p));
      setAccessOpen(false);
      modal.success('Acesso criado para o profissional.');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        const code = err.body?.error;
        if (code === 'professional_already_has_user') {
          setAccessError('Este profissional já possui um usuário de acesso.');
        } else if (code === 'email_already_in_use') {
          setAccessError('Este e-mail já está em uso por outro usuário.');
        } else {
          setAccessError(err.message);
        }
      } else {
        setAccessError(err instanceof Error ? err.message : 'Erro ao criar o acesso.');
      }
    } finally { setSavingAccess(false); }
  }

  // ── JSX ───────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="spinner">Carregando…</div>;
  }

  if (!prof) {
    return (
      <div className="card">
        <div className="empty-state">
          Profissional não encontrado.{' '}
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/scheduling/professionals')}>
            Voltar para a lista
          </button>
        </div>
      </div>
    );
  }

  const cardStyle: React.CSSProperties = { padding: 24, marginBottom: 16 };

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/scheduling/professionals')}>
            ← Voltar
          </button>
          <h1>{prof.name}</h1>
          {prof.is_active
            ? <Badge variant="active">Ativo</Badge>
            : <Badge variant="inactive">Inativo</Badge>}
        </div>
      </div>

      {/* ── (a) Dados ────────────────────────────────────────────────── */}
      <div className="card" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}>Dados</h3>
          <Can permission="scheduling_professionals:edit">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)' }}>
              {prof.is_active ? 'Ativo' : 'Inativo'}
              <Switch checked={prof.is_active} onChange={() => void toggleActive()} label="Profissional ativo" />
            </label>
          </Can>
        </div>

        <form onSubmit={handleSaveData} noValidate>
          {dataError && <div className="alert alert-error" role="alert">{dataError}</div>}

          <div className="field">
            <label>Nome *</label>
            <input value={dataForm.name} onChange={setD('name')} required disabled={!canEdit} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>E-mail</label>
              <input type="email" value={dataForm.email} onChange={setD('email')} disabled={!canEdit} />
            </div>
            <div className="field">
              <label>Telefone</label>
              <input value={dataForm.phone} onChange={setD('phone')} placeholder="(11) 99999-0000" disabled={!canEdit} />
            </div>
          </div>
          <div className="field">
            <label>Bio</label>
            <textarea value={dataForm.bio} onChange={setD('bio')} rows={3} disabled={!canEdit}
              placeholder="Breve apresentação exibida ao cliente" />
          </div>

          <Can permission="scheduling_professionals:edit">
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={savingData}>
              {savingData ? 'Salvando…' : 'Salvar dados'}
            </button>
          </Can>
        </form>
      </div>

      {/* ── (b) Áreas ────────────────────────────────────────────────── */}
      <div className="card" style={cardStyle}>
        <h3 style={{ fontSize: 15, marginBottom: 16 }}>Áreas atendidas</h3>

        {areas.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            Nenhuma área de atuação cadastrada.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {areas.filter(a => a.is_active || areaIds.includes(a.id)).map(a => (
              <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: canEdit ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={areaIds.includes(a.id)} disabled={!canEdit}
                  onChange={() => toggleArea(a.id)} style={{ width: 'auto', margin: 0 }} />
                {a.name}{!a.is_active && <span style={{ fontSize: 11, color: 'var(--muted)' }}>(inativa)</span>}
              </label>
            ))}
          </div>
        )}

        <Can permission="scheduling_professionals:edit">
          <button className="btn btn-primary" style={{ width: 'auto' }} disabled={savingAreas}
            onClick={() => void handleSaveAreas()}>
            {savingAreas ? 'Salvando…' : 'Salvar áreas'}
          </button>
        </Can>
      </div>

      {/* ── (c) Grade semanal ────────────────────────────────────────── */}
      <div className="card" style={cardStyle}>
        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Grade semanal</h3>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Horários em que o profissional atende regularmente. Dias sem faixas ficam fechados.
        </p>

        <AvailabilityWeekEditor value={weekly} onChange={setWeekly} disabled={!canEdit} />

        <Can permission="scheduling_professionals:edit">
          <button className="btn btn-primary" style={{ width: 'auto', marginTop: 16 }} disabled={savingWeekly}
            onClick={() => void handleSaveWeekly()}>
            {savingWeekly ? 'Salvando…' : 'Salvar grade'}
          </button>
        </Can>
      </div>

      {/* ── (d) Exceções ─────────────────────────────────────────────── */}
      <div className="card" style={cardStyle}>
        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Exceções</h3>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Bloqueios pontuais (folgas, feriados) ou aberturas extras fora da grade semanal.
        </p>

        {exceptions.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Nenhuma exceção cadastrada.</p>
        ) : (
          <div style={{ marginBottom: 16 }}>
            {exceptions.map(ex => (
              <div key={ex.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                borderBottom: '1px solid var(--border)', fontSize: 13,
              }}>
                <span style={{ fontWeight: 500, minWidth: 90 }}>{fmtDate(ex.date)}</span>
                <Badge variant={ex.kind === 'open' ? 'active' : 'cancelled'}>
                  {ex.kind === 'open' ? 'Abertura' : 'Bloqueio'}
                </Badge>
                <span style={{ flex: 1 }}>
                  {exceptionLabel(ex)}
                  {ex.note && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>· {ex.note}</span>}
                </span>
                <Can permission="scheduling_professionals:edit">
                  <button className="btn btn-danger btn-sm" onClick={() => void handleRemoveException(ex)}>
                    Remover
                  </button>
                </Can>
              </div>
            ))}
          </div>
        )}

        <Can permission="scheduling_professionals:edit">
          <form onSubmit={handleAddException} noValidate>
            {exError && <div className="alert alert-error" role="alert">{exError}</div>}

            <div className="field-row-3">
              <div className="field">
                <label>Data *</label>
                <input type="date" value={exForm.date}
                  onChange={e => setExForm(f => ({ ...f, date: e.target.value }))} required />
              </div>
              <div className="field">
                <label>Tipo *</label>
                <select value={exForm.mode}
                  onChange={e => setExForm(f => ({ ...f, mode: e.target.value as ExceptionMode }))}>
                  <option value="block_full">Bloqueio dia inteiro</option>
                  <option value="block_partial">Bloqueio parcial</option>
                  <option value="open">Abertura extra</option>
                </select>
              </div>
              {exForm.mode !== 'block_full' ? (
                <div className="field">
                  <label>Horário *</label>
                  <div className="flex-gap">
                    <input type="time" value={exForm.start_time}
                      onChange={e => setExForm(f => ({ ...f, start_time: e.target.value }))} />
                    <span aria-hidden>–</span>
                    <input type="time" value={exForm.end_time}
                      onChange={e => setExForm(f => ({ ...f, end_time: e.target.value }))} />
                  </div>
                </div>
              ) : <div />}
            </div>

            <div className="field">
              <label>Nota</label>
              <input value={exForm.note}
                onChange={e => setExForm(f => ({ ...f, note: e.target.value }))}
                placeholder="Ex.: feriado, consulta médica…" />
            </div>

            <button type="submit" className="btn btn-secondary" style={{ width: 'auto' }} disabled={savingEx}>
              {savingEx ? 'Adicionando…' : '+ Adicionar exceção'}
            </button>
          </form>
        </Can>
      </div>

      {/* ── (e) Acesso ───────────────────────────────────────────────── */}
      <div className="card" style={cardStyle}>
        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Acesso ao sistema</h3>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Com um usuário de acesso, o profissional consulta a própria agenda no sistema.
        </p>

        {prof.user_id ? (
          <Badge variant="confirmed">Acesso criado ✓</Badge>
        ) : (
          <Can permission="users:create"
            fallback={<span style={{ fontSize: 13, color: 'var(--muted)' }}>Este profissional ainda não possui acesso.</span>}>
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={openAccessDrawer}>
              Criar acesso
            </button>
          </Can>
        )}
      </div>

      {/* ── (f) Google Calendar ──────────────────────────────────────── */}
      <div className="card" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <h3 style={{ fontSize: 15, margin: 0 }}>Google Calendar</h3>
          {gcal?.connected && <Badge variant="confirmed">Conectado</Badge>}
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Conecte a agenda do Google deste profissional para que as sessões apareçam automaticamente no calendário dele.
        </p>

        {gcalMsg && (
          <div className={`alert ${gcalMsg.kind === 'ok' ? 'alert-success' : 'alert-error'}`} role="alert" style={{ marginBottom: 12 }}>
            {gcalMsg.text}
          </div>
        )}

        {gcal?.connected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {gcal.google_account_email && (
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                Conta: <strong style={{ color: 'var(--text)' }}>{gcal.google_account_email}</strong>
              </span>
            )}
            <Can permission="scheduling:manage">
              <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={disconnectGcal} disabled={gcalBusy}>
                {gcalBusy ? '…' : 'Desconectar'}
              </button>
            </Can>
          </div>
        ) : (
          <Can permission="scheduling:manage"
            fallback={<span style={{ fontSize: 13, color: 'var(--muted)' }}>Nenhuma agenda do Google conectada.</span>}>
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={connectGcal} disabled={gcalBusy}>
              {gcalBusy ? 'Redirecionando…' : 'Conectar Google Calendar'}
            </button>
          </Can>
        )}
      </div>

      {/* ── Drawer — criar acesso ────────────────────────────────────── */}
      {accessOpen && (
        <div className="overlay" onClick={() => setAccessOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>Criar acesso</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setAccessOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateAccess} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {accessError && <div className="alert alert-error" role="alert">{accessError}</div>}

                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                  O profissional entrará no sistema com este e-mail e senha.
                </p>

                <div className="field">
                  <label>E-mail *</label>
                  <input type="email" value={accessForm.email} required autoComplete="username"
                    onChange={e => setAccessForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Senha *</label>
                  <input type="password" value={accessForm.password} required minLength={8}
                    placeholder="Mínimo de 8 caracteres" autoComplete="new-password"
                    onChange={e => setAccessForm(f => ({ ...f, password: e.target.value }))} />
                </div>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setAccessOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={savingAccess}>
                  {savingAccess ? 'Criando…' : 'Criar acesso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
