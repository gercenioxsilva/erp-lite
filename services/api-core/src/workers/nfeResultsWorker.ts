import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { getSqsClient } from '../lib/sqsClient';
import { pool } from '../db/pool';
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

export function stopNfeResultsWorker() { running = false; }

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
        WaitTimeSeconds:     15,  // long-poll: reduces API calls and latency
      }));

      for (const msg of resp.Messages ?? []) {
        try {
          const result: NfeResultMessage = JSON.parse(msg.Body!);
          await processResult(result);
          // Delete only after successful processing (at-least-once delivery guarantee)
          await sqs.send(new DeleteMessageCommand({
            QueueUrl:      queueUrl,
            ReceiptHandle: msg.ReceiptHandle!,
          }));
        } catch (err) {
          // Leave message in queue — SQS will redeliver after visibility timeout
          console.error(JSON.stringify({ event: 'nfe_result_error', error: String(err) }));
        }
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'nfe_poll_error', error: String(err) }));
      await sleep(5_000);  // backoff on network/SQS error
    }
  }
}

async function processResult(result: NfeResultMessage): Promise<void> {
  const { invoice_id, nfe_status, nfe_chave, nfe_protocol,
          nfe_auth_date, xml_s3_key, danfe_url, nfe_reject_reason } = result;

  if (nfe_status === 'authorized') {
    // Generate NF-e number (sequential per tenant+serie among issued invoices)
    const { rows: [inv] } = await pool.query(
      `SELECT i.tenant_id, i.serie, i.number,
              COALESCE(c.company_name, c.full_name) AS client_name,
              c.email AS client_email
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       WHERE i.id = $1`,
      [invoice_id],
    );
    if (!inv) return;

    let number = inv.number as string;
    if (!number || number === '') {
      const { rows: [seq] } = await pool.query(
        `SELECT COALESCE(
           MAX(CASE WHEN number ~ '^[0-9]+$' THEN number::BIGINT END), 0
         ) + 1 AS n
         FROM invoices
         WHERE tenant_id = $1 AND serie = $2 AND status = 'issued'`,
        [inv.tenant_id, inv.serie],
      );
      number = String(seq.n).padStart(9, '0');
    }

    await pool.query(
      `UPDATE invoices
       SET status        = 'issued',
           number        = $2,
           issue_date    = CURRENT_DATE,
           nfe_status    = 'authorized',
           nfe_chave     = $3,
           nfe_protocol  = $4,
           nfe_auth_date = $5,
           nfe_xml_s3_key = $6,
           nfe_danfe_url  = $7,
           nfe_attempts   = nfe_attempts + 1
       WHERE id = $1 AND nfe_status = 'processing'`,
      [invoice_id, number, nfe_chave, nfe_protocol, nfe_auth_date, xml_s3_key, danfe_url],
    );

    await pool.query(
      `INSERT INTO nfe_events (invoice_id, tenant_id, event_type, status_code, protocol, payload)
       VALUES ($1, $2, 'emission', '100', $3, $4)`,
      [invoice_id, result.tenant_id, nfe_protocol,
       JSON.stringify({ nfe_chave, nfe_protocol, nfe_auth_date })],
    );

    console.info(JSON.stringify({ event: 'nfe_result_authorized', invoice_id, nfe_chave }));

    if (inv.client_email) {
      await sendNotificationIfEnabled({
        tenant_id: result.tenant_id,
        type:      'nfe_authorized',
        recipient: { email: inv.client_email, name: inv.client_name ?? '' },
        data:      { invoice_number: number, nfe_chave: nfe_chave ?? '', danfe_url: danfe_url ?? '' },
      }).catch(err => console.warn(JSON.stringify({ event: 'notification_enqueue_warn', error: String(err) })));
    }

  } else {
    await pool.query(
      `UPDATE invoices
       SET nfe_status         = 'rejected',
           nfe_reject_reason  = $2,
           nfe_attempts       = nfe_attempts + 1
       WHERE id = $1`,
      [invoice_id, nfe_reject_reason],
    );

    await pool.query(
      `INSERT INTO nfe_events (invoice_id, tenant_id, event_type, payload)
       VALUES ($1, $2, 'emission_rejected', $3)`,
      [invoice_id, result.tenant_id, JSON.stringify({ nfe_reject_reason })],
    );

    console.warn(JSON.stringify({ event: 'nfe_result_rejected', invoice_id, nfe_reject_reason }));

    // For rejected: fetch client info separately since the authorized branch already uses inv
    const { rows: [rejInv] } = await pool.query(
      `SELECT i.number,
              COALESCE(c.company_name, c.full_name) AS client_name,
              c.email AS client_email
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       WHERE i.id = $1`,
      [invoice_id],
    );
    if (rejInv?.client_email) {
      await sendNotificationIfEnabled({
        tenant_id: result.tenant_id,
        type:      'nfe_rejected',
        recipient: { email: rejInv.client_email, name: rejInv.client_name ?? '' },
        data:      { invoice_number: rejInv.number ?? '', reject_reason: nfe_reject_reason ?? '' },
      }).catch(err => console.warn(JSON.stringify({ event: 'notification_enqueue_warn', error: String(err) })));
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
