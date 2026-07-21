import { useMemo } from 'react';
import './TimeGrid.css';
import { hmToMinutes } from '../../lib/schedulingTime';

export interface TimeGridColumn {
  key:          string;
  /** Rótulo grande (ex.: número do dia, ou nome do técnico). */
  label:        React.ReactNode;
  /** Rótulo pequeno acima do label (ex.: "seg", "ter"). Opcional. */
  sublabel?:    React.ReactNode;
  highlighted?: boolean;
}

export interface TimeGridBlock {
  id:          string;
  columnKey:   string;
  start:       string; // 'HH:mm'
  end:         string; // 'HH:mm'
  /** Sufixo de classe CSS: renderiza `ds-cal__block--<statusClass>`. */
  statusClass: string;
  title:       React.ReactNode;
  subtitle?:   React.ReactNode;
  tooltip:     string;
}

type TimeGridProps = {
  columns:  TimeGridColumn[];
  blocks:   TimeGridBlock[];
  ariaLabel: string;
  onBlockClick?: (id: string) => void;
  onSlotClick?:  (columnKey: string, time: string) => void;
};

const HOUR_PX = 48;
const SNAP_MINUTES = 30;

/**
 * Grade de horário genérica (dias × horas, ou qualquer outro eixo de coluna
 * × horas) — motor de posicionamento extraído de CalendarWeekGrid para ser
 * reaproveitado pela Agenda do Técnico (colunas = técnicos, regra 78) sem
 * duplicar a matemática de layout. CalendarWeekGrid continua sendo o adapter
 * de domínio do Agendamento (colunas = dias da semana) — this component não
 * conhece "sessão de agendamento" nem "visita técnica", só colunas e blocos.
 *
 * A janela de horas se ajusta ao conteúdo (min 07–19h). Número de colunas é
 * dinâmico (`gridTemplateColumns` inline) — não fica preso a 7 como o CSS
 * original assumia.
 */
export function TimeGrid({ columns, blocks, ariaLabel, onBlockClick, onSlotClick }: TimeGridProps) {
  const [startHour, endHour] = useMemo(() => {
    let min = 7 * 60, max = 19 * 60;
    for (const b of blocks) {
      min = Math.min(min, hmToMinutes(b.start));
      max = Math.max(max, hmToMinutes(b.end));
    }
    return [Math.floor(min / 60), Math.ceil(max / 60)];
  }, [blocks]);

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const bodyHeight = hours.length * HOUR_PX;
  const colCount = Math.max(columns.length, 1);
  const gridTemplateColumns = `56px repeat(${colCount}, minmax(110px, 1fr))`;
  const minWidth = 56 + colCount * 110;

  const blockStyle = (b: TimeGridBlock) => {
    const top = ((hmToMinutes(b.start) - startHour * 60) / 60) * HOUR_PX;
    const height = ((hmToMinutes(b.end) - hmToMinutes(b.start)) / 60) * HOUR_PX;
    return { top, height: Math.max(height - 2, 18) };
  };

  const clickSlot = (columnKey: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSlotClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = startHour * 60 + ((e.clientY - rect.top) / HOUR_PX) * 60;
    const snapped = Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES;
    const h = Math.floor(snapped / 60), m = snapped % 60;
    onSlotClick(columnKey, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };

  return (
    <div className="ds-cal" role="grid" aria-label={ariaLabel}>
      <div className="ds-cal__header" style={{ gridTemplateColumns, minWidth }}>
        <div className="ds-cal__axis-spacer" />
        {columns.map(col => (
          <div key={col.key} className={`ds-cal__day-head${col.highlighted ? ' ds-cal__day-head--today' : ''}`}>
            {col.sublabel !== undefined && <span className="ds-cal__day-name">{col.sublabel}</span>}
            <span className="ds-cal__day-num">{col.label}</span>
          </div>
        ))}
      </div>

      <div className="ds-cal__body" style={{ height: bodyHeight, gridTemplateColumns, minWidth }}>
        <div className="ds-cal__axis">
          {hours.map(h => (
            <div key={h} className="ds-cal__hour" style={{ height: HOUR_PX }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {columns.map(col => (
          <div
            key={col.key}
            className={`ds-cal__col${col.highlighted ? ' ds-cal__col--today' : ''}`}
            onClick={onSlotClick ? (e) => clickSlot(col.key, e) : undefined}
          >
            {hours.map(h => (
              <div key={h} className="ds-cal__line" style={{ height: HOUR_PX }} />
            ))}
            {blocks.filter(b => b.columnKey === col.key).map(b => (
              <button
                key={b.id}
                type="button"
                className={`ds-cal__block ds-cal__block--${b.statusClass}`}
                style={blockStyle(b)}
                title={b.tooltip}
                onClick={(e) => { e.stopPropagation(); onBlockClick?.(b.id); }}
              >
                <span className="ds-cal__block-time">{b.start}</span>
                <span className="ds-cal__block-client">{b.title}</span>
                {b.subtitle && <span className="ds-cal__block-area">{b.subtitle}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
