import './IntegrationUnavailable.css';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '../../rbac';

// Aviso INFORMATIVO (nunca vermelho) para telas de feature que dependem de uma
// integração ainda não configurada. Não é erro: o resto do módulo funciona.
//
// REGRA DE PRODUTO: a mensagem é sempre genérica. Nome de variável de ambiente
// (SERPRO_CONSUMER_KEY, PLUGGY_CLIENT_ID…) NUNCA aparece na UI — o que o
// usuário precisa saber é que falta configurar, e onde configurar.

const DEFAULT_TITLE = 'Integração aguardando configuração';
const DEFAULT_DESCRIPTION =
  'Esta funcionalidade precisa de uma integração que ainda não foi ativada. ' +
  'O restante do módulo continua funcionando normalmente.';

type IntegrationUnavailableProps = {
  title?: string;
  description?: string;
  /** Sobrescreve a navegação padrão para a tela de Integrações. */
  onConfigure?: () => void;
};

export function IntegrationUnavailable({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  onConfigure,
}: IntegrationUnavailableProps) {
  const navigate = useNavigate();
  const { can } = usePermissions();

  // Sem a permissão, o botão levaria a uma tela que o usuário não pode abrir —
  // pior que não oferecer saída nenhuma.
  const canConfigure = can('tenant_modules:manage');
  const handleConfigure = onConfigure ?? (() => navigate('/integracoes'));

  return (
    <div className="ds-int-unavailable" role="status">
      <span className="ds-int-unavailable__icon" aria-hidden="true">⚙</span>
      <div className="ds-int-unavailable__body">
        <strong className="ds-int-unavailable__title">{title}</strong>
        <p className="ds-int-unavailable__desc">{description}</p>
        {canConfigure && (
          <button type="button" className="btn btn-secondary btn-sm"
            style={{ width: 'auto' }} onClick={handleConfigure}>
            Configurar integrações
          </button>
        )}
      </div>
    </div>
  );
}
