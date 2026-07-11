// Worker in-process (mesmo molde de boletoResultsWorker.ts) — consome o
// resultado do envio (sucesso/falha, provider_message_id) publicado pela
// lambda-whatsapp. Status de entrega/leitura (delivered/read) chegam depois,
// via webhook (whatsappWebhookService.ts), não por esta fila.

import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { eq, and } from 'drizzle-orm';
import { getSqsClient } from '../lib/sqsClient';
import { db, whatsappMessages, whatsappMessageEvents } from '../db';
import type { WhatsAppSendResultMessage } from '../lib/whatsapp-types';

let running = true;
export function stopWhatsAppResultsWorker() { running = false; }

export function startWhatsAppResultsWorker(): void {
  const queueUrl = process.env.WHATSAPP_RESULTS_QUEUE_URL;
  if (!queueUrl) {
    console.info('WHATSAPP_RESULTS_QUEUE_URL not set — WhatsApp results worker disabled');
    return;
  }
  console.info('WhatsApp results worker started — polling', queueUrl);
  void poll(queueUrl);
}

async function poll(queueUrl: string): Promise<void> {
  while (running) {
    try {
      const sqs  = getSqsClient();
      const resp = await sqs.send(new ReceiveMessageCommand({
        QueueUrl:            queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds:     15,
      }));

      for (const msg of resp.Messages ?? []) {
        try {
          const result: WhatsAppSendResultMessage = JSON.parse(msg.Body!);
          await processResult(result);
          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle! }));
        } catch (err) {
          console.error(JSON.stringify({ event: 'whatsapp_result_error', error: String(err) }));
        }
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'whatsapp_poll_error', error: String(err) }));
      await sleep(5_000);
    }
  }
}

async function processResult(result: WhatsAppSendResultMessage): Promise<void> {
  const { whatsapp_message_id, tenant_id, status } = result;

  await db.update(whatsappMessages)
    .set({
      status:              status === 'sent' ? 'sent' : 'failed',
      provider_message_id: result.provider_message_id ?? null,
      status_reason:        result.error_reason ?? null,
      sent_at:              status === 'sent' ? new Date() : null,
    })
    .where(and(eq(whatsappMessages.id, whatsapp_message_id), eq(whatsappMessages.tenant_id, tenant_id)));

  await db.insert(whatsappMessageEvents).values({
    tenant_id, whatsapp_message_id, event_type: status,
    payload: { provider_message_id: result.provider_message_id, error_reason: result.error_reason },
  });

  console.info(JSON.stringify({ event: 'whatsapp_result_processed', whatsapp_message_id, status }));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
