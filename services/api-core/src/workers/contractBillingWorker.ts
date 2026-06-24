import { db, receivables, contractBillings } from '../db';
import { sql } from 'drizzle-orm';

let running = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

export function startContractBillingWorker() {
  running = true;
  // Run once on startup, then every hour
  void processContractBillings();
  intervalId = setInterval(() => {
    if (!running) return;
    void processContractBillings();
  }, 60 * 60 * 1000);
}

export function stopContractBillingWorker() {
  running = false;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function processContractBillings() {
  const today     = new Date();
  const dayOfMonth = today.getDate();
  const year      = today.getFullYear();
  const month     = today.getMonth() + 1; // 1–12

  try {
    // Find active contracts where billing_day matches today and contract period is valid
    const { rows: contracts } = await db.execute<{
      id: string; tenant_id: string; client_id: string; description: string;
      billing_frequency: string; billing_day: number; amount: string;
    }>(sql`
      SELECT id, tenant_id, client_id, description, billing_frequency, billing_day, amount
      FROM service_contracts
      WHERE status = 'active'
        AND billing_day = ${dayOfMonth}
        AND start_date <= CURRENT_DATE
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)
    `);

    for (const contract of contracts) {
      await maybeGenerateBilling(contract, year, month, today.toISOString().slice(0, 10));
    }
  } catch (err) {
    console.error('[ContractBillingWorker] Error processing billings:', err);
  }
}

async function maybeGenerateBilling(
  contract: { id: string; tenant_id: string; client_id: string; description: string; billing_frequency: string; billing_day: number; amount: string },
  year: number,
  month: number,
  dueDate: string,
) {
  // Determine period based on frequency; skip if not the right month to trigger
  let periodStart: string;
  let periodEnd: string;

  if (contract.billing_frequency === 'monthly') {
    periodStart = `${year}-${pad(month)}-01`;
    periodEnd   = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;
  } else if (contract.billing_frequency === 'quarterly') {
    const quarter    = Math.ceil(month / 3);
    const qStartMon  = (quarter - 1) * 3 + 1;
    const qEndMon    = quarter * 3;
    if (month !== qStartMon) return; // only trigger in first month of the quarter
    periodStart = `${year}-${pad(qStartMon)}-01`;
    periodEnd   = `${year}-${pad(qEndMon)}-${pad(new Date(year, qEndMon, 0).getDate())}`;
  } else if (contract.billing_frequency === 'semiannual') {
    const semester   = month <= 6 ? 1 : 2;
    const sStartMon  = (semester - 1) * 6 + 1;
    const sEndMon    = semester * 6;
    if (month !== sStartMon) return;
    periodStart = `${year}-${pad(sStartMon)}-01`;
    periodEnd   = `${year}-${pad(sEndMon)}-${pad(new Date(year, sEndMon, 0).getDate())}`;
  } else if (contract.billing_frequency === 'annual') {
    if (month !== 1) return;
    periodStart = `${year}-01-01`;
    periodEnd   = `${year}-12-31`;
  } else {
    return;
  }

  // Idempotency: skip if billing already exists for this period
  const { rows: [{ count }] } = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM contract_billings
    WHERE contract_id  = ${contract.id}
      AND period_start = ${periodStart}
      AND status      != 'cancelled'
  `);
  if (count > 0) return;

  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const description = `${contract.description} — ${months[month - 1]}/${year}`;

  try {
    await db.transaction(async (tx) => {
      const [rec] = await tx.insert(receivables).values({
        tenant_id:   contract.tenant_id,
        client_id:   contract.client_id,
        description,
        amount:      contract.amount,
        due_date:    dueDate,
        status:      'pending',
        notes:       'Gerado automaticamente pelo contrato de manutenção',
      }).returning();

      await tx.insert(contractBillings).values({
        tenant_id:     contract.tenant_id,
        contract_id:   contract.id,
        receivable_id: rec.id,
        period_start:  periodStart,
        period_end:    periodEnd,
        amount:        contract.amount,
        due_date:      dueDate,
        status:        'billed',
      });
    });
    console.log(`[ContractBillingWorker] Generated billing for contract ${contract.id} period ${periodStart}`);
  } catch (err) {
    console.error(`[ContractBillingWorker] Failed contract ${contract.id}:`, err);
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
