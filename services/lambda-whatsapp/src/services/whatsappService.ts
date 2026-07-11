import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { FastifyInstance } from 'fastify';
import type { SQSRecord } from 'aws-lambda';
import type { WhatsAppSendMessage, WhatsAppSendResultMessage } from '../lib/types';
import { TwilioAdapter } from '../adapters/twilio';
import type { WhatsAppAdapter } from '../adapters/index';

function getAdapter(provider: string, credentials: Record<string, string>): WhatsAppAdapter {
  if (provider === 'twilio') return new TwilioAdapter({ account_sid: credentials.account_sid, auth_token: credentials.auth_token });
  throw new Error(`Provedor WhatsApp "${provider}" não suportado nesta fase. Só Twilio implementado.`);
}

export async function processRecord(app: FastifyInstance, record: SQSRecord): Promise<void> {
  const msg: WhatsAppSendMessage = JSON.parse(record.body);

  app.log.info({
    event:                'whatsapp_send_received',
    whatsapp_message_id:  msg.whatsapp_message_id,
    tenant_id:            msg.tenant_id,
    template_key:         msg.template_key,
    provider:              msg.account.provider,
  });

  let result: WhatsAppSendResultMessage;

  try {
    const adapter = getAdapter(msg.account.provider, msg.account.credentials);

    const sendResult = await adapter.sendTemplate({
      to_phone_e164:        msg.to_phone_e164,
      provider_template_id: msg.provider_template_id,
      variables:             msg.variables,
      whatsapp_number:       msg.account.whatsapp_number,
    });

    result = {
      whatsapp_message_id: msg.whatsapp_message_id,
      tenant_id:            msg.tenant_id,
      status:                'sent',
      provider_message_id:  sendResult.provider_message_id,
    };

    app.log.info({ event: 'whatsapp_sent', whatsapp_message_id: msg.whatsapp_message_id, provider_message_id: sendResult.provider_message_id });
  } catch (err: any) {
    app.log.error({ event: 'whatsapp_send_failed', whatsapp_message_id: msg.whatsapp_message_id, error: err.message });

    result = {
      whatsapp_message_id: msg.whatsapp_message_id,
      tenant_id:            msg.tenant_id,
      status:                'failed',
      error_reason:          err.message,
    };
  }

  await app.sqs.send(new SendMessageCommand({
    QueueUrl:    app.config.whatsappResultsQueueUrl,
    MessageBody: JSON.stringify(result),
  }));
}
