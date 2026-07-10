import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

// Permissões são strings `modulo:acao`. O array vem do backend (/auth/login e
// /auth/me) já resolvido — inclusive para o owner (backend devolve todas). Aqui
// só consultamos; a autoridade é sempre o backend.
export type Permission = string;

export interface UsePermissions {
  can:    (permission: Permission) => boolean;
  canAny: (...permissions: Permission[]) => boolean;
  canAll: (...permissions: Permission[]) => boolean;
  role:   string | null;
  permissions: string[];
}

export function usePermissions(): UsePermissions {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];

  const set = useMemo(() => new Set(permissions), [permissions]);

  return useMemo<UsePermissions>(() => ({
    can:    (p) => set.has(p),
    canAny: (...ps) => ps.some((p) => set.has(p)),
    canAll: (...ps) => ps.every((p) => set.has(p)),
    role:   user?.role ?? null,
    permissions,
  }), [set, user?.role, permissions]);
}
