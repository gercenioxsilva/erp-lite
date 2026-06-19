import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { FastifyInstance } from 'fastify';
import type { SQSRecord } from 'aws-lambda';
import type { NotificationMessage } from '../lib/types';

export async function processRecord(app: FastifyInstance, record: SQSRecord): Promise<void> {
  const msg: NotificationMessage = JSON.parse(record.body);

  app.log.info({ event: 'notification_received', tenant_id: msg.tenant_id, type: msg.type, recipient: msg.recipient.email });

  if (msg.channel !== 'email') {
    app.log.warn({ event: 'unsupported_channel', channel: msg.channel });
    return;
  }

  const { subject, html, text } = app.getTemplate(msg.type, msg.data);

  const fromAddress = `"${msg.from_name}" <${app.config.sesFromEmail}>`;

  await app.ses.send(new SendEmailCommand({
    FromEmailAddress:  fromAddress,
    Destination:       { ToAddresses: [msg.recipient.email] },
    ReplyToAddresses:  msg.reply_to ? [msg.reply_to] : undefined,
    Content: {
      Simple: {
        Subject: { Data: subject,  Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: text, Charset: 'UTF-8' },
        },
      },
    },
  }));

  app.log.info({ event: 'notification_sent', tenant_id: msg.tenant_id, type: msg.type, recipient: msg.recipient.email });
}
