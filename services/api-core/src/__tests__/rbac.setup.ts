import { vi } from 'vitest';

// Nos testes de ROTA (integração), o RBAC não é o alvo — o usuário de teste
// (role 'admin') precisa ter acesso. Concedemos todas as permissões por padrão
// para não exigir seed de papéis no db mockado de cada teste.
//
// Os testes dedicados do RBAC contornam este mock:
//   • permissionService.test.ts usa vi.importActual (implementação real);
//   • requirePermission.test.ts define seu próprio vi.mock (precede o setup).
vi.mock('../rbac/permissionService', async () => {
  const { ALL_PERMISSION_KEYS } = await import('../rbac/permissions');
  return {
    getPermissionsForUser:     async () => new Set(ALL_PERMISSION_KEYS),
    getPermissionsList:        async () => [...ALL_PERMISSION_KEYS],
    invalidatePermissionCache: () => {},
  };
});
