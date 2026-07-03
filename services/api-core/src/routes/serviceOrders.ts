import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { requireModule } from '../lib/requireModule';
import {
  createServiceOrder, transitionServiceOrder, ServiceOrderDomainError,
} from '../services/serviceOrderService';
import { scheduleVisit, buildVisitLink, ServiceVisitDomainError } from '../services/serviceVisitService';
import { isRoutingTokenValid } from '../domain/serviceVisit/serviceVisitDomain';
import { getPresignedReadUrl } from '../services/servicePhotoStorageService';

export const serviceOrdersRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate], preHandler: [requireModule('service_orders')] };

  // ── GET /v1/service-orders ───────────────────────────────────────────────
  fastify.get('/service-orders', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { status, search, page = '1', per_page = '20' } = request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const statusFilter = status ? sql`AND so.status = ${status}` : sql``;
    const searchFilter = search
      ? sql`AND (so.number ILIKE ${'%' + search + '%'} OR so.title ILIKE ${'%' + search + '%'})`
      : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT so.id, so.number, so.title, so.type, so.status, so.total, so.created_at,
               COALESCE(c.company_name, c.full_name) AS client_name
        FROM service_orders so
        LEFT JOIN clients c ON c.id = so.client_id
        WHERE so.tenant_id = ${tenantId} ${statusFilter} ${searchFilter}
        ORDER BY so.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM service_orders so
        WHERE so.tenant_id = ${tenantId} ${statusFilter} ${searchFilter}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  // ── POST /v1/service-orders ──────────────────────────────────────────────
  fastify.post('/service-orders', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const b = request.body as any;

    try {
      const so = await createServiceOrder({
        tenantId, createdBy: userId,
        clientId: b.client_id, costCenterId: b.cost_center_id,
        title: b.title, description: b.description, type: b.type,
        items: b.items,
      });
      return reply.code(201).send(so);
    } catch (err) {
      if (err instanceof ServiceOrderDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  // ── GET /v1/service-orders/:id ───────────────────────────────────────────
  fastify.get('/service-orders/:id', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const [{ rows: [so] }, { rows: items }, { rows: visits }] = await Promise.all([
      db.execute<any>(sql`
        SELECT so.*, COALESCE(c.company_name, c.full_name) AS client_name
        FROM service_orders so
        LEFT JOIN clients c ON c.id = so.client_id
        WHERE so.id = ${id} AND so.tenant_id = ${tenantId}
      `),
      db.execute<any>(sql`
        SELECT * FROM service_order_items WHERE service_order_id = ${id} ORDER BY created_at
      `),
      db.execute<any>(sql`
        SELECT sv.id, sv.status, sv.scheduled_at, sv.checked_in_at, sv.checked_out_at,
               sv.technician_name, sv.report_notes, sv.signed_by_name, sv.signed_at,
               sv.routing_token, sv.token_expires_at,
               t.name AS technician_current_name
        FROM service_visits sv
        LEFT JOIN technicians t ON t.id = sv.technician_id
        WHERE sv.service_order_id = ${id} AND sv.tenant_id = ${tenantId}
        ORDER BY sv.scheduled_at DESC
      `),
    ]);

    if (!so) return reply.notFound('Ordem de serviço não encontrada');

    // Link de roteamento do técnico (regra 38) — exposto aqui para reenvio manual
    // (ex.: WhatsApp) pelo backoffice; o link em si nunca concede acesso sozinho.
    const visitsWithLink = visits.map((v: any) => {
      const { routing_token, token_expires_at, ...rest } = v;
      return {
        ...rest,
        visit_link: routing_token ? buildVisitLink(v.id, routing_token) : null,
        link_valid: routing_token
          ? isRoutingTokenValid(new Date(token_expires_at), v.status)
          : false,
      };
    });

    return { ...so, items, visits: visitsWithLink };
  });

  // ── POST /v1/service-orders/:id/visits ───────────────────────────────────
  fastify.post('/service-orders/:id/visits', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { technician_id, scheduled_at } = request.body as { technician_id: string; scheduled_at: string };

    if (!technician_id) return reply.badRequest('technician_id é obrigatório');
    if (!scheduled_at)  return reply.badRequest('scheduled_at é obrigatório');

    try {
      const visit = await scheduleVisit({
        tenantId, serviceOrderId: id, technicianId: technician_id, scheduledAt: new Date(scheduled_at),
      });
      return reply.code(201).send(visit);
    } catch (err) {
      if (err instanceof ServiceVisitDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  // ── GET /v1/service-orders/:id/visits/:visitId ───────────────────────────
  // Visão do backoffice (não do técnico) — fotos e assinatura via URL assinada
  // de leitura, gerada sob demanda, nunca um link fixo.
  fastify.get('/service-orders/:id/visits/:visitId', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { visitId } = request.params as { visitId: string };

    const { rows: [visit] } = await db.execute<any>(sql`
      SELECT sv.*, t.name AS technician_current_name
      FROM service_visits sv
      LEFT JOIN technicians t ON t.id = sv.technician_id
      WHERE sv.id = ${visitId} AND sv.tenant_id = ${tenantId}
    `);
    if (!visit) return reply.notFound('Visita não encontrada');

    const { rows: photoRows } = await db.execute<any>(sql`
      SELECT id, s3_key, caption, created_at FROM service_visit_photos
      WHERE service_visit_id = ${visitId} ORDER BY created_at
    `);

    const photos = await Promise.all(photoRows.map(async (p: any) => ({
      id: p.id, caption: p.caption, created_at: p.created_at,
      url: await getPresignedReadUrl(p.s3_key),
    })));

    const signatureUrl = visit.signature_s3_key ? await getPresignedReadUrl(visit.signature_s3_key) : null;

    return { ...visit, photos, signature_url: signatureUrl };
  });

  // ── POST /v1/service-orders/:id/cancel ───────────────────────────────────
  fastify.post('/service-orders/:id/cancel', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    try {
      await transitionServiceOrder(id, tenantId, 'cancelled');
      return { ok: true, status: 'cancelled' };
    } catch (err) {
      if (err instanceof ServiceOrderDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });
};
