import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { eq, and, sql } from 'drizzle-orm';
import { getSqsClient } from '../lib/sqsClient';
import { db, invoices, invoiceItems, nfeEvents, nfseInvoices, nfseEvents, simplesRemessaEvents } from '../db';
import { sendNotificationIfEnabled } from '../lib/notificationsClient';
import { applyExit } from '../services/costCenterStock';
import { accrueCommission } from '../services/commissionService';
import { applyRemessaStockMovement } from '../services/simplesRemessaService';
import { createReceivableFromInvoice } from '../services/receivableService';
import { recordRevenue } from '../services/fiscalRevenueService';
import { runScheduled as runScheduledConsolidation } from '../services/consolidationService';

/** Ciclo fiscal 23:59: roda o consolidar→validar→emitir de cada tenant com o
 *  módulo 'fiscal' habilitado. Erro em um tenant nunca derruba os demais. */
async function runFiscalScheduledCycle(): Promise<void> {
  const { rows } = await db.execute<{ tenant_id: string }>(sql`
    SELECT tenant_id FROM tenant_modules WHERE module_key = 'fiscal' AND enabled = true
  `);
  console.info(JSON.stringify({ event: 'fiscal_scheduled_cycle_start', tenants: rows.length }));
  for (const { tenant_id } of rows) {
    try {
      const result = await runScheduledConsolidation(tenant_id);
      console.info(JSON.stringify({ event: 'fiscal_scheduled_cycle_tenant', tenant_id, ...result, errors: result.errors.length }));
    } catch (err) {
      console.error(JSON.stringify({ event: 'fiscal_scheduled_cycle_error', tenant_id, error: String(err) }));
    }
  }
}
import { notifyFiscalDocumentAuthorized } from '../services/whatsappAutomationService';

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

interface NfseResultMessage {
  type:                'nfse';
  nfse_id:             string;
  tenant_id:           string;
  nfse_status:         'authorized' | 'rejected';
  nfse_number?:        string;
  nfse_chave?:         string;
  nfse_verify_code?:   string;
  nfse_protocol?:      string;
  nfse_auth_date?:     string;
  nfse_pdf_url?:       string;
  nfse_xml_s3_key?:    string;
  nfse_reject_reason?: string;
}

