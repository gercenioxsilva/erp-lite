export interface WhatsAppSendPayload {
  to_phone_e164: string;
  provider_template_id: string; // Content SID já aprovado
  /** Ordenado pela posição do placeholder — numerado pelo adapter, nunca por nome. */
  variables: string[];
  whatsapp_number: string; // remetente (nosso número, "From" do provedor)
}

export interface WhatsAppSendResult {
  provider_message_id: string;
}

/** Contrato que todo adapter de provedor WhatsApp precisa cumprir — mesmo
 * molde de BoletoAdapter (lambda-billing). Só TwilioAdapter implementado
 * nesta fase; a interface já fica pronta pra 360dialog/Meta Cloud API direta
 * sem reescrever o resto (handler, worker de resultado). */
export interface WhatsAppAdapter {
  sendTemplate(payload: WhatsAppSendPayload): Promise<WhatsAppSendResult>;
}
