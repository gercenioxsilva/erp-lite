import { describe, it, expect, vi } from 'vitest';
import { createReceivableFromInvoice } from '../services/receivableService';
import type { DrizzleDB } from '../services/receivableService';

const TENANT_ID  = 'tenant-1';
const INVOICE_ID = 'invoice-1';
const CLIENT_ID  = 'client-1';

function makeMockDb(opts: { insertShouldConflict?: boolean; existing?: Record<string, unknown> }) {
  const db: any = {
    insert: vi.fn(() => ({
      values: (data: Record<string, unknown>) => ({
        returning: () => {
          if (opts.insertShouldConflict) {
            const err: any = new Error('duplicate key value violates unique constraint "uq_receivables_invoice"');
            err.code = '23505';
            return Promise.reject(err);
          }
          return Promise.resolve([{ id: 'recv-new', ...data }]);
        },
      }),
    })),
    select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([opts.existing]) }) })),
  };
  return db as DrizzleDB;
}

describe('createReceivableFromInvoice', () => {
  it('cria e devolve a conta a receber quando não existe conflito', async () => {
    const db = makeMockDb({});
    const result = await createReceivableFromInvoice({
      tenantId: TENANT_ID, invoiceId: INVOICE_ID, clientId: CLIENT_ID,
      amount: '250.00', description: 'NF-e nº 000123 (série 1)', dueDate: '2026-08-10',
    }, db);

    expect(result).toMatchObject({ id: 'recv-new', tenant_id: TENANT_ID, invoice_id: INVOICE_ID, status: 'pending' });
  });

  it('idempotente: em caso de UNIQUE violation (23505), devolve o recebível já existente em vez de lançar', async () => {
    const existing = { id: 'recv-existing', tenant_id: TENANT_ID, invoice_id: INVOICE_ID, status: 'pending' };
    const db = makeMockDb({ insertShouldConflict: true, existing });

    const result = await createReceivableFromInvoice({
      tenantId: TENANT_ID, invoiceId: INVOICE_ID, clientId: CLIENT_ID,
      amount: '250.00', description: 'NF-e nº 000123 (série 1)', dueDate: '2026-08-10',
    }, db);

    expect(result).toEqual(existing);
  });

  it('propaga erros que não são violação de UNIQUE', async () => {
    const db: any = {
      insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.reject(new Error('connection lost')) }) })),
    };

    await expect(createReceivableFromInvoice({
      tenantId: TENANT_ID, invoiceId: INVOICE_ID, clientId: CLIENT_ID,
      amount: '250.00', description: 'x', dueDate: '2026-08-10',
    }, db as DrizzleDB)).rejects.toThrow('connection lost');
  });
});
