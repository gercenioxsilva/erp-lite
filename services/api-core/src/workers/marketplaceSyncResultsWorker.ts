// Consumidor da fila marketplace-sync-results (Fase 2 — Lambda ainda não
// existe). Mesmo molde de boletoResultsWorker.ts: long-poll in-process no ECS,
// desabilitado (log + no-op) quando a fila não está configurada — hoje, em
// qualquer ambiente, já que a fila é Terraform/Fase 2. Fica pronto e testável
// para quando a Fase 2 publicar mensagens de verdade.

import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { eq, and } from 'drizzle-orm';
import { getSqsClient } from '../lib/sqsClient';
import { db, orders, orderItems, clients, materialMarketplaceLinks } from '../db';
import { mapMlOrderToErpOrder, MarketplaceDomainError, type MlOrder } from '../domain/marketplace/marketplaceDomain';

export interface MarketplaceSyncResultMessage {
  type: 'order_import' | 'sync_material';
  tenant_id: string;
  connection_id: string;
  // order_import
  ml_order?: MlOrder;
  // sync_material
  link_id?: string;
  status?: 'active' | 'error';
  error_reason?: string;
}

let running = true;

export function stopMarketplaceSyncResultsWorker() { running = false; }

export function startMarketplaceSyncResultsWorker(): void {
  const queueUrl = process.env.MARKETPLACE_SYNC_RESULTS_QUEUE_URL;
  if (!queueUrl) {
    console.info('MARKETPLACE_SYNC_RESULTS_QUEUE_URL not set — marketplace sync results worker disabled');
    return;
  }
  console.info('Marketplace sync results worker started — polling', queueUrl);
  void poll(queueUrl);
}

async function poll(queueUrl: string): Promise<void> {
  while (running) {
    try {
      const sqs = getSqsClient();
      const resp = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 15,
      }));

      for (const msg of resp.Messages ?? []) {
        try {
          const result: MarketplaceSyncResultMessage = JSON.parse(msg.Body!);
          await processResult(result);
          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle! }));
        } catch (err) {
          console.error(JSON.stringify({ event: 'marketplace_sync_result_error', error: String(err) }));
        }
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'marketplace_sync_poll_error', error: String(err) }));
      await sleep(5_000);
    }
  }
}

/**
 * Nome/marcador do cliente genérico usado para pedidos importados do
 * Mercado Livre — decisão deliberada de v1: não criamos um client por
 * comprador anônimo do marketplace (mesmo padrão comum em integrações de
 * canal de venda). Revisitar em Fase 2 se for necessário 1 client por comprador.
 */
const MARKETPLACE_CLIENT_NAME = 'Cliente Mercado Livre';

async function getOrCreateMarketplaceClient(tenantId: string): Promise<string> {
  const [existing] = await db.select({ id: clients.id }).from(clients)
    .where(and(eq(clients.tenant_id, tenantId), eq(clients.full_name, MARKETPLACE_CLIENT_NAME)));
  if (existing) return existing.id;

  const [created] = await db.insert(clients).values({
    tenant_id: tenantId, person_type: 'PF', full_name: MARKETPLACE_CLIENT_NAME,
  }).returning({ id: clients.id });
  return created.id;
}

async function processResult(result: MarketplaceSyncResultMessage): Promise<void> {
  if (result.type === 'sync_material') {
    if (!result.link_id) return;
    await db.update(materialMarketplaceLinks).set({
      status: result.status ?? 'error',
      last_error: result.error_reason ?? null,
      last_synced_at: new Date(),
    }).where(and(eq(materialMarketplaceLinks.id, result.link_id), eq(materialMarketplaceLinks.tenant_id, result.tenant_id)));
    return;
  }

  if (result.type === 'order_import' && result.ml_order) {
    const links = await db.select({
      material_id: materialMarketplaceLinks.material_id,
      ml_item_id: materialMarketplaceLinks.ml_item_id,
      ml_variation_id: materialMarketplaceLinks.ml_variation_id,
    }).from(materialMarketplaceLinks)
      .where(and(eq(materialMarketplaceLinks.connection_id, result.connection_id), eq(materialMarketplaceLinks.tenant_id, result.tenant_id)));

    let mapped;
    try {
      mapped = mapMlOrderToErpOrder(result.ml_order, links as any);
    } catch (err) {
      if (err instanceof MarketplaceDomainError) {
        console.error(JSON.stringify({ event: 'marketplace_order_unmatched_item', tenant_id: result.tenant_id, error: err.code, payload: err.payload }));
        return;
      }
      throw err;
    }

    const clientId = await getOrCreateMarketplaceClient(result.tenant_id);
    const subtotal = mapped.items.reduce((s, it) => s + it.quantity * it.unit_price, 0);

    await db.transaction(async (tx: any) => {
      const [order] = await tx.insert(orders).values({
        tenant_id: result.tenant_id, client_id: clientId,
        number: `ML-${mapped.marketplace_order_id}`,
        status: 'confirmed', // pedido do ML já está pago/comprometido — pula 'draft'
        subtotal: String(subtotal), total: String(subtotal),
        origin: 'mercadolivre', marketplace_order_id: mapped.marketplace_order_id,
      }).returning();

      for (const item of mapped.items) {
        await tx.insert(orderItems).values({
          order_id: order.id, material_id: item.material_id,
          name: item.name ?? 'Item Mercado Livre',
          quantity: String(item.quantity), unit_price: String(item.unit_price),
          total: String(item.quantity * item.unit_price),
        });
      }
    });

    console.info(JSON.stringify({ event: 'marketplace_order_imported', tenant_id: result.tenant_id, marketplace_order_id: mapped.marketplace_order_id }));
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
