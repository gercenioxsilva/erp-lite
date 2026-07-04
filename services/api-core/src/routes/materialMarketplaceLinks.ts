import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import {
  listLinks, createLink, updateLink, closeLink, requestSync,
  MarketplaceDomainError,
} from '../services/materialMarketplaceLinkService';

export const materialMarketplaceLinksRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate], preHandler: [requireModule('mercadolivre')] };

  /* ── GET /v1/materials/:id/marketplace-links ────────────────────────── */
  fastify.get('/materials/:id/marketplace-links', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    const rows = await listLinks(tenantId, { materialId: id });
    return { data: rows };
  });

  /* ── POST /v1/materials/:id/marketplace-links ───────────────────────── */
  fastify.post('/materials/:id/marketplace-links', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    const body = request.body as any;

    if (!body?.connection_id) return reply.badRequest('connection_id é obrigatório');

    try {
      const row = await createLink(tenantId, { ...body, material_id: id });
      return reply.code(201).send(row);
    } catch (err) {
      if (err instanceof MarketplaceDomainError) {
        if (err.code === 'material_not_found' || err.code === 'connection_not_found') return reply.notFound('Material ou conexão não encontrados');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── PATCH /v1/materials/:id/marketplace-links/:linkId ──────────────── */
  fastify.patch('/materials/:id/marketplace-links/:linkId', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { linkId } = request.params as { linkId: string };

    try {
      const row = await updateLink(tenantId, linkId, request.body as any);
      return row;
    } catch (err) {
      if (err instanceof MarketplaceDomainError) {
        if (err.code === 'link_not_found') return reply.notFound('Vínculo não encontrado');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── DELETE /v1/materials/:id/marketplace-links/:linkId ─────────────── */
  fastify.delete('/materials/:id/marketplace-links/:linkId', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { linkId } = request.params as { linkId: string };

    try {
      await closeLink(tenantId, linkId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof MarketplaceDomainError) {
        if (err.code === 'link_not_found') return reply.notFound('Vínculo não encontrado');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── POST /v1/materials/:id/marketplace-links/:linkId/sync ──────────── */
  fastify.post('/materials/:id/marketplace-links/:linkId/sync', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { linkId } = request.params as { linkId: string };

    try {
      const result = await requestSync(tenantId, linkId);
      return result;
    } catch (err) {
      if (err instanceof MarketplaceDomainError) {
        if (err.code === 'link_not_found') return reply.notFound('Vínculo não encontrado');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });
};
