import { useEffect, useState, FormEvent } from 'react';
import { api } from '../../lib/api';
import { Switch } from '../../ds/components/Switch';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Settings {
  business_name:       string | null;
  business_type:       string | null;
  allow_self_booking:  boolean;
  min_advance_hours:   number;
  cancel_window_hours: number;
  timezone:            string | null;
  onboarding_complete: boolean;
}

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  business_name:       '',
  business_type:       '',
  allow_self_booking:  false,
  min_advance_hours:   '0',
  cancel_window_hours: '0',
  timezone:            '',
};

// ── Main component ─────────────────────────────────────────────────────────────

export function SchedulingSettingsPage() {
  const [form,    setForm]    = useState({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  // ── Data loading ───────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    api.get<Settings>('/v1/scheduling/settings')
      .then(s => {
        if (cancelled) return;
        setForm({
          business_name:       s.business_name ?? '',
          business_type:       s.business_type ?? '',
          allow_self_booking:  s.allow_self_booking,
          min_advance_hours:   String(s.min_advance_hours),
          cancel_window_hours: String(s.cancel_window_hours),
          timezone:            s.timezone ?? '',
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar as configurações.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Form helpers ───────────────────────────────────────────────────────────

  function setF(field: 'business_name' | 'business_type' | 'min_advance_hours' | 'cancel_window_hours' | 'timezone') {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setSuccess('');
      setForm(f => ({ ...f, [field]: e.target.value }));
    };
  }

  function toggleSelfBooking() {
    setSuccess('');
    setForm(f => ({ ...f, allow_self_booking: !f.allow_self_booking }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    const minAdvance   = parseInt(form.min_advance_hours, 10);
    const cancelWindow = parseInt(form.cancel_window_hours, 10);
    if (!Number.isInteger(minAdvance) || minAdvance < 0) {
      setError('A antecedência mínima deve ser um número de horas maior ou igual a 0.'); return;
    }
    if (!Number.isInteger(cancelWindow) || cancelWindow < 0) {
      setError('A janela de cancelamento deve ser um número de horas maior ou igual a 0.'); return;
    }

    setSaving(true);
    try {
      await api.patch('/v1/scheduling/settings', {
        business_name:       form.business_name.trim() || undefined,
        business_type:       form.business_type.trim() || undefined,
        allow_self_booking:  form.allow_self_booking,
        min_advance_hours:   minAdvance,
        cancel_window_hours: cancelWindow,
        timezone:            form.timezone.trim() || undefined,
      });
      setSuccess('Configurações salvas com sucesso.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar as configurações.');
    } finally { setSaving(false); }
  }

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <h1>Configurações do Agendamento</h1>
      </div>

      <div className="card" style={{ padding: 24, maxWidth: 640 }}>
        {loading ? (
          <div className="spinner">Carregando…</div>
        ) : (
          <form onSubmit={handleSave} noValidate>
            {error   && <div className="alert alert-error"   role="alert">{error}</div>}
            {success && <div className="alert alert-success" role="alert">{success}</div>}

            <div className="field-row">
              <div className="field">
                <label>Nome do negócio</label>
                <input value={form.business_name} onChange={setF('business_name')}
                  placeholder="Ex.: Studio Corpo & Mente" />
              </div>
              <div className="field">
                <label>Tipo do negócio</label>
                <input value={form.business_type} onChange={setF('business_type')}
                  placeholder="Ex.: clínica, estúdio, salão…" />
              </div>
            </div>

            <div className="field">
              <label>Auto-agendamento</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Switch checked={form.allow_self_booking} onChange={toggleSelfBooking}
                  label="Permitir auto-agendamento" />
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Permite que clientes marquem sessões pelo portal, sem passar pela recepção.
                </span>
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>Antecedência mínima (horas)</label>
                <input type="number" min={0} value={form.min_advance_hours}
                  onChange={setF('min_advance_hours')} />
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Tempo mínimo entre a marcação e o início da sessão.
                </span>
              </div>
              <div className="field">
                <label>Janela de cancelamento (horas)</label>
                <input type="number" min={0} value={form.cancel_window_hours}
                  onChange={setF('cancel_window_hours')} />
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Até quantas horas antes o cliente pode cancelar. 0 = sem restrição.
                </span>
              </div>
            </div>

            <div className="field">
              <label>Fuso horário</label>
              <input value={form.timezone} onChange={setF('timezone')}
                placeholder="Ex.: America/Sao_Paulo" />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: 'auto', marginTop: 8 }} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar configurações'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
