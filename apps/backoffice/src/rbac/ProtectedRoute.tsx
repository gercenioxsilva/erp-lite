import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermissions, type Permission } from './usePermissions';

interface ProtectedRouteProps {
  /** Permissão exigida para acessar a rota. */
  permission?: Permission;
  /** Alternativa: qualquer uma (OR). */
  anyOf?: Permission[];
  children: ReactNode;
}

// Envolve uma rota. Sem a permissão → redireciona para a página 403.
// A checagem real de acesso continua no backend; isto evita a tela vazia/erro.
export function ProtectedRoute({ permission, anyOf, children }: ProtectedRouteProps) {
  const { can, canAny } = usePermissions();

  const allowed = permission ? can(permission) : anyOf ? canAny(...anyOf) : true;
  if (!allowed) return <Navigate to="/403" replace />;

  return <>{children}</>;
}
