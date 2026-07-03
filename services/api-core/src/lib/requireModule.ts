import { FastifyRequest, FastifyReply } from 'fastify';
import { isModuleEnabled, type ModuleKey } from '../services/tenantModuleService';

/**
 * preHandler hook — bloqueia uma rota inteira se o tenant não tiver o módulo
 * habilitado (regra 2/gate de módulo opcional). Backend é sempre a autoridade:
 * o frontend só esconde o item de menu por conveniência de UX, nunca é o
 * controle de acesso de verdade.
 */
export function requireModule(moduleKey: ModuleKey) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).user?.tenantId;
    if (!tenantId) return reply.unauthorized();

    const enabled = await isModuleEnabled(tenantId, moduleKey);
    if (!enabled) {
      return reply.code(403).send({
        error:   'ModuleNotEnabled',
        message: `Módulo "${moduleKey}" não está habilitado para este tenant.`,
      });
    }
  };
}
