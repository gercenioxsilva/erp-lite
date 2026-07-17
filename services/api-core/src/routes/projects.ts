import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import {
  createProject, updateProject, transitionProject, listProjects, getProject,
  allocateProfessional, removeProfessional,
  linkOrder, unlinkOrder, linkServiceOrder, unlinkServiceOrder,
  ProjectDomainError,
} from '../services/projectService';

function projectErrorStatus(code: string): number {
  return code.endsWith('_not_found') ? 404 : 422;
}

export const projectsRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate], preHandler: [requireModule('projects')] };

  // ── GET /v1/projects ──────────────────────────────────────────────────────
  fastify.get('/projects', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:view') ] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { status, search, page = '1', per_page = '20' } = request.query as Record<string, string>;
    return listProjects(tenantId, {
      status, search, page: Number(page) || 1, perPage: Number(per_page) || 20,
    });
  });

  // ── POST /v1/projects ─────────────────────────────────────────────────────
  fastify.post('/projects', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:create') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const b = request.body as any;

    try {
      const project = await createProject({
        tenantId, createdBy: userId,
        name: b.name, description: b.description,
        totalValue: Number(b.total_value) || 0,
        clientId: b.client_id, costCenterId: b.cost_center_id,
        startDate: b.start_date, endDate: b.end_date,
      });
      return reply.code(201).send(project);
    } catch (err) {
      if (err instanceof ProjectDomainError) return reply.code(projectErrorStatus(err.code)).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  // ── GET /v1/projects/:id ──────────────────────────────────────────────────
  fastify.get('/projects/:id', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:view') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const project = await getProject(id, tenantId);
    if (!project) return reply.notFound('Projeto não encontrado');
    return project;
  });

  // ── PATCH /v1/projects/:id ────────────────────────────────────────────────
  fastify.patch('/projects/:id', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:edit') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const b = request.body as any;

    try {
      const project = await updateProject(id, tenantId, {
        name: b.name, description: b.description,
        totalValue: Number(b.total_value) || 0,
        clientId: b.client_id, costCenterId: b.cost_center_id,
        startDate: b.start_date, endDate: b.end_date,
      });
      return project;
    } catch (err) {
      if (err instanceof ProjectDomainError) return reply.code(projectErrorStatus(err.code)).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  // ── Transições de status ──────────────────────────────────────────────────
  async function handleTransition(request: any, reply: any, to: 'in_progress' | 'completed' | 'cancelled') {
    const tenantId = request.user.tenantId;
    const { id }    = request.params as { id: string };
    try {
      await transitionProject(id, tenantId, to);
      return { ok: true, status: to };
    } catch (err) {
      if (err instanceof ProjectDomainError) return reply.code(projectErrorStatus(err.code)).send({ error: err.code, ...err.payload });
      throw err;
    }
  }
  fastify.post('/projects/:id/start', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:edit') ] },
    (request, reply) => handleTransition(request, reply, 'in_progress'));
  fastify.post('/projects/:id/complete', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:edit') ] },
    (request, reply) => handleTransition(request, reply, 'completed'));
  fastify.post('/projects/:id/cancel', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:edit') ] },
    (request, reply) => handleTransition(request, reply, 'cancelled'));

  // ── Profissionais alocados ────────────────────────────────────────────────
  fastify.post('/projects/:id/professionals', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:edit') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const b = request.body as any;
    try {
      const row = await allocateProfessional(id, tenantId, {
        professionalType: b.professional_type,
        technicianId:      b.technician_id,
        sellerId:           b.seller_id,
        commissionPct:      Number(b.commission_pct) || 0,
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (err instanceof ProjectDomainError) return reply.code(projectErrorStatus(err.code)).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  fastify.delete('/projects/:id/professionals/:allocationId', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:edit') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id, allocationId } = request.params as { id: string; allocationId: string };
    try {
      await removeProfessional(id, tenantId, allocationId);
      return { ok: true };
    } catch (err) {
      if (err instanceof ProjectDomainError) return reply.code(projectErrorStatus(err.code)).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  // ── Pedidos de venda vinculados ───────────────────────────────────────────
  fastify.post('/projects/:id/orders', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:edit') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { order_id } = request.body as { order_id?: string };
    if (!order_id) return reply.badRequest('order_id é obrigatório');
    try {
      const row = await linkOrder(id, tenantId, order_id);
      return reply.code(201).send(row);
    } catch (err) {
      if (err instanceof ProjectDomainError) return reply.code(projectErrorStatus(err.code)).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  fastify.delete('/projects/:id/orders/:orderId', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:edit') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id, orderId } = request.params as { id: string; orderId: string };
    try {
      await unlinkOrder(id, tenantId, orderId);
      return { ok: true };
    } catch (err) {
      if (err instanceof ProjectDomainError) return reply.code(projectErrorStatus(err.code)).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  // ── Ordens de serviço vinculadas ──────────────────────────────────────────
  fastify.post('/projects/:id/service-orders', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:edit') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { service_order_id } = request.body as { service_order_id?: string };
    if (!service_order_id) return reply.badRequest('service_order_id é obrigatório');
    try {
      const row = await linkServiceOrder(id, tenantId, service_order_id);
      return reply.code(201).send(row);
    } catch (err) {
      if (err instanceof ProjectDomainError) return reply.code(projectErrorStatus(err.code)).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  fastify.delete('/projects/:id/service-orders/:serviceOrderId', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('projects:edit') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id, serviceOrderId } = request.params as { id: string; serviceOrderId: string };
    try {
      await unlinkServiceOrder(id, tenantId, serviceOrderId);
      return { ok: true };
    } catch (err) {
      if (err instanceof ProjectDomainError) return reply.code(projectErrorStatus(err.code)).send({ error: err.code, ...err.payload });
      throw err;
    }
  });
};
