import axios from 'axios';
import type { WhatsAppAdapter, WhatsAppSendPayload, WhatsAppSendResult } from './index';

// ── Twilio — WhatsApp Business Platform via BSP ─────────────────────────────
// Docs: https://www.twilio.com/docs/whatsapp/api
// Envio de template fora da janela de 24h do cliente usa a Content API
// (ContentSid + ContentVariables numeradas), não Body livre — é o único jeito
// de mandar mensagem proativa (cobrança, nota fiscal) fora de uma conversa já
// iniciada pelo cliente. Autenticação: Basic Auth com Account SID + Auth
// Token (credenciais por tenant, nunca uma conta compartilhada da
// plataforma — regra 59, mesmo racional do C6 Bank).

export interface TwilioCredentials {
  account_sid: string;
  auth_token: string;
}

export class TwilioAdapter implements WhatsAppAdapter {
  constructor(private readonly credentials: TwilioCredentials) {
    const missing = (['account_sid', 'auth_token'] as const).filter(k => !credentials[k]?.trim());
    if (missing.length > 0) {
      throw new Error(
        `Twilio adapter: credenciais incompletas (faltando: ${missing.join(', ')}). ` +
        'Cada tenant precisa cadastrar o próprio Account SID/Auth Token em Minha Empresa > Integrações > WhatsApp.'
      );
    }
  }

  async sendTemplate(payload: WhatsAppSendPayload): Promise<WhatsAppSendResult> {
    const { account_sid, auth_token } = this.credentials;

    const contentVariables = Object.fromEntries(
      payload.variables.map((value, index) => [String(index + 1), value]),
    );

    const body = new URLSearchParams({
      From:              `whatsapp:${payload.whatsapp_number}`,
      To:                `whatsapp:${payload.to_phone_e164}`,
      ContentSid:        payload.provider_template_id,
      ContentVariables:  JSON.stringify(contentVariables),
    });

    const resp = await axios.post<TwilioMessageResponse>(
      `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/Messages.json`,
      body.toString(),
      {
        auth: { username: account_sid, password: auth_token },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      },
    );

    return { provider_message_id: resp.data.sid };
  }
}

interface TwilioMessageResponse {
  sid: string;
  status: string;
}
