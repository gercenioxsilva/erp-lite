import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import {
  createTechnician, listTechnicians, setTechnicianActive, updateTechnician,
  resendTechnicianInvite, TechnicianServiceError,
} from '../services/technicianService';

export const techniciansRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate], preHandler: [requireModule('service_orders')] };

  // ── GET /v1/technicians ─────────────────────────────────────────────────
  fastify.get('/technicians', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('technicians:view') ] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { search, page = '1', per_page = '20' } = request.query as Record<string, string>;
    return listTechnicians({
      tenantId, search,
      page: Number(page) || 1,
      perPage: Math.min(Number(per_page) || 20, 100),
    });
  });

  // ── POST /v1/technicians ────────────────────────────────────────────────
  fastify.post('/technicians', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('technicians:create') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { name, email, phone, cpf, specialty } = request.body as {
      name: string; email: string; phone?: string; cpf: string; specialty?: string;
    };

    if (!name?.trim())  return reply.badRequest('name é obrigatório');
    if (!email?.trim()) return reply.badRequest('email é obrigatório');
    if (!cpf?.trim())   return reply.badRequest('cpf é obrigatório');

    try {
      const technician = await createTechnician({ tenantId, name, email, phone, cpf, specialty });
      return reply.code(201).send(technician);
    } catch (err) {
      if (err instanceof TechnicianServiceError) {
        if (err.code === 'invalid_cpf') return reply.badRequest('CPF inválido');
        if (err.code === 'email_already_registered') return reply.conflict('E-mail já cadastrado');
        return reply.badRequest(err.code);
      }
      throw err;
    }
  });

  // ── PATCH /v1/technicians/:id ───────────────────────────────────────────
  // Edita dados cadastrais (nunca senha) — corrige erros de digitação do
  // onboarding sem precisar recriar o técnico.
  fastify.patch('/technicians/:id', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { name, email, phone, cpf, specialty } = request.body as {
      name?: string; email?: string; phone?: string | null; cpf?: string; specialty?: string | null;
    };

    try {
      const technician = await updateTechnician(id, tenantId, { name, email, phone, cpf, specialty });
      return technician;
    } catch (err) {
      if (err instanceof TechnicianServiceError) {
        if (err.code === 'technician_not_found') return reply.notFound('Técnico não encontrado');
        if (err.code === 'invalid_cpf') return reply.badRequest('CPF inválido');
        if (err.code === 'email_already_registered') return reply.conflict('E-mail já cadastrado');
        return reply.badRequest(err.code);
      }
      throw err;
    }
  });

  // ── POST /v1/technicians/:id/resend-invite ──────────────────────────────
  // Reenvia o link de definição de senha — mesmo mecanismo do convite
  // inicial, útil quando o e-mail foi digitado errado ou o link expirou.
  fastify.post('/technicians/:id/resend-invite', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    try {
      await resendTechnicianInvite(id, tenantId);
      return { ok: true };
    } catch (err) {
      if (err instanceof TechnicianServiceError && err.code === 'technician_not_found') {
        return reply.notFound('Técnico não encontrado');
      }
      throw err;
    }
  });

  // ── PATCH /v1/technicians/:id/active ────────────────────────────────────
  fastify.patch('/technicians/:id/active', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('technicians:edit') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { is_active } = request.body as { is_active: boolean };

    try {
      await setTechnicianActive(id, tenantId, !!is_active);
      return { ok: true };
    } catch (err) {
      if (err instanceof TechnicianServiceError && err.code === 'technician_not_found') {
        return reply.notFound('Técnico não encontrado');
      }
      throw err;
    }
  });
};
