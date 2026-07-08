import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api, AUTH_SIGNOUT_EVENT } from '../lib/api';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string;
  permissions: string[];
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

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    api.get<AuthUser>('/v1/auth/me')
      .then(u => { setUser(u); setTenantId(u.tenant_id); })
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
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

  function saveSession(res: AuthResponse) {
    localStorage.setItem('token', res.token);
    setUser({ ...res.user, tenant_id: res.tenantId, permissions: res.permissions ?? [] });
    setTenantId(res.tenantId);
  }

  async function login(email: string, password: string) {
    const res = await api.post<AuthResponse>('/v1/auth/login', { email, password });
    saveSession(res);
  }

  async function register(data: RegisterData) {
    const res = await api.post<AuthResponse>('/v1/auth/register', data);
    saveSession(res);
  }

  const refreshPermissions = useCallback(async () => {
    const u = await api.get<AuthUser>('/v1/auth/me');
    setUser(u);
    setTenantId(u.tenant_id);
  }, []);

  return (
    <AuthContext.Provider value={{ user, tenantId, loading, login, register, logout, refreshPermissions }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
