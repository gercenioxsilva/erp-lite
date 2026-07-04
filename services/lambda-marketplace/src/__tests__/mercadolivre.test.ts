import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHttpGet, mockHttpPut, mockPost } = vi.hoisted(() => ({
  mockHttpGet: vi.fn(),
  mockHttpPut: vi.fn(),
  mockPost: vi.fn(),
}));

vi.mock('axios', () => {
  const isAxiosError = (err: unknown): boolean => Boolean(err && typeof err === 'object' && 'isAxiosError' in (err as object));
  return {
    default: {
      create: () => ({ get: mockHttpGet, put: mockHttpPut }),
      post: mockPost,
      isAxiosError,
    },
    isAxiosError,
  };
});

import { MercadoLivreAdapter } from '../adapters/mercadolivre';
import type { MarketplaceSyncRequestMessage } from '../lib/types';

const CLIENT_ID = 'ml-client-id';
const CLIENT_SECRET = 'ml-client-secret';
const BASE_URL = 'https://api.mercadolibre.com';
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

function makeAdapter() {
  return new MercadoLivreAdapter(CLIENT_ID, CLIENT_SECRET, BASE_URL, TOKEN_URL);
}

function baseMsg(overrides: Partial<MarketplaceSyncRequestMessage> = {}): MarketplaceSyncRequestMessage {
  return {
    type: 'sync_material',
    tenant_id: 'tenant-1',
    connection_id: 'conn-1',
    connection: {
      access_token: 'valid-token',
      refresh_token: 'valid-refresh',
      token_expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), // 1h no futuro
    },
    ...overrides,
  };
}

describe('MercadoLivreAdapter', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws if client_id/client_secret are missing (credenciais do app ainda não configuradas)', () => {
    expect(() => new MercadoLivreAdapter('', '', BASE_URL, TOKEN_URL)).toThrow();
  });

  it('does not call the refresh endpoint when the access token still has plenty of time left', async () => {
    const adapter = makeAdapter();
    mockHttpPut.mockResolvedValue({});

    const outcome = await adapter.syncMaterial(baseMsg({
      link_id: 'link-1', ml_item_id: 'MLB1', sync_price: true, price: '10.00',
    }));

    expect(mockPost).not.toHaveBeenCalled();
    expect(outcome.status).toBe('active');
    expect(outcome.refreshed_tokens).toBeUndefined();
    expect(mockHttpPut).toHaveBeenCalledWith('/items/MLB1', { price: 10 }, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer valid-token' }),
    }));
  });

  it('refreshes the token when it is expired, and returns the new pair (refresh_token do ML é de uso único)', async () => {
    const adapter = makeAdapter();
    mockPost.mockResolvedValue({
      data: { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 21600 },
    });
    mockHttpPut.mockResolvedValue({});

    const outcome = await adapter.syncMaterial(baseMsg({
      link_id: 'link-1', ml_item_id: 'MLB1', sync_stock: true, available_quantity: 5,
      connection: { access_token: 'old-access', refresh_token: 'old-refresh', token_expires_at: new Date(Date.now() - 1000).toISOString() },
    }));

    expect(mockPost).toHaveBeenCalledWith(TOKEN_URL, expect.stringContaining('grant_type=refresh_token'), expect.any(Object));
    expect(mockPost.mock.calls[0][1]).toContain('old-refresh');
    expect(outcome.refreshed_tokens).toEqual({
      access_token: 'new-access', refresh_token: 'new-refresh',
      token_expires_at: expect.any(String),
    });
    expect(mockHttpPut).toHaveBeenCalledWith('/items/MLB1', { available_quantity: 5 }, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer new-access' }),
    }));
  });

  it('only sends the fields whose sync flag is enabled', async () => {
    const adapter = makeAdapter();
    mockHttpPut.mockResolvedValue({});

    await adapter.syncMaterial(baseMsg({
      link_id: 'link-1', ml_item_id: 'MLB1',
      sync_price: true, price: '50.00',
      sync_stock: false, available_quantity: 999,
    }));

    expect(mockHttpPut).toHaveBeenCalledWith('/items/MLB1', { price: 50 }, expect.any(Object));
  });

  it('returns status:error (never throws) when the Mercado Livre API rejects the update', async () => {
    const adapter = makeAdapter();
    const apiError = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: { status: 400, data: { message: 'invalid price' } },
    });
    mockHttpPut.mockRejectedValue(apiError);

    const outcome = await adapter.syncMaterial(baseMsg({ link_id: 'link-1', ml_item_id: 'MLB1', sync_price: true, price: '10.00' }));

    expect(outcome.status).toBe('error');
    expect(outcome.error_reason).toContain('400');
  });

  it('ignores webhook topics that are not orders, without calling the ML API', async () => {
    const adapter = makeAdapter();
    const outcome = await adapter.fetchResource(baseMsg({ type: 'fetch_resource', topic: 'questions', resource: '/questions/1' }));

    expect(outcome.ml_order).toBeNull();
    expect(mockHttpGet).not.toHaveBeenCalled();
  });

  it('fetches an order and maps it into the MlOrder shape expected by marketplaceSyncResultsWorker', async () => {
    const adapter = makeAdapter();
    mockHttpGet.mockResolvedValue({
      data: {
        id: 123456,
        order_items: [
          { item: { id: 'MLB1', title: 'Produto A', variation_id: 789 }, quantity: 2, unit_price: 49.9 },
          { item: { id: 'MLB2', title: 'Produto B', variation_id: null }, quantity: 1, unit_price: 10 },
        ],
      },
    });

    const outcome = await adapter.fetchResource(baseMsg({ type: 'fetch_resource', topic: 'orders_v2', resource: '/orders/123456' }));

    expect(outcome.ml_order).toEqual({
      id: '123456',
      items: [
        { ml_item_id: 'MLB1', ml_variation_id: '789', quantity: 2, unit_price: 49.9, title: 'Produto A' },
        { ml_item_id: 'MLB2', ml_variation_id: null, quantity: 1, unit_price: 10, title: 'Produto B' },
      ],
    });
  });
});
