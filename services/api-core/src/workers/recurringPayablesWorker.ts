import { sql } from 'drizzle-orm';
import { db } from '../db';

let running = true;
export function stopRecurringPayablesWorker() { running = false; }

export function startRecurringPayablesWorker(): void {
  console.info('Recurring payables worker started');
  void run();
}

async function run(): Promise<void> {
  while (running) {
    try {
      await generateDueRecurring();
    } catch (err) {
      console.error(JSON.stringify({ event: 'recurring_payables_error', error: String(err) }));
    }
    await sleep(23 * 60 * 60 * 1000); // 23h para evitar drift
  }
}

async function generateDueRecurring(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { rows } = await db.execute<any>(sql`
    SELECT * FROM payables
    WHERE recurrence != 'none'
      AND status != 'cancelled'
      AND (recurrence_last_generated IS NULL OR recurrence_last_generated < ${today}::date)
      AND (recurrence_end_date IS NULL OR recurrence_end_date >= ${today}::date)
      AND due_date <= ${today}::date
  `);

  for (const p of rows) {
    const nextDue = nextDueDate(p.due_date, p.recurrence, p.recurrence_day);
    if (!nextDue) continue;
    if (p.recurrence_end_date && nextDue > p.recurrence_end_date) continue;

    await db.execute(sql`
      INSERT INTO payables (tenant_id, supplier_id, supplier_name, category, description,
        amount, due_date, status, notes, recurrence, recurrence_day, recurrence_end_date, parent_payable_id)
      VALUES (${p.tenant_id}, ${p.supplier_id}, ${p.supplier_name}, ${p.category}, ${p.description},
        ${p.amount}, ${nextDue}::date, 'pending', ${p.notes},
        ${p.recurrence}, ${p.recurrence_day}, ${p.recurrence_end_date}, ${p.id})
    `);

    await db.execute(sql`
      UPDATE payables SET recurrence_last_generated = ${today}::date WHERE id = ${p.id}
    `);

    console.info(JSON.stringify({ event: 'recurring_payable_generated', parent_id: p.id, next_due: nextDue }));
  }
}

function nextDueDate(dueDateStr: string, recurrence: string, day: number | null): string | null {
  const base = new Date(dueDateStr + 'T12:00:00Z');
  let next: Date;
  switch (recurrence) {
    case 'weekly':    next = add(base, 0, 0, 7);  break;
    case 'monthly':   next = add(base, 0, 1, 0);
                      if (day) next.setUTCDate(Math.min(day, lastDayOfMonth(next))); break;
    case 'quarterly': next = add(base, 0, 3, 0);  break;
    case 'yearly':    next = add(base, 1, 0, 0);  break;
    default:          return null;
  }
  return next.toISOString().slice(0, 10);
}

function add(d: Date, years: number, months: number, days: number): Date {
  const r = new Date(d);
  r.setUTCFullYear(r.getUTCFullYear() + years);
  r.setUTCMonth(r.getUTCMonth() + months);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

function lastDayOfMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
