import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, actionErrorMessage } from '../../lib/api';
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
          <div className="portal-kv"><dt>Telefone</dt><dd><PhoneEditor initial={me.client.phone} /></dd></div>
        </dl>
      </div>

      <div className="portal-section-head"><h2>Segurança</h2></div>
      <div className="portal-card">
        <PasswordChanger />
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


// ── Perfil editável (0083): telefone + senha — o que o cliente corrige sozinho.

function PhoneEditor({ initial }: { initial: string | null }) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone]     = useState(initial ?? '');
  const [saved, setSaved]     = useState(initial ?? '');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  async function save() {
    setBusy(true); setError('');
    try {
      const resp = await api.patch<{ phone: string | null }>('/v1/portal/me', { phone: phone.trim() || null });
      setSaved(resp.phone ?? '');
      setEditing(false);
    } catch (err) { setError(actionErrorMessage(err, 'Não foi possível salvar.')); }
    finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <span>
        {saved || '—'}{' '}
        <button type="button" className="portal-link-btn" style={{ background: 'none', border: 'none', color: 'var(--primary, #2563eb)', cursor: 'pointer', fontSize: 13, padding: 0 }}
          onClick={() => { setPhone(saved); setEditing(true); }}>
          editar
        </button>
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input value={phone} onChange={e => setPhone(e.target.value)} maxLength={20}
        placeholder="(00) 00000-0000" style={{ width: 160 }} aria-label="Telefone" />
      <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={busy} onClick={() => void save()}>
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
      <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} disabled={busy} onClick={() => setEditing(false)}>
        Cancelar
      </button>
      {error && <span role="alert" style={{ color: 'var(--danger, #b91c1c)', fontSize: 12 }}>{error}</span>}
    </span>
  );
}

function PasswordChanger() {
  const [current, setCurrent] = useState('');
  const [next, setNext]       = useState('');
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function change() {
    if (next.length < 8) { setMsg({ kind: 'err', text: 'A nova senha precisa de pelo menos 8 caracteres.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await api.post('/v1/portal/me/password', { current_password: current, new_password: next });
      setMsg({ kind: 'ok', text: 'Senha alterada com sucesso.' });
      setCurrent(''); setNext('');
    } catch (err) { setMsg({ kind: 'err', text: actionErrorMessage(err, 'Não foi possível alterar a senha.') }); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 320 }}>
      <label style={{ fontSize: 13 }}>Senha atual
        <input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" />
      </label>
      <label style={{ fontSize: 13 }}>Nova senha (mín. 8)
        <input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
      </label>
      <button type="button" className="btn btn-primary" style={{ width: 'auto' }} disabled={busy || !current || !next}
        onClick={() => void change()}>
        {busy ? 'Alterando…' : 'Alterar senha'}
      </button>
      {msg && (
        <span role={msg.kind === 'err' ? 'alert' : 'status'}
          style={{ fontSize: 13, color: msg.kind === 'err' ? 'var(--danger, #b91c1c)' : 'var(--success, #15803d)' }}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
