import { FastifyRequest, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';

// Hook global irmão de subscriptionGuard.ts — mesma filosofia (consulta viva
// ao banco por request, nunca cacheada no JWT; allowlist de prefixos nunca
// bloqueada), mas SEPARADO por SRP: billing e identidade/ativação são
// preocupações diferentes, mesmo racional que já mantém technicianRoleGuard
// isolado de subscriptionGuard. Reaproveita a MESMA allowlist — as rotas de
// verificação/reenvio vivem sob /v1/auth/*, então nenhum prefixo novo
// precisa ser adicionado aqui.
const EXCLUDED_PREFIXES = [
  '/health',
  '/v1/auth/',
  '/v1/subscription/',
  '/v1/public/',
];

export async function tenantActivationGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = request.url.split('?')[0];
  if (EXCLUDED_PREFIXES.some(p => url === p.replace(/\/$/, '') || url.startsWith(p))) return;

  const user = (request as any).user;
  if (!user?.tenantId) return; // unauthenticated routes handled separately

  // Fail-open em erro de infraestrutura na própria consulta: este guard é uma
  // regra de negócio (ativação de conta), não o mecanismo de isolamento
  // multi-tenant (que é sempre o filtro tenant_id em cada query de cada
  // rota, intacto e independente deste hook). Se o banco estiver
  // genuinamente indisponível, a própria rota vai falhar logo em seguida na
  // sua própria query — não faz sentido este hook ser o único ponto de
  // falha 500 pra toda a aplicação por causa disso.
  let tenant: { activated_at: string | null } | undefined;
  try {
    ({ rows: [tenant] } = await db.execute<{ activated_at: string | null }>(sql`
      SELECT activated_at FROM tenants WHERE id = ${user.tenantId} LIMIT 1
    `));
  } catch (err) {
    request.log.warn({ event: 'tenant_activation_guard_query_failed', error: String(err) });
    return;
  }

  if (!tenant) return; // tenant não encontrado — deixa a rota decidir (não é responsabilidade deste guard)

  // Comparação estrita com `null` (não apenas falsy): no Postgres real, uma
  // coluna timestamptz NULL sempre desserializa para `null`, nunca para
  // `undefined` — a chave sempre existe na linha. `undefined` só é possível
  // aqui por ambiguidade de teste (mock genérico de `db.execute`/`db.select`
  // reaproveitado por múltiplas queries de uma mesma rota devolvendo uma
  // linha de outro formato). Nesse caso de ambiguidade real, o guard nunca
  // bloqueia — só bloqueia quando tem certeza de que activated_at é NULL.
  if (tenant.activated_at !== null) return;

  return reply.code(403).send({
    error:   'EmailNotVerified',
    message: 'Confirme seu e-mail para ativar sua conta e continuar usando o sistema.',
  });
}
