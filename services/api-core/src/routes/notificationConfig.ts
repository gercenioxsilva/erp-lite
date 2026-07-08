import { FastifyPluginAsync } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db, notificationConfigs } from '../db';
import { requirePermission } from '../lib/requirePermission';

export const notificationConfigRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/notification-config ────────────────────────────────────── */
  fastify.get('/notification-config', {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requirePermission('company:view')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;

    const [cfg] = await db.select().from(notificationConfigs)
      .where(eq(notificationConfigs.tenant_id, tenantId));

    if (!cfg) {
      return {
        tenant_id: tenantId,
        email_enabled:          true,
        email_from_name:        'GAX ERP',
        email_reply_to:         null,
        notify_nfe_authorized:  true,
        notify_nfe_rejected:    true,
        notify_order_confirmed: false,
      };
    }
    return cfg;
  });

  /* ── PUT /v1/notification-config ────────────────────────────────────── */
  fastify.put('/notification-config', {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requirePermission('company:edit')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const body = request.body as any;
    const { email_enabled, email_from_name, email_reply_to,
            notify_nfe_authorized, notify_nfe_rejected, notify_order_confirmed,
            notify_receivable_due_days } = body;

    const [cfg] = await db.insert(notificationConfigs).values({
      tenant_id: tenantId,
      email_enabled:                email_enabled                ?? true,
      email_from_name:              email_from_name              ?? 'GAX ERP',
      email_reply_to:               email_reply_to               ?? null,
      notify_nfe_authorized:        notify_nfe_authorized        ?? true,
      notify_nfe_rejected:          notify_nfe_rejected          ?? true,
      notify_order_confirmed:       notify_order_confirmed       ?? false,
      notify_receivable_due_days:   notify_receivable_due_days   ?? 3,
    }).onConflictDoUpdate({
      target: notificationConfigs.tenant_id,
      set: {
        email_enabled:                sql`EXCLUDED.email_enabled`,
        email_from_name:              sql`EXCLUDED.email_from_name`,
        email_reply_to:               sql`EXCLUDED.email_reply_to`,
        notify_nfe_authorized:        sql`EXCLUDED.notify_nfe_authorized`,
        notify_nfe_rejected:          sql`EXCLUDED.notify_nfe_rejected`,
        notify_order_confirmed:       sql`EXCLUDED.notify_order_confirmed`,
        notify_receivable_due_days:   sql`EXCLUDED.notify_receivable_due_days`,
        updated_at:                   sql`NOW()`,
      },
    }).returning();

    reply.code(200);
    return cfg;
  });
};
