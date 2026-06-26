import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { eq } from 'drizzle-orm';
import { db, notificationConfigs } from '../db';
import { getSqsClient } from './sqsClient';

// Gated types require a notification_configs row with the flag enabled
type GatedNotificationType = 'nfe_authorized' | 'nfe_rejected' | 'order_confirmed' | 'boleto_generated'
  | 'nfse_authorized' | 'nfse_rejected';

// All notification types — gated + system (always sent, no config check)
export type NotificationType = GatedNotificationType | 'user_welcome' | 'password_reset' | 'receivable_due_soon';

const typeToConfigKey: Record<GatedNotificationType, keyof typeof notificationConfigs.$inferSelect> = {
  nfe_authorized:   'notify_nfe_authorized',
  nfe_rejected:     'notify_nfe_rejected',
  order_confirmed:  'notify_order_confirmed',
  boleto_generated: 'notify_boleto_generated',
  nfse_authorized:  'notify_nfse_authorized',
  nfse_rejected:    'notify_nfse_rejected',
};

export interface NotificationPayload {
  tenant_id: string;
  type:      GatedNotificationType; // checked against notification_configs flags
  recipient: { email: string; name: string };
  data:      Record<string, string | number>;
}

/** Sends a tenant-configured notification (checks email_enabled + type flag). */
export async function sendNotificationIfEnabled(payload: NotificationPayload): Promise<void> {
  const queueUrl = process.env.NOTIFICATIONS_QUEUE_URL;
  if (!queueUrl) return;

  const [cfg] = await db.select().from(notificationConfigs)
    .where(eq(notificationConfigs.tenant_id, payload.tenant_id));

  if (!cfg || !cfg.email_enabled) return;
  if (!cfg[typeToConfigKey[payload.type]]) return;

  const message = {
    tenant_id: payload.tenant_id,
    type:      payload.type,
    channel:   'email',
    recipient: payload.recipient,
    from_name: cfg.email_from_name ?? 'Orquestra ERP',
    reply_to:  cfg.email_reply_to  ?? undefined,
    data:      payload.data,
  };

  await getSqsClient().send(new SendMessageCommand({
    QueueUrl:    queueUrl,
    MessageBody: JSON.stringify(message),
  }));
}

export interface SystemNotificationPayload {
  tenant_id:  string;
  type:       NotificationType;
  recipient:  { email: string; name: string };
  data:       Record<string, string | number>;
  from_name?: string;
}

/** Sends a system-generated email unconditionally (no notification_configs check). */
export async function sendSystemNotification(payload: SystemNotificationPayload): Promise<void> {
  const queueUrl = process.env.NOTIFICATIONS_QUEUE_URL;
  if (!queueUrl) return;

  await getSqsClient().send(new SendMessageCommand({
    QueueUrl:    queueUrl,
    MessageBody: JSON.stringify({
      tenant_id: payload.tenant_id,
      type:      payload.type,
      channel:   'email',
      recipient: payload.recipient,
      from_name: payload.from_name ?? 'Orquestra ERP',
      data:      payload.data,
    }),
  }));
}
