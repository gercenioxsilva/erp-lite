import { FastifyRequest, FastifyReply } from 'fastify';

// ── Achado da revisão de segurança do módulo de Visita Técnica ──────────────
// Sem este guard, um JWT com role='technician' teria acesso a QUALQUER rota
// existente (authenticate só confere tenantId, nunca role) — inclusive
// /v1/clients, /v1/receivables etc. Técnico externo/terceirizado não deveria
// ter essa visibilidade. Em vez de retrofitar uma checagem de papel em cada
// rota existente (risco de regressão), um único hook global aqui restringe o
// papel novo a um allowlist mínimo — aditivo, não muda nada para os papéis
// que já existem hoje (owner/admin/manager/user).

const TECHNICIAN_ALLOWED_PREFIXES = [
  '/health',
  '/v1/auth/me',
  '/v1/technician/',
];

export async function technicianRoleGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = (request as any).user;
  if (!user || user.role !== 'technician') return; // não é técnico — segue o fluxo normal

  const url = request.url.split('?')[0];
  const allowed = TECHNICIAN_ALLOWED_PREFIXES.some(p => url === p || url.startsWith(p));
  if (allowed) return;

  return reply.code(403).send({
    error:   'TechnicianRoleRestricted',
    message: 'Contas de técnico só têm acesso ao portal de visitas.',
  });
}
