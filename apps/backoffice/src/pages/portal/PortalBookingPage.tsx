import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { BalanceBar, SlotPicker, StepProgress } from '../../ds';
import type { Slot, Step } from '../../ds';
import { todayISO, formatDateBR } from '../../lib/schedulingTime';
import { usePortalMe } from './PortalLayout';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalPackage {
  id:                 string;
  name:               string;
  area_id:            string | null; // null = vale para qualquer área
  total_sessions:     number;
  used_sessions:      number;
  remaining_sessions: number;
}

interface PortalArea {
  id:          string;
  name:        string;
  description: string | null;
  default_duration_minutes: number;
  rules_text:  string | null;
}

interface Professional {
  id:   string;
  name: string;
  bio:  string | null;
}

const STEPS: Step[] = [
  { label: 'Serviço',      description: 'Pacote e área' },
  { label: 'Quem e quando', description: 'Profissional e data' },
  { label: 'Horário',      description: 'Escolha e confirme' },
];

const NO_PACKAGE = 'none'; // sentinela do "Sem pacote (avulso)"

function submitErrorMessage(err: unknown, minAdvanceFallback: number): string {
  if (err instanceof ApiError && err.body) {
    const h = typeof err.body.min_advance_hours === 'number' ? err.body.min_advance_hours : minAdvanceFallback;
    switch (err.body.error) {
      case 'slot_unavailable':       return 'Esse horário acabou de ficar indisponível. Escolha outro abaixo.';
      case 'min_advance_violation':  return `As solicitações precisam de pelo menos ${h}h de antecedência. Escolha outro horário.`;
      case 'session_conflict':       return 'Você já tem uma sessão marcada nesse horário.';
      case 'package_area_mismatch':  return 'O pacote escolhido não vale para esta área. Volte ao primeiro passo e ajuste.';
      case 'package_expired':        return 'O pacote escolhido está vencido. Volte ao primeiro passo e escolha outra opção.';
      case 'package_not_active':     return 'O pacote escolhido não está mais ativo. Volte ao primeiro passo e escolha outra opção.';
      case 'package_exhausted':      return 'As sessões deste pacote já foram todas usadas. Volte ao primeiro passo e escolha outra opção.';
      case 'self_booking_disabled':  return 'O agendamento online foi desativado. Fale diretamente com o profissional.';
    }
  }
  return 'Não foi possível enviar a solicitação. Tente novamente.';
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PortalBookingPage() {
  const me = usePortalMe();

  const [step, setStep] = useState(0);
  const [sent, setSent] = useState(false);

  // Passo 1 — pacote + área
  const [packages,       setPackages]       = useState<PortalPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [packageChoice,  setPackageChoice]  = useState<string | null>(null); // null=nada; NO_PACKAGE=avulso; senão id
  const [areas,          setAreas]          = useState<PortalArea[]>([]);
  const [areasLoading,   setAreasLoading]   = useState(false);
  const [areaId,         setAreaId]         = useState<string | null>(null);

  // Passo 2 — profissional + data
  const [professionals,  setProfessionals]  = useState<Professional[]>([]);
  const [prosLoading,    setProsLoading]    = useState(false);
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [date,           setDate]           = useState('');

  // Passo 3 — slots + envio
  const [slots,         setSlots]         = useState<Slot[]>([]);
  const [slotsLoading,  setSlotsLoading]  = useState(false);
  const [slotStart,     setSlotStart]     = useState<string | null>(null);
  const [slotsReload,   setSlotsReload]   = useState(0);
  const [notes,         setNotes]         = useState('');
  const [submitting,    setSubmitting]    = useState(false);

  const [error, setError] = useState('');

  const allowed = me.business.allow_self_booking;

  // ── Data loading ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!allowed) { setPackagesLoading(false); return; }
    let alive = true;
    api.get<{ data: PortalPackage[] }>('/v1/portal/packages?status=active')
      .then(resp => { if (alive) setPackages(resp.data); })
      .catch(() => { if (alive) setError('Não foi possível carregar seus pacotes. Tente novamente.'); })
      .finally(() => { if (alive) setPackagesLoading(false); });
    return () => { alive = false; };
  }, [allowed]);

  // Áreas dependem do pacote (pacote com área fixa devolve só ela).
  useEffect(() => {
    if (!allowed || packageChoice === null) return;
    let alive = true;
    setAreasLoading(true);
    setAreas([]);
    const qs = packageChoice !== NO_PACKAGE ? `?package_id=${encodeURIComponent(packageChoice)}` : '';
    api.get<{ data: PortalArea[] }>(`/v1/portal/areas${qs}`)
      .then(resp => {
        if (!alive) return;
        setAreas(resp.data);
        if (resp.data.length === 1) setAreaId(resp.data[0].id); // única opção → auto-seleciona
      })
      .catch(() => { if (alive) setError('Não foi possível carregar as áreas. Tente novamente.'); })
      .finally(() => { if (alive) setAreasLoading(false); });
    return () => { alive = false; };
  }, [allowed, packageChoice]);

  useEffect(() => {
    if (!allowed || !areaId) return;
    let alive = true;
    setProsLoading(true);
    setProfessionals([]);
    api.get<{ data: Professional[] }>(`/v1/portal/professionals?area_id=${encodeURIComponent(areaId)}`)
      .then(resp => {
        if (!alive) return;
        setProfessionals(resp.data);
        if (resp.data.length === 1) setProfessionalId(resp.data[0].id);
      })
      .catch(() => { if (alive) setError('Não foi possível carregar os profissionais. Tente novamente.'); })
      .finally(() => { if (alive) setProsLoading(false); });
    return () => { alive = false; };
  }, [allowed, areaId]);

  useEffect(() => {
    if (!allowed || step !== 2 || !professionalId || !areaId || !date) return;
    let alive = true;
    setSlotsLoading(true);
    setSlots([]);
    setSlotStart(null);
    api.get<{ data: Slot[] }>(
      `/v1/portal/slots?professional_id=${encodeURIComponent(professionalId)}&area_id=${encodeURIComponent(areaId)}&date=${encodeURIComponent(date)}`,
    )
      .then(resp => { if (alive) setSlots(resp.data); })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof ApiError && err.body?.error === 'self_booking_disabled'
          ? 'O agendamento online foi desativado. Fale diretamente com o profissional.'
          : 'Não foi possível carregar os horários. Tente novamente.');
      })
      .finally(() => { if (alive) setSlotsLoading(false); });
    return () => { alive = false; };
  }, [allowed, step, professionalId, areaId, date, slotsReload]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function choosePackage(choice: string) {
    setPackageChoice(choice);
    setAreaId(null);
    setProfessionalId(null);
    setDate('');
    setSlotStart(null);
    setError('');
  }

  function chooseArea(id: string) {
    setAreaId(id);
    setProfessionalId(null);
    setSlotStart(null);
    setError('');
  }

  async function handleSubmit() {
    if (!professionalId || !areaId || !date || !slotStart) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post('/v1/portal/sessions', {
        professional_id: professionalId,
        area_id:         areaId,
        date,
        start_time:      slotStart,
        package_id:      packageChoice && packageChoice !== NO_PACKAGE ? packageChoice : undefined,
        notes:           notes.trim() || undefined,
      });
      setSent(true);
    } catch (err: unknown) {
      setError(submitErrorMessage(err, me.business.min_advance_hours));
      if (err instanceof ApiError && err.body?.error === 'slot_unavailable') {
        setSlotsReload(k => k + 1); // horário sumiu → recarrega a grade
      }
    } finally { setSubmitting(false); }
  }

  function resetWizard() {
    setStep(0); setSent(false);
    setPackageChoice(null); setAreas([]); setAreaId(null);
    setProfessionals([]); setProfessionalId(null); setDate('');
    setSlots([]); setSlotStart(null); setNotes(''); setError('');
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const selectedArea = areas.find(a => a.id === areaId) ?? null;
  const selectedPro  = professionals.find(p => p.id === professionalId) ?? null;
  const selectedPkg  = packages.find(p => p.id === packageChoice) ?? null;
  const selectedSlot = slots.find(s => s.start === slotStart) ?? null;
  const dateValid    = date !== '' && date >= todayISO();

  // ── JSX ───────────────────────────────────────────────────────────────────

  if (!allowed) {
    return (
      <div>
        <h1 className="portal-hello">Agendar</h1>
        <div className="portal-note" role="status">
          Agendamentos são feitos diretamente com o profissional.
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="portal-card portal-success" role="status">
        <div className="portal-success__icon" aria-hidden="true">✓</div>
        <h2>Solicitação enviada!</h2>
        <p>Aguardando aprovação do profissional. Você acompanha o andamento em Minhas sessões.</p>
        <div className="portal-stack">
          <Link className="portal-cta" to="/portal/sessoes">Ver minhas sessões</Link>
          <button type="button" className="portal-btn-ghost" onClick={resetWizard}>
            Fazer outra solicitação
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="portal-hello">Solicitar horário</h1>
      <p className="portal-hello-sub">Sua solicitação será confirmada pelo profissional.</p>

      <StepProgress steps={STEPS} currentStep={step} />

      {error && <div className="alert alert-error" role="alert" style={{ marginTop: 14 }}>{error}</div>}

      {/* ── Passo 1 — pacote + área ────────────────────────────────────── */}
      {step === 0 && (
        <div className="portal-wizard-step">
          <h2>Como você quer pagar?</h2>
          {packagesLoading ? (
            <div className="spinner">Carregando…</div>
          ) : (
            <div className="portal-stack">
              <button type="button"
                className={`portal-option${packageChoice === NO_PACKAGE ? ' is-selected' : ''}`}
                onClick={() => choosePackage(NO_PACKAGE)}>
                <span className="portal-option__title">Sem pacote (avulso)</span>
                <span className="portal-option__meta">Uma sessão única, combinada direto com o profissional.</span>
              </button>
              {packages.map(p => (
                <button key={p.id} type="button"
                  className={`portal-option${packageChoice === p.id ? ' is-selected' : ''}`}
                  disabled={p.remaining_sessions <= 0}
                  onClick={() => choosePackage(p.id)}>
                  <span className="portal-option__title">{p.name}</span>
                  <span className="portal-option__meta">
                    {p.remaining_sessions} de {p.total_sessions} {p.remaining_sessions === 1 ? 'sessão restante' : 'sessões restantes'}
                  </span>
                  <span className="portal-option__balance">
                    <BalanceBar total={p.total_sessions} used={p.used_sessions} compact />
                  </span>
                </button>
              ))}
            </div>
          )}

          {packageChoice !== null && (
            <>
              <h2>Qual área?</h2>
              {areasLoading ? (
                <div className="spinner">Carregando…</div>
              ) : areas.length === 0 ? (
                <div className="portal-empty">Nenhuma área disponível para esta opção.</div>
              ) : (
                <div className="portal-stack">
                  {areas.map(a => (
                    <button key={a.id} type="button"
                      className={`portal-option${areaId === a.id ? ' is-selected' : ''}`}
                      onClick={() => chooseArea(a.id)}>
                      <span className="portal-option__title">{a.name}</span>
                      <span className="portal-option__meta">
                        {a.default_duration_minutes} min{a.description ? ` · ${a.description}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {selectedArea?.rules_text && (
                <div className="portal-rules" style={{ marginTop: 12 }}>
                  <strong>Regras de {selectedArea.name}</strong>
                  {selectedArea.rules_text}
                </div>
              )}
            </>
          )}

          <div className="portal-wizard-nav">
            <button type="button" className="portal-cta" disabled={!areaId}
              onClick={() => { setError(''); setStep(1); }}>
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* ── Passo 2 — profissional + data ──────────────────────────────── */}
      {step === 1 && (
        <div className="portal-wizard-step">
          <h2>Com quem?</h2>
          {prosLoading ? (
            <div className="spinner">Carregando…</div>
          ) : professionals.length === 0 ? (
            <div className="portal-empty">Nenhum profissional atende esta área no momento.</div>
          ) : (
            <div className="portal-stack">
              {professionals.map(p => (
                <button key={p.id} type="button"
                  className={`portal-option${professionalId === p.id ? ' is-selected' : ''}`}
                  onClick={() => { setProfessionalId(p.id); setSlotStart(null); setError(''); }}>
                  <span className="portal-option__title">{p.name}</span>
                  {p.bio && <span className="portal-option__meta">{p.bio}</span>}
                </button>
              ))}
            </div>
          )}

          <h2>Em que dia?</h2>
          <div className="field">
            <label htmlFor="pb-date">Data</label>
            <input id="pb-date" type="date" min={todayISO()} value={date}
              onChange={e => { setDate(e.target.value); setSlotStart(null); setError(''); }} />
          </div>

          <div className="portal-wizard-nav">
            <button type="button" className="portal-btn-ghost" onClick={() => { setError(''); setStep(0); }}>
              Voltar
            </button>
            <button type="button" className="portal-cta" disabled={!professionalId || !dateValid}
              onClick={() => { setError(''); setStep(2); }}>
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* ── Passo 3 — horário + confirmação ────────────────────────────── */}
      {step === 2 && (
        <div className="portal-wizard-step">
          <h2>Escolha o horário</h2>
          {slotsLoading ? (
            <div className="spinner">Carregando horários…</div>
          ) : (
            <SlotPicker slots={slots} value={slotStart} onChange={slot => { setSlotStart(slot.start); setError(''); }}
              emptyMessage="Nenhum horário disponível neste dia. Volte e tente outra data." />
          )}

          <h2>Observações</h2>
          <div className="field">
            <label htmlFor="pb-notes">Alguma informação para o profissional? (opcional)</label>
            <textarea id="pb-notes" rows={3} maxLength={500} value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ex.: primeira vez, preferência de atendimento…" />
          </div>

          <h2>Resumo</h2>
          <div className="portal-card">
            <dl className="portal-summary">
              <dt>Área</dt><dd>{selectedArea?.name ?? '—'}</dd>
              <dt>Profissional</dt><dd>{selectedPro?.name ?? '—'}</dd>
              <dt>Data</dt><dd>{date ? formatDateBR(date) : '—'}</dd>
              <dt>Horário</dt><dd>{selectedSlot ? `${selectedSlot.start} – ${selectedSlot.end}` : '—'}</dd>
              <dt>Pagamento</dt><dd>{selectedPkg ? selectedPkg.name : 'Sem pacote (avulso)'}</dd>
            </dl>
          </div>

          <div className="portal-wizard-nav">
            <button type="button" className="portal-btn-ghost" disabled={submitting}
              onClick={() => { setError(''); setStep(1); }}>
              Voltar
            </button>
            <button type="button" className="portal-cta" disabled={!slotStart || submitting}
              onClick={() => void handleSubmit()}>
              {submitting ? 'Enviando…' : 'Enviar solicitação'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
