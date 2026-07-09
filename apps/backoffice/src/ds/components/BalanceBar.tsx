import './BalanceBar.css';

type BalanceBarProps = {
  total: number;
  used:  number;
  /** Compacta (sem rótulo) para linhas de tabela. */
  compact?: boolean;
};

/**
 * Saldo de pacote como segmentos discretos — 1 segmento por sessão, porque o
 * recurso é contável (8 de 10 diz mais que 80%). Acima de 24 sessões degrada
 * para barra contínua, senão os segmentos viram ruído.
 */
export function BalanceBar({ total, used, compact }: BalanceBarProps) {
  const remaining = Math.max(total - used, 0);
  const label = `${remaining} de ${total} ${remaining === 1 ? 'restante' : 'restantes'}`;
  const exhausted = remaining === 0;

  return (
    <div className={`ds-balance${compact ? ' ds-balance--compact' : ''}`} role="img" aria-label={label}>
      {total <= 24 ? (
        <div className="ds-balance__segments">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`ds-balance__seg${i < used ? ' ds-balance__seg--used' : ''}${exhausted ? ' ds-balance__seg--exhausted' : ''}`}
            />
          ))}
        </div>
      ) : (
        <div className="ds-balance__track">
          <span
            className={`ds-balance__fill${exhausted ? ' ds-balance__seg--exhausted' : ''}`}
            style={{ width: `${total > 0 ? (used / total) * 100 : 0}%` }}
          />
        </div>
      )}
      {!compact && <span className="ds-balance__label">{label}</span>}
    </div>
  );
}
