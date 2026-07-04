// Consumidor da fila marketplace-sync-results (Fase 2 — populada pelo
// lambda-marketplace). Mesmo molde de boletoResultsWorker.ts: long-poll
// in-process no ECS, desabilitado (log + no-op) quando a fila não está
// configurada.

import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { eq, and } from 'drizzle-orm';
import { getSqsClient } from '../lib/sqsClient';
import { db, orders, orderItems, clients, materialMarketplaceLinks, marketplaceConnections } from '../db';
import { mapMlOrderToErpOrder, MarketplaceDomainError } from '../domain/marketplace/marketplaceDomain';
import type { MarketplaceSyncResultMessage } from '../lib/marketplace-types';

export type { MarketplaceSyncResultMessage };

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

/**
 * O refresh_token do Mercado Livre é de uso único — se o Lambda renovou o
 * token durante o processamento (em qualquer um dos dois fluxos), o novo par
 * precisa ser persistido aqui, senão a próxima chamada usaria um
 * refresh_token já invalidado pela própria API do ML.
 */
async function persistRefreshedTokens(result: MarketplaceSyncResultMessage): Promise<void> {
  if (!result.refreshed_tokens) return;
  await db.update(marketplaceConnections).set({
    access_token: result.refreshed_tokens.access_token,
    refresh_token: result.refreshed_tokens.refresh_token,
    token_expires_at: new Date(result.refreshed_tokens.token_expires_at),
    last_refreshed_at: new Date(),
  }).where(and(eq(marketplaceConnections.id, result.connection_id), eq(marketplaceConnections.tenant_id, result.tenant_id)));
}

// Exportado só para teste unitário direto (mesmo racional de expor um pouco
// mais de superfície do que os outros workers in-process — a persistência de
// refreshed_tokens é sensível o bastante para merecer cobertura isolada).
export async function processResult(result: MarketplaceSyncResultMessage): Promise<void> {
  await persistRefreshedTokens(result);

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
