import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { StepProgress, AvailabilityWeekEditor } from '../../ds';
import type { Step, WeeklyRule } from '../../ds';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Settings {
  business_name:       string | null;
  business_type:       string | null;
  onboarding_complete: boolean;
}

interface Area {
  id:        string;
  name:      string;
  is_active: boolean;
}

interface Professional {
  id:      string;
  name:    string;
  user_id: string | null;
  area_ids?: string[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STEPS: Step[] = [
  { label: 'Seu negócio',      description: 'Como você se apresenta' },
  { label: 'Primeira área',    description: 'O que você oferece' },
  { label: 'Disponibilidade',  description: 'Quando você atende' },
];

// Grade padrão: segunda a sexta (1–5), 09:00–18:00.
const DEFAULT_WEEK: WeeklyRule[] = [1, 2, 3, 4, 5].map(weekday => ({
  weekday, start_time: '09:00', end_time: '18:00',
}));

// A grade semanal precisa de espaço pra mostrar a semana inteira numa linha
// só — os outros dois passos são formulários de 1-2 campos e ficam melhor
// numa coluna estreita e centrada, então só este passo pede mais largura.
const WIDE_STEP = 2;
const NARROW_WIDTH = 680;
const WIDE_WIDTH   = 1180;

// ── Main component ─────────────────────────────────────────────────────────────

export function SchedulingOnboardingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [step,  setStep]  = useState<0 | 1 | 2>(0);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  // ── Passo 1 — Seu negócio ──────────────────────────────────────────────────
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');

  // ── Passo 2 — Primeira área ────────────────────────────────────────────────
  const [existingAreas,  setExistingAreas]  = useState<Area[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [areaName,       setAreaName]       = useState('');
  const [areaDuration,   setAreaDuration]   = useState('60');

  // ── Passo 3 — Disponibilidade ──────────────────────────────────────────────
  const [selfService, setSelfService] = useState(true);
  const [profName,    setProfName]    = useState('');
  const [rules,       setRules]       = useState<WeeklyRule[]>(DEFAULT_WEEK);
  const [existingProfessionals, setExistingProfessionals] = useState<Professional[]>([]);

  // ── Data loading (pré-preenche negócio + áreas + profissionais já existentes)

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      try {
        const [settings, areasResp, profResp] = await Promise.all([
          api.get<Settings>('/v1/scheduling/settings'),
          api.get<{ data: Area[] }>('/v1/scheduling/areas'),
          api.get<{ data: Professional[] }>('/v1/scheduling/professionals?include_inactive=true'),
        ]);
        if (cancelled) return;
        setBusinessName(settings.business_name ?? '');
        setBusinessType(settings.business_type ?? '');
        const active = areasResp.data.filter(a => a.is_active);
        setExistingAreas(active);
        if (active.length > 0) setSelectedAreaId(active[0].id);
        setExistingProfessionals(profResp.data);

        // Já existe um profissional vinculado ao próprio usuário — provavelmente
        // um retorno ao onboarding: pré-marca "eu mesmo atendo" com esse nome.
        const own = profResp.data.find(p => p.user_id === user?.id);
        if (own) setProfName(own.name);
      } catch { /**/ }
    }

    void loadInitial();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goToStep(n: 0 | 1 | 2) {
    setError('');
    setStep(n);
  }

  // ── Passo 1 — salvar negócio ───────────────────────────────────────────────

  async function handleBusinessSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!businessName.trim()) { setError('Informe o nome do seu negócio.'); return; }

    setBusy(true);
    try {
      await api.patch('/v1/scheduling/settings', {
        business_name: businessName.trim(),
        business_type: businessType.trim() || undefined,
      });
      goToStep(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar os dados do negócio.');
    } finally { setBusy(false); }
  }

  // ── Passo 2 — criar / escolher área ────────────────────────────────────────

  async function handleAreaSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    // Já existe área: só segue com a seleção atual.
    if (existingAreas.length > 0) { goToStep(2); return; }

    const duration = parseInt(areaDuration, 10);
    if (!areaName.trim())                            { setError('Informe o nome da área.'); return; }
    if (!Number.isInteger(duration) || duration < 1) { setError('A duração padrão deve ser de pelo menos 1 minuto.'); return; }

