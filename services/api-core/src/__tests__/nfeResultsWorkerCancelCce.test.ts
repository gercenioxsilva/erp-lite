import { describe, it, expect, vi, beforeEach } from 'vitest';

// processCancelResult/processCceResult (migration 0089) — chamados direto,
// mesmo padrão de nfeResultsWorkerReceivable.test.ts (sem SQS/Fastify real,
// só a lógica de atualização do banco a partir do resultado do lambda-fiscal).

const mockDb = vi.hoisted(() => ({ update: vi.fn(), insert: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

import { processCancelResult, processCceResult } from '../workers/nfeResultsWorker';

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const INVOICE_ID = '22222222-2222-2222-2222-222222222222';

function updateChain() {
  const set = vi.fn().mockReturnThis();
  const where = vi.fn().mockResolvedValue(undefined);
  return { set, where };
}

describe('processCancelResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockImplementation(() => updateChain());
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  });

  it('cancelamento confirmado: nfe_status vira cancelled com protocolo, insere evento de cancelamento', async () => {
    await processCancelResult({
      type: 'nfe_cancel', invoice_id: INVOICE_ID, tenant_id: TENANT_ID,
      cancel_status: 'cancelled', cancel_protocol: '135000000000001',
    });

    const updateCall = mockDb.update.mock.results[0].value;
    expect(updateCall.set).toHaveBeenCalledWith(expect.objectContaining({
      nfe_status: 'cancelled', nfe_cancel_protocol: '135000000000001',
    }));

    const insertValues = mockDb.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      invoice_id: INVOICE_ID, tenant_id: TENANT_ID, event_type: 'cancellation', protocol: '135000000000001',
    }));
  });

  it('cancelamento rejeitado pela SEFAZ: nfe_status volta pra authorized, insere evento de rejeição', async () => {
    await processCancelResult({
      type: 'nfe_cancel', invoice_id: INVOICE_ID, tenant_id: TENANT_ID,
      cancel_status: 'rejected', cancel_reject_reason: 'Fora do prazo de cancelamento',
    });

    const updateCall = mockDb.update.mock.results[0].value;
    expect(updateCall.set).toHaveBeenCalledWith(expect.objectContaining({
      nfe_status: 'authorized', nfe_cancel_reject_reason: 'Fora do prazo de cancelamento',
    }));

    const insertValues = mockDb.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      invoice_id: INVOICE_ID, event_type: 'cancellation_rejected',
    }));
  });
});

describe('processCceResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockImplementation(() => updateChain());
  });

  it('CC-e registrada: atualiza a linha própria (status=registered + protocolo), nunca nfe_events', async () => {
    await processCceResult({
      type: 'cce', invoice_id: INVOICE_ID, tenant_id: TENANT_ID, sequencia: 1,
      cce_status: 'registered', cce_protocol: '135000000000002',
    });

    const updateCall = mockDb.update.mock.results[0].value;
    expect(updateCall.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'registered', protocol: '135000000000002',
    }));
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('CC-e rejeitada: atualiza a linha própria com status=rejected + motivo', async () => {
    await processCceResult({
      type: 'cce', invoice_id: INVOICE_ID, tenant_id: TENANT_ID, sequencia: 2,
      cce_status: 'rejected', cce_reject_reason: 'Texto contém dado fiscalmente relevante',
    });

    const updateCall = mockDb.update.mock.results[0].value;
    expect(updateCall.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'rejected', reject_reason: 'Texto contém dado fiscalmente relevante',
    }));
  });
});
