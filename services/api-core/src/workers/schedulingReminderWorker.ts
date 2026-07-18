// Lembrete D-1 de sessão (0083) — molde do fiscalAlertsWorker: loop
// in-process, erro isolado por tenant, idempotente por sessão
// (reminder_sent_at marca o envio; re-run nunca duplica e-mail).
//
// Varre por TENANT porque "amanhã" depende do fuso do tenant
// (scheduling_settings.timezone) — 23h de loop garante ao menos uma passada
// por dia em qualquer fuso, e a janela D-1 é estável o dia inteiro.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { schedulingSessions } from '../db/schema';
import { getOrCreateSettings } from '../services/schedulingSettingsService';
import { notifySessionEvent } from '../services/schedulingNotificationService';
import { wallClockInTimezone } from '../domain/scheduling/advanceDomain';

const LOOP_MS = 60 * 60 * 1000; // 1h — barato (query indexada) e pega fusos

let running = false;

export function stopSchedulingReminderWorker() { running = false; }

export function startSchedulingReminderWorker(): void {
  if (running) return;
  running = true;
  void (async () => {
    console.info('Scheduling reminder worker started');
    while (running) {
      try { await runReminderCycle(); } catch (err) {
        console.error(JSON.stringify({ event: 'scheduling_reminder_cycle_fatal', error: String(err) }));
      }
      await new Promise((r) => setTimeout(r, LOOP_MS));
    }
  })();
}

/** Exportado para teste direto (mesmo padrão do processResult do NF-e). */
export async function runReminderCycle(now: Date = new Date()): Promise<{ sent: number }> {
  const { rows: tenants } = await db.execute<{ tenant_id: string }>(sql`
    SELECT tenant_id FROM tenant_modules WHERE module_key = 'scheduling' AND enabled = true
  `);

  let sent = 0;
  for (const { tenant_id } of tenants) {
    try {
      const settings = await getOrCreateSettings(tenant_id, db);
      const today = wallClockInTimezone(settings.timezone, now).date;      // 'YYYY-MM-DD'
      const tomorrow = new Date(`${today}T12:00:00Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const tomorrowISO = tomorrow.toISOString().slice(0, 10);

      const sessions = await db.select().from(schedulingSessions).where(and(
        eq(schedulingSessions.tenant_id, tenant_id),
        eq(schedulingSessions.status, 'confirmed'),
        eq(schedulingSessions.date, tomorrowISO),
        isNull(schedulingSessions.reminder_sent_at),
      ));

      for (const session of sessions) {
        // Marca ANTES de enviar: e-mail é fire-and-forget via fila; duplicar
        // lembrete incomoda mais que perder um numa falha rara de SQS.
        await db.update(schedulingSessions).set({ reminder_sent_at: new Date() })
          .where(eq(schedulingSessions.id, session.id));
        await notifySessionEvent('scheduling_session_reminder', session, db);
        sent++;
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'scheduling_reminder_tenant_error', tenant_id, error: String(err) }));
    }
  }
  if (sent > 0) console.info(JSON.stringify({ event: 'scheduling_reminders_sent', sent }));
  return { sent };
}
