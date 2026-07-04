import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({ send: vi.fn() }),
}));

import { getSqsClient } from '../lib/sqsClient';
import { startMarketplaceSyncResultsWorker, stopMarketplaceSyncResultsWorker } from '../workers/marketplaceSyncResultsWorker';

describe('marketplaceSyncResultsWorker', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { stopMarketplaceSyncResultsWorker(); delete process.env.MARKETPLACE_SYNC_RESULTS_QUEUE_URL; });

  it('não inicia o polling quando MARKETPLACE_SYNC_RESULTS_QUEUE_URL não está configurada (Fase 2 ainda não existe)', () => {
    delete process.env.MARKETPLACE_SYNC_RESULTS_QUEUE_URL;
    startMarketplaceSyncResultsWorker();
    expect(getSqsClient).not.toHaveBeenCalled();
  });
});
