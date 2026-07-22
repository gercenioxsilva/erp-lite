// Cliente HTTP síncrono para validar credenciais do provedor de WhatsApp sem
// custo/efeito colateral — nunca envia mensagem, só confirma que a Basic
// Auth é aceita. Mesmo padrão de fetch() + teste síncrono já usado em
// services/fiscal/fiscalIntegrationClient.ts::testarConexaoFiscal.

export interface WhatsAppConnectionTestResult {
  ok: boolean;
  reason?: string;
}

/** GET /Accounts/{sid}.json — Twilio valida a Basic Auth sem enviar nada
 *  (diferente de POST /Messages.json, que é pago e exige template aprovado). */
export async function testarConexaoTwilio(
  accountSid: string, authToken: string,
): Promise<WhatsAppConnectionTestResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`;
  const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: auth } });
  } catch (err) {
    return { ok: false, reason: `Falha de comunicação com o Twilio: ${String(err)}` };
  }

  if (res.status === 401) return { ok: false, reason: 'Account SID ou Auth Token inválidos' };
  if (res.status === 404) return { ok: false, reason: 'Account SID não encontrado na Twilio' };
  if (!res.ok) return { ok: false, reason: `O Twilio retornou um erro (HTTP ${res.status})` };
  return { ok: true };
}

/** Despacha pro validador certo — só 'twilio' implementado nesta fase, mesmo
 *  racional de assertProviderCredentials em domain/whatsapp/whatsappDomain.ts. */
export function testarConexaoProvider(
  provider: string, credentials: Record<string, string> | null | undefined,
): Promise<WhatsAppConnectionTestResult> {
  if (provider === 'twilio') {
    return testarConexaoTwilio(credentials?.account_sid ?? '', credentials?.auth_token ?? '');
  }
  return Promise.resolve({ ok: false, reason: `Provedor "${provider}" não suportado` });
}
