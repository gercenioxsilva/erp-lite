// Card de um par (provider × ambiente). Puramente apresentacional: quem chama
// a API é a IntegrationsPage — este componente só emite intenção.

import './integrations.css';
import { Switch } from '../../ds/components/Switch';
import type { IntegrationEnvironment, PublicProviderCard } from './types';

const ENV_LABEL: Record<IntegrationEnvironment, string> = {
  sandbox: 'SANDBOX',
  production: 'PRODUCTION',
};

// Reaproveita .env-badge do index.css: homologação = azul, produção = vermelho.
// A mesma convenção de cor já é usada na emissão fiscal, então o operador lê
// "produção = para valer" sem aprender nada novo.
const ENV_CLASS: Record<IntegrationEnvironment, string> = {
  sandbox: 'env-badge env-badge--homo',
  production: 'env-badge env-badge--prod',
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "agora mesmo" / "há 4 min" / "há 3 h" / "há 2 d" / data absoluta acima de 7d. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < MINUTE) return 'agora mesmo';
  if (diff < HOUR) return `há ${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `há ${Math.floor(diff / HOUR)} h`;
  if (diff < 7 * DAY) return `há ${Math.floor(diff / DAY)} d`;
  return new Date(iso).toLocaleDateString('pt-BR', { dateStyle: 'short' });
}

function IcoPencil() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.2 2.3l3.5 3.5L6.5 15H3v-3.5L12.2 2.3z" /><path d="M10.8 3.7l3.5 3.5" />
    </svg>
  );
}

function IcoPulse() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 9h3l2-5.5 3.5 11L13 9h3.5" />
    </svg>
  );
}

interface ProviderCardProps {
  card: PublicProviderCard;
  canManage: boolean;
  toggling: boolean;
  pinging: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onPing: () => void;
}

export function ProviderCard({
  card, canManage, toggling, pinging, onToggle, onEdit, onPing,
}: ProviderCardProps) {
  const credentialsLabel = card.requiredTotal === 0
    ? 'Sem credenciais obrigatórias'
    : `${card.requiredFilled}/${card.requiredTotal} credenciais obrigatórias preenchidas`;
  const credentialsComplete = card.requiredTotal > 0 && card.requiredFilled === card.requiredTotal;

  return (
    <div className={`module-card int-card${card.enabled ? ' module-card--on' : ''}${canManage ? '' : ' int-card--readonly'}`}>
      <div className="int-card__top">
        <div className="int-card__heading">
          <span className="int-card__title">{card.label}</span>
          <span className={ENV_CLASS[card.environment]}>{ENV_LABEL[card.environment]}</span>
        </div>
        <Switch
          checked={card.enabled}
          disabled={!canManage || toggling}
          onChange={onToggle}
          label={`${card.label} (${ENV_LABEL[card.environment]}): ${card.enabled ? 'desativar' : 'ativar'}`}
        />
      </div>

      <p className="int-card__desc">{card.description}</p>

      <div className="int-card__meta">
        <span>Provider: <code>{card.key}</code></span>
        <span className="int-card__meta-sep" aria-hidden="true">·</span>
        <span className={credentialsComplete ? 'int-card__meta--complete' : undefined}>
          {credentialsLabel}
        </span>
      </div>

      {card.services.length > 0 && (
        <div className="int-chips">
          {/* Chip apagado = serviço desligado nas configurações. Mostramos os
              desligados também (em vez de esconder) para o card não parecer que
              o provider simplesmente não tem aquela capacidade. */}
          {card.services.map(s => (
            <span
              key={s.key}
              className={`int-chip${s.enabled ? '' : ' int-chip--off'}`}
              title={s.enabled ? undefined : 'Desativado nas configurações'}
            >
              {s.label}
            </span>
          ))}
        </div>
      )}

      {card.usingPlatformFallback && (
        <p className="int-card__fallback">
          <span aria-hidden="true">ℹ</span>
          Usando a configuração padrão do sistema.
        </p>
      )}

      {/* Sem role="status": é o histórico do último teste, e quem anuncia o
          resultado recém-chegado é o alerta no topo da página. */}
      {card.lastPing && (
        <p className={`int-ping int-ping--${card.lastPing.ok ? 'ok' : 'fail'}`}>
          <span aria-hidden="true">{card.lastPing.ok ? '✓' : '✗'}</span>
          <span>
            <span className="int-ping__when">{relativeTime(card.lastPing.at)}</span>
            {card.lastPing.message ? ` — ${card.lastPing.message}` : ''}
          </span>
        </p>
      )}

      {canManage && (
        <div className="int-card__footer">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit}>
            <IcoPencil /> Editar
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={pinging} onClick={onPing}>
            {pinging ? <span className="int-spin" aria-hidden="true">↻</span> : <IcoPulse />}
            {pinging ? 'Testando…' : 'Ping'}
          </button>
        </div>
      )}
    </div>
  );
}
