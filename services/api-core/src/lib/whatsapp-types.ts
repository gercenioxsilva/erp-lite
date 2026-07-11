// Types para mensageria WhatsApp (SQS) — mesmo molde de billing-types.ts.

export interface WhatsAppAccountConfig {
  provider: string;
  whatsapp_number: string;
  /** Genérico por provedor — {account_sid, auth_token} pro Twilio. Sempre lido
   *  fresh do banco, nunca cacheado (mesmo padrão de C6, regra 59). */
  credentials: Record<string, string>;
}

export interface WhatsAppSendMessage {
  whatsapp_message_id: string; // linha já criada em whatsapp_messages (status='queued'), pra idempotência
  tenant_id: string;
  to_phone_e164: string;
  template_key: string;
  provider_template_id: string; // Content SID já aprovado pro tenant
  /** Ordenado pela posição do placeholder no template (WHATSAPP_TEMPLATES[key].variables),
   *  nunca um Record por nome — a Content API do Twilio espera variáveis
   *  numeradas ({{1}}, {{2}}...), não nomeadas. api-core já monta na ordem
   *  certa antes de publicar; o Lambda só numera pela posição do array. */
  variables: string[];
  account: WhatsAppAccountConfig;
}

export interface WhatsAppSendResultMessage {
  whatsapp_message_id: string;
  tenant_id: string;
  status: 'sent' | 'failed';
  provider_message_id?: string;
  error_reason?: string;
}
