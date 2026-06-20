import { useEffect, useState } from 'react';
import { useModal } from '../contexts/ModalContext';

export function Modal() {
  const { state, _resolve, _close } = useModal();
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!state) { setShowDetails(false); return; }
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') _close(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [state, _close]);

  if (!state) return null;

  if (state.kind === 'confirm') {
    const { opts } = state;
    return (
      <div className="modal-backdrop" onClick={_close} role="dialog" aria-modal>
        <div className="modal-dialog modal-dialog--compact" onClick={e => e.stopPropagation()}>
          <div className={`modal-icon-wrap ${opts.danger ? 'modal-icon-wrap--danger' : 'modal-icon-wrap--info'}`}>
            {opts.danger ? <AlertIcon /> : <QuestionIcon />}
          </div>
          <h2 className="modal-title">{opts.title}</h2>
          <p className="modal-msg">{opts.message}</p>
          <div className="modal-actions">
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={_close}>
              {opts.cancelLabel ?? 'Cancelar'}
            </button>
            <button
              className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
              style={{ flex: 1, width: 'auto' }}
              onClick={() => _resolve(true)}
              autoFocus
            >
              {opts.confirmLabel ?? 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    const { opts } = state;
    return (
      <div className="modal-backdrop" role="alertdialog" aria-modal>
        <div className="modal-dialog modal-dialog--error" onClick={e => e.stopPropagation()}>
          <div className="modal-error-art">
            <div className="modal-error-glow" />
            <div className="modal-gear-wrap">
              <GearIcon className="modal-gear" />
              <span className="modal-spark" aria-hidden>✦</span>
            </div>
          </div>
          <h2 className="modal-title">{opts.title}</h2>
          <p className="modal-msg">{opts.message}</p>
          {opts.technical && (
            <div className="modal-details">
              <button
                type="button"
                className="modal-details-toggle"
                onClick={() => setShowDetails(v => !v)}
              >
                {showDetails ? '▲' : '▶'} Detalhes técnicos
              </button>
              {showDetails && <code className="modal-details-code">{opts.technical}</code>}
            </div>
          )}
          <div className="modal-actions">
            {opts.onRetry && (
              <button
                className="btn btn-primary"
                style={{ width: 'auto', flex: 1 }}
                onClick={() => { _close(); opts.onRetry!(); }}
                autoFocus
              >
                Tentar novamente
              </button>
            )}
            <button className="btn btn-secondary" style={{ width: 'auto', flex: 1 }} onClick={_close}>
              {opts.onRetry ? 'Fechar' : 'Entendi'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

/* ── Icons ──────────────────────────────────────────────────────────────────── */

function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96a7.37 7.37 0 0 0-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.488.488 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94L2.86 14.52a.48.48 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.49.37 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 0 1 8.4 12 3.6 3.6 0 0 1 12 8.4a3.6 3.6 0 0 1 3.6 3.6A3.6 3.6 0 0 1 12 15.6z" />
      <polyline
        points="13,7.5 10.5,12 13.5,14 11,18.5"
        fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
