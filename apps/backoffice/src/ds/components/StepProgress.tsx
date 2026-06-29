import './StepProgress.css';

export type Step = { label: string; description: string };

type StepProgressProps = {
  steps: Step[];
  currentStep: number;
};

export function StepProgress({ steps, currentStep }: StepProgressProps) {
  return (
    <nav className="ds-step-progress" aria-label="Progresso">
      <ol className="ds-step-progress__list">
        {steps.map((step, i) => {
          const state: 'done' | 'active' | 'locked' =
            i < currentStep ? 'done' : i === currentStep ? 'active' : 'locked';
          return (
            <li key={i} className={`ds-step-progress__item ds-step-progress__item--${state}`}>
              {i > 0 && (
                <div className={`ds-step-progress__connector${i <= currentStep ? ' ds-step-progress__connector--done' : ''}`} />
              )}
              <div className={`ds-step-progress__circle ds-step-progress__circle--${state}`} aria-hidden="true">
                {state === 'done' ? '✓' : i + 1}
              </div>
              <div className="ds-step-progress__labels">
                <span className="ds-step-progress__label">{step.label}</span>
                <span className="ds-step-progress__desc">{step.description}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
