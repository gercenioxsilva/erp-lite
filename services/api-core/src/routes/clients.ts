import { FastifyPluginAsync } from 'fastify';
import { eq, ilike, or, and, sql } from 'drizzle-orm';
import { db, clients } from '../db';
import { normalizeCNPJ } from '../domain/cnpj/cnpjDomain';
import { requirePermission } from '../lib/requirePermission';

const clientBody = {
  type: 'object',
  required: ['tenant_id', 'person_type'],
  properties: {
    tenant_id: { type: 'string', format: 'uuid' }, person_type: { type: 'string', enum: ['PJ', 'PF'] },
    company_name: { type: 'string', maxLength: 255 }, trade_name: { type: 'string', maxLength: 255 },
    cnpj: { type: 'string', maxLength: 14 }, state_reg: { type: 'string', maxLength: 30 },
    municipal_reg: { type: 'string', maxLength: 30 }, suframa: { type: 'string', maxLength: 20 },
    full_name: { type: 'string', maxLength: 255 }, cpf: { type: 'string', maxLength: 11 },
    birth_date: { type: 'string', format: 'date' }, rg: { type: 'string', maxLength: 20 },
    rg_issuer: { type: 'string', maxLength: 30 }, rg_issue_date: { type: 'string', format: 'date' },
    email: { type: 'string', format: 'email' }, phone: { type: 'string', maxLength: 20 },
    mobile: { type: 'string', maxLength: 20 }, zip_code: { type: 'string', maxLength: 8 },
    street: { type: 'string', maxLength: 255 }, street_number: { type: 'string', maxLength: 20 },
    complement: { type: 'string', maxLength: 100 }, neighborhood: { type: 'string', maxLength: 100 },
    city: { type: 'string', maxLength: 100 }, state: { type: 'string', maxLength: 2 },
    country: { type: 'string', maxLength: 2 },
    icms_taxpayer: { type: 'string', enum: ['1', '2', '9'] }, consumer_type: { type: 'string', enum: ['0', '1'] },
    // Regra 61/74: travado no cadastro, nunca perguntado na tela de nota.
    tax_regime: { type: 'string', enum: ['lucro_presumido', 'lucro_real', 'simples_nacional', 'mei'] },
    is_active: { type: 'boolean' }, notes: { type: 'string' },
    // Consentimento WhatsApp (migration 0067) — LGPD, opt-in explícito do
    // cliente final pra receber cobranças/documentos pelo WhatsApp.
    whatsapp_opt_in: { type: 'boolean' },
  },
  additionalProperties: false,
};

const patchBody = { ...clientBody, required: [] as string[] };

