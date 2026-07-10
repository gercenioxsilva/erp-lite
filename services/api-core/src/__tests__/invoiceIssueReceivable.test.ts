import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// POST /v1/invoices/:id/issue (caminho legado) — refatorado pra usar
// createReceivableFromInvoice, o mesmo serviço idempotente que
// nfeResultsWorker.ts usa na autorização real via SEFAZ (regra 60). Prova
// que o contrato HTTP não mudou (mesmo shape de resposta) e que a conta a
// receber continua sendo criada.

const mockDb = vi.hoisted(() => ({
  select: vi.fn(), execute: vi.fn(), transaction: vi.fn(),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const INVOICE_ID = '22222222-2222-2222-2222-222222222222';
const CLIENT_ID  = '33333333-3333-3333-3333-333333333333';

describe('POST /v1/invoices/:id/issue', () => {
  let app: FastifyInstance;
  let token: string;
  let insertedReceivable: Record<string, unknown> | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    insertedReceivable = undefined;

    mockDb.select.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([{
          id: INVOICE_ID, tenant_id: TENANT_ID, client_id: CLIENT_ID,
          serie: '1', status: 'draft', total: '850.00',
        }]),
      }),
    });
    mockDb.execute.mockResolvedValue({ rows: [{ n: '1' }] });
    mockDb.transaction.mockImplementation(async (fn: any) => {
      const tx = {
        update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve(undefined) }) })),
        insert: vi.fn(() => ({
          values: (data: Record<string, unknown>) => {
            insertedReceivable = data;
            return { returning: () => Promise.resolve([{ id: 'recv-1', ...data }]) };
          },
        })),
      };
      return fn(tx as any);
    });

    app = await buildApp();
    token = app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
  });

  afterEach(async () => { await app.close(); });

  it('continua criando a conta a receber (mesmo contrato de resposta de antes do refactor)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/issue`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: 'issued' });
    expect(insertedReceivable).toMatchObject({
      tenant_id: TENANT_ID, invoice_id: INVOICE_ID, client_id: CLIENT_ID,
      amount: '850.00', status: 'pending',
    });
  });
});
