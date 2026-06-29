import './Timeline.css';

export interface TimelineEvent {
  event_type: string;
  status_code: string | null;
  protocol: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

function getRejectReason(ev: TimelineEvent): string | null {
  const p = ev.payload;
  if (!p) return null;
  const r = p['nfe_reject_reason'] ?? p['reject_reason'] ?? p['message'];
  return r != null ? String(r) : null;
}

function dotVariant(eventType: string): 'success' | 'error' | 'default' {
  if (eventType.includes('authorized') || eventType === 'emission') return 'success';
  if (eventType.includes('rejected') || eventType.includes('error')) return 'error';
  return 'default';
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="ds-timeline__empty">Nenhum evento registrado</p>;
  }

  return (
    <div className="ds-timeline">
      {events.map((ev, i) => {
        const variant = dotVariant(ev.event_type);
        const isLast = i === events.length - 1;
        const reason = getRejectReason(ev);

        return (
          <div key={i} className="ds-timeline__item">
            <div className="ds-timeline__track">
              <div className={`ds-timeline__dot ds-timeline__dot--${variant}`} aria-hidden="true" />
              {!isLast && <div className="ds-timeline__line" aria-hidden="true" />}
            </div>
            <div className="ds-timeline__content">
              <div className="ds-timeline__row">
                <span className="ds-timeline__type">{ev.event_type}</span>
                {ev.status_code && (
                  <code className="ds-timeline__code">cStat {ev.status_code}</code>
                )}
                <time className="ds-timeline__time">
                  {new Date(ev.created_at).toLocaleString('pt-BR')}
                </time>
              </div>
              {ev.protocol && (
                <div className="ds-timeline__protocol">
                  nProt: <code>{ev.protocol}</code>
                </div>
              )}
              {reason && variant === 'error' && (
                <div className="ds-timeline__reject">{reason}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
