import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { eq, and, sql } from 'drizzle-orm';
import { getSqsClient } from '../lib/sqsClient';
import { db, invoices, nfeEvents } from '../db';
import { sendNotificationIfEnabled } from '../lib/notificationsClient';

interface NfeResultMessage {
  invoice_id:         string;
  tenant_id:          string;
  nfe_status:         'authorized' | 'rejected' | 'error';
  nfe_chave?:         string;
  nfe_protocol?:      string;
  nfe_auth_date?:     string;
  xml_s3_key?:        string;
  danfe_url?:         string;
  nfe_reject_reason?: string;
}

let running = true;

export function stopNfeResultsWorker()  { running = false; }

export function startNfeResultsWorker(): void {
  const queueUrl = process.env.NFE_RESULTS_QUEUE_URL;
  if (!queueUrl) {
    console.info('NFE_RESULTS_QUEUE_URL not set — NF-e results worker disabled (local dev mode)');
    return;
  }
  console.info('NF-e results worker started — polling', queueUrl);
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
          const result: NfeResultMessage = JSON.parse(msg.Body!);
          await processResult(result);
          await sqs.send(new DeleteMessageCommand({
            QueueUrl:      queueUrl,
            ReceiptHandle: msg.ReceiptHandle!,
          }));
        } catch (err) {
          console.error(JSON.stringify({ event: 'nfe_result_error', error: String(err) }));
        }
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'nfe_poll_error', error: String(err) }));
      await sleep(5_000);
    }
  }
}

async function processResult(result: NfeResultMessage): Promise<void> {
  const { invoice_id, nfe_status, nfe_chave, nfe_protocol,
          nfe_auth_date, xml_s3_key, danfe_url, nfe_reject_reason } = result;

  if (nfe_status === 'authorized') {
    const { rows: [inv] } = await db.execute<{
      tenant_id: string; serie: string; number: string | null;
      client_name: string | null; client_email: string | null;
    }>(sql`
      SELECT i.tenant_id, i.serie, i.number,
             COALESCE(c.company_name, c.full_name) AS client_name,
             c.email AS client_email
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.id = ${invoice_id}
    `);
    if (!inv) return;

    let number = inv.number ?? '';
    if (!number) {
      const { rows: [seq] } = await db.execute<{ n: string }>(sql`
        SELECT COALESCE(MAX(CASE WHEN number ~ '^[0-9]+$' THEN number::BIGINT END), 0) + 1 AS n
        FROM invoices WHERE tenant_id = ${inv.tenant_id} AND serie = ${inv.serie} AND status = 'issued'
      `);
      number = String(seq.n).padStart(9, '0');
    }

    await db.update(invoices)
      .set({
        status:        'issued',
        number,
        issue_date:    new Date().toISOString().slice(0, 10),
        nfe_status:    'authorized',
        nfe_chave:     nfe_chave     || null,
        nfe_protocol:  nfe_protocol  || null,
        nfe_auth_date: nfe_auth_date ? new Date(nfe_auth_date) : null,
        nfe_xml_s3_key: xml_s3_key   || null,
        nfe_danfe_url:  danfe_url    || null,
        nfe_attempts:  sql`nfe_attempts + 1`,
      })
      .where(and(eq(invoices.id, invoice_id), eq(invoices.nfe_status, 'processing')));

    await db.insert(nfeEvents).values({
      invoice_id, tenant_id: result.tenant_id,
      event_type:  'emission',
      status_code: '100',
      protocol:    nfe_protocol || null,
      payload:     { nfe_chave, nfe_protocol, nfe_auth_date },
    });

    console.info(JSON.stringify({ event: 'nfe_result_authorized', invoice_id, nfe_chave }));

    if (inv.client_email) {
      await sendNotificationIfEnabled({
        tenant_id: result.tenant_id, type: 'nfe_authorized',
        recipient: { email: inv.client_email, name: inv.client_name ?? '' },
        data:      { invoice_number: number, nfe_chave: nfe_chave ?? '', danfe_url: danfe_url ?? '' },
      }).catch(err => console.warn(JSON.stringify({ event: 'notification_enqueue_warn', error: String(err) })));
    }

  } else {
    await db.update(invoices)
      .set({
        nfe_status:        'rejected',
        nfe_reject_reason: nfe_reject_reason || null,
        nfe_attempts:      sql`nfe_attempts + 1`,
      })
      .where(eq(invoices.id, invoice_id));

    await db.insert(nfeEvents).values({
      invoice_id, tenant_id: result.tenant_id,
      event_type: 'emission_rejected',
      payload:    { nfe_reject_reason },
    });

    console.warn(JSON.stringify({ event: 'nfe_result_rejected', invoice_id, nfe_reject_reason }));

    const { rows: [rejInv] } = await db.execute<{
      number: string | null; client_name: string | null; client_email: string | null;
    }>(sql`
      SELECT i.number, COALESCE(c.company_name, c.full_name) AS client_name, c.email AS client_email
      FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.id = ${invoice_id}
    `);
    if (rejInv?.client_email) {
      await sendNotificationIfEnabled({
        tenant_id: result.tenant_id, type: 'nfe_rejected',
        recipient: { email: rejInv.client_email, name: rejInv.client_name ?? '' },
        data:      { invoice_number: rejInv.number ?? '', reject_reason: nfe_reject_reason ?? '' },
      }).catch(err => console.warn(JSON.stringify({ event: 'notification_enqueue_warn', error: String(err) })));
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
