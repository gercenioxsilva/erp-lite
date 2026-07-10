import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api, AUTH_SIGNOUT_EVENT } from '../lib/api';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string;
  permissions: string[];
  // Ativação de conta por e-mail — null = tenant ainda não confirmou o
  // e-mail do owner. Só controla UX (tela de bloqueio); o controle de
  // acesso de verdade é sempre tenantActivationGuard.ts no backend.
  tenant_activated_at: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  tenantId: string | null;
  loading: boolean;
  login:    (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout:   () => void;
  /** Recarrega papel + permissões do /auth/me (reflete troca de perfil sem re-login). */
  refreshPermissions: () => Promise<void>;
  /** Alias usado pelo fluxo de ativação (VerifyEmailPage/EmailNotVerifiedScreen). */
  refreshUser: () => Promise<void>;
  tenantActivated: boolean;
}

interface RegisterData {
  company_name: string;
  trade_name?:  string;
  tax_id:       string;
  tax_id_type:  string;
  name:         string;
  email:        string;
  password:     string;
}

interface AuthResponse {
  token: string;
  user: { id: string; email: string; name: string; role: string };
  tenantId: string;
  permissions: string[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fonte única de verdade pro AuthUser — sempre busca o /auth/me completo
  // (inclui tenant_activated_at), nunca reconstrói o objeto a partir da
  // resposta parcial de login/register. Reaproveitada tanto no boot quanto
  // depois de VerifyEmailPage.tsx confirmar o e-mail (o token de sessão já
  // existe desde o registro — só o status de ativação muda).
  async function loadMe(): Promise<void> {
    const u = await api.get<AuthUser>('/v1/auth/me');
    setUser(u);
    setTenantId(u.tenant_id);
  }

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    loadMe()
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setUser(null);
    setTenantId(null);
  }, []);

  // Sessão expirada / revogada (401 em request autenticado): o api.ts limpa o
  // token e dispara este evento; aqui só zeramos o estado → GuardedRoutes
  // redireciona para /login sem reload duro.
  useEffect(() => {
    const handle = () => { setUser(null); setTenantId(null); };
    window.addEventListener(AUTH_SIGNOUT_EVENT, handle);
    return () => window.removeEventListener(AUTH_SIGNOUT_EVENT, handle);
  }, []);

  async function saveSession(res: AuthResponse): Promise<void> {
    localStorage.setItem('token', res.token);
    await loadMe();
  }

  async function login(email: string, password: string) {
    const res = await api.post<AuthResponse>('/v1/auth/login', { email, password });
    await saveSession(res);
  }

  async function register(data: RegisterData) {
    const res = await api.post<AuthResponse>('/v1/auth/register', data);
    await saveSession(res);
  }

  const refreshPermissions = useCallback(async () => {
    await loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tenantActivated = user != null && user.tenant_activated_at != null;

  return (
    <AuthContext.Provider value={{
      user, tenantId, loading, login, register, logout,
      refreshPermissions, refreshUser: loadMe, tenantActivated,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
