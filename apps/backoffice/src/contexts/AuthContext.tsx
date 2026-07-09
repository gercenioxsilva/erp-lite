import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../lib/api';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string;
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

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    api.get<AuthUser>('/v1/auth/me')
      .then(u => { setUser(u); setTenantId(u.tenant_id); loadPermissions(); })
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  function saveSession(res: AuthResponse) {
    localStorage.setItem('token', res.token);
    setUser({ ...res.user, tenant_id: res.tenantId });
    setTenantId(res.tenantId);
    loadPermissions();
  }

  async function login(email: string, password: string) {
    const res = await api.post<AuthResponse>('/v1/auth/login', { email, password });
    saveSession(res);
  }

  async function register(data: RegisterData) {
    const res = await api.post<AuthResponse>('/v1/auth/register', data);
    saveSession(res);
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

  return (
    <AuthContext.Provider value={{ user, tenantId, loading, login, register, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
