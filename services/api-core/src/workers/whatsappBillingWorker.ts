// Worker interval-based (mesmo molde de dueSoonWorker.ts) — cobre os 2
// eventos de proximidade de vencimento que o WhatsApp precisa e o
// dueSoonWorker (só "antes", só e-mail) não cobre sozinho: cobrança a vencer
// e cobrança vencida. Idempotência via whatsapp_messages (nenhuma coluna
// nova em receivables) — ver whatsappAutomationService.ts::alreadyDispatched.

import { sql } from 'drizzle-orm';
import { db } from '../db';
import { notifyInvoiceDueSoon, notifyInvoiceOverdue } from '../services/whatsappAutomationService';

let running = true;
export function stopWhatsAppBillingWorker() { running = false; }

export function startWhatsAppBillingWorker(): void {
  console.info('WhatsApp billing worker started');
  void run();
}

async function run(): Promise<void> {
  while (running) {
    try {
      await sendDueSoonAndOverdue();
    } catch (err) {
      console.error(JSON.stringify({ event: 'whatsapp_billing_worker_error', error: String(err) }));
    }
    await sleep(23 * 60 * 60 * 1000);
  }
}

async function sendDueSoonAndOverdue(): Promise<void> {
  const { rows: automations } = await db.execute<{
    tenant_id: string; template_key: 'invoice_due_soon' | 'invoice_overdue'; config: { days_before?: number; days_after?: number };
  }>(sql`
    SELECT tenant_id, template_key, config
    FROM whatsapp_automations
    WHERE enabled = true AND template_key IN ('invoice_due_soon', 'invoice_overdue')
  `);

  for (const automation of automations) {
    const days = automation.template_key === 'invoice_due_soon'
      ? Number(automation.config?.days_before) : Number(automation.config?.days_after);
    if (!Number.isInteger(days) || days < 1) continue;

    const targetDate = new Date();
    if (automation.template_key === 'invoice_due_soon') targetDate.setDate(targetDate.getDate() + days);
    else                                                 targetDate.setDate(targetDate.getDate() - days);
    const dateStr = targetDate.toISOString().slice(0, 10);

    const { rows: receivables } = await db.execute<{
      id: string; client_id: string | null; description: string; amount: string; due_date: string;
    }>(sql`
      SELECT id, client_id, description, amount, due_date::text
      FROM receivables
      WHERE tenant_id = ${automation.tenant_id}
        AND status IN ('pending', 'partial')
        AND due_date = ${dateStr}::date
    `);

    for (const rec of receivables) {
      if (automation.template_key === 'invoice_due_soon') await notifyInvoiceDueSoon(automation.tenant_id, rec);
      else                                                 await notifyInvoiceOverdue(automation.tenant_id, rec);
    }
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
