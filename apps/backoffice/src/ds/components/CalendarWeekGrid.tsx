import { useMemo } from 'react';
import { TimeGrid } from './TimeGrid';
import type { TimeGridColumn, TimeGridBlock } from './TimeGrid';
import {
  weekOf, todayISO, WEEKDAY_LABELS_SHORT, weekdayOf,
} from '../../lib/schedulingTime';

export interface CalendarSession {
  id:          string;
  date:        string; // 'YYYY-MM-DD'
  start_time:  string; // 'HH:mm'
  end_time:    string;
  status:      'pending' | 'confirmed' | 'completed' | 'canceled' | 'declined' | 'no_show';
  client_name: string;
  area_name?:  string;
}

type CalendarWeekGridProps = {
  days?:      string[];  // default: semana do anchorDate
  /** Qualquer data da semana a exibir. */
  anchorDate: string;
  sessions:   CalendarSession[];
  onSessionClick?: (session: CalendarSession) => void;
  onSlotClick?:    (date: string, time: string) => void;
};

/**
 * Agenda semanal do Agendamento (regra 65) — adapter de domínio sobre o
 * motor genérico TimeGrid (colunas = dias da semana). Props/comportamento
 * idênticos aos de sempre; a matemática de layout mora em TimeGrid.tsx,
 * reaproveitada também pela Agenda do Técnico (colunas = técnicos, regra 78).
 * Visão diária (0083): o chamador pode restringir as colunas (ex.: [anchor]).
 */
export function CalendarWeekGrid({ anchorDate, days: daysProp, sessions, onSessionClick, onSlotClick }: CalendarWeekGridProps) {
  const days = daysProp ?? weekOf(anchorDate);
  const today = todayISO();

  const visible = useMemo(
    () => sessions.filter(s => s.status === 'pending' || s.status === 'confirmed' || s.status === 'completed'),
    [sessions],
  );

  const columns: TimeGridColumn[] = useMemo(() => days.map(date => ({
    key:         date,
    label:       Number(date.slice(8, 10)),
    sublabel:    WEEKDAY_LABELS_SHORT[weekdayOf(date)],
    highlighted: date === today,
  })), [days, today]);

  const blocks: TimeGridBlock[] = useMemo(() => visible.map(s => ({
    id:          s.id,
    columnKey:   s.date,
    start:       s.start_time,
    end:         s.end_time,
    statusClass: s.status,
    title:       s.client_name,
    subtitle:    s.area_name,
    tooltip:     `${s.start_time}–${s.end_time} · ${s.client_name}${s.area_name ? ` · ${s.area_name}` : ''}`,
  })), [visible]);

  const sessionById = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);

  return (
    <TimeGrid
      ariaLabel="Agenda da semana"
      columns={columns}
      blocks={blocks}
      onBlockClick={onSessionClick ? (id) => { const s = sessionById.get(id); if (s) onSessionClick(s); } : undefined}
      onSlotClick={onSlotClick}
    />
  );
}
