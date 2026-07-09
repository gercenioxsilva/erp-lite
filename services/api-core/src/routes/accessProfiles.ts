import { FastifyPluginAsync } from 'fastify';
import { requireRole } from '../lib/requireRole';
import {
  listProfiles, createProfile, updateProfile, deleteProfile,
  listProfilePermissions, setProfilePermissions,
  AccessControlDomainError,
} from '../services/accessControlService';
import { PERMISSION_RESOURCES, PERMISSION_ACTIONS } from '../domain/accessControl/accessControlDomain';

export const accessProfilesRoutes: FastifyPluginAsync = async (fastify) => {
  const auth      = { onRequest: [(fastify as any).authenticate] };
  const ownerOnly = { onRequest: [(fastify as any).authenticate], preHandler: [requireRole('owner')] };

  function handleDomainError(err: unknown, reply: any) {
    if (err instanceof AccessControlDomainError) {
      if (err.code === 'profile_not_found' || err.code === 'user_not_found') {
        return reply.notFound(err.code);
      }
      if (err.code === 'actor_not_owner') {
        return reply.code(403).send({ error: err.code });
      }
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    throw err;
  }

  // ── Catálogo (leitura pública ao tenant — alimenta o seletor no frontend) ────
  fastify.get('/access-profiles/catalog', auth, async () => {
    return { resources: PERMISSION_RESOURCES, actions: PERMISSION_ACTIONS };
  });

  // ── Perfis — leitura disponível a qualquer usuário autenticado do tenant ────
  // (mesmo espírito de GET /v1/users hoje: ver a lista não é a capacidade
  // sensível, mutar é — por isso só as mutações abaixo exigem requireRole('owner')).
  fastify.get('/access-profiles', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    return { data: await listProfiles(tenantId) };
  });

  fastify.get('/access-profiles/:id/permissions', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    try {
      return { data: await listProfilePermissions(id, tenantId) };
    } catch (err) { return handleDomainError(err, reply); }
  });

  // ── Mutações — owner apenas ─────────────────────────────────────────────────
  fastify.post('/access-profiles', ownerOnly, async (request, reply) => {
    const tenantId  = (request as any).user.tenantId;
    const actorRole = (request as any).user.role;
    const changedBy = (request as any).user.userId;
    const { name, description } = request.body as { name: string; description?: string };
    try {
      return reply.code(201).send(await createProfile({ tenantId, actorRole, name, description, changedBy }));
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.patch('/access-profiles/:id', ownerOnly, async (request, reply) => {
    const tenantId  = (request as any).user.tenantId;
    const actorRole = (request as any).user.role;
    const changedBy = (request as any).user.userId;
    const { id }    = request.params as { id: string };
    const { name, description } = request.body as { name?: string; description?: string };
    try {
      return await updateProfile(id, tenantId, { actorRole, name, description, changedBy });
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.delete('/access-profiles/:id', ownerOnly, async (request, reply) => {
    const tenantId  = (request as any).user.tenantId;
    const actorRole = (request as any).user.role;
    const changedBy = (request as any).user.userId;
    const { id }    = request.params as { id: string };
    try {
      await deleteProfile(id, tenantId, actorRole, changedBy);
      return reply.code(204).send();
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.put('/access-profiles/:id/permissions', ownerOnly, async (request, reply) => {
    const tenantId  = (request as any).user.tenantId;
    const actorRole = (request as any).user.role;
    const changedBy = (request as any).user.userId;
    const { id }    = request.params as { id: string };
    const { grants } = request.body as { grants: Array<{ resource: string; action: string }> };
    if (!Array.isArray(grants)) return reply.badRequest('grants deve ser uma lista');
    try {
      return { data: await setProfilePermissions(id, tenantId, grants as any, actorRole, changedBy) };
    } catch (err) { return handleDomainError(err, reply); }
  });
};

// A atribuição de perfil a um usuário acontece em PATCH /v1/users/:id
// (routes/users.ts), não aqui — evita duas rotas fazendo a mesma mutação.
// accessControlService#assignUserProfile é a função reaproveitada por lá.
