import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import {
  listStages, createStage, updateStage,
  listOpportunities, createOpportunity, updateOpportunity, moveStage, markWon, markLost,
  listActivities, logActivity, convertToProposal,
  SalesPipelineDomainError,
} from '../services/salesPipelineService';

export const salesPipelineRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate], preHandler: [requireModule('sales_pipeline')] };

  function handleDomainError(err: unknown, reply: any) {
    if (err instanceof SalesPipelineDomainError) {
      if (err.code === 'opportunity_not_found' || err.code === 'stage_not_found') {
        return reply.notFound(err.code);
      }
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    throw err;
  }

  // ── Etapas ─────────────────────────────────────────────────────────────────
  fastify.get('/sales-pipeline/stages', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    return { data: await listStages(tenantId) };
  });

  fastify.post('/sales-pipeline/stages', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { name } = request.body as { name: string };
    try {
      return reply.code(201).send(await createStage({ tenantId, name }));
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.patch('/sales-pipeline/stages/:id', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { name, sort_order, is_active } = request.body as { name?: string; sort_order?: number; is_active?: boolean };
    try {
      return await updateStage(id, tenantId, { name, sort_order, is_active });
    } catch (err) { return handleDomainError(err, reply); }
  });

  // ── Oportunidades ──────────────────────────────────────────────────────────
  fastify.get('/sales-pipeline/opportunities', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { seller_id, status } = request.query as { seller_id?: string; status?: 'open' | 'won' | 'lost' };
    return { data: await listOpportunities({ tenantId, sellerId: seller_id, status }) };
  });

  fastify.post('/sales-pipeline/opportunities', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const b = request.body as any;
    try {
      const opportunity = await createOpportunity({
        tenantId, stageId: b.stage_id, title: b.title,
        clientId: b.client_id, sellerId: b.seller_id,
        contactName: b.contact_name, contactEmail: b.contact_email, contactPhone: b.contact_phone,
        value: b.value != null ? Number(b.value) : undefined,
        source: b.source, expectedCloseDate: b.expected_close_date, notes: b.notes,
        createdBy: userId,
      });
      return reply.code(201).send(opportunity);
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.get('/sales-pipeline/opportunities/:id/activities', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    try {
      return { data: await listActivities(id, tenantId) };
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.patch('/sales-pipeline/opportunities/:id', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const b = request.body as any;
    try {
      return await updateOpportunity(id, tenantId, {
        title: b.title, clientId: b.client_id, sellerId: b.seller_id,
        contactName: b.contact_name, contactEmail: b.contact_email, contactPhone: b.contact_phone,
        value: b.value != null ? Number(b.value) : undefined,
        source: b.source, expectedCloseDate: b.expected_close_date, notes: b.notes,
      });
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.post('/sales-pipeline/opportunities/:id/move', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params as { id: string };
    const { stage_id } = request.body as { stage_id: string };
    if (!stage_id) return reply.badRequest('stage_id é obrigatório');
    try {
      return await moveStage(id, tenantId, stage_id, userId);
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.post('/sales-pipeline/opportunities/:id/won', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params as { id: string };
    try {
      return await markWon(id, tenantId, userId);
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.post('/sales-pipeline/opportunities/:id/lost', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params as { id: string };
    const { reason } = request.body as { reason?: string };
    try {
      return await markLost(id, tenantId, reason ?? null, userId);
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.post('/sales-pipeline/opportunities/:id/activities', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params as { id: string };
    const { type, description } = request.body as { type: 'note' | 'call' | 'meeting'; description?: string };
    if (!type) return reply.badRequest('type é obrigatório');
    try {
      return reply.code(201).send(await logActivity({ opportunityId: id, tenantId, type, description, userId }));
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.post('/sales-pipeline/opportunities/:id/convert-to-proposal', auth, async (request, reply) => {
    const tenantId  = (request as any).user.tenantId;
    const userId    = (request as any).user.userId;
    const userEmail = (request as any).user.email;
    const { id }    = request.params as { id: string };
    try {
      return reply.code(201).send(await convertToProposal(id, tenantId, userId, userEmail ?? null));
    } catch (err) { return handleDomainError(err, reply); }
  });
};
