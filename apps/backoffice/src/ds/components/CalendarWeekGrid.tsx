import { useMemo } from 'react';
import './CalendarWeekGrid.css';
import {
  hmToMinutes, weekOf, todayISO, WEEKDAY_LABELS_SHORT, weekdayOf,
} from '../../lib/schedulingTime';

export interface CalendarSession {
  id:          string;
  date:        string; // 'YYYY-MM-DD'
  start_time:  string; // 'HH:mm'
  end_time:    string;
  status:      'pending' | 'confirmed' | 'completed' | 'canceled' | 'declined';
  client_name: string;
  area_name?:  string;
}

type CalendarWeekGridProps = {
  /** Qualquer data da semana a exibir. */
  anchorDate: string;
  sessions:   CalendarSession[];
  onSessionClick?: (session: CalendarSession) => void;
  onSlotClick?:    (date: string, time: string) => void;
};

const HOUR_PX = 48;
const SNAP_MINUTES = 30;

/**
 * Agenda semanal com eixo de horas e blocos posicionados por minuto.
 * A janela de horas se ajusta ao conteúdo (min 07–19h) — uma barbearia
 * noturna e uma autoescola matinal enxergam a própria realidade.
 * Canceladas/recusadas ficam de fora (horário liberado); pendentes
 * aparecem hachuradas — seguram horário mas ainda pedem decisão.
 */
export function CalendarWeekGrid({ anchorDate, sessions, onSessionClick, onSlotClick }: CalendarWeekGridProps) {
  const days = weekOf(anchorDate);
  const today = todayISO();

  const visible = useMemo(
    () => sessions.filter(s => s.status === 'pending' || s.status === 'confirmed' || s.status === 'completed'),
    [sessions],
  );

  const [startHour, endHour] = useMemo(() => {
    let min = 7 * 60, max = 19 * 60;
    for (const s of visible) {
      min = Math.min(min, hmToMinutes(s.start_time));
      max = Math.max(max, hmToMinutes(s.end_time));
    }
    return [Math.floor(min / 60), Math.ceil(max / 60)];
  }, [visible]);

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const bodyHeight = hours.length * HOUR_PX;

  const blockStyle = (s: CalendarSession) => {
    const top = ((hmToMinutes(s.start_time) - startHour * 60) / 60) * HOUR_PX;
    const height = ((hmToMinutes(s.end_time) - hmToMinutes(s.start_time)) / 60) * HOUR_PX;
    return { top, height: Math.max(height - 2, 18) };
  };

  const clickSlot = (date: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSlotClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = startHour * 60 + ((e.clientY - rect.top) / HOUR_PX) * 60;
    const snapped = Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES;
    const h = Math.floor(snapped / 60), m = snapped % 60;
    onSlotClick(date, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };

  return (
    <div className="ds-cal" role="grid" aria-label="Agenda da semana">
      <div className="ds-cal__header">
        <div className="ds-cal__axis-spacer" />
        {days.map(date => (
          <div key={date} className={`ds-cal__day-head${date === today ? ' ds-cal__day-head--today' : ''}`}>
            <span className="ds-cal__day-name">{WEEKDAY_LABELS_SHORT[weekdayOf(date)]}</span>
            <span className="ds-cal__day-num">{Number(date.slice(8, 10))}</span>
          </div>
        ))}
      </div>

      <div className="ds-cal__body" style={{ height: bodyHeight }}>
        <div className="ds-cal__axis">
          {hours.map(h => (
            <div key={h} className="ds-cal__hour" style={{ height: HOUR_PX }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {days.map(date => (
          <div
            key={date}
            className={`ds-cal__col${date === today ? ' ds-cal__col--today' : ''}`}
            onClick={onSlotClick ? (e) => clickSlot(date, e) : undefined}
          >
            {hours.map(h => (
              <div key={h} className="ds-cal__line" style={{ height: HOUR_PX }} />
            ))}
            {visible.filter(s => s.date === date).map(s => (
              <button
                key={s.id}
                type="button"
                className={`ds-cal__block ds-cal__block--${s.status}`}
                style={blockStyle(s)}
                title={`${s.start_time}–${s.end_time} · ${s.client_name}${s.area_name ? ` · ${s.area_name}` : ''}`}
                onClick={(e) => { e.stopPropagation(); onSessionClick?.(s); }}
              >
                <span className="ds-cal__block-time">{s.start_time}</span>
                <span className="ds-cal__block-client">{s.client_name}</span>
                {s.area_name && <span className="ds-cal__block-area">{s.area_name}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
