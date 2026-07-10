import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePortalMe } from './PortalLayout';

// Rótulos amigáveis para os tipos de negócio conhecidos; valores fora da lista
// caem no texto cru vindo do backend.
const BUSINESS_TYPE_LABELS: Record<string, string> = {
  driving_school: 'Autoescola',
  barbershop:     'Barbearia',
  salon:          'Salão de beleza',
  clinic:         'Clínica',
  gym:            'Academia',
  other:          'Outro',
};

export function PortalProfilePage() {
  const me = usePortalMe();
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/portal/entrar');
  }

  const businessType = me.business.business_type
    ? (BUSINESS_TYPE_LABELS[me.business.business_type] ?? me.business.business_type)
    : null;

  return (
    <div>
      <h1 className="portal-hello">Perfil</h1>
      <p className="portal-hello-sub">Seus dados e como funciona o atendimento.</p>

      <div className="portal-section-head"><h2>Seus dados</h2></div>
      <div className="portal-card">
        <dl className="portal-kv-list">
          <div className="portal-kv"><dt>Nome</dt><dd>{me.client.full_name}</dd></div>
          {me.client.company_name && (
            <div className="portal-kv"><dt>Empresa</dt><dd>{me.client.company_name}</dd></div>
          )}
          {me.client.email && (
            <div className="portal-kv"><dt>E-mail</dt><dd>{me.client.email}</dd></div>
          )}
          {me.client.phone && (
            <div className="portal-kv"><dt>Telefone</dt><dd>{me.client.phone}</dd></div>
          )}
        </dl>
      </div>

      <div className="portal-section-head"><h2>Acesso</h2></div>
      <div className="portal-card">
        <dl className="portal-kv-list">
          <div className="portal-kv"><dt>Nome de acesso</dt><dd>{me.user.name}</dd></div>
          <div className="portal-kv"><dt>Login</dt><dd>{me.user.email}</dd></div>
        </dl>
      </div>

      <div className="portal-section-head"><h2>Atendimento</h2></div>
      <div className="portal-card">
        <dl className="portal-kv-list">
          <div className="portal-kv">
            <dt>Estabelecimento</dt>
            <dd>{me.business.business_name ?? 'Agendamentos'}</dd>
          </div>
          {businessType && (
            <div className="portal-kv"><dt>Tipo</dt><dd>{businessType}</dd></div>
          )}
        </dl>
        <div className="portal-rules" style={{ marginTop: 12 }}>
          <strong>Regras de agendamento</strong>
          Solicitações precisam de pelo menos {me.business.min_advance_hours}h de antecedência.
          Cancelamentos são aceitos até {me.business.cancel_window_hours}h antes do horário.
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <button type="button" className="portal-btn-ghost" onClick={handleLogout}>
          Sair da conta
        </button>
      </div>
    </div>
  );
}
