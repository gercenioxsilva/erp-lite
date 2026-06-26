import { sql } from 'drizzle-orm';
import { db } from '../db';
import { getSqsClient } from '../lib/sqsClient';
import { SendMessageCommand } from '@aws-sdk/client-sqs';

let running = true;
export function stopDueSoonWorker() { running = false; }

export function startDueSoonWorker(): void {
  console.info('Due-soon notification worker started');
  void run();
}

async function run(): Promise<void> {
  while (running) {
    try {
      await sendDueSoonNotifications();
    } catch (err) {
      console.error(JSON.stringify({ event: 'due_soon_error', error: String(err) }));
    }
    await sleep(23 * 60 * 60 * 1000);
  }
}

async function sendDueSoonNotifications(): Promise<void> {
  const queueUrl = process.env.NOTIFICATIONS_QUEUE_URL;
  if (!queueUrl) return;

  const { rows: configs } = await db.execute<any>(sql`
    SELECT tenant_id, notify_receivable_due_days, email_enabled,
           COALESCE(email_from_name, 'Orquestra ERP') AS from_name,
           email_reply_to
    FROM notification_configs
    WHERE email_enabled = true AND notify_receivable_due_days > 0
  `);

  for (const cfg of configs) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + Number(cfg.notify_receivable_due_days));
    const dateStr = targetDate.toISOString().slice(0, 10);

    const { rows } = await db.execute<any>(sql`
      SELECT r.id, r.description, r.amount, r.due_date,
             COALESCE(c.company_name, c.full_name) AS client_name,
             c.email AS client_email
      FROM receivables r
      LEFT JOIN clients c ON c.id = r.client_id
      WHERE r.tenant_id = ${cfg.tenant_id}
        AND r.status IN ('pending', 'partial')
        AND r.due_date = ${dateStr}::date
        AND r.due_notification_sent = false
        AND c.email IS NOT NULL
    `);

    const sqs = getSqsClient();
    for (const rec of rows) {
      try {
        await sqs.send(new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({
            tenant_id:  cfg.tenant_id,
            type:       'receivable_due_soon',
            channel:    'email',
            recipient:  { email: rec.client_email, name: rec.client_name ?? '' },
            from_name:  cfg.from_name,
            reply_to:   cfg.email_reply_to ?? undefined,
            data: {
              client_name:  rec.client_name ?? '',
              description:  rec.description,
              amount:       Number(rec.amount).toFixed(2),
              due_date:     rec.due_date,
              days_ahead:   String(cfg.notify_receivable_due_days),
            },
          }),
        }));

        await db.execute(sql`
          UPDATE receivables SET due_notification_sent = true WHERE id = ${rec.id}
        `);

        console.info(JSON.stringify({ event: 'due_soon_sent', receivable_id: rec.id }));
      } catch (err) {
        console.warn(JSON.stringify({ event: 'due_soon_warn', id: rec.id, error: String(err) }));
      }
    }
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
