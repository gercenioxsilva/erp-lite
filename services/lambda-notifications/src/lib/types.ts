export type NotificationType =
  | 'nfe_authorized'
  | 'nfe_rejected'
  | 'order_confirmed'
  | 'boleto_generated';

export type NotificationChannel = 'email';

export interface NotificationRecipient {
  email: string;
  name:  string;
}

/** Shape of each SQS message body sent by api-core's notificationsClient */
export interface NotificationMessage {
  tenant_id:  string;
  type:       NotificationType;
  channel:    NotificationChannel;
  recipient:  NotificationRecipient;
  from_name:  string;
  reply_to?:  string;
  /** Template-specific values already resolved by api-core (no DB access in Lambda) */
  data:       Record<string, string | number>;
}

export interface EmailTemplate {
  subject: string;
  html:    string;
  text:    string;
}

export type TemplateData = Record<string, string | number>;
