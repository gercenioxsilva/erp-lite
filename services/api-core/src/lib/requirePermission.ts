import { FastifyRequest, FastifyReply } from 'fastify';
import { getPermissionsForUser } from '../rbac/permissionService';
import type { Permission } from '../rbac/permissions';

/**
 * preHandler — exige que o usuário autenticado possua TODAS as permissões
 * informadas (AND). Deve vir depois de `authenticate` (onRequest), que popula
 * request.user. Backend é a autoridade: o frontend só esconde por UX.
 *
 * Padrão de uso:
 *   fastify.post('/clients',
 *     { onRequest:[fastify.authenticate], preHandler:[requirePermission('clients:create')] },
 *     handler)
 */
export function requirePermission(...required: Permission[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user?.userId || !user?.tenantId) return reply.unauthorized();

    const perms = await getPermissionsForUser(user.tenantId, user.role);
    const missing = required.filter((p) => !perms.has(p));
    if (missing.length) {
      request.log.warn(
        {
          event: 'rbac_denied', userId: user.userId, tenantId: user.tenantId,
          role: user.role, required, missing, method: request.method, url: request.url,
        },
        'rbac_denied',
      );
      return reply.code(403).send({
        error:   'PermissionDenied',
        message: 'Você não possui permissão para executar esta ação.',
        required,
      });
    }
  };
}

/** Variante OR — exige QUALQUER uma das permissões. */
export function requireAnyPermission(...anyOf: Permission[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user?.userId || !user?.tenantId) return reply.unauthorized();

    const perms = await getPermissionsForUser(user.tenantId, user.role);
    if (anyOf.some((p) => perms.has(p))) return;

    request.log.warn(
      {
        event: 'rbac_denied', userId: user.userId, tenantId: user.tenantId,
        role: user.role, anyOf, method: request.method, url: request.url,
      },
      'rbac_denied',
    );
    return reply.code(403).send({
      error:   'PermissionDenied',
      message: 'Você não possui permissão para executar esta ação.',
      required: anyOf,
    });
  };
}
