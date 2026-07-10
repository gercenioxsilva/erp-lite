import { describe, it, expect, vi } from 'vitest';
import { updateBankAccount } from '../services/bankAccountService';
import type { DrizzleDB } from '../services/bankAccountService';

// Achado do usuário ao testar com credenciais reais de C6: o formulário
// sempre manda os 4 campos de credencial no PATCH, mesmo os que o usuário não
// tocou (client_secret/cert/key ficam em branco quando o valor é mascarado na
// leitura — nunca reenviados como se fossem novos). Sem um merge explícito,
// um PATCH "só trocar o certificado" apagaria client_secret/key existentes
// (o service fazia um replace ingênuo do jsonb inteiro). Estes testes provam
// o merge: string vazia numa chave específica de `credentials` nunca apaga o
// que já estava gravado naquela chave.

const TENANT_ID  = 'tenant-1';
const ACCOUNT_ID = 'account-1';

function chain(rows: unknown[]): any {
  const p: any = Promise.resolve(rows);
  p.where = () => chain(rows);
  return p;
}

function makeMockDb(currentRow: Record<string, unknown>) {
  const updatedValues: Record<string, unknown>[] = [];
  const db: any = {
    select: vi.fn(() => ({ from: () => chain([currentRow]) })),
    update: vi.fn(() => ({
      set: (data: Record<string, unknown>) => {
        updatedValues.push(data);
        return { where: () => ({ returning: () => Promise.resolve([{ ...currentRow, ...data }]) }) };
      },
    })),
  };
  return { db: db as DrizzleDB, updatedValues };
}

function baseC6Row(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID, tenant_id: TENANT_ID, company_id: 'company-1', is_active: true,
    bank_code: '336', agency: '1234', account: '16102', account_digit: '5',
    billing_provider: 'c6', billing_days_to_expire: 30,
    credentials: { client_id: 'old-id', client_secret: 'old-secret', cert: 'OLD-CERT', key: 'OLD-KEY' },
    ...overrides,
  };
}

describe('updateBankAccount — merge de credenciais', () => {
  it('troca só o certificado sem apagar client_secret/key existentes (campos vazios preservam)', async () => {
    const { db, updatedValues } = makeMockDb(baseC6Row());

    await updateBankAccount(TENANT_ID, ACCOUNT_ID, {
      bank_code: '336', agency: '1234', account: '16102', account_digit: '5', billing_provider: 'c6',
      credentials: { client_id: '', client_secret: '', cert: 'NEW-CERT', key: '' },
    }, db);

    expect(updatedValues[0].credentials).toEqual({
      client_id: 'old-id', client_secret: 'old-secret', cert: 'NEW-CERT', key: 'OLD-KEY',
    });
  });

  it('não envia credentials nenhum (campo omitido) preserva o objeto inteiro como estava', async () => {
    const { db, updatedValues } = makeMockDb(baseC6Row());

    await updateBankAccount(TENANT_ID, ACCOUNT_ID, {
      bank_code: '336', agency: '1234', account: '16102', account_digit: '5', billing_provider: 'c6',
      billing_days_to_expire: 45, // só isso mudou
    }, db);

    expect(updatedValues[0].credentials).toEqual({
      client_id: 'old-id', client_secret: 'old-secret', cert: 'OLD-CERT', key: 'OLD-KEY',
    });
  });

  it('um valor não-vazio realmente sobrescreve a chave correspondente', async () => {
    const { db, updatedValues } = makeMockDb(baseC6Row());

    await updateBankAccount(TENANT_ID, ACCOUNT_ID, {
      bank_code: '336', agency: '1234', account: '16102', account_digit: '5', billing_provider: 'c6',
      credentials: { client_id: 'old-id', client_secret: 'brand-new-secret', cert: '', key: '' },
    }, db);

    const credentials = updatedValues[0].credentials as Record<string, string>;
    expect(credentials.client_secret).toBe('brand-new-secret');
    expect(credentials.cert).toBe('OLD-CERT');
    expect(credentials.key).toBe('OLD-KEY');
  });
});
