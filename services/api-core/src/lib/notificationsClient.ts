import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { getSqsClient } from './sqsClient';
import { pool } from '../db/pool';

export type NotificationType = 'nfe_authorized' | 'nfe_rejected' | 'order_confirmed';

const typeToConfigKey: Record<NotificationType, string> = {
  nfe_authorized:  'notify_nfe_authorized',
  nfe_rejected:    'notify_nfe_rejected',
  order_confirmed: 'notify_order_confirmed',
};

export interface NotificationPayload {
  tenant_id:  string;
  type:       NotificationType;
  recipient:  { email: string; name: string };
  data:       Record<string, string | number>;
}

/**
 * Checks notification_configs for the tenant, then enqueues a message to
 * lambda-notifications if the channel and notification type are enabled.
 * Silently no-ops when:
 *   - NOTIFICATIONS_QUEUE_URL is not set (local dev without SQS)
 *   - No notification_configs row exists for the tenant (opt-in)
 *   - email_enabled = false
 *   - The specific notification type toggle is false
 */
export async function sendNotificationIfEnabled(payload: NotificationPayload): Promise<void> {
  const queueUrl = process.env.NOTIFICATIONS_QUEUE_URL;
  if (!queueUrl) return;

  const { rows: [cfg] } = await pool.query(
    'SELECT * FROM notification_configs WHERE tenant_id = $1',
    [payload.tenant_id],
  );
  if (!cfg || !cfg.email_enabled) return;
  if (!cfg[typeToConfigKey[payload.type]]) return;

  const message = {
    tenant_id: payload.tenant_id,
    type:      payload.type,
    channel:   'email',
    recipient: payload.recipient,
    from_name: cfg.email_from_name ?? 'GAX ERP',
    reply_to:  cfg.email_reply_to ?? undefined,
    data:      payload.data,
  };

  await getSqsClient().send(new SendMessageCommand({
    QueueUrl:    queueUrl,
    MessageBody: JSON.stringify(message),
  }));
}
