import { FastifyPluginAsync } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { db, clientContacts, clients } from '../db';

const CONTACT_TYPES = ['comercial', 'juridico', 'compras', 'manutencao', 'comprador', 'outro'] as const;

const contactBody = {
  type: 'object',
  properties: {
    tenant_id:    { type: 'string', format: 'uuid' },
    contact_type: { type: 'string', enum: CONTACT_TYPES },
    name:         { type: 'string', maxLength: 255 },
    email:        { type: 'string', maxLength: 255 },
    phone:        { type: 'string', maxLength: 20 },
    notes:        { type: 'string' },
    is_active:    { type: 'boolean' },
  },
  additionalProperties: false,
};

const patchBody = { ...contactBody, required: [] as string[] };

export const clientContactsRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /v1/clients/:id/contacts
  fastify.get<{ Params: { id: string } }>('/clients/:id/contacts', async (request, reply) => {
    const { id: clientId } = request.params;
    const { tenant_id } = request.query as { tenant_id?: string };

    const [c] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
    if (!c) return reply.notFound('Client not found');

    const conditions: any[] = [
      eq(clientContacts.client_id, clientId),
      eq(clientContacts.is_active, true),
    ];
    if (tenant_id) conditions.push(eq(clientContacts.tenant_id, tenant_id));

    const rows = await db.select()
      .from(clientContacts)
      .where(and(...conditions as [any, ...any[]]))
      .orderBy(sql`${clientContacts.contact_type} ASC, ${clientContacts.name} ASC`);

    return { data: rows };
  });

  // POST /v1/clients/:id/contacts
  fastify.post<{ Params: { id: string } }>('/clients/:id/contacts', {
    schema: {
      body: {
        ...contactBody,
        required: ['tenant_id', 'contact_type'],
      },
    },
  }, async (request, reply) => {
    const { id: clientId } = request.params;
    const b = request.body as Record<string, unknown>;

    const [c] = await db.select({ id: clients.id }).from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.tenant_id, b.tenant_id as string)));
    if (!c) return reply.notFound('Client not found');

    const [contact] = await db.insert(clientContacts).values({
      tenant_id:    b.tenant_id    as string,
      client_id:    clientId,
      contact_type: (b.contact_type ?? 'comercial') as string,
      name:         (b.name  ?? null) as string | null,
      email:        (b.email ?? null) as string | null,
      phone:        (b.phone ?? null) as string | null,
      notes:        (b.notes ?? null) as string | null,
    }).returning();

    return reply.code(201).send(contact);
  });

  // PATCH /v1/clients/:id/contacts/:cid
  fastify.patch<{ Params: { id: string; cid: string } }>('/clients/:id/contacts/:cid', {
    schema: { body: patchBody },
  }, async (request, reply) => {
    const { id: clientId, cid } = request.params;
    const b = request.body as Record<string, unknown>;

    const [existing] = await db.select({ id: clientContacts.id })
      .from(clientContacts)
      .where(and(eq(clientContacts.id, cid), eq(clientContacts.client_id, clientId)));
    if (!existing) return reply.notFound('Contact not found');

    const allowed = ['contact_type', 'name', 'email', 'phone', 'notes', 'is_active'];
    const updateData = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(updateData).length) return reply.badRequest('No fields to update');

    const [updated] = await db.update(clientContacts)
      .set(updateData as any)
      .where(eq(clientContacts.id, cid))
      .returning();

    return updated;
  });

  // DELETE /v1/clients/:id/contacts/:cid (soft delete)
  fastify.delete<{ Params: { id: string; cid: string } }>('/clients/:id/contacts/:cid', async (request, reply) => {
    const { id: clientId, cid } = request.params;

    const result = await db.update(clientContacts)
      .set({ is_active: false })
      .where(and(eq(clientContacts.id, cid), eq(clientContacts.client_id, clientId)));

    if (!result.rowCount) return reply.notFound('Contact not found');
    return reply.code(204).send();
  });
};
