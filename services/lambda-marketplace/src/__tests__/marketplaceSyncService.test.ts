import { describe, it, expect, vi } from 'vitest';
import type { SQSRecord } from 'aws-lambda';
import { processRecord } from '../services/marketplaceSyncService';
import type { MarketplaceAdapter } from '../adapters';

function fakeApp(adapter: Partial<MarketplaceAdapter>) {
  const sendMock = vi.fn().mockResolvedValue({});
  const app = {
    getMarketplaceAdapter: () => adapter as MarketplaceAdapter,
    sqs: { send: sendMock },
    config: { marketplaceSyncResultsQueueUrl: 'http://localhost/queue/results' },
    log: { info: vi.fn(), error: vi.fn() },
  };
  return { app: app as any, sendMock };
}

function record(body: unknown): SQSRecord {
  return { body: JSON.stringify(body) } as SQSRecord;
}

describe('marketplaceSyncService.processRecord', () => {
  it('sends a sync_material result message with the outcome from the adapter', async () => {
    const { app, sendMock } = fakeApp({
      syncMaterial: vi.fn().mockResolvedValue({ status: 'active', refreshed_tokens: undefined }),
    });

    await processRecord(app, record({
      type: 'sync_material', tenant_id: 't1', connection_id: 'c1', link_id: 'l1', ml_item_id: 'MLB1',
      connection: { access_token: 'a', refresh_token: 'r', token_expires_at: null },
    }));

    expect(sendMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(sendMock.mock.calls[0][0].input.MessageBody);
    expect(body).toMatchObject({ type: 'sync_material', tenant_id: 't1', connection_id: 'c1', link_id: 'l1', status: 'active' });
  });

  it('forwards refreshed_tokens into the result message when the adapter renewed the token', async () => {
    const { app, sendMock } = fakeApp({
      syncMaterial: vi.fn().mockResolvedValue({
        status: 'active',
        refreshed_tokens: { access_token: 'new-a', refresh_token: 'new-r', token_expires_at: '2026-01-01T00:00:00.000Z' },
      }),
    });

    await processRecord(app, record({
      type: 'sync_material', tenant_id: 't1', connection_id: 'c1', link_id: 'l1',
      connection: { access_token: 'a', refresh_token: 'r', token_expires_at: null },
    }));

    const body = JSON.parse(sendMock.mock.calls[0][0].input.MessageBody);
    expect(body.refreshed_tokens).toEqual({ access_token: 'new-a', refresh_token: 'new-r', token_expires_at: '2026-01-01T00:00:00.000Z' });
  });

  it('sends an order_import result message when fetch_resource resolves an order', async () => {
    const mlOrder = { id: '999', items: [{ ml_item_id: 'MLB1', ml_variation_id: null, quantity: 1, unit_price: 10 }] };
    const { app, sendMock } = fakeApp({
      fetchResource: vi.fn().mockResolvedValue({ ml_order: mlOrder }),
    });

    await processRecord(app, record({
      type: 'fetch_resource', tenant_id: 't1', connection_id: 'c1', topic: 'orders_v2', resource: '/orders/999',
      connection: { access_token: 'a', refresh_token: 'r', token_expires_at: null },
    }));

    const body = JSON.parse(sendMock.mock.calls[0][0].input.MessageBody);
    expect(body).toMatchObject({ type: 'order_import', tenant_id: 't1', connection_id: 'c1', ml_order: mlOrder });
  });

  it('does not send any result message when fetch_resource ignores an unsupported topic', async () => {
    const { app, sendMock } = fakeApp({
      fetchResource: vi.fn().mockResolvedValue({ ml_order: null }),
    });

    await processRecord(app, record({
      type: 'fetch_resource', tenant_id: 't1', connection_id: 'c1', topic: 'questions', resource: '/questions/1',
      connection: { access_token: 'a', refresh_token: 'r', token_expires_at: null },
    }));

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('propagates an exception from fetchResource so the SQS handler retries the message', async () => {
    const { app } = fakeApp({
      fetchResource: vi.fn().mockRejectedValue(new Error('ML API down')),
    });

    await expect(processRecord(app, record({
      type: 'fetch_resource', tenant_id: 't1', connection_id: 'c1', topic: 'orders_v2', resource: '/orders/1',
      connection: { access_token: 'a', refresh_token: 'r', token_expires_at: null },
    }))).rejects.toThrow('ML API down');
  });
});