export const clientsRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /v1/clients
  fastify.post('/clients', {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requirePermission('clients:create')],
    schema: { body: clientBody },
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const b = request.body as Record<string, unknown>;

    if (b.person_type === 'PJ' && !b.company_name)
      return reply.badRequest('company_name is required for PJ');
    if (b.person_type === 'PF' && !b.full_name)
      return reply.badRequest('full_name is required for PF');

    const consumer_type = b.person_type === 'PF' ? '1' : ((b.consumer_type ?? '0') as string);
    const icms_taxpayer = b.person_type === 'PF' ? '9' : ((b.icms_taxpayer ?? '9') as string);

    const [client] = await db.insert(clients).values({
      tenant_id: tenantId, person_type: b.person_type as string,
      company_name: (b.company_name ?? null) as string | null,
      trade_name:   (b.trade_name   ?? null) as string | null,
      cnpj:         b.cnpj ? normalizeCNPJ(b.cnpj as string) : null,
      state_reg:    (b.state_reg    ?? null) as string | null,
      municipal_reg: (b.municipal_reg ?? null) as string | null,
      suframa:      (b.suframa      ?? null) as string | null,
      full_name:    (b.full_name    ?? null) as string | null,
      cpf:          (b.cpf          ?? null) as string | null,
      birth_date:   (b.birth_date   ?? null) as string | null,
      rg:           (b.rg           ?? null) as string | null,
      rg_issuer:    (b.rg_issuer    ?? null) as string | null,
      rg_issue_date: (b.rg_issue_date ?? null) as string | null,
      email:        (b.email        ?? null) as string | null,
      phone:        (b.phone        ?? null) as string | null,
      mobile:       (b.mobile       ?? null) as string | null,
      zip_code:     (b.zip_code     ?? null) as string | null,
      street:       (b.street       ?? null) as string | null,
      street_number: (b.street_number ?? null) as string | null,
      complement:   (b.complement   ?? null) as string | null,
      neighborhood: (b.neighborhood ?? null) as string | null,
      city:         (b.city         ?? null) as string | null,
      state:        (b.state        ?? null) as string | null,
      country:      (b.country      ?? 'BR') as string,
      icms_taxpayer, consumer_type,
      tax_regime:   (b.tax_regime   ?? null) as string | null,
      notes: (b.notes ?? null) as string | null,
      whatsapp_opt_in:    Boolean(b.whatsapp_opt_in),
      whatsapp_opt_in_at: b.whatsapp_opt_in ? new Date() : null,
    }).returning();
    return reply.code(201).send(client);
  });

  // POST /v1/clients/import
  fastify.post('/clients/import', {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requirePermission('clients:import')],
    schema: {
      body: {
        type: 'object', required: ['tenant_id', 'clients'], additionalProperties: false,
        properties: {
          tenant_id: { type: 'string', format: 'uuid' },
          clients: { type: 'array', minItems: 1, maxItems: 500,
            items: { type: 'object', required: ['person_type'], additionalProperties: true,
              properties: { person_type: { type: 'string' } } } },
        },
      },
    },
  }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { clients: rows } = request.body as {
      tenant_id: string; clients: Record<string, unknown>[];
    };

    const toStr    = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null; };
    const toDigits = (v: unknown): string | null => { const s = String(v ?? '').replace(/\D/g, ''); return s || null; };
    const toCNPJ   = (v: unknown): string | null => { const s = normalizeCNPJ(String(v ?? '')); return s || null; };
    const toDate   = (v: unknown): string | null => {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const s = String(v ?? '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    };

    let imported = 0; let skipped = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const b   = rows[i];
      const row = i + 2;
      const personType = String(b.person_type ?? '').trim().toUpperCase();
      if (!['PJ', 'PF'].includes(personType)) {
        errors.push({ row, message: `tipo_pessoa inválido: "${b.person_type}" — use PJ ou PF` });
        skipped++; continue;
      }
      if (personType === 'PJ' && !toStr(b.company_name)) {
        errors.push({ row, message: 'razao_social é obrigatória para PJ' }); skipped++; continue;
      }
      if (personType === 'PF' && !toStr(b.full_name)) {
        errors.push({ row, message: 'nome_completo é obrigatório para PF' }); skipped++; continue;
      }
      const icms = personType === 'PF' ? '9' : (['1','2','9'].includes(String(b.icms_taxpayer)) ? String(b.icms_taxpayer) : '9');
      const cons = personType === 'PF' ? '1' : (['0','1'].includes(String(b.consumer_type))  ? String(b.consumer_type)  : '0');

      try {
        const inserted = await db.insert(clients).values({
          tenant_id: tenantId, person_type: personType,
          company_name: toStr(b.company_name), trade_name: toStr(b.trade_name),
          cnpj: toCNPJ(b.cnpj), state_reg: toStr(b.state_reg),
          municipal_reg: toStr(b.municipal_reg), suframa: toStr(b.suframa),
          full_name: toStr(b.full_name), cpf: toDigits(b.cpf),
          birth_date: toDate(b.birth_date), rg: toStr(b.rg), rg_issuer: toStr(b.rg_issuer),
          email: toStr(b.email), phone: toDigits(b.phone), mobile: toDigits(b.mobile),
          zip_code: toDigits(b.zip_code), street: toStr(b.street),
          street_number: toStr(b.street_number), complement: toStr(b.complement),
          neighborhood: toStr(b.neighborhood), city: toStr(b.city),
          state: toStr(b.state) as string | null, country: 'BR',
          icms_taxpayer: icms, consumer_type: cons, notes: toStr(b.notes),
        } as any).onConflictDoNothing().returning({ id: clients.id });

        if (!inserted.length) {
          errors.push({ row, message: `${personType === 'PJ' ? 'CNPJ' : 'CPF'} já cadastrado para este tenant` });
          skipped++;
        } else { imported++; }
      } catch (err: unknown) {
        errors.push({ row, message: err instanceof Error ? err.message : 'Erro ao inserir registro' });
        skipped++;
      }
    }
    return { imported, skipped, errors };
  });

  // GET /v1/clients
  fastify.get('/clients', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('clients:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { person_type, origin, search, page = '1', per_page = '20' } =
      request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const conditions: any[] = [eq(clients.tenant_id, tenantId), eq(clients.is_active, true)];
    if (person_type) conditions.push(eq(clients.person_type, person_type));
    // Filtro "Origem" (migration 0084) — só pra distinguir leads capturados
    // pela API pública (origin='landing_page') do resto da carteira, nunca
    // muda o comportamento padrão (sem o filtro, mostra tudo, como sempre).
    if (origin) conditions.push(eq(clients.origin, origin));
    if (search) conditions.push(or(
      ilike(clients.company_name, `%${search}%`),
      ilike(clients.full_name,    `%${search}%`),
      eq(clients.cnpj, search),
      eq(clients.cpf,  search),
    ));
    const where = and(...conditions as [any, ...any[]]);

    const [[{ total }], rows] = await Promise.all([
      db.select({ total: sql<number>`COUNT(*)::int` }).from(clients).where(where),
      db.select().from(clients).where(where)
        .orderBy(sql`COALESCE(${clients.company_name}, ${clients.full_name}) ASC`)
        .limit(limit).offset(offset),
    ]);

    return { data: rows, total, page: Number(page), per_page: limit };
  });

  // GET /v1/clients/:id
  fastify.get<{ Params: { id: string } }>('/clients/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('clients:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const [c] = await db.select().from(clients).where(and(eq(clients.id, request.params.id), eq(clients.tenant_id, tenantId)));
    if (!c) return reply.notFound('Client not found');
    return c;
  });

  // PATCH /v1/clients/:id
  fastify.patch<{ Params: { id: string } }>('/clients/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('clients:edit')], schema: { body: patchBody } }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params;
    const [existing] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, id), eq(clients.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Client not found');

    const b = request.body as Record<string, unknown>;
    const allowed = [
      'person_type','company_name','trade_name','cnpj','state_reg','municipal_reg','suframa',
      'full_name','cpf','birth_date','rg','rg_issuer','rg_issue_date',
      'email','phone','mobile','zip_code','street','street_number','complement',
      'neighborhood','city','state','country','icms_taxpayer','consumer_type','tax_regime','is_active','notes',
      'whatsapp_opt_in',
    ];
    const updateData = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k))) as Record<string, unknown>;
    if (!Object.keys(updateData).length) return reply.badRequest('No fields to update');

    // Carimba data/hora do consentimento (ou da revogação, se desmarcado pelo
    // backoffice) — mesmo racional do opt-out via webhook "SAIR"
    // (whatsappWebhookService.ts), só que aqui é o próprio tenant editando.
    if ('whatsapp_opt_in' in updateData) {
      if (updateData.whatsapp_opt_in) updateData.whatsapp_opt_in_at = new Date();
      else                             updateData.whatsapp_opt_out_at = new Date();
    }

    const [updated] = await db.update(clients).set(updateData as any).where(and(eq(clients.id, id), eq(clients.tenant_id, tenantId))).returning();
    return updated;
  });

  // DELETE /v1/clients/:id (soft delete)
  fastify.delete<{ Params: { id: string } }>('/clients/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('clients:delete')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const result = await db.update(clients)
      .set({ is_active: false })
      .where(and(eq(clients.id, request.params.id), eq(clients.is_active, true), eq(clients.tenant_id, tenantId)));
    if (!result.rowCount) return reply.notFound('Client not found or already inactive');
    return reply.code(204).send();
  });

  // GET /v1/clients/:id/history — 360° view: orders, invoices, receivables
  fastify.get<{ Params: { id: string } }>('/clients/:id/history', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('clients:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params;

    const [client] = await db.select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.tenant_id, tenantId)));
    if (!client) return reply.notFound();

    const [ordersResult, invoicesResult, receivablesResult] = await Promise.all([
      db.execute<any>(sql`
        SELECT id, number, status, total, created_at
        FROM orders WHERE client_id = ${id} AND tenant_id = ${tenantId}
        ORDER BY created_at DESC LIMIT 20
      `),
      db.execute<any>(sql`
        SELECT id, number, status, total, issue_date, nfe_status
        FROM invoices WHERE client_id = ${id} AND tenant_id = ${tenantId}
        ORDER BY issue_date DESC NULLS LAST LIMIT 20
      `),
      db.execute<any>(sql`
        SELECT id, description, amount, paid_amount, due_date, status
        FROM receivables WHERE client_id = ${id} AND tenant_id = ${tenantId}
        ORDER BY due_date DESC LIMIT 20
      `),
    ]);

    return {
      orders:      ordersResult.rows,
      invoices:    invoicesResult.rows,
      receivables: receivablesResult.rows,
    };
  });
};
