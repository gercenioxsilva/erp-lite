import { FastifyPluginAsync } from 'fastify';
import { sql, eq } from 'drizzle-orm';
import { db, simplesRemessaEvents } from '../db';
import {
  createSimplesRemessa,
  emitSimplesRemessa,
  registrarRetorno,
  SimplesRemessaDomainError,
} from '../services/simplesRemessaService';
import { SIMPLES_REMESSA_MOTIVOS } from '../domain/simplesRemessa/simplesRemessaDomain';

// Rota fina — nunca contém regra de negócio, só traduz HTTP ↔ service
// (mesma disciplina de Clean Architecture usada no resto da base).
export const simplesRemessaRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate] };

  /* ── GET /v1/simples-remessas ──────────────────────────────────────────── */
  fastify.get('/simples-remessas', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { status, motivo, search, page = '1', per_page = '20' } = request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const statusFilter = status ? sql`AND sr.status = ${status}` : sql``;
    const motivoFilter = motivo ? sql`AND sr.motivo = ${motivo}` : sql``;
    const searchFilter = search
      ? sql`AND (COALESCE(sr.nfe_chave,'') ILIKE ${'%' + search + '%'} OR COALESCE(c.company_name, c.full_name, '') ILIKE ${'%' + search + '%'})`
      : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT sr.id, sr.motivo, sr.cfop, sr.status, sr.total, sr.nfe_chave,
               sr.parent_remessa_id, sr.created_at,
               COALESCE(c.company_name, c.full_name) AS client_name
        FROM simples_remessas sr
        LEFT JOIN clients c ON c.id = sr.client_id
        WHERE sr.tenant_id = ${tenantId} ${statusFilter} ${motivoFilter} ${searchFilter}
        ORDER BY sr.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM simples_remessas sr
        LEFT JOIN clients c ON c.id = sr.client_id
        WHERE sr.tenant_id = ${tenantId} ${statusFilter} ${motivoFilter} ${searchFilter}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit, motivos: SIMPLES_REMESSA_MOTIVOS };
  });

  /* ── POST /v1/simples-remessas ─────────────────────────────────────────── */
  fastify.post('/simples-remessas', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const b = request.body as any;

    if (!b.client_id) return reply.badRequest('client_id é obrigatório');
    if (!b.items?.length) return reply.badRequest('Ao menos um item é obrigatório');

    try {
      const sr = await createSimplesRemessa({
        tenantId, companyId: b.company_id ?? null, clientId: b.client_id, motivo: b.motivo,
        notes: b.notes, createdBy: userId,
        items: (b.items as any[]).map(it => ({
          materialId: it.material_id, name: it.name, ncmCode: it.ncm_code,
          quantity: it.quantity, unit_price: it.unit_price,
        })),
      }, db);
      return reply.code(201).send(sr);
    } catch (err) {
      if (err instanceof SimplesRemessaDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  /* ── GET /v1/simples-remessas/:id ──────────────────────────────────────── */
  fastify.get('/simples-remessas/:id', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const [{ rows: [sr] }, { rows: items }, { rows: retornos }] = await Promise.all([
      db.execute<any>(sql`
        SELECT sr.*, COALESCE(c.company_name, c.full_name) AS client_name
        FROM simples_remessas sr
        LEFT JOIN clients c ON c.id = sr.client_id
        WHERE sr.id = ${id} AND sr.tenant_id = ${tenantId}
      `),
      db.execute<any>(sql`
        SELECT sri.*, m.name AS material_name, m.sku AS material_sku
        FROM simples_remessa_items sri
        LEFT JOIN materials m ON m.id = sri.material_id
        WHERE sri.simples_remessa_id = ${id}
        ORDER BY sri.created_at
      `),
      db.execute<any>(sql`
        SELECT id, status, total, created_at FROM simples_remessas
        WHERE parent_remessa_id = ${id} ORDER BY created_at DESC
      `),
    ]);

    if (!sr) return reply.notFound('Simples Remessa não encontrada');
    return { ...sr, items, retornos };
  });

  /* ── POST /v1/simples-remessas/:id/emit ────────────────────────────────── */
  fastify.post('/simples-remessas/:id/emit', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    try {
      const result = await emitSimplesRemessa(id, tenantId, db);
      return reply.code(202).send({
        ok: true, ...result,
        message: 'Simples Remessa enviada para processamento. Acompanhe o status em tempo real.',
      });
    } catch (err) {
      if (err instanceof SimplesRemessaDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  /* ── POST /v1/simples-remessas/:id/retorno ─────────────────────────────── */
  // Registra o retorno (draft) vinculado à remessa original — reaproveita o
  // mesmo fluxo de emissão (POST /:id/emit) para o retorno em si.
  fastify.post('/simples-remessas/:id/retorno', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params as { id: string };
    const b = (request.body ?? {}) as any;

    try {
      const retorno = await registrarRetorno(id, {
        tenantId, createdBy: userId,
        items: b.items?.length
          ? (b.items as any[]).map(it => ({
              materialId: it.material_id, name: it.name, ncmCode: it.ncm_code,
              quantity: it.quantity, unit_price: it.unit_price,
            }))
          : undefined,
      }, db);
      return reply.code(201).send(retorno);
    } catch (err) {
      if (err instanceof SimplesRemessaDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  /* ── GET /v1/simples-remessas/:id/events ───────────────────────────────── */
  fastify.get('/simples-remessas/:id/events', auth, async (request) => {
    const { id } = request.params as { id: string };
    const rows = await db.select({
      event_type: simplesRemessaEvents.event_type, status_code: simplesRemessaEvents.status_code,
      protocol: simplesRemessaEvents.protocol, payload: simplesRemessaEvents.payload, created_at: simplesRemessaEvents.created_at,
    }).from(simplesRemessaEvents).where(eq(simplesRemessaEvents.simples_remessa_id, id))
      .orderBy(sql`${simplesRemessaEvents.created_at} DESC`);
    return rows;
  });
};