    setBusy(true);
    try {
      const created = await api.post<Area>('/v1/scheduling/areas', {
        name:                     areaName.trim(),
        default_duration_minutes: duration,
      });
      let newId: string | null = created?.id ?? null;
      if (!newId) {
        // Resposta sem corpo: recarrega e localiza pelo nome.
        const resp = await api.get<{ data: Area[] }>('/v1/scheduling/areas');
        newId = resp.data.find(a => a.name.toLowerCase() === areaName.trim().toLowerCase())?.id ?? null;
      }
      setSelectedAreaId(newId);
      goToStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao criar a área.');
    } finally { setBusy(false); }
  }

  function skipAreaStep() {
    setSelectedAreaId(null);
    goToStep(2);
  }

  // ── Passo 3 — profissional + grade + concluir ──────────────────────────────

  // Reaproveita um profissional já cadastrado sempre que possível — só cria
  // um novo quando de fato não existe (evita duplicar por causa de um
  // reenvio do formulário ou de o usuário digitar um nome já cadastrado).
  async function ensureProfessional(name: string): Promise<string> {
    const reuse = selfService
      ? existingProfessionals.find(p => p.user_id === user?.id)
      : existingProfessionals.find(p => p.name.trim().toLowerCase() === name.toLowerCase());

    if (reuse) {
      // Garante que o profissional reaproveitado também atende a área
      // escolhida neste onboarding, sem descartar áreas que já tinha.
      if (selectedAreaId && !(reuse.area_ids ?? []).includes(selectedAreaId)) {
        try {
          await api.put(`/v1/scheduling/professionals/${reuse.id}/areas`, {
            area_ids: [...new Set([...(reuse.area_ids ?? []), selectedAreaId])],
          });
        } catch { /* não bloqueia a conclusão do onboarding por isso */ }
      }
      return reuse.id;
    }

    try {
      const created = await api.post<Professional>('/v1/scheduling/professionals', {
        name,
        link_self: selfService || undefined,
        area_ids:  selectedAreaId ? [selectedAreaId] : undefined,
      });
      if (created?.id) return created.id;
    } catch (err: unknown) {
      // Erros do servidor não são "já existe" — propaga.
      if (!(err instanceof ApiError) || err.status >= 500) throw err;
    }
    // Corrida rara (duplo submit) ou resposta sem id: reaproveita o cadastro.
    const list = await api.get<{ data: Professional[] }>('/v1/scheduling/professionals?include_inactive=true');
    const existing =
      (selfService ? list.data.find(p => p.user_id === user?.id) : undefined) ??
      list.data.find(p => p.name.trim().toLowerCase() === name.toLowerCase());
    if (!existing) throw new Error('Não foi possível criar o profissional. Tente novamente.');
    return existing.id;
  }

  async function handleFinish(e: FormEvent) {
    e.preventDefault();
    setError('');

    const name = selfService ? (user?.name ?? '').trim() : profName.trim();
    if (!name) {
      setError(selfService
        ? 'Não foi possível identificar o seu nome. Informe o nome do profissional manualmente.'
        : 'Informe o nome do profissional.');
      return;
    }
    if (rules.length === 0) { setError('Adicione pelo menos uma faixa de horário na grade semanal.'); return; }

    setBusy(true);
    try {
      const profId = await ensureProfessional(name);
      await api.put(`/v1/scheduling/professionals/${profId}/availability/weekly`, { rules });
      await api.patch('/v1/scheduling/settings', { onboarding_complete: true });
      navigate('/scheduling');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao concluir a configuração.');
    } finally { setBusy(false); }
  }

  // ── JSX ───────────────────────────────────────────────────────────────────

  const isWideStep = step === WIDE_STEP;

  return (
    <div style={{ maxWidth: WIDE_WIDTH, margin: '0 auto' }}>
      {/* Cabeçalho e indicador de passos ficam sempre numa coluna estreita e
          centrada — só o card de conteúdo alarga no passo da grade semanal. */}
      <div style={{ maxWidth: NARROW_WIDTH, margin: '0 auto' }}>
        <div className="page-header">
          <h1>Configurar Agendamento</h1>
        </div>
        <StepProgress steps={STEPS} currentStep={step} />
      </div>

      <div
        className="card"
        style={{
          padding: 24,
          marginTop: 20,
          ...(isWideStep ? {} : { maxWidth: NARROW_WIDTH, marginLeft: 'auto', marginRight: 'auto' }),
        }}
      >
        {error && <div className="alert alert-error" role="alert">{error}</div>}

        {/* ── Passo 1 — Seu negócio ──────────────────────────────────── */}
        {step === 0 && (
          <form onSubmit={handleBusinessSubmit} noValidate>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>Seu negócio</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Estas informações aparecem para os clientes no portal de agendamento.
            </p>

            <div className="field">
              <label>Nome do negócio *</label>
              <input value={businessName} onChange={e => setBusinessName(e.target.value)}
                required placeholder="Ex.: Studio Corpo & Mente" />
            </div>
            <div className="field">
              <label>Tipo do negócio</label>
              <input value={businessType} onChange={e => setBusinessType(e.target.value)}
                placeholder="Ex.: clínica, estúdio, salão…" />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={busy}>
                {busy ? 'Salvando…' : 'Continuar'}
              </button>
            </div>
          </form>
        )}

        {/* ── Passo 2 — Primeira área ────────────────────────────────── */}
        {step === 1 && (
          <form onSubmit={handleAreaSubmit} noValidate>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>Primeira área de atuação</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              A área define o tipo de atendimento que os clientes podem marcar (ex.: fisioterapia, pilates).
            </p>

            {existingAreas.length > 0 ? (
              <>
                <p style={{ fontSize: 13, marginBottom: 10 }}>
                  Você já tem {existingAreas.length === 1 ? 'uma área cadastrada' : 'áreas cadastradas'}.
                  Escolha qual usar nesta configuração:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                  {existingAreas.map(a => (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input type="radio" name="onboarding-area" checked={selectedAreaId === a.id}
                        onChange={() => setSelectedAreaId(a.id)} style={{ width: 'auto', margin: 0 }} />
                      {a.name}
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <div className="field-row">
                <div className="field">
                  <label>Nome da área *</label>
                  <input value={areaName} onChange={e => setAreaName(e.target.value)}
                    required placeholder="Ex.: Fisioterapia" />
                </div>
                <div className="field">
                  <label>Duração padrão (minutos) *</label>
                  <input type="number" min={1} value={areaDuration}
                    onChange={e => setAreaDuration(e.target.value)} required />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" style={{ width: 'auto' }}
                onClick={() => goToStep(0)} disabled={busy}>
                Voltar
              </button>
              <div className="flex-gap">
                <button type="button" className="btn btn-secondary" style={{ width: 'auto' }}
                  onClick={skipAreaStep} disabled={busy}>
                  Pular esta etapa
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={busy}>
                  {busy ? 'Salvando…' : 'Continuar'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* ── Passo 3 — Disponibilidade ──────────────────────────────── */}
        {step === 2 && (
          <form onSubmit={handleFinish} noValidate>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>Disponibilidade</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Defina quem atende e em quais horários. Clique nos atalhos de período ou ajuste manualmente —
              dá pra mudar tudo depois em Profissionais.
            </p>

            <div className="field-row" style={{ alignItems: 'start' }}>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontSize: 13, color: 'var(--text)' }}>
                  <input type="checkbox" checked={selfService}
                    onChange={e => setSelfService(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
                  Eu mesmo atendo
                </label>
                {selfService ? (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Vamos usar seu perfil profissional como <strong>{user?.name ?? 'você'}</strong>, vinculado ao seu usuário.
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Busque um profissional já cadastrado ou digite um nome novo para criar.
                  </span>
                )}
              </div>

              {!selfService && (
                <div className="field">
                  <label>Nome do profissional *</label>
                  <input
                    value={profName} onChange={e => setProfName(e.target.value)}
                    required placeholder="Buscar ou criar…" list="onboarding-professionals"
                  />
                  <datalist id="onboarding-professionals">
                    {existingProfessionals.map(p => <option key={p.id} value={p.name} />)}
                  </datalist>
                </div>
              )}
            </div>

            <div className="field" style={{ marginTop: 4 }}>
              <label>Grade semanal</label>
              <AvailabilityWeekEditor value={rules} onChange={setRules} disabled={busy} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" style={{ width: 'auto' }}
                onClick={() => goToStep(1)} disabled={busy}>
                Voltar
              </button>
              <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={busy}>
                {busy ? 'Concluindo…' : 'Concluir configuração'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
