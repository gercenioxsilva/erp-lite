import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({ send: vi.fn() }),
}));

const mockDb = vi.hoisted(() => ({ update: vi.fn(), select: vi.fn() }));
vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

import { getSqsClient } from '../lib/sqsClient';
import {
  startMarketplaceSyncResultsWorker, stopMarketplaceSyncResultsWorker, processResult,
} from '../workers/marketplaceSyncResultsWorker';

describe('marketplaceSyncResultsWorker', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { stopMarketplaceSyncResultsWorker(); delete process.env.MARKETPLACE_SYNC_RESULTS_QUEUE_URL; });

  it('não inicia o polling quando MARKETPLACE_SYNC_RESULTS_QUEUE_URL não está configurada (Fase 2 ainda não existe)', () => {
    delete process.env.MARKETPLACE_SYNC_RESULTS_QUEUE_URL;
    startMarketplaceSyncResultsWorker();
    expect(getSqsClient).not.toHaveBeenCalled();
  });

  it('persists refreshed_tokens into marketplace_connections regardless of message type (refresh_token do ML é de uso único)', async () => {
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDb.update.mockReturnValue({ set: setMock });

    await processResult({
      type: 'sync_material',
      tenant_id: 'tenant-1',
      connection_id: 'conn-1',
      link_id: 'link-1',
      status: 'active',
      refreshed_tokens: {
        access_token: 'new-access', refresh_token: 'new-refresh',
        token_expires_at: '2026-01-01T06:00:00.000Z',
      },
    });

    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
      access_token: 'new-access', refresh_token: 'new-refresh',
    }));
  });

  it('does not touch marketplace_connections when refreshed_tokens is absent', async () => {
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });

    await processResult({
      type: 'sync_material', tenant_id: 'tenant-1', connection_id: 'conn-1',
      link_id: 'link-1', status: 'active',
    });

    expect(mockDb.update).toHaveBeenCalledTimes(1); // só o UPDATE de material_marketplace_links
  });
});
