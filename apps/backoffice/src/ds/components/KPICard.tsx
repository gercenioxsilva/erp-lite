import './KPICard.css';
import type { ReactNode } from 'react';

export type KPIIconVariant = 'green' | 'amber' | 'red' | 'blue';

type KPICardProps = {
  label: string;
  value: string | number;
  icon?: ReactNode;
  iconVariant?: KPIIconVariant;
  sub?: string;
  active?: boolean;
  onClick?: () => void;
};

export function KPICard({ label, value, icon, iconVariant = 'blue', sub, active, onClick }: KPICardProps) {
  return (
    <div
      className={`bento-card ds-kpi-card${active ? ' ds-kpi-card--active' : ''}${onClick ? ' ds-kpi-card--clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      {icon && (
        <div className={`ds-kpi-icon ds-kpi-icon--${iconVariant}`} aria-hidden="true">
          {icon}
        </div>
      )}
      <div className="bento-label">{label}</div>
      <div className="bento-value-md">{value}</div>
      {sub && <div className="bento-sub">{sub}</div>}
    </div>
  );
}
