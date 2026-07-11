import { describe, it, expect, vi } from 'vitest';
import { ingestWebhook } from '../services/whatsappWebhookService';
import type { DrizzleDB } from '../services/whatsappWebhookService';

// Idempotência de webhook (reenvio do mesmo evento nunca duplica/processa
// duas vezes) e opt-out via resposta "SAIR" — mesmo padrão de injeção direta
// de `db` mockado já usado em whatsappAccountService.test.ts.

const TENANT_ID = 'tenant-1';

function chain(rows: unknown[]): any {
  const p: any = Promise.resolve(rows);
  p.where = () => chain(rows);
  return p;
}

function makeMockDb(opts: { messageRow?: Record<string, unknown> | null } = {}) {
  const insertedWebhookEvents: Record<string, unknown>[] = [];
  const updatedMessages: Record<string, unknown>[] = [];
  const insertedMessageEvents: Record<string, unknown>[] = [];
  const updatedClients: Record<string, unknown>[] = [];

  const db: any = {
    insert: vi.fn((table: unknown) => ({
      values: (data: Record<string, unknown>) => {
        // Discrimina por conteúdo do valor inserido — não temos acesso direto
        // ao objeto de tabela real aqui, então usamos a forma do payload.
        if ('idempotency_key' in data) {
          insertedWebhookEvents.push(data);
          if (insertedWebhookEvents.filter(e => e.idempotency_key === data.idempotency_key).length > 1) {
            const err: any = new Error('duplicate key value violates unique constraint');
            err.code = '23505';
            throw err;
          }
          return Promise.resolve(undefined);
        }
        insertedMessageEvents.push(data);
        return Promise.resolve(undefined);
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (data: Record<string, unknown>) => ({
        where: () => {
          // Discrimina pelo shape exato do objeto — processStatusCallback
          // sempre manda os 5 campos juntos; o "marca processado" do webhook
          // event manda só {status, processed_at}; o opt-out do cliente manda
          // {whatsapp_opt_in, whatsapp_opt_out_at}.
          if ('whatsapp_opt_in' in data) updatedClients.push(data);
          else if ('sent_at' in data) updatedMessages.push(data);
          return Promise.resolve(undefined);
        },
      }),
    })),
    select: vi.fn(() => ({
      from: () => chain(opts.messageRow ? [opts.messageRow] : []),
    })),
  };
  return { db: db as DrizzleDB, insertedWebhookEvents, updatedMessages, insertedMessageEvents, updatedClients };
}

describe('ingestWebhook — idempotência', () => {
  it('processa um status callback normalmente na primeira vez', async () => {
    const { db, updatedMessages } = makeMockDb({ messageRow: { id: 'msg-1', sent_at: null, delivered_at: null, read_at: null } });

    const result = await ingestWebhook(TENANT_ID, {
      MessageSid: 'SM123', MessageStatus: 'delivered', From: 'whatsapp:+5511999998888',
    }, db);

    expect(result).toEqual({ ok: true });
    expect(updatedMessages[0]).toMatchObject({ status: 'delivered' });
  });

  it('reenvio do mesmo evento (mesmo MessageSid+status) é descartado como duplicado, nunca reprocessado', async () => {
    const { db, updatedMessages } = makeMockDb({ messageRow: { id: 'msg-1', sent_at: null, delivered_at: null, read_at: null } });

    await ingestWebhook(TENANT_ID, { MessageSid: 'SM123', MessageStatus: 'delivered', From: 'whatsapp:+5511999998888' }, db);
    const second = await ingestWebhook(TENANT_ID, { MessageSid: 'SM123', MessageStatus: 'delivered', From: 'whatsapp:+5511999998888' }, db);

    expect(second).toEqual({ ok: true, duplicate: true });
    // Só processou uma vez, mesmo com duas chamadas
    expect(updatedMessages).toHaveLength(1);
  });

  it('status diferente para o mesmo MessageSid conta como evento novo (queued → sent → delivered)', async () => {
    const { db, updatedMessages } = makeMockDb({ messageRow: { id: 'msg-1', sent_at: null, delivered_at: null, read_at: null } });

    await ingestWebhook(TENANT_ID, { MessageSid: 'SM123', MessageStatus: 'sent', From: 'whatsapp:+5511999998888' }, db);
    await ingestWebhook(TENANT_ID, { MessageSid: 'SM123', MessageStatus: 'delivered', From: 'whatsapp:+5511999998888' }, db);

    expect(updatedMessages).toHaveLength(2);
  });

  it('mensagem "SAIR" recebida revoga o opt-in do cliente pelo telefone', async () => {
    const { db, updatedClients } = makeMockDb();

    await ingestWebhook(TENANT_ID, {
      MessageSid: 'SM999', Body: 'SAIR', From: 'whatsapp:+5511999998888', To: 'whatsapp:+5511000001111',
    }, db);

    expect(updatedClients[0]).toMatchObject({ whatsapp_opt_in: false });
  });

  it('mensagem recebida que não é "SAIR" não mexe no consentimento do cliente', async () => {
    const { db, updatedClients } = makeMockDb();

    await ingestWebhook(TENANT_ID, {
      MessageSid: 'SM999', Body: 'Obrigado!', From: 'whatsapp:+5511999998888', To: 'whatsapp:+5511000001111',
    }, db);

    expect(updatedClients).toHaveLength(0);
  });

  it('status callback pra uma mensagem que não existe no tenant é ignorado, nunca lança', async () => {
    const { db } = makeMockDb({ messageRow: null });
    await expect(ingestWebhook(TENANT_ID, {
      MessageSid: 'SM-unknown', MessageStatus: 'delivered', From: 'whatsapp:+5511999998888',
    }, db)).resolves.toEqual({ ok: true });
  });
});
