import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * preHandler hook — bloqueia uma rota inteira se o usuário autenticado não
 * tiver um dos papéis informados. Generaliza o padrão ad-hoc já usado em
 * technicianRoleGuard.ts (hook global fixo pra 'technician') para um
 * preHandler reutilizável por rota — usado hoje pelas rotas de perfis de
 * acesso e pelas mutações de papel/perfil em routes/users.ts, restritas a
 * requireRole('owner').
 */
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = (request as any).user?.role;
    if (!role || !roles.includes(role)) {
      return reply.code(403).send({
        error:   'RoleNotAllowed',
        message: `Esta ação exige um dos papéis: ${roles.join(', ')}.`,
      });
    }
  };
}