interface RemessaResultMessage {
  type:                'remessa';
  remessa_id:          string;
  tenant_id:           string;
  nfe_status:          'authorized' | 'rejected' | 'error';
  nfe_chave?:          string;
  nfe_protocol?:       string;
  nfe_auth_date?:      string;
  xml_s3_key?:         string;
  danfe_url?:          string;
  nfe_reject_reason?:  string;
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
          const body = JSON.parse(msg.Body!);
          // type='nfse' → NFS-e result; type='remessa' → Simples Remessa
          // result; anything else (incl. undefined) → NF-e de venda result.
          if (body.type === 'nfse') {
            await processNfseResult(body as NfseResultMessage);
          } else if (body.type === 'remessa') {
            await processRemessaResult(body as RemessaResultMessage);
          } else if (body.type === 'fiscal_consolidation_run') {
            // Ciclo agendado 23:59 (EventBridge → esta fila): consolida →
            // valida → emite por tenant com o módulo fiscal habilitado.
            await runFiscalScheduledCycle();
          } else {
            await processResult(body as NfeResultMessage);
          }
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

// Exportado só pra teste direto (processResult nunca é chamado fora deste
// arquivo em produção — sempre via poll()/SQS).
export async function processResult(result: NfeResultMessage): Promise<void> {
  const { invoice_id, nfe_status, nfe_chave, nfe_protocol,
          nfe_auth_date, xml_s3_key, danfe_url, nfe_reject_reason } = result;

  if (nfe_status === 'authorized') {
    const { rows: [inv] } = await db.execute<{
      tenant_id: string; serie: string; number: string | null;
      client_id: string | null; total: string; company_id: string | null;
      client_name: string | null; client_email: string | null;
    }>(sql`
      SELECT i.tenant_id, i.serie, i.number, i.client_id, i.total, i.company_id,
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
        // Focus devolve a chave com prefixo "NFe"; a coluna é CHAR(44), então
        // normalizamos para somente os 44 dígitos.
        nfe_chave:     nfe_chave ? nfe_chave.replace(/\D/g, '') : null,
        nfe_protocol:  nfe_protocol  || null,
        nfe_auth_date: nfe_auth_date ? new Date(nfe_auth_date) : null,
        nfe_xml_s3_key: xml_s3_key   || null,
        nfe_danfe_url:  danfe_url    || null,
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

    // ── Stock OUT trigger (fire-and-forget, idempotent) ──────────────────────
    try {
      const { rows: invoiceRows } = await db.execute<{
        cost_center_id: string | null;
      }>(sql`SELECT cost_center_id FROM invoices WHERE id = ${invoice_id}`);
      const costCenterId = invoiceRows[0]?.cost_center_id ?? null;

      if (costCenterId) {
        const { rows: items } = await db.execute<{
          material_id: string | null;
          quantity: string;
        }>(sql`SELECT material_id, quantity FROM invoice_items WHERE invoice_id = ${invoice_id}`);

        for (const item of items) {
          if (!item.material_id) continue;
          // NF-e lifecycle: once cancelled, a new invoice must be issued (new ID). Reuse of this invoiceId is impossible.
          await applyExit({
            tenantId:     result.tenant_id,
            costCenterId,
            materialId:   item.material_id,
            quantity:     Number(item.quantity),
            source:       'invoice',
            sourceId:     invoice_id,
            userId:       undefined,
          }, db);
        }
      }
    } catch (stockErr) {
      console.error(JSON.stringify({ event: 'stock_exit_error', invoice_id, error: String(stockErr) }));
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Commission accrual trigger (fire-and-forget, idempotent) ─────────────
    // Comissão é sempre lançada na autorização da NF-e (regra de negócio do tenant).
    try {
      const { rows: commRows } = await db.execute<{
        seller_id: string | null;
        order_id:  string | null;
        subtotal:  string;
        total:     string;
      }>(sql`SELECT seller_id, order_id, subtotal, total FROM invoices WHERE id = ${invoice_id}`);
      const commInvoice = commRows[0];

      if (commInvoice?.seller_id) {
        const { rows: sellerRows } = await db.execute<{
          default_commission_pct: string;
          commission_base:        string;
        }>(sql`SELECT default_commission_pct, commission_base FROM sellers WHERE id = ${commInvoice.seller_id}`);
        const seller = sellerRows[0];

        if (seller) {
          const baseAmount = seller.commission_base === 'total'
            ? Number(commInvoice.total)
            : Number(commInvoice.subtotal);

          await accrueCommission({
            tenantId:  result.tenant_id,
            sellerId:  commInvoice.seller_id,
            invoiceId: invoice_id,
            orderId:   commInvoice.order_id,
            baseAmount,
            rate: Number(seller.default_commission_pct),
          }, db);
        }
      }
    } catch (commErr) {
      console.error(JSON.stringify({ event: 'commission_accrual_error', invoice_id, error: String(commErr) }));
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Conta a receber (fire-and-forget, idempotente) ────────────────────────
    // Toda nota de venda autorizada pelo SEFAZ gera uma conta a receber — é o
    // fluxo correto de qualquer ERP, a nota fiscal É o fato gerador do
    // recebível. Faltava aqui: só o caminho legado POST /invoices/:id/issue
    // (que nunca passa pelo SEFAZ de verdade) criava isso — regra 60.
    try {
      const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await createReceivableFromInvoice({
        tenantId:    result.tenant_id,
        invoiceId:   invoice_id,
        clientId:    inv.client_id,
        amount:      inv.total,
        description: `NF-e nº ${number} (série ${inv.serie})`,
        dueDate,
      }, db);
    } catch (recvErr) {
      console.error(JSON.stringify({ event: 'receivable_creation_error', invoice_id, error: String(recvErr) }));
    }
    // ─────────────────────────────────────────────────────────────────────────

    // WhatsApp — Cobranças e Notificações (módulo opcional pago). Nunca lança
    // (fire-and-forget, mesma filosofia de sendNotificationIfEnabled) — a
    // própria função já engole erro de elegibilidade (automação desligada,
    // conta não conectada, cliente sem opt-in etc.).
    void notifyFiscalDocumentAuthorized(result.tenant_id, { id: invoice_id, client_id: inv.client_id, number, total: inv.total });

    // ── Projeção de receita fiscal (fire-and-forget, idempotente por doc) ────
    // Alimenta fiscal_revenue_monthly → RBT12 calculado por empresa (módulo
    // fiscal). NF-e = receita de comércio (Anexo I). Mesmo racional da regra
    // 60: a nota autorizada é o fato gerador; UNIQUE(source_doc) impede dupla
    // contagem no redelivery do SQS.
    if (inv.company_id) {
      try {
        await recordRevenue({
          tenantId: result.tenant_id, companyId: inv.company_id,
          competencia: new Date().toISOString().slice(0, 7),
          anexo: 1, amount: Number(inv.total),
          sourceDocType: 'invoice', sourceDocId: invoice_id,
        }, db);
      } catch (revErr) {
        console.error(JSON.stringify({ event: 'fiscal_revenue_projection_error', invoice_id, error: String(revErr) }));
      }
    }

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
      })
      .where(and(eq(invoices.id, invoice_id), eq(invoices.nfe_status, 'processing')));

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

async function processNfseResult(result: NfseResultMessage): Promise<void> {
  const { nfse_id, tenant_id, nfse_status, nfse_number, nfse_chave,
          nfse_verify_code, nfse_protocol, nfse_auth_date,
          nfse_pdf_url, nfse_xml_s3_key, nfse_reject_reason } = result;

  // ── Cancelamento (motor próprio 0074, action:'cancel') ──────────────────
  // NfseResultMessage tipa nfse_status como authorized|rejected (contrato do
  // Focus); o transporte ABRASF publica 'cancelled' — daí o cast local.
  if ((result as any).action === 'cancel') {
    if ((nfse_status as string) === 'cancelled') {
      await db.update(nfseInvoices)
        .set({ nfse_status: 'cancelled', cancel_date: new Date() })
        .where(and(eq(nfseInvoices.id, nfse_id), eq(nfseInvoices.nfse_status, 'authorized')));
      await db.insert(nfseEvents).values({
        nfse_id, tenant_id, event_type: 'cancellation', payload: { nfse_number },
      });
      console.info(JSON.stringify({ event: 'nfse_result_cancelled', nfse_id }));
    } else {
      await db.insert(nfseEvents).values({
        nfse_id, tenant_id, event_type: 'cancellation_rejected',
        payload: { reason: nfse_reject_reason ?? null },
      });
      console.warn(JSON.stringify({ event: 'nfse_cancel_rejected', nfse_id, reason: nfse_reject_reason }));
    }
    return;
  }

  if (nfse_status === 'authorized') {
    await db.update(nfseInvoices)
      .set({
        nfse_status:      'authorized',
        nfse_number:      nfse_number      || null,
        nfse_chave:       nfse_chave       || null,
        nfse_verify_code: nfse_verify_code || null,
        nfse_protocol:    nfse_protocol    || null,
        nfse_auth_date:   nfse_auth_date ? new Date(nfse_auth_date) : null,
        nfse_pdf_url:     nfse_pdf_url     || null,
        nfse_xml_s3_key:  nfse_xml_s3_key  || null,
      })
      .where(and(eq(nfseInvoices.id, nfse_id), eq(nfseInvoices.nfse_status, 'processing')));

    await db.insert(nfseEvents).values({
      nfse_id, tenant_id,
      event_type:  'emission',
      status_code: '100',
      protocol:    nfse_protocol || null,
      payload:     { nfse_number, nfse_chave, nfse_verify_code, nfse_protocol, nfse_auth_date },
    });

    console.info(JSON.stringify({ event: 'nfse_result_authorized', nfse_id, nfse_number }));

    // Draft de consolidação vinculado (0073): autorização fecha o ciclo.
    await db.execute(sql`
      UPDATE fiscal_document_drafts SET status = 'emitted', updated_at = NOW()
      WHERE nfse_id = ${nfse_id} AND status = 'emitting'
    `);

    const { rows: [inv] } = await db.execute<{
      amount: string; iss_value: string; company_id: string | null; iss_retido: boolean | null;
      client_name: string | null; client_email: string | null;
    }>(sql`
      SELECT n.amount, n.iss_value, n.company_id, n.iss_retido,
             COALESCE(c.company_name, c.full_name) AS client_name,
             c.email AS client_email
      FROM nfse_invoices n LEFT JOIN clients c ON c.id = n.client_id
      WHERE n.id = ${nfse_id}
    `);

    // Projeção de receita fiscal (fire-and-forget, idempotente por documento):
    // NFS-e autorizada = receita de serviço no ledger do RBT12; o anexo (III/IV/V)
    // é resolvido na apuração pelo cadastro/Fator R, não aqui.
    if (inv?.company_id) {
      try {
        await recordRevenue({
          tenantId: tenant_id, companyId: inv.company_id,
          competencia: new Date().toISOString().slice(0, 7),
          amount: Number(inv.amount),
          comRetencao: inv.iss_retido ? Number(inv.amount) : 0,
          sourceDocType: 'nfse', sourceDocId: nfse_id,
        }, db);
      } catch (revErr) {
        console.error(JSON.stringify({ event: 'fiscal_revenue_projection_error', nfse_id, error: String(revErr) }));
      }
    }

    if (inv?.client_email) {
      await sendNotificationIfEnabled({
        tenant_id, type: 'nfse_authorized',
        recipient: { email: inv.client_email, name: inv.client_name ?? '' },
        data: {
          nfse_number: nfse_number ?? '',
          valor:       inv.amount ?? '',
          iss_valor:   inv.iss_value ?? '',
          pdf_url:     nfse_pdf_url ?? '',
        },
      }).catch(err => console.warn(JSON.stringify({ event: 'notification_enqueue_warn', error: String(err) })));
    }

  } else {
    await db.update(nfseInvoices)
      .set({ nfse_status: 'rejected', nfse_reject_reason: nfse_reject_reason || null })
      .where(and(eq(nfseInvoices.id, nfse_id), eq(nfseInvoices.nfse_status, 'processing')));

    await db.insert(nfseEvents).values({
      nfse_id, tenant_id,
      event_type: 'emission_rejected',
      payload:    { nfse_reject_reason },
    });

    // Draft vinculado volta para 'failed' com o motivo — reenvio recalcula/emite.
    await db.execute(sql`
      UPDATE fiscal_document_drafts
      SET status = 'failed', error_message = ${nfse_reject_reason || 'rejeitada'}, updated_at = NOW()
      WHERE nfse_id = ${nfse_id} AND status = 'emitting'
    `);

    console.warn(JSON.stringify({ event: 'nfse_result_rejected', nfse_id, nfse_reject_reason }));

    const { rows: [inv] } = await db.execute<{
      nfse_number: string | null; client_name: string | null; client_email: string | null;
    }>(sql`
      SELECT n.nfse_number, COALESCE(c.company_name, c.full_name) AS client_name, c.email AS client_email
      FROM nfse_invoices n LEFT JOIN clients c ON c.id = n.client_id
      WHERE n.id = ${nfse_id}
    `);
    if (inv?.client_email) {
      await sendNotificationIfEnabled({
        tenant_id, type: 'nfse_rejected',
        recipient: { email: inv.client_email, name: inv.client_name ?? '' },
        data: { nfse_number: inv.nfse_number ?? '', reject_reason: nfse_reject_reason ?? '' },
      }).catch(err => console.warn(JSON.stringify({ event: 'notification_enqueue_warn', error: String(err) })));
    }
  }
}

async function processRemessaResult(result: RemessaResultMessage): Promise<void> {
  const { remessa_id, tenant_id, nfe_status, nfe_chave, nfe_protocol,
          nfe_auth_date, xml_s3_key, danfe_url, nfe_reject_reason } = result;

  if (nfe_status === 'authorized') {
    const { rows: [updated] } = await db.execute<{ id: string; parent_remessa_id: string | null }>(sql`
      UPDATE simples_remessas SET
        status         = 'authorized',
        nfe_chave      = ${nfe_chave ? nfe_chave.replace(/\D/g, '') : null},
        nfe_protocol   = ${nfe_protocol  || null},
        nfe_auth_date  = ${nfe_auth_date ? new Date(nfe_auth_date) : null},
        nfe_xml_s3_key = ${xml_s3_key || null},
        nfe_danfe_url  = ${danfe_url  || null},
        updated_at     = now()
      WHERE id = ${remessa_id} AND status = 'processing'
      RETURNING id, parent_remessa_id
    `);
    if (!updated) return; // já processado (idempotência) ou não encontrado

    await db.insert(simplesRemessaEvents).values({
      simples_remessa_id: remessa_id, tenant_id,
      event_type:  'emission',
      status_code: '100',
      protocol:    nfe_protocol || null,
      payload:     { nfe_chave, nfe_protocol, nfe_auth_date },
    });

    console.info(JSON.stringify({ event: 'remessa_result_authorized', remessa_id, nfe_chave }));

    // Estoque (regra 51): uma remessa original baixa estoque ('out'); um
    // retorno (parent_remessa_id preenchido) devolve ('in'). Nunca gera
    // receivable nem comissão — não é venda.
    try {
      await applyRemessaStockMovement(remessa_id, tenant_id, updated.parent_remessa_id ? 'in' : 'out', db);
    } catch (stockErr) {
      console.error(JSON.stringify({ event: 'remessa_stock_error', remessa_id, error: String(stockErr) }));
    }

  } else {
    const { rows: [updated] } = await db.execute<{ id: string }>(sql`
      UPDATE simples_remessas SET
        status = 'rejected', nfe_reject_reason = ${nfe_reject_reason || null}, updated_at = now()
      WHERE id = ${remessa_id} AND status = 'processing'
      RETURNING id
    `);
    if (!updated) return;

    await db.insert(simplesRemessaEvents).values({
      simples_remessa_id: remessa_id, tenant_id,
      event_type: 'emission_rejected',
      payload:    { nfe_reject_reason },
    });

    console.warn(JSON.stringify({ event: 'remessa_result_rejected', remessa_id, nfe_reject_reason }));
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
