// Worker diário de alertas fiscais (molde dueSoonWorker: loop com sleep 23h,
// roda no boot). Varre tenant×company com módulo 'fiscal' habilitado; erro é
// isolado POR company — um tenant quebrado nunca aborta o ciclo dos demais.

import { sql } from 'drizzle-orm';
import { db } from '../db';
import { evaluateAndPersist } from '../services/fiscalAlertService';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let running = false;

async function runCycle(): Promise<void> {
  const { rows } = await db.execute<{ tenant_id: string; company_id: string }>(sql`
    SELECT tm.tenant_id, fc.company_id
    FROM tenant_modules tm
    JOIN fiscal_company_config fc ON fc.tenant_id = tm.tenant_id
    WHERE tm.module_key = 'fiscal' AND tm.enabled = true
  `);
  console.info(JSON.stringify({ event: 'fiscal_alerts_cycle_start', companies: rows.length }));
  for (const r of rows) {
    try {
      const result = await evaluateAndPersist(r.tenant_id, r.company_id, db);
      if (result.raised > 0 || result.autoResolved > 0) {
        console.info(JSON.stringify({ event: 'fiscal_alerts_cycle_company', ...r, ...result }));
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'fiscal_alerts_cycle_error', ...r, error: String(err) }));
    }
  }
}

export function startFiscalAlertsWorker(): void {
  if (running) return;
  running = true;
  void (async () => {
    console.info('Fiscal alerts worker started');
    while (running) {
      try { await runCycle(); } catch (err) {
        console.error(JSON.stringify({ event: 'fiscal_alerts_cycle_fatal', error: String(err) }));
      }
      await sleep(23 * 60 * 60 * 1000); // 23h p/ evitar drift (padrão dueSoonWorker)
    }
  })();
}

export function stopFiscalAlertsWorker(): void {
  running = false;
}
