import { describe, it, expect, vi } from 'vitest';
import { upsertWhatsAppAccount, resolveConnectedAccount, testWhatsAppConnection } from '../services/whatsappAccountService';
import { WhatsAppDomainError } from '../domain/whatsapp/whatsappDomain';
import type { DrizzleDB } from '../services/whatsappAccountService';

vi.mock('../services/whatsappConnectionClient', () => ({
  testarConexaoProvider: vi.fn(),
}));

// Mesmo padrão de bankAccountService.test.ts: injeção direta de `db` mockado
// via último parâmetro, sem vi.mock('../db'). Prova o merge de credenciais
// (string vazia numa chave nunca apaga o que já estava gravado) e a
// validação de elegibilidade pra envio.

const TENANT_ID = 'tenant-1';

function chain(rows: unknown[]): any {
  const p: any = Promise.resolve(rows);
  p.where = () => chain(rows);
  return p;
}

function makeMockDb(existingRow: Record<string, unknown> | null) {
  const updatedValues: Record<string, unknown>[] = [];
  const insertedValues: Record<string, unknown>[] = [];
  const db: any = {
    select: vi.fn(() => ({ from: () => chain(existingRow ? [existingRow] : []) })),
    update: vi.fn(() => ({
      set: (data: Record<string, unknown>) => {
        updatedValues.push(data);
        return { where: () => ({ returning: () => Promise.resolve([{ ...existingRow, ...data }]) }) };
      },
    })),
    insert: vi.fn(() => ({
      values: (data: Record<string, unknown>) => {
        insertedValues.push(data);
        return { returning: () => Promise.resolve([{ id: 'account-1', ...data }]) };
      },
    })),
  };
  return { db: db as DrizzleDB, updatedValues, insertedValues };
}

describe('upsertWhatsAppAccount — merge de credenciais', () => {
  it('cria a conta quando nenhuma existe ainda, com credenciais completas', async () => {
    const { db, insertedValues } = makeMockDb(null);

    const account = await upsertWhatsAppAccount(TENANT_ID, {
      whatsapp_number: '+5511999998888',
      credentials: { account_sid: 'AC123', auth_token: 'tok123' },
    }, db);

    expect(account.status).toBe('connected');
    expect(insertedValues[0]).toMatchObject({
      tenant_id: TENANT_ID, status: 'connected',
      credentials: { account_sid: 'AC123', auth_token: 'tok123' },
    });
  });

  it('rejeita a criação quando as credenciais estão incompletas', async () => {
    const { db } = makeMockDb(null);
    await expect(upsertWhatsAppAccount(TENANT_ID, {
      credentials: { account_sid: 'AC123' },
    }, db)).rejects.toBeInstanceOf(WhatsAppDomainError);
  });

  it('atualização parcial (só trocar o número) preserva as credenciais já gravadas', async () => {
    const { db, updatedValues } = makeMockDb({
      id: 'account-1', tenant_id: TENANT_ID, provider: 'twilio', status: 'connected',
      whatsapp_number: '+5511999998888', display_name: null,
      credentials: { account_sid: 'AC-old', auth_token: 'tok-old' },
    });

    await upsertWhatsAppAccount(TENANT_ID, { whatsapp_number: '+5511988887777' }, db);

    expect(updatedValues[0].credentials).toEqual({ account_sid: 'AC-old', auth_token: 'tok-old' });
    expect(updatedValues[0].whatsapp_number).toBe('+5511988887777');
  });

  it('string vazia numa chave de credential nunca apaga o valor já gravado (mascaramento)', async () => {
    const { db, updatedValues } = makeMockDb({
      id: 'account-1', tenant_id: TENANT_ID, provider: 'twilio', status: 'connected',
      whatsapp_number: '+5511999998888', display_name: null,
      credentials: { account_sid: 'AC-old', auth_token: 'tok-old' },
    });

    // Frontend reenviando o formulário com auth_token em branco (valor
    // mascarado na leitura, usuário não editou) — só account_sid muda.
    await upsertWhatsAppAccount(TENANT_ID, {
      credentials: { account_sid: 'AC-new', auth_token: '' },
    }, db);

    expect(updatedValues[0].credentials).toEqual({ account_sid: 'AC-new', auth_token: 'tok-old' });
  });
});

describe('resolveConnectedAccount', () => {
  it('devolve a conta quando conectada', async () => {
    const { db } = makeMockDb({ id: 'account-1', tenant_id: TENANT_ID, status: 'connected' });
    const account = await resolveConnectedAccount(TENANT_ID, db);
    expect(account.status).toBe('connected');
  });

  it('lança quando não existe conta nenhuma', async () => {
    const { db } = makeMockDb(null);
    await expect(resolveConnectedAccount(TENANT_ID, db)).rejects.toBeInstanceOf(WhatsAppDomainError);
  });

  it('lança quando a conta existe mas está desconectada', async () => {
    const { db } = makeMockDb({ id: 'account-1', tenant_id: TENANT_ID, status: 'disconnected' });
    await expect(resolveConnectedAccount(TENANT_ID, db)).rejects.toBeInstanceOf(WhatsAppDomainError);
  });
});

describe('testWhatsAppConnection', () => {
  it('lança account_not_connected quando não existe conta cadastrada ainda', async () => {
    const { db } = makeMockDb(null);
    await expect(testWhatsAppConnection(TENANT_ID, db)).rejects.toBeInstanceOf(WhatsAppDomainError);
  });

  it('delega ao cliente do provedor com o provider e as credenciais salvas', async () => {
    const { db } = makeMockDb({
      id: 'account-1', tenant_id: TENANT_ID, provider: 'twilio', status: 'connected',
      credentials: { account_sid: 'AC123', auth_token: 'tok123' },
    });
    const { testarConexaoProvider } = await import('../services/whatsappConnectionClient');
    (testarConexaoProvider as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const result = await testWhatsAppConnection(TENANT_ID, db);

    expect(testarConexaoProvider).toHaveBeenCalledWith('twilio', { account_sid: 'AC123', auth_token: 'tok123' });
    expect(result).toEqual({ ok: true });
  });
});
