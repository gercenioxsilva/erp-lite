// Fundação do módulo Fiscal (0068): utils canônicos (money/pgErrors) e o
// fiscalAuditService (sanitização de segredo + idempotência 23505). Sem I/O —
// db mockado, mesmo estilo de googleCalendarSync.test.ts.

import { describe, it, expect, vi } from 'vitest';
import { round2, toNumber, toDecimalString } from '../lib/money';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import { record, sanitizePayload } from '../services/fiscalAuditService';

describe('lib/money', () => {
  it('round2 arredonda para centavos', () => {
    expect(round2(10.005)).toBe(10.01);
    expect(round2(10.004)).toBe(10.0);
    expect(round2(-1.005)).toBe(-1); // Math.round(-100.5) = -100
  });

  it('toNumber converte DECIMAL string e trata null/vazio como 0', () => {
    expect(toNumber('1234.50')).toBe(1234.5);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('')).toBe(0);
    expect(toNumber('abc')).toBe(0);
  });

  it('toDecimalString formata com 2 casas', () => {
    expect(toDecimalString(10)).toBe('10.00');
    expect(toDecimalString(10.005)).toBe('10.01');
  });
});

describe('lib/pgErrors', () => {
  it('detecta código 23505', () => {
    const err = Object.assign(new Error('x'), { code: '23505' });
    expect(isUniqueConstraintViolation(err)).toBe(true);
  });

  it('detecta pela mensagem (unique/duplicate)', () => {
    expect(isUniqueConstraintViolation(new Error('duplicate key value violates unique constraint'))).toBe(true);
  });

  it('não classifica erro comum como violação', () => {
    expect(isUniqueConstraintViolation(new Error('connection refused'))).toBe(false);
    expect(isUniqueConstraintViolation('not-an-error')).toBe(false);
  });
});

describe('fiscalAuditService.sanitizePayload', () => {
  it('mascara chaves sensíveis recursivamente sem mutar o original', () => {
    const original = {
      cnpj: '11222333000181',
      credentials: { pfx_base64: 'AAAA', senha: '1234' },
      nested: { focus_token_producao: 'tok', ok: 'fica' },
    };
    const out = sanitizePayload(original) as Record<string, any>;
    expect(out.cnpj).toBe('11222333000181');
    expect(out.credentials).toBe('****');           // chave 'credentials' inteira mascarada
    expect(out.nested.focus_token_producao).toBe('****');
    expect(out.nested.ok).toBe('fica');
    expect(original.credentials.senha).toBe('1234'); // imutável
  });

  it('trunca profundidade excessiva em vez de estourar', () => {
    let deep: any = { v: 1 };
    for (let i = 0; i < 10; i++) deep = { child: deep };
    const out = sanitizePayload(deep) as Record<string, any>;
    expect(JSON.stringify(out)).toContain('[truncated]');
  });
});

describe('fiscalAuditService.record', () => {
  const makeDb = (impl: () => Promise<any[]>) => {
    const values = vi.fn((v: any) => ({ returning: () => impl() }));
    return { db: { insert: vi.fn(() => ({ values })) } as any, values };
  };

  it('insere e devolve o evento com payloads sanitizados', async () => {
    const row = { id: 'e1' };
    const { db, values } = makeDb(async () => [row]);
    const res = await record({
      tenantId: 't1', aggregateType: 'nfse', eventType: 'emission_failed',
      requestPayload: { senha: 'x', valor: 10 }, attempt: 2, idempotencyKey: 'nfse:1:2',
    }, db);
    expect(res).toEqual({ duplicate: false, event: row });
    const persisted = values.mock.calls[0][0];
    expect(persisted.request_payload.senha).toBe('****');
    expect(persisted.request_payload.valor).toBe(10);
    expect(persisted.actor_user_id).toBeNull(); // omitido = sistema
  });

  it('23505 vira duplicate:true (idempotência), sem relançar', async () => {
    const { db } = makeDb(async () => { throw Object.assign(new Error('dup'), { code: '23505' }); });
    const res = await record({ tenantId: 't1', aggregateType: 'nfse', eventType: 'x', idempotencyKey: 'k' }, db);
    expect(res).toEqual({ duplicate: true, event: null });
  });

  it('erro real é relançado', async () => {
    const { db } = makeDb(async () => { throw new Error('connection refused'); });
    await expect(record({ tenantId: 't1', aggregateType: 'nfse', eventType: 'x' }, db)).rejects.toThrow('connection refused');
  });
});
