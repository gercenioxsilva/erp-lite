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

/**
 * Grade semanal editável: uma coluna por dia, faixas HH:mm adicionáveis.
 * Controlado e imutável — o pai salva a semana inteira de uma vez
 * (PUT replace-wholesale). Faixas sobrepostas são aceitas: o backend
 * normaliza com merge na leitura.
 */
export function AvailabilityWeekEditor({ value, onChange, disabled }: AvailabilityWeekEditorProps) {
  const byDay = (weekday: number) =>
    value.map((r, index) => ({ ...r, index })).filter(r => r.weekday === weekday);

  const addRange = (weekday: number) =>
    onChange([...value, { weekday, start_time: '09:00', end_time: '18:00' }]);

  const removeAt = (index: number) =>
    onChange(value.filter((_, i) => i !== index));

  const patchAt = (index: number, field: 'start_time' | 'end_time', v: string) =>
    onChange(value.map((r, i) => (i === index ? { ...r, [field]: v } : r)));

  return (
    <div className="ds-weekgrid">
      {WEEKDAY_LABELS.map((label, weekday) => {
        const ranges = byDay(weekday);
        return (
          <section key={weekday} className={`ds-weekgrid__day${ranges.length === 0 ? ' ds-weekgrid__day--off' : ''}`}>
            <header className="ds-weekgrid__head">
              <h4>{label}</h4>
              {ranges.length === 0 && <span className="ds-weekgrid__off">Fechado</span>}
            </header>

            {ranges.map((r) => (
              <div key={r.index} className="ds-weekgrid__range">
                <input
                  type="time" value={r.start_time} disabled={disabled}
                  aria-label={`${label} — início`}
                  onChange={(e) => patchAt(r.index, 'start_time', e.target.value)}
                />
                <span aria-hidden>–</span>
                <input
                  type="time" value={r.end_time} disabled={disabled}
                  aria-label={`${label} — fim`}
                  onChange={(e) => patchAt(r.index, 'end_time', e.target.value)}
                />
                <button
                  type="button" className="ds-weekgrid__remove" disabled={disabled}
                  aria-label={`Remover faixa de ${label}`}
                  onClick={() => removeAt(r.index)}
                >×</button>
              </div>
            ))}

            <button
              type="button" className="ds-weekgrid__add" disabled={disabled}
              onClick={() => addRange(weekday)}
            >
              + faixa
            </button>
          </section>
        );
      })}
    </div>
  );
}
