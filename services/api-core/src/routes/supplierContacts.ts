import { FastifyPluginAsync } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { db, supplierContacts, suppliers } from '../db';
import { requirePermission } from '../lib/requirePermission';

// Papéis do lado do fornecedor — não reaproveita os rótulos de client_contacts
// ('comprador'/'compras' descreve quem compra DE nós, não faz sentido aqui).
const CONTACT_TYPES = ['comercial', 'financeiro', 'suporte', 'logistica', 'outro'] as const;

const contactBody = {
  type: 'object',
  properties: {
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

// Diferente de clientContacts.ts (que ainda recebe tenant_id do body/query —
// exceção legada, regra 4 do README): aqui o tenantId vem sempre do JWT,
// mesmo padrão já usado por suppliers.ts.
export const supplierContactsRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate] };

  // GET /v1/suppliers/:id/contacts
  fastify.get<{ Params: { id: string } }>('/suppliers/:id/contacts', { ...auth, preHandler: [requirePermission('suppliers:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id: supplierId } = request.params;

    const [sup] = await db.select({ id: suppliers.id }).from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.tenant_id, tenantId)));
    if (!sup) return reply.notFound('Fornecedor não encontrado');

    const rows = await db.select()
      .from(supplierContacts)
      .where(and(eq(supplierContacts.supplier_id, supplierId), eq(supplierContacts.is_active, true)))
      .orderBy(sql`${supplierContacts.contact_type} ASC, ${supplierContacts.name} ASC`);

    return { data: rows };
  });

  // POST /v1/suppliers/:id/contacts
  fastify.post<{ Params: { id: string } }>('/suppliers/:id/contacts', {
    ...auth,
    schema: { body: { ...contactBody, required: ['contact_type'] } },
    preHandler: [requirePermission('suppliers:edit')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id: supplierId } = request.params;
    const b = request.body as Record<string, unknown>;

    const [sup] = await db.select({ id: suppliers.id }).from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.tenant_id, tenantId)));
    if (!sup) return reply.notFound('Fornecedor não encontrado');

    const [contact] = await db.insert(supplierContacts).values({
      tenant_id:    tenantId,
      supplier_id:  supplierId,
      contact_type: (b.contact_type ?? 'comercial') as string,
      name:         (b.name  ?? null) as string | null,
      email:        (b.email ?? null) as string | null,
      phone:        (b.phone ?? null) as string | null,
      notes:        (b.notes ?? null) as string | null,
    }).returning();

    return reply.code(201).send(contact);
  });

  // PATCH /v1/suppliers/:id/contacts/:cid
  fastify.patch<{ Params: { id: string; cid: string } }>('/suppliers/:id/contacts/:cid', {
    ...auth,
    schema: { body: patchBody },
    preHandler: [requirePermission('suppliers:edit')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id: supplierId, cid } = request.params;
    const b = request.body as Record<string, unknown>;

    const [existing] = await db.select({ id: supplierContacts.id })
      .from(supplierContacts)
      .where(and(
        eq(supplierContacts.id, cid),
        eq(supplierContacts.supplier_id, supplierId),
        eq(supplierContacts.tenant_id, tenantId),
      ));
    if (!existing) return reply.notFound('Contato não encontrado');

    const allowed = ['contact_type', 'name', 'email', 'phone', 'notes', 'is_active'];
    const updateData = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(updateData).length) return reply.badRequest('Nenhum campo para atualizar');

    const [updated] = await db.update(supplierContacts)
      .set(updateData as any)
      .where(eq(supplierContacts.id, cid))
      .returning();

    return updated;
  });

  // DELETE /v1/suppliers/:id/contacts/:cid (soft delete)
  fastify.delete<{ Params: { id: string; cid: string } }>('/suppliers/:id/contacts/:cid', { ...auth, preHandler: [requirePermission('suppliers:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id: supplierId, cid } = request.params;

    const result = await db.update(supplierContacts)
      .set({ is_active: false })
      .where(and(
        eq(supplierContacts.id, cid),
        eq(supplierContacts.supplier_id, supplierId),
        eq(supplierContacts.tenant_id, tenantId),
      ));

    if (!result.rowCount) return reply.notFound('Contato não encontrado');
    return reply.code(204).send();
  });
};
