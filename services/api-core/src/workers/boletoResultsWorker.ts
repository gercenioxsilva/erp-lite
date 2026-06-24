import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { eq, and, sql } from 'drizzle-orm';
import { getSqsClient } from '../lib/sqsClient';
import { db, boletos, boletoEvents, receivables } from '../db';
import { sendNotificationIfEnabled } from '../lib/notificationsClient';
import { BillingResultMessage } from '../lib/billing-types';

let running = true;

export function stopBoletoResultsWorker()  { running = false; }

export function startBoletoResultsWorker(): void {
  const queueUrl = process.env.BILLING_RESULTS_QUEUE_URL;
  if (!queueUrl) {
    console.info('BILLING_RESULTS_QUEUE_URL not set — boleto results worker disabled');
    return;
  }
  console.info('Boleto results worker started — polling', queueUrl);
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
          const result: BillingResultMessage = JSON.parse(msg.Body!);
          await processResult(result);
          await sqs.send(new DeleteMessageCommand({
            QueueUrl:      queueUrl,
            ReceiptHandle: msg.ReceiptHandle!,
          }));
        } catch (err) {
          console.error(JSON.stringify({ event: 'boleto_result_error', error: String(err) }));
        }
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'boleto_poll_error', error: String(err) }));
      await sleep(5_000);
    }
  }
}

async function processResult(result: BillingResultMessage): Promise<void> {
  const { boleto_id, receivable_id, tenant_id, boleto_status } = result;

  if (boleto_status === 'generated') {
    await db.update(boletos)
      .set({
        status:       'sent',
        boleto_id:    result.external_id   || null,
        nosso_numero: result.nosso_numero  || null,
        brcode:       result.brcode        || null,
        pix_qr_code:  result.pix_qr_code   || null,
        boleto_url:   result.boleto_url    || null,
        pdf_s3_key:   result.pdf_s3_key    || null,
        issued_at:    result.issued_at ? new Date(result.issued_at) : new Date(),
        expires_at:   result.expires_at    || null,
      })
      .where(and(eq(boletos.id, boleto_id), eq(boletos.tenant_id, tenant_id)));

    await db.insert(boletoEvents).values({
      boleto_id,
      tenant_id,
      event_type:  'generated',
      status_code: '200',
      response:    { external_id: result.external_id, nosso_numero: result.nosso_numero },
    });

    console.info(JSON.stringify({ event: 'boleto_result_generated', boleto_id, receivable_id }));

    // Send email notification via lambda-notifications if client email configured
    const { rows: [rec] } = await db.execute<{
      description: string; amount: string; due_date: string;
      client_name: string | null; client_email: string | null;
    }>(sql`
      SELECT r.description, r.amount::text, r.due_date::text,
             COALESCE(c.company_name, c.full_name) AS client_name,
             c.email AS client_email
      FROM receivables r
      LEFT JOIN clients c ON c.id = r.client_id
      WHERE r.id = ${receivable_id}
    `);

    if (rec?.client_email) {
      await sendNotificationIfEnabled({
        tenant_id,
        type:      'boleto_generated',
        recipient: { email: rec.client_email, name: rec.client_name ?? '' },
        data: {
          description: rec.description,
          amount:      Number(rec.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
          due_date:    new Date(rec.due_date + 'T00:00:00').toLocaleDateString('pt-BR'),
          boleto_url:  result.boleto_url ?? '',
          brcode:      result.brcode ?? '',
        },
      }).catch(err =>
        console.warn(JSON.stringify({ event: 'boleto_notification_warn', error: String(err) }))
      );
    }

  } else {
    await db.update(boletos)
      .set({ status: 'error' })
      .where(and(eq(boletos.id, boleto_id), eq(boletos.tenant_id, tenant_id)));

    await db.insert(boletoEvents).values({
      boleto_id,
      tenant_id,
      event_type:  'error',
      status_code: 'ERR',
      response:    { error_reason: result.error_reason },
    });

    console.warn(JSON.stringify({ event: 'boleto_result_error', boleto_id, receivable_id,
      error: result.error_reason }));
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
