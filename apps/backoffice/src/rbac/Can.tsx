import { ReactNode } from 'react';
import { usePermissions, type Permission } from './usePermissions';

interface CanProps {
  /** Exige esta permissão. */
  permission?: Permission;
  /** Exige QUALQUER uma (OR). */
  anyOf?: Permission[];
  /** Exige TODAS (AND). */
  allOf?: Permission[];
  /** Render alternativo quando não autorizado (padrão: nada). */
  fallback?: ReactNode;
  children: ReactNode;
}

// Renderiza os filhos só se o usuário tiver a permissão. Use para esconder
// botões/ações. Lembre: esconder no front é UX — a API é a autoridade.
export function Can({ permission, anyOf, allOf, fallback = null, children }: CanProps) {
  const { can, canAny, canAll } = usePermissions();

  let allowed = true;
  if (permission)   allowed = can(permission);
  else if (anyOf)   allowed = canAny(...anyOf);
  else if (allOf)   allowed = canAll(...allOf);

  return <>{allowed ? children : fallback}</>;
}
