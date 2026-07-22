import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import {
  createServiceOrder, updateServiceOrder, transitionServiceOrder, ServiceOrderDomainError,
} from '../services/serviceOrderService';
import { scheduleVisit, buildVisitLink, ServiceVisitDomainError } from '../services/serviceVisitService';
import { isRoutingTokenValid } from '../domain/serviceVisit/serviceVisitDomain';
import { getPresignedReadUrl } from '../services/servicePhotoStorageService';
import { billServiceOrder, ServiceOrderBillingDomainError } from '../services/serviceOrderBillingService';
import { getFieldValuesForVisit } from '../services/serviceVisitFieldService';
import { formatFieldValueForDisplay } from '../domain/customFields/customFieldDomain';

export const serviceOrdersRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate], preHandler: [requireModule('service_orders')] };

  // ── GET /v1/service-orders ───────────────────────────────────────────────
  fastify.get('/service-orders', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('service_orders:view') ] }, async (request) => {
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
  fastify.post('/service-orders', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('service_orders:create') ] }, async (request, reply) => {
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
  fastify.get('/service-orders/:id', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('service_orders:view') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const [{ rows: [so] }, { rows: items }, { rows: visits }] = await Promise.all([
      // Faturamento (regra 47): junta o receivable (no máximo 1 por OS,
      // via UNIQUE parcial) e o boleto/NFS-e vinculados, se existirem — o
      // frontend mostra tudo isso direto na tela da OS, sem navegar até
      // Contas a Receber.
      db.execute<any>(sql`
        SELECT so.*, COALESCE(c.company_name, c.full_name) AS client_name,
               r.id AS receivable_id, r.status AS receivable_status,
               r.due_date AS receivable_due_date, r.amount AS receivable_amount,
               r.paid_amount AS receivable_paid_amount,
               b.status AS boleto_status, b.brcode, b.pix_qr_code, b.boleto_url,
               n.id AS nfse_id, n.nfse_status
        FROM service_orders so
        LEFT JOIN clients c ON c.id = so.client_id
        LEFT JOIN receivables r ON r.service_order_id = so.id
        LEFT JOIN boletos b ON b.id = r.boleto_id
        LEFT JOIN nfse_invoices n ON n.receivable_id = r.id
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
    // custom_fields (migration 0088): respostas do formulário técnico dinâmico
    // já coletadas em campo — visíveis aqui pro operador do tenant conferir o
    // que o técnico preencheu, sem precisar abrir o portal dele.
    const visitsWithLink = await Promise.all(visits.map(async (v: any) => {
      const { routing_token, token_expires_at, ...rest } = v;
      return {
        ...rest,
        visit_link: routing_token ? buildVisitLink(v.id, routing_token) : null,
        link_valid: routing_token
          ? isRoutingTokenValid(new Date(token_expires_at), v.status)
          : false,
        custom_fields: await getFieldValuesForVisit(v.id, tenantId, db),
      };
    }));

    return { ...so, items, visits: visitsWithLink };
  });

  // ── PATCH /v1/service-orders/:id ─────────────────────────────────────────
  // Substitui header + itens por completo, só permitido em 'draft' (mesmo
  // padrão de PATCH /purchase-orders/:id) — depois de agendada, a OS vira
  // somente-leitura, restando apenas cancelar.
  fastify.patch('/service-orders/:id', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('service_orders:edit') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const b = request.body as any;

    try {
      const so = await updateServiceOrder(id, tenantId, {
        clientId: b.client_id, costCenterId: b.cost_center_id,
        title: b.title, description: b.description, type: b.type,
        items: b.items,
      });
      return so;
    } catch (err) {
      if (err instanceof ServiceOrderDomainError) {
        return reply.code(err.code === 'service_order_not_found' ? 404 : 422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  // ── GET /v1/service-orders/:id/print ─────────────────────────────────────
  // "Espelho do técnico" — mesmos dados que o técnico vê no portal (cliente
  // completo com endereço/contato, visitas com foto/assinatura), autenticado
  // por tenantId. Usado pra o tenant conferir o que o técnico vai ver antes
  // de agendar, e pra imprimir a OS. Deliberadamente NÃO inclui a tabela de
  // itens — o técnico também não vê itens no portal dele, só o título e a
  // descrição da OS, então essa visão espelha exatamente isso.
  fastify.get('/service-orders/:id/print', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const { rows: [so] } = await db.execute<any>(sql`
      SELECT so.id, so.number, so.title, so.description, so.type, so.status, so.created_at,
             COALESCE(c.company_name, c.full_name) AS client_name,
             c.phone AS client_phone, c.mobile AS client_mobile, c.email AS client_email,
             c.street AS client_street, c.street_number AS client_street_number,
             c.complement AS client_complement, c.neighborhood AS client_neighborhood,
             c.city AS client_city, c.state AS client_state, c.zip_code AS client_zip_code
      FROM service_orders so
      LEFT JOIN clients c ON c.id = so.client_id
      WHERE so.id = ${id} AND so.tenant_id = ${tenantId}
    `);
    if (!so) return reply.notFound('Ordem de serviço não encontrada');

    const { rows: visits } = await db.execute<any>(sql`
      SELECT sv.id, sv.status, sv.scheduled_at, sv.checked_in_at, sv.checked_out_at,
             sv.report_notes, sv.signed_by_name, sv.signed_at, sv.signature_s3_key,
             COALESCE(t.name, sv.technician_name) AS technician_name
      FROM service_visits sv
      LEFT JOIN technicians t ON t.id = sv.technician_id
      WHERE sv.service_order_id = ${id} AND sv.tenant_id = ${tenantId}
      ORDER BY sv.scheduled_at
    `);

    const visitsWithMedia = await Promise.all(visits.map(async (v: any) => {
      const { signature_s3_key, ...rest } = v;
      const { rows: photoRows } = await db.execute<any>(sql`
        SELECT id, caption, created_at, s3_key FROM service_visit_photos
        WHERE service_visit_id = ${v.id} ORDER BY created_at
      `);
      const photos = await Promise.all(photoRows.map(async (p: any) => ({
        id: p.id, caption: p.caption, created_at: p.created_at,
        url: await getPresignedReadUrl(p.s3_key),
      })));
      // custom_fields (migration 0088) — mesmo padrão de formatação de
      // impressão já usado pra contrato (regra 71): formatted_value pronto
      // pra exibição, nunca reformatado no frontend.
      const customFields = await getFieldValuesForVisit(v.id, tenantId, db);
      return {
        ...rest, photos,
        signature_url: signature_s3_key ? await getPresignedReadUrl(signature_s3_key) : null,
        custom_fields: customFields.map(f => ({
          label: f.label, field_type: f.field_type,
          value: f.value, formatted_value: formatFieldValueForDisplay(f.field_type, f.value),
        })),
      };
    }));

    return { ...so, visits: visitsWithMedia };
  });

  // ── POST /v1/service-orders/:id/visits ───────────────────────────────────
  fastify.post('/service-orders/:id/visits', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('service_orders:assign') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { technician_id, scheduled_at, duration_minutes } = request.body as {
      technician_id: string; scheduled_at: string; duration_minutes?: number;
    };

    if (!technician_id) return reply.badRequest('technician_id é obrigatório');
    if (!scheduled_at)  return reply.badRequest('scheduled_at é obrigatório');

    try {
      const visit = await scheduleVisit({
        tenantId, serviceOrderId: id, technicianId: technician_id, scheduledAt: new Date(scheduled_at),
        durationMinutes: duration_minutes ? Number(duration_minutes) : undefined,
      });
      return reply.code(201).send(visit);
    } catch (err) {
      if (err instanceof ServiceVisitDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  // ── GET /v1/service-orders/visits ────────────────────────────────────────
  // Agenda do Técnico (regra 78): leitura por período, opcionalmente filtrada
  // por técnico — alimenta o calendário estilo Google Agenda no backoffice.
  // Rota estática (não aninhada em /:id) — find-my-way (roteador do Fastify)
  // sempre prioriza rota estática sobre parametrizada, então nunca colide com
  // GET /service-orders/:id mesmo que ambas comecem com o mesmo prefixo.
  fastify.get('/service-orders/visits', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('service_orders:view') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { technician_id, from, to } = request.query as { technician_id?: string; from?: string; to?: string };

    if (!from) return reply.badRequest('from é obrigatório (YYYY-MM-DD)');
    if (!to)   return reply.badRequest('to é obrigatório (YYYY-MM-DD)');

    const technicianFilter = technician_id ? sql`AND sv.technician_id = ${technician_id}` : sql``;

    const { rows } = await db.execute<any>(sql`
      SELECT sv.id, sv.service_order_id, sv.scheduled_at, sv.duration_minutes, sv.status,
             sv.technician_id, t.name AS technician_name,
             so.number AS service_order_number, so.title AS service_order_title,
             COALESCE(c.company_name, c.full_name) AS client_name
      FROM service_visits sv
      JOIN technicians t ON t.id = sv.technician_id
      JOIN service_orders so ON so.id = sv.service_order_id
      LEFT JOIN clients c ON c.id = so.client_id
      WHERE sv.tenant_id = ${tenantId}
        AND sv.scheduled_at >= ${from}::date
        AND sv.scheduled_at < (${to}::date + interval '1 day')
        ${technicianFilter}
      ORDER BY sv.scheduled_at
    `);

    const data = rows.map((r: any) => {
      const scheduledAt = new Date(r.scheduled_at);
      const endsAt = new Date(scheduledAt.getTime() + r.duration_minutes * 60_000);
      return {
        id: r.id, service_order_id: r.service_order_id,
        service_order_number: r.service_order_number, service_order_title: r.service_order_title,
        technician_id: r.technician_id, technician_name: r.technician_name,
        client_name: r.client_name,
        scheduled_at: scheduledAt.toISOString(), ends_at: endsAt.toISOString(),
        duration_minutes: r.duration_minutes, status: r.status,
      };
    });

    return { data };
  });

  // ── GET /v1/service-orders/:id/visits/:visitId ───────────────────────────
  // Visão do backoffice (não do técnico) — fotos e assinatura via URL assinada
  // de leitura, gerada sob demanda, nunca um link fixo.
  fastify.get('/service-orders/:id/visits/:visitId', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('service_orders:view') ] }, async (request, reply) => {
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
    const customFields = await getFieldValuesForVisit(visitId, tenantId, db);

    return { ...visit, photos, signature_url: signatureUrl, custom_fields: customFields };
  });

  // ── POST /v1/service-orders/:id/cancel ───────────────────────────────────
  fastify.post('/service-orders/:id/cancel', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('service_orders:edit') ] }, async (request, reply) => {
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

  // ── POST /v1/service-orders/:id/billing ──────────────────────────────────
  // Faturamento manual de uma OS concluída (regra 47): gera o receivable e,
  // opcionalmente, a NFS-e — a cobrança em si (boleto/Pix) segue pelo fluxo
  // que já existe, POST /v1/receivables/:id/emit-boleto, sem mudança nenhuma.
  fastify.post('/service-orders/:id/billing', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('service_orders:edit') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params as { id: string };
    const { due_date, emit_nfse, company_id } = request.body as {
      due_date?: string; emit_nfse?: boolean; company_id?: string;
    };

    try {
      const result = await billServiceOrder({
        tenantId, serviceOrderId: id, dueDate: due_date,
        emitNfse: Boolean(emit_nfse), companyId: company_id ?? null,
      }, db);
      fastify.log.info({ event: 'service_order_billed', service_order_id: id, tenant_id: tenantId, user_id: userId, ...result });
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof ServiceOrderBillingDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });
};
