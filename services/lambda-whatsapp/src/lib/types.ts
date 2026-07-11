// Espelha services/api-core/src/lib/whatsapp-types.ts — mesmo padrão de
// lambda-billing/src/lib/types.ts duplicar BillingEmitMessage/
// BillingResultMessage: cada Lambda é um pacote independente, sem código
// compartilhado entre api-core e Lambdas.

export interface WhatsAppAccountConfig {
  provider: string;
  whatsapp_number: string;
  credentials: Record<string, string>; // {account_sid, auth_token} pro Twilio
}

export interface WhatsAppSendMessage {
  whatsapp_message_id: string;
  tenant_id: string;
  to_phone_e164: string;
  template_key: string;
  provider_template_id: string;
  /** Ordenado pela posição do placeholder no template — a Content API do
   *  Twilio espera variáveis numeradas ({{1}}, {{2}}...), nunca por nome.
   *  api-core já monta na ordem certa; aqui só numeramos pela posição. */
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
