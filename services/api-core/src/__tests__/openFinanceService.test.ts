// Sync Open Finance — os invariantes que protegem o ledger: idempotência
// (re-sync = tudo duplicate), PENDING nunca entra, erro marca a conexão sem
// propagar dado parcial, e o gating por env (503 sem PLUGGY_*).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/reconciliationService', () => ({
  runReconciliation: vi.fn().mockResolvedValue({ processed: 2, autoConfirmed: 1, suggested: 0, unmatched: 1 }),
}));
vi.mock('../services/fiscalAuditService', () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));
// 0087: a credencial Pluggy virou por tenant (com fallback de plataforma). Aqui
// interessa o comportamento do SYNC, não a cascata de resolução — que tem teste
// próprio. O mock preserva a semântica dirigida por env que estes casos usam.
vi.mock('../services/integrations/integrationService', () => ({
  resolveCredentials: vi.fn(async () => (
    process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET
      ? {
          providerKey: 'pluggy', environment: 'sandbox', source: 'platform',
          values: {
            client_id: process.env.PLUGGY_CLIENT_ID,
            client_secret: process.env.PLUGGY_CLIENT_SECRET,
          },
        }
      : null
  )),
  // 0088: gate de serviço. Aqui todos ligados — é o default de quem não
  // configurou nada (enabled_services NULL). O gate em si tem teste próprio.
  isServiceEnabled: vi.fn(async () => true),
  assertServiceEnabled: vi.fn(async () => undefined),
}));

import { syncConnection, connectToken, OpenFinanceError } from '../services/openFinanceService';
import { runReconciliation } from '../services/reconciliationService';

const CONN = {
  id: 'conn-1', tenant_id: 'tenant-1', company_id: 'company-1',
  item_id: 'local-item-1', institution: 'Banco Simulado',
  status: 'active', last_synced_at: null,
};
const ACCOUNTS = [{ id: 'bca-1', connection_id: 'conn-1', account_id: 'local-item-1-acc-1', sync_enabled: true }];

// db mock por tabela: selects devolvem conexão/contas; inserts em
// imported_transactions respeitam um Set de dedup keys (simula o UNIQUE).
function makeDb(insertedKeys: Set<string>) {
  let selectCall = 0;
  return {
    select: vi.fn(() => ({
      from: () => ({
        where: () => {
          selectCall++;
          return Promise.resolve(selectCall === 1 ? [CONN] : ACCOUNTS);
        },
      }),
    })),
    insert: vi.fn((table: any) => ({
      values: (v: any) => {
        const isBatch = v.source_kind === 'openfinance' && v.original_filename;
        if (isBatch) return { returning: () => Promise.resolve([{ id: 'batch-1' }]) };
        // imported_transactions: UNIQUE(tenant, dedup_key) simulado
        if (insertedKeys.has(v.dedup_key)) {
          const err: any = new Error('duplicate key value violates unique constraint');
          err.code = '23505';
          return Promise.reject(err);
        }
        insertedKeys.add(v.dedup_key);
        return Promise.resolve();
      },
    })),
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
  } as any;
}

describe('openFinanceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLUGGY_CLIENT_ID = 'local-dev';
    process.env.PLUGGY_CLIENT_SECRET = 'local-secret';
  });
  afterEach(() => {
    delete process.env.PLUGGY_CLIENT_ID;
    delete process.env.PLUGGY_CLIENT_SECRET;
  });

  it('sem credencial resolvida → openfinance_disabled (vira 503, nunca 500)', async () => {
    delete process.env.PLUGGY_CLIENT_ID;
    await expect(connectToken('tenant-1')).rejects.toMatchObject({ code: 'openfinance_disabled' });
  });

  it('modo local-: connectToken sinaliza simulated=true para a UI', async () => {
    const t = await connectToken('tenant-1');
    expect(t.simulated).toBe(true);
    expect(t.token).toBe('local-connect-token');
  });

  it('sync insere só POSTED (PENDING pulado) e roda a conciliação da empresa', async () => {
    const keys = new Set<string>();
    const result = await syncConnection('tenant-1', 'conn-1', makeDb(keys));

    // Simulação local-: 4 transações, 1 PENDING → 3 entram.
    expect(result.inserted).toBe(3);
    expect(result.duplicate).toBe(0);
    expect(result.skippedPending).toBe(1);
    expect(result.reconciliation).toEqual({ processed: 2, autoConfirmed: 1 });
    expect(runReconciliation).toHaveBeenCalledWith('tenant-1', { companyId: 'company-1' }, expect.anything());
  });

  it('RE-SYNC é idempotente: tudo vira duplicate e a conciliação NÃO roda de novo', async () => {
    const keys = new Set<string>();
    await syncConnection('tenant-1', 'conn-1', makeDb(keys));
    vi.mocked(runReconciliation).mockClear();

    const second = await syncConnection('tenant-1', 'conn-1', makeDb(keys));
    expect(second.inserted).toBe(0);
    expect(second.duplicate).toBe(3);
    expect(runReconciliation).not.toHaveBeenCalled(); // inserted=0 → sem passada extra
  });

  it('conexão desconhecida → connection_not_found', async () => {
    const db = {
      select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })),
    } as any;
    await expect(syncConnection('tenant-1', 'nope', db)).rejects.toMatchObject({ code: 'connection_not_found' });
  });

  it('OpenFinanceError expõe o código como message (contrato das rotas)', () => {
    expect(new OpenFinanceError('openfinance_disabled').message).toBe('openfinance_disabled');
  });
});
