import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { GaxLogo }  from '../../components/GaxLogo';
import { AuthHero } from '../../components/AuthHero';
import { useAuth }  from '../../contexts/AuthContext';
import { ApiError } from '../../lib/api';

// Entrada do Portal do Cliente (/portal/entrar) — fora do PortalLayout, molde do
// TechnicianLoginPage: mesmo POST /v1/auth/login do backoffice, só muda o destino
// pós-login. Quem tem role='client' cai em /portal; qualquer outro papel vai
// para o app normal ('/').
export function PortalLoginPage() {
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();

  // Já logado como client → direto pro portal. Outros papéis só são redirecionados
  // após um login feito AQUI (submitted) — assim um admin pode usar esta tela para
  // entrar com uma conta de cliente de teste sem ser expulso na chegada.
  useEffect(() => {
    if (!user) return;
    if (user.role === 'client') navigate('/portal', { replace: true });
    else if (submitted)         navigate('/', { replace: true });
  }, [user, submitted, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      setSubmitted(true); // o useEffect decide o destino quando o user chegar
    } catch (err: unknown) {
      setError(err instanceof ApiError && err.status === 0
        ? 'Sem conexão com o servidor. Tente novamente.'
        : 'E-mail ou senha inválidos.');
    } finally { setLoading(false); }
  }

  return (
    <div className="ls-shell">
      <AuthHero />
      <section className="ls-form-panel">
        <div className="ls-form-body">
          <div className="ls-form-logo"><GaxLogo size="xl" variant="full" theme="light" /></div>
          <div className="ls-form-heading">
            <h2>Portal do Cliente</h2>
            <p>Acesse para ver e solicitar seus horários.</p>
          </div>

          {error && <div className="alert alert-error" role="alert">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="pl-email">E-mail</label>
              <input id="pl-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus autoComplete="username" />
            </div>
            <div className="field">
              <label htmlFor="pl-password">Senha</label>
              <input id="pl-password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                required autoComplete="current-password" />
            </div>
            <button type="submit" className="btn btn-primary ls-submit" disabled={loading}>
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
