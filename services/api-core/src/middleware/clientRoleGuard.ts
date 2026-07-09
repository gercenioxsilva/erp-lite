import { FastifyRequest, FastifyReply } from 'fastify';

// ── Mesmo raciocínio do technicianRoleGuard ──────────────────────────────────
// authenticate só confere o JWT (tenantId), nunca o papel. Sem este guard, um
// JWT com role='client' (aluno/cliente do portal de agendamentos) acessaria
// qualquer rota do ERP do tenant — /v1/clients, /v1/receivables etc. Um único
// hook global restringe o papel novo a um allowlist mínimo, aditivo, sem tocar
// nos papéis existentes. O RBAC (scheduling_portal:access) é a segunda camada.

const CLIENT_ALLOWED_PREFIXES = [
  '/health',
  '/v1/auth/me',
  '/v1/portal/',
];

export async function clientRoleGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = (request as any).user;
  if (!user || user.role !== 'client') return; // não é cliente do portal — segue o fluxo normal

  const url = request.url.split('?')[0];
  const allowed = CLIENT_ALLOWED_PREFIXES.some(p => url === p || url.startsWith(p));
  if (allowed) return;

  return reply.code(403).send({
    error:   'ClientRoleRestricted',
    message: 'Contas de cliente só têm acesso ao portal de agendamentos.',
  });
}
