import { FastifyRequest, FastifyReply } from 'fastify';
import { getEffectivePermissions } from '../services/accessControlService';
import type { PermissionResource, PermissionAction } from '../domain/accessControl/accessControlDomain';

/**
 * preHandler hook — bloqueia uma rota inteira se o usuário autenticado não
 * tiver a permissão (resource, action) concedida pelo seu perfil de acesso.
 * Mesmo desenho de requireModule.ts: sempre uma consulta viva ao banco
 * (nunca cacheada no JWT) — revogar uma permissão tem efeito imediato, sem
 * precisar logout. `owner` faz bypass total (getEffectivePermissions já
 * resolve isso no domínio — nunca pode ficar trancado fora do próprio
 * tenant por má configuração de perfil).
 *
 * Eixo ortogonal a requireModule(): módulo decide se a funcionalidade existe
 * pro tenant; isto decide se ESTE usuário pode usá-la. Quando uma rota tem
 * os dois gates, requireModule() deve vir primeiro no array de preHandlers.
 */
export function requirePermission(resource: PermissionResource, action: PermissionAction) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const tenantId = user?.tenantId;
    const userId   = user?.userId;
    if (!tenantId || !userId) return reply.unauthorized();

    const effective = await getEffectivePermissions(userId, tenantId);
    if (!effective.can(resource, action)) {
      return reply.code(403).send({
        error:   'PermissionDenied',
        message: `Seu perfil de acesso não permite "${action}" em "${resource}".`,
      });
    }
  };
}
