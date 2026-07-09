import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../lib/api';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string;
  // Ativação de conta por e-mail — null = tenant ainda não confirmou o
  // e-mail do owner. Só controla UX (tela de bloqueio); o controle de
  // acesso de verdade é sempre tenantActivationGuard.ts no backend.
  tenant_activated_at: string | null;
}

// Perfil de Acesso (RBAC) — mapa de permissões efetivas do usuário logado,
// vindo de GET /v1/auth/permissions. Só controla UX (menu/botões); o
// controle de acesso de verdade é sempre requirePermission() no backend
// (mesmo princípio já usado por GET /v1/tenant/modules).
type PermissionMap = Record<string, { view: boolean; manage: boolean }>;

interface AuthContextValue {
  user: AuthUser | null;
  tenantId: string | null;
  loading: boolean;
  login:    (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout:   () => void;
  can: (resource: string, action?: 'view' | 'manage') => boolean;
  tenantActivated: boolean;
  refreshUser: () => Promise<void>;
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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [loading, setLoading] = useState(true);

  function loadPermissions() {
    api.get<{ permissions: PermissionMap }>('/v1/auth/permissions')
      .then(res => setPermissions(res.permissions ?? {}))
      .catch(() => setPermissions({}));
  }

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
      .then(loadPermissions)
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSession(res: AuthResponse): Promise<void> {
    localStorage.setItem('token', res.token);
    await loadMe();
    loadPermissions();
  }

  async function login(email: string, password: string) {
    const res = await api.post<AuthResponse>('/v1/auth/login', { email, password });
    await saveSession(res);
  }

  async function register(data: RegisterData) {
    const res = await api.post<AuthResponse>('/v1/auth/register', data);
    await saveSession(res);
  }

  function logout() {
    localStorage.removeItem('token');
    setUser(null);
    setTenantId(null);
    setPermissions({});
  }

  function can(resource: string, action: 'view' | 'manage' = 'view'): boolean {
    return permissions[resource]?.[action] ?? false;
  }

  const tenantActivated = user != null && user.tenant_activated_at != null;

  return (
    <AuthContext.Provider value={{
      user, tenantId, loading, login, register, logout, can, tenantActivated, refreshUser: loadMe,
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
