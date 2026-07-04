import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { FastifyInstance } from 'fastify';
import type { SQSRecord } from 'aws-lambda';
import type { MarketplaceSyncRequestMessage, MarketplaceSyncResultMessage } from '../lib/types';

/**
 * sync_material sempre produz um resultado (status active|error) — erros da
 * API do ML são capturados pelo adapter e viram o result message, nunca uma
 * exceção (mesmo padrão de boletoService.ts).
 *
 * fetch_resource (order import) É deixado propagar exceção para o handler: não
 * existe uma linha de "falha de importação" no schema para registrar o erro
 * como resultado, então uma falha aqui deve virar retry do SQS (e DLQ depois
 * de 3 tentativas) — nunca falhar silenciosamente.
 */
export async function processRecord(app: FastifyInstance, record: SQSRecord): Promise<void> {
  const msg: MarketplaceSyncRequestMessage = JSON.parse(record.body);
  const adapter = app.getMarketplaceAdapter();

  app.log.info({ event: 'marketplace_sync_received', type: msg.type, tenant_id: msg.tenant_id, connection_id: msg.connection_id });

  if (msg.type === 'sync_material') {
    const outcome = await adapter.syncMaterial(msg);
    const result: MarketplaceSyncResultMessage = {
      type: 'sync_material',
      tenant_id: msg.tenant_id,
      connection_id: msg.connection_id,
      link_id: msg.link_id,
      status: outcome.status,
      error_reason: outcome.error_reason,
      refreshed_tokens: outcome.refreshed_tokens,
    };
    await sendResult(app, result);
    app.log.info({ event: 'marketplace_sync_material_done', link_id: msg.link_id, status: outcome.status });
    return;
  }

  if (msg.type === 'fetch_resource') {
    const outcome = await adapter.fetchResource(msg);
    if (!outcome.ml_order) {
      app.log.info({ event: 'marketplace_webhook_topic_ignored', topic: msg.topic });
      return; // tópico não suportado nesta fase (perguntas, itens etc.) — ack silencioso
    }

    const result: MarketplaceSyncResultMessage = {
      type: 'order_import',
      tenant_id: msg.tenant_id,
      connection_id: msg.connection_id,
      ml_order: outcome.ml_order,
      refreshed_tokens: outcome.refreshed_tokens,
    };
    await sendResult(app, result);
    app.log.info({ event: 'marketplace_order_fetched', marketplace_order_id: outcome.ml_order.id });
  }
}

async function sendResult(app: FastifyInstance, result: MarketplaceSyncResultMessage): Promise<void> {
  await app.sqs.send(new SendMessageCommand({
    QueueUrl: app.config.marketplaceSyncResultsQueueUrl,
    MessageBody: JSON.stringify(result),
  }));
}
