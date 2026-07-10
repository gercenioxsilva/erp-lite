import { useState } from 'react';
import './AvailabilityWeekEditor.css';
import { WEEKDAY_LABELS } from '../../lib/schedulingTime';

export interface WeeklyRule {
  weekday:    number; // 0=domingo … 6=sábado (convenção do backend)
  start_time: string;
  end_time:   string;
}

type AvailabilityWeekEditorProps = {
  value:    WeeklyRule[];
  onChange: (rules: WeeklyRule[]) => void;
  disabled?: boolean;
};

const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];

// Atalhos de faixa — clicar aplica/remove a faixa exata (toggle), permitindo
// compor um dia com "Manhã" + "Tarde" (com intervalo de almoço) ou usar
// "Comercial"/"Dia todo" isoladamente.
const PRESETS: { key: string; label: string; start: string; end: string }[] = [
  { key: 'morning',    label: 'Manhã',     start: '08:00', end: '12:00' },
  { key: 'afternoon',  label: 'Tarde',     start: '13:00', end: '18:00' },
  { key: 'commercial', label: 'Comercial', start: '09:00', end: '18:00' },
  { key: 'allday',     label: 'Dia todo',  start: '00:00', end: '23:59' },
];

const toMinutes = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/**
 * Grade semanal editável: uma LINHA por dia (não coluna) — cada dia usa a
 * largura inteira disponível, então a barra de 24h e os horários ficam
 * legíveis mesmo com 7 dias visíveis ao mesmo tempo. Controlado e imutável —
 * o pai salva a semana inteira de uma vez (PUT replace-wholesale). Faixas
 * sobrepostas são aceitas: o backend normaliza com merge na leitura.
 */
export function AvailabilityWeekEditor({ value, onChange, disabled }: AvailabilityWeekEditorProps) {
  // Linha com o formulário de "faixa personalizada" aberto (só uma por vez).
  const [customFor, setCustomFor] = useState<number | null>(null);
  const [customStart, setCustomStart] = useState('09:00');
  const [customEnd,   setCustomEnd]   = useState('18:00');

  const byDay = (weekday: number) =>
    value.map((r, index) => ({ ...r, index })).filter(r => r.weekday === weekday)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const addRange = (weekday: number, start: string, end: string) =>
    onChange([...value, { weekday, start_time: start, end_time: end }]);

  const removeAt = (index: number) =>
    onChange(value.filter((_, i) => i !== index));

  function togglePreset(weekday: number, start: string, end: string) {
    const existing = byDay(weekday).find(r => r.start_time === start && r.end_time === end);
    if (existing) removeAt(existing.index);
    else addRange(weekday, start, end);
  }

  // Replica as faixas do dia de origem para segunda–sexta (substitui o que já
  // houver nesses dias) — atalho para o caso comum "todo dia útil é assim".
  function copyToWeekdays(sourceWeekday: number) {
    const source = byDay(sourceWeekday).map(r => ({ start_time: r.start_time, end_time: r.end_time }));
    if (source.length === 0) return;
    const rest = value.filter(r => !WEEKDAYS_MON_FRI.includes(r.weekday));
    const applied = WEEKDAYS_MON_FRI.flatMap(weekday =>
      source.map(r => ({ weekday, start_time: r.start_time, end_time: r.end_time })));
    onChange([...rest, ...applied]);
  }

  function openCustom(weekday: number) {
    setCustomStart('09:00');
    setCustomEnd('18:00');
    setCustomFor(weekday);
  }

  function confirmCustom() {
    if (customFor === null) return;
    if (customStart < customEnd) addRange(customFor, customStart, customEnd);
    setCustomFor(null);
  }

  return (
    <div className="ds-weekgrid" role="table" aria-label="Grade semanal de disponibilidade">
      {WEEKDAY_LABELS.map((label, weekday) => {
        const ranges = byDay(weekday);
        const isOpen = ranges.length > 0;
        const editingCustom = customFor === weekday;

        return (
          <div key={weekday} role="row" className={`ds-weekgrid__row${isOpen ? ' ds-weekgrid__row--open' : ''}`}>
            <div className="ds-weekgrid__label">
              <span className="ds-weekgrid__day-name">{label}</span>
              <span className={`ds-weekgrid__status${isOpen ? ' ds-weekgrid__status--open' : ''}`}>
                {isOpen ? 'Aberto' : 'Fechado'}
              </span>
            </div>

            <div className="ds-weekgrid__bar" aria-hidden="true">
              <div className="ds-weekgrid__bar-track">
                {ranges.map(r => (
                  <span
                    key={r.index}
                    className="ds-weekgrid__bar-fill"
                    style={{
                      left:  `${(toMinutes(r.start_time) / 1440) * 100}%`,
                      width: `${Math.max(((toMinutes(r.end_time) - toMinutes(r.start_time)) / 1440) * 100, 0.8)}%`,
                    }}
                  />
                ))}
              </div>
              <div className="ds-weekgrid__bar-ticks">
                <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
              </div>
            </div>

            <div className="ds-weekgrid__controls">
              {ranges.length > 0 && (
                <div className="ds-weekgrid__pills">
                  {ranges.map(r => (
                    <span key={r.index} className="ds-weekgrid__pill">
                      {r.start_time}–{r.end_time}
                      <button
                        type="button" disabled={disabled}
                        aria-label={`Remover faixa ${r.start_time}–${r.end_time} de ${label}`}
                        onClick={() => removeAt(r.index)}
                      >×</button>
                    </span>
                  ))}
                </div>
              )}

              <div className="ds-weekgrid__actions">
                {PRESETS.map(p => {
                  const active = ranges.some(r => r.start_time === p.start && r.end_time === p.end);
                  return (
                    <button
                      key={p.key} type="button" disabled={disabled}
                      className={`ds-weekgrid__preset${active ? ' ds-weekgrid__preset--active' : ''}`}
                      aria-pressed={active}
                      title={`${p.start}–${p.end}`}
                      onClick={() => togglePreset(weekday, p.start, p.end)}
                    >
                      {p.label}
                    </button>
                  );
                })}

                {editingCustom ? (
                  <span className="ds-weekgrid__custom-form">
                    <input
                      type="time" value={customStart} disabled={disabled} autoFocus
                      aria-label={`${label} — início personalizado`}
                      onChange={e => setCustomStart(e.target.value)}
                    />
                    <span aria-hidden>–</span>
                    <input
                      type="time" value={customEnd} disabled={disabled}
                      aria-label={`${label} — fim personalizado`}
                      onChange={e => setCustomEnd(e.target.value)}
                    />
                    <button type="button" className="ds-weekgrid__custom-ok" disabled={disabled || customStart >= customEnd}
                      onClick={confirmCustom} aria-label="Confirmar faixa personalizada">✓</button>
                    <button type="button" className="ds-weekgrid__custom-cancel" disabled={disabled}
                      onClick={() => setCustomFor(null)} aria-label="Cancelar">✕</button>
                  </span>
                ) : (
                  <button
                    type="button" className="ds-weekgrid__add" disabled={disabled}
                    onClick={() => openCustom(weekday)}
                  >
                    + personalizada
                  </button>
                )}

                {isOpen && !editingCustom && (
                  <button
                    type="button" className="ds-weekgrid__copy" disabled={disabled}
                    title={`Aplicar o horário de ${label} a todos os dias úteis`}
                    onClick={() => copyToWeekdays(weekday)}
                  >
                    Aplicar a dias úteis
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
