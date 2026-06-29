import './SectionCard.css';
import type { ReactNode } from 'react';

type SectionCardProps = {
  step: number;
  title: string;
  description?: string;
  unlocked: boolean;
  children: ReactNode;
};

export function SectionCard({ step, title, description, unlocked, children }: SectionCardProps) {
  return (
    <div
      className={`card ds-section-card${unlocked ? ' ds-section-card--unlocked' : ' ds-section-card--locked'}`}
      aria-disabled={!unlocked}
    >
      <div className="ds-section-card__header">
        <div
          className={`ds-section-card__step${unlocked ? ' ds-section-card__step--unlocked' : ''}`}
          aria-label={`Passo ${step}`}
        >
          {step}
        </div>
        <div className="ds-section-card__titles">
          <h3 className="ds-section-card__title">{title}</h3>
          {description && <p className="ds-section-card__desc">{description}</p>}
        </div>
        {!unlocked && <span className="ds-section-card__lock" aria-label="Bloqueado">🔒</span>}
      </div>
      {unlocked && (
        <div className="ds-section-card__body">
          {children}
        </div>
      )}
    </div>
  );
}
