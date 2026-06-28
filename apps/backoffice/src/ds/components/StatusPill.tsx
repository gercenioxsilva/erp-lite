import './StatusPill.css';

export type FiscalStatus = 'authorized' | 'rejected' | 'pending' | 'processing';

const CFG: Record<FiscalStatus, { label: string; icon: string }> = {
  pending:    { label: 'Enviando…',    icon: '⏳' },
  processing: { label: 'Processando…', icon: '⏳' },
  authorized: { label: 'Autorizada',   icon: '✓'  },
  rejected:   { label: 'Rejeitada',    icon: '✗'  },
};

type StatusPillProps = {
  status: FiscalStatus;
  spinning?: boolean;
  onClick?: () => void;
  title?: string;
};

export function StatusPill({ status, spinning, onClick, title }: StatusPillProps) {
  const { label, icon } = CFG[status];
  const isSpinning = spinning ?? (status === 'pending' || status === 'processing');
  const className = `ds-status-pill ds-status-pill--${status}`;

  const content = (
    <>
      <span className="ds-status-pill__icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
      {isSpinning && <span className="ds-status-pill__spinner" aria-hidden="true">↻</span>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} title={title}>
        {content}
      </button>
    );
  }

  return (
    <span className={className} title={title}>
      {content}
    </span>
  );
}
