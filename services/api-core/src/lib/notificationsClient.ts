import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { eq } from 'drizzle-orm';
import { db, notificationConfigs } from '../db';
import { getSqsClient } from './sqsClient';

export type NotificationType =
  | 'nfe_authorized'
  | 'nfe_rejected'
  | 'order_confirmed'
  | 'boleto_generated';

const typeToConfigKey: Record<NotificationType, keyof typeof notificationConfigs.$inferSelect> = {
  nfe_authorized:   'notify_nfe_authorized',
  nfe_rejected:     'notify_nfe_rejected',
  order_confirmed:  'notify_order_confirmed',
  boleto_generated: 'notify_boleto_generated',
};

export interface NotificationPayload {
  tenant_id: string;
  type:      NotificationType;
  recipient: { email: string; name: string };
  data:      Record<string, string | number>;
}

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
