import { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool';

export const notificationConfigRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/notification-config ─────────────────────────────────────── */
  fastify.get('/notification-config', async (request, reply) => {
    const { tenant_id } = request.query as { tenant_id?: string };
    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const { rows: [cfg] } = await pool.query(
      'SELECT * FROM notification_configs WHERE tenant_id = $1',
      [tenant_id],
    );

    if (!cfg) {
      return {
        tenant_id,
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

  /* ── PUT /v1/notification-config ─────────────────────────────────────── */
  fastify.put('/notification-config', async (request, reply) => {
    const body = request.body as any;
    const tenant_id = body.tenant_id as string;
    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const {
      email_enabled,
      email_from_name,
      email_reply_to,
      notify_nfe_authorized,
      notify_nfe_rejected,
      notify_order_confirmed,
    } = body;

    const { rows: [cfg] } = await pool.query(
      `INSERT INTO notification_configs
         (tenant_id, email_enabled, email_from_name, email_reply_to,
          notify_nfe_authorized, notify_nfe_rejected, notify_order_confirmed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id) DO UPDATE SET
         email_enabled          = EXCLUDED.email_enabled,
         email_from_name        = EXCLUDED.email_from_name,
         email_reply_to         = EXCLUDED.email_reply_to,
         notify_nfe_authorized  = EXCLUDED.notify_nfe_authorized,
         notify_nfe_rejected    = EXCLUDED.notify_nfe_rejected,
         notify_order_confirmed = EXCLUDED.notify_order_confirmed,
         updated_at             = NOW()
       RETURNING *`,
      [
        tenant_id,
        email_enabled          ?? true,
        email_from_name        ?? 'GAX ERP',
        email_reply_to         ?? null,
        notify_nfe_authorized  ?? true,
        notify_nfe_rejected    ?? true,
        notify_order_confirmed ?? false,
      ],
    );

    reply.code(200);
    return cfg;
  });
};
