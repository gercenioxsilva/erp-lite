import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../lib/api';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  tenantId: string | null;
  loading: boolean;
  login:    (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout:   () => void;
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    api.get<AuthUser>('/v1/auth/me')
      .then(u => { setUser(u); setTenantId(u.tenant_id); })
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  function saveSession(res: AuthResponse) {
    localStorage.setItem('token', res.token);
    setUser({ ...res.user, tenant_id: res.tenantId });
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

  function logout() {
    localStorage.removeItem('token');
    setUser(null);
    setTenantId(null);
  }

  return (
    <AuthContext.Provider value={{ user, tenantId, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
