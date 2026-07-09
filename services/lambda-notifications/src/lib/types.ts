export type NotificationType =
  | 'nfe_authorized' | 'nfe_rejected'
  | 'nfse_authorized' | 'nfse_rejected'
  | 'order_confirmed' | 'boleto_generated'
  | 'user_welcome'
  | 'password_reset'
  | 'receivable_due_soon'
  | 'proposal_sent'
  | 'proposal_accepted'
  | 'proposal_rejected'
  | 'technician_welcome'
  | 'service_visit_assigned'
  | 'tenant_email_verification';

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
  // Cópia opcional — hoje só usada por 'tenant_email_verification' (cópia
  // pro dono do sistema). Ver services/notificationService.ts#CcAddresses.
  cc?:        string[];
  /** Template-specific values already resolved by api-core (no DB access in Lambda) */
  data:       Record<string, string | number>;
}

export interface EmailTemplate {
  subject: string;
  html:    string;
  text:    string;
}

export type TemplateData = Record<string, string | number>;
