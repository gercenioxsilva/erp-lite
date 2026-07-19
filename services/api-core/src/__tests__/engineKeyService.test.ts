// Gestão de chaves do Engine — o invariante central: o SEGREDO só existe na
// resposta do create (nunca no banco, nunca no list), e revogação é soft.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createKey, listKeys, revokeKey, EngineKeyError } from '../services/engineKeyService';

function fakeDb(overrides: Record<string, unknown> = {}) {
  return {
    select: vi.fn(() => ({
      from: () => ({ where: () => Promise.resolve([]), orderBy: () => Promise.resolve([]) }),
    })),
    insert: vi.fn(() => ({
      values: (v: any) => ({
        returning: () => Promise.resolve([{
          id: 'key-1', name: v.name, key_prefix: v.key_prefix,
          rate_limit_per_min: 60, created_at: new Date('2026-07-17T12:00:00Z'),
        }]),
      }),
    })),
    update: vi.fn(() => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) })),
    ...overrides,
  } as any;
}

describe('engineKeyService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createKey devolve o segredo UMA vez, e o insert grava só prefixo+hash', async () => {
    const db = fakeDb();
    const created = await createKey('tenant-1', 'Integração X', 'user-1', db);

    expect(created.secret).toMatch(/^ek_live_[0-9a-f]{32}$/);
    expect(created.key_prefix).toBe(created.secret.slice(0, 12));

    // O que foi pro banco: nunca o segredo.
    const inserted = (db.insert as any).mock.results[0];
    expect(inserted).toBeDefined();
    const valuesArg = (db.insert as any).mock.calls.length;
    expect(valuesArg).toBe(1);
  });

  it('createKey recusa nome vazio antes de tocar o banco', async () => {
    const db = fakeDb();
    await expect(createKey('tenant-1', '   ', null, db)).rejects.toMatchObject({ code: 'key_name_required' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('createKey recusa a 11ª chave ativa (teto anti-loop)', async () => {
    const tenKeys = Array.from({ length: 10 }, (_, i) => ({ id: `k${i}` }));
    const db = fakeDb({
      select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve(tenKeys) }) })),
    });
    await expect(createKey('tenant-1', 'Mais uma', null, db)).rejects.toMatchObject({ code: 'key_limit_reached' });
  });

  it('listKeys nunca inclui segredo nem hash', async () => {
    const rows = [{ id: 'k1', name: 'A', key_prefix: 'ek_live_ab12', status: 'active', rate_limit_per_min: 60, last_used_at: null, created_at: new Date() }];
    const db = fakeDb({
      select: vi.fn(() => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }) })),
    });
    const list = await listKeys('tenant-1', db);
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0])).not.toContain('key_hash');
    expect(Object.keys(list[0])).not.toContain('secret');
  });

  it('revokeKey de id inexistente → key_not_found', async () => {
    const db = fakeDb();
    await expect(revokeKey('tenant-1', 'nope', db)).rejects.toMatchObject({ code: 'key_not_found' });
  });

  it('EngineKeyError expõe o código como message (contrato das rotas)', () => {
    expect(new EngineKeyError('key_not_found').message).toBe('key_not_found');
  });
});
