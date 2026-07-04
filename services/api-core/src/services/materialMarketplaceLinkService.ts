// Orquestração de I/O para o vínculo material↔item do Mercado Livre (regra 42).
// requestSync() enfileira em marketplace-sync-requests SE a fila estiver
// configurada — mesmo padrão de graceful no-op já usado em toda emissão fiscal
// (a fila só existe na Fase 2/Lambda; até lá, o código fica pronto e testado,
// mas inerte, sem derrubar a requisição).

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { materialMarketplaceLinks, materials, marketplaceConnections, inventory } from '../db/schema';
import { getSqsClient } from '../lib/sqsClient';
import { MarketplaceDomainError } from '../domain/marketplace/marketplaceDomain';
import type { MarketplaceSyncRequestMessage } from '../lib/marketplace-types';

export { MarketplaceDomainError };

export type DrizzleDB = typeof _db;
export type MaterialMarketplaceLink = typeof materialMarketplaceLinks.$inferSelect;

export interface LinkInput {
  material_id: string;
  connection_id: string;
  ml_item_id?: string | null;
  ml_variation_id?: string | null;
  sync_price?: boolean;
  sync_stock?: boolean;
}

async function assertOwnership(tenantId: string, materialId: string, connectionId: string, db: DrizzleDB) {
  const [material] = await db.select({ id: materials.id }).from(materials)
    .where(and(eq(materials.id, materialId), eq(materials.tenant_id, tenantId)));
  if (!material) throw new MarketplaceDomainError('material_not_found', { materialId });

  const [connection] = await db.select({ id: marketplaceConnections.id }).from(marketplaceConnections)
    .where(and(eq(marketplaceConnections.id, connectionId), eq(marketplaceConnections.tenant_id, tenantId)));
  if (!connection) throw new MarketplaceDomainError('connection_not_found', { connectionId });
}

export async function listLinks(
  tenantId: string, filters: { materialId?: string; connectionId?: string } = {}, db: DrizzleDB = _db,
): Promise<MaterialMarketplaceLink[]> {
  const conditions = [eq(materialMarketplaceLinks.tenant_id, tenantId)];
  if (filters.materialId)   conditions.push(eq(materialMarketplaceLinks.material_id, filters.materialId));
  if (filters.connectionId) conditions.push(eq(materialMarketplaceLinks.connection_id, filters.connectionId));
  return db.select().from(materialMarketplaceLinks).where(and(...conditions));
}

export async function createLink(tenantId: string, input: LinkInput, db: DrizzleDB = _db): Promise<MaterialMarketplaceLink> {
  await assertOwnership(tenantId, input.material_id, input.connection_id, db);

  const [row] = await db.insert(materialMarketplaceLinks).values({
    tenant_id: tenantId,
    material_id: input.material_id,
    connection_id: input.connection_id,
    ml_item_id: input.ml_item_id ?? null,
    ml_variation_id: input.ml_variation_id ?? null,
    sync_price: input.sync_price ?? true,
    sync_stock: input.sync_stock ?? true,
    status: 'pending',
  }).returning();

  return row;
}

async function getOwnedLink(tenantId: string, linkId: string, db: DrizzleDB): Promise<MaterialMarketplaceLink> {
  const [row] = await db.select().from(materialMarketplaceLinks)
    .where(and(eq(materialMarketplaceLinks.id, linkId), eq(materialMarketplaceLinks.tenant_id, tenantId)));
  if (!row) throw new MarketplaceDomainError('link_not_found', { linkId });
  return row;
}

export async function updateLink(
  tenantId: string, linkId: string, input: Partial<LinkInput>, db: DrizzleDB = _db,
): Promise<MaterialMarketplaceLink> {
  await getOwnedLink(tenantId, linkId, db);

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (input.ml_item_id !== undefined)      patch.ml_item_id = input.ml_item_id;
  if (input.ml_variation_id !== undefined) patch.ml_variation_id = input.ml_variation_id;
  if (input.sync_price !== undefined)      patch.sync_price = input.sync_price;
  if (input.sync_stock !== undefined)      patch.sync_stock = input.sync_stock;

  const [row] = await db.update(materialMarketplaceLinks).set(patch)
    .where(eq(materialMarketplaceLinks.id, linkId)).returning();
  return row;
}

/** Soft-delete (regra 8) — nunca apaga fisicamente o vínculo, só marca 'closed'. */
export async function closeLink(tenantId: string, linkId: string, db: DrizzleDB = _db): Promise<void> {
  await getOwnedLink(tenantId, linkId, db);
  await db.update(materialMarketplaceLinks).set({ status: 'closed', updated_at: new Date() })
    .where(eq(materialMarketplaceLinks.id, linkId));
}

/**
 * Pede uma sincronização de preço/estoque para o Mercado Livre. Enfileira em
 * marketplace-sync-requests SE a fila estiver configurada (Fase 2 — o Lambda
 * lambda-marketplace consome essa fila); sem a fila configurada, continua um
 * no-op deliberado (mesmo comportamento de toda emissão fiscal).
 *
 * O Lambda nunca acessa o Postgres diretamente (mesmo padrão de
 * BillingEmitMessage.banking) — por isso a mensagem carrega um snapshot dos
 * tokens da conexão e do preço/estoque atuais do material.
 */
export async function requestSync(tenantId: string, linkId: string, db: DrizzleDB = _db): Promise<{ enqueued: boolean }> {
  const link = await getOwnedLink(tenantId, linkId, db);

  const queueUrl = process.env.MARKETPLACE_SYNC_REQUESTS_QUEUE_URL;
  if (!queueUrl) {
    console.info('MARKETPLACE_SYNC_REQUESTS_QUEUE_URL not set — sync request not enqueued (Fase 2 ainda não configurada)');
    return { enqueued: false };
  }

  const [connection] = await db.select().from(marketplaceConnections)
    .where(eq(marketplaceConnections.id, link.connection_id));
  if (!connection) throw new MarketplaceDomainError('connection_not_found', { connectionId: link.connection_id });

  const [material] = await db.select({ sale_price: materials.sale_price }).from(materials)
    .where(eq(materials.id, link.material_id));
  const [stock] = await db.select({ quantity: inventory.quantity }).from(inventory)
    .where(eq(inventory.material_id, link.material_id));

  const message: MarketplaceSyncRequestMessage = {
    type: 'sync_material',
    tenant_id: tenantId,
    connection_id: link.connection_id,
    connection: {
      access_token: connection.access_token,
      refresh_token: connection.refresh_token,
      token_expires_at: connection.token_expires_at ? connection.token_expires_at.toISOString() : null,
    },
    link_id: link.id,
    ml_item_id: link.ml_item_id,
    ml_variation_id: link.ml_variation_id,
    sync_price: link.sync_price,
    sync_stock: link.sync_stock,
    price: material?.sale_price ?? undefined,
    available_quantity: stock ? Number(stock.quantity) : undefined,
  };

  await getSqsClient().send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message),
  }));

  await db.update(materialMarketplaceLinks).set({ status: 'pending', updated_at: new Date() })
    .where(eq(materialMarketplaceLinks.id, linkId));

  return { enqueued: true };
}
