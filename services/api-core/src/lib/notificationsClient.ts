import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { eq } from 'drizzle-orm';
import { db, notificationConfigs } from '../db';
import { getSqsClient } from './sqsClient';

// Gated types require a notification_configs row with the flag enabled
type GatedNotificationType = 'nfe_authorized' | 'nfe_rejected' | 'order_confirmed' | 'boleto_generated'
  | 'nfse_authorized' | 'nfse_rejected';

// All notification types — gated + system (always sent, no config check)
export type NotificationType = GatedNotificationType | 'user_welcome' | 'password_reset' | 'receivable_due_soon'
  | 'proposal_sent' | 'proposal_accepted' | 'proposal_rejected'
  | 'technician_welcome' | 'service_visit_assigned' | 'tenant_email_verification'
  | 'contract_sent'
  // Alerta fiscal crítico (1x por alerta, owner do tenant).
  | 'fiscal_alert'
  // Agendamento (0083) — ciclo de vida da sessão + lembrete D-1.
  | 'scheduling_session_requested' | 'scheduling_session_approved'
  | 'scheduling_session_declined' | 'scheduling_session_canceled'
  | 'scheduling_session_reminder' | 'scheduling_session_client_canceled';

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
  // Cópia opcional — hoje só usado por 'tenant_email_verification' (cópia
  // pro dono do sistema via SYSTEM_OWNER_EMAIL). Não é um campo genérico
  // habilitado em todo tipo de e-mail sem necessidade real.
  cc?: string[];
}

/** Sends a system-generated email unconditionally (no notification_configs check). */
export async function sendSystemNotification(payload: SystemNotificationPayload): Promise<void> {
  const queueUrl = process.env.NOTIFICATIONS_QUEUE_URL;
  if (!queueUrl) {
    console.warn('[notificationsClient] NOTIFICATIONS_QUEUE_URL not set — e-mail ignorado', { type: payload.type, recipient: payload.recipient.email });
    return;
  }

  await getSqsClient().send(new SendMessageCommand({
    QueueUrl:    queueUrl,
    MessageBody: JSON.stringify({
      tenant_id: payload.tenant_id,
      type:      payload.type,
      channel:   'email',
      recipient: payload.recipient,
      from_name: payload.from_name ?? 'Orquestra ERP',
      cc:        payload.cc,
      data:      payload.data,
    }),
  }));
}
