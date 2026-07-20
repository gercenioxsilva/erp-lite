// Regra 61/74: regime tributário do cliente travado no cadastro, nunca mais
// perguntado na tela de nota. Cobre só o campo novo (tax_regime) nas rotas
// de clients — mesmo padrão de mock de bankAccounts.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID = '22222222-2222-2222-2222-222222222222';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function selectOnce(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(rows) };
}

describe('POST /v1/clients — tax_regime', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('aceita e persiste tax_regime informado', async () => {
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: CLIENT_ID, person_type: 'PJ', company_name: 'Acme',
          tax_regime: 'simples_nacional',
        }]),
      }),
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/clients',
      headers: { authorization: `Bearer ${token(app)}` },
      payload: {
        tenant_id: TENANT_ID, person_type: 'PJ', company_name: 'Acme',
        tax_regime: 'simples_nacional',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().tax_regime).toBe('simples_nacional');
    const insertedValues = mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.tax_regime).toBe('simples_nacional');
  });

  it('grava null quando tax_regime não é informado — nunca adivinha', async () => {
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: CLIENT_ID, person_type: 'PJ', company_name: 'Acme', tax_regime: null }]),
      }),
    });

    await app.inject({
      method: 'POST', url: '/v1/clients',
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { tenant_id: TENANT_ID, person_type: 'PJ', company_name: 'Acme' },
    });

    const insertedValues = mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.tax_regime).toBeNull();
  });

  it('400 quando tax_regime não é um dos 4 valores aceitos', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/clients',
      headers: { authorization: `Bearer ${token(app)}` },
      payload: {
        tenant_id: TENANT_ID, person_type: 'PJ', company_name: 'Acme',
        tax_regime: 'não-existe',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /v1/clients/:id — tax_regime', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('atualiza tax_regime de um cliente existente', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([{ id: CLIENT_ID }]));
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: CLIENT_ID, tax_regime: 'mei' }]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/clients/${CLIENT_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { tax_regime: 'mei' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tax_regime).toBe('mei');
    const setArg = mockDb.update.mock.results[0].value.set.mock.calls[0][0];
    expect(setArg.tax_regime).toBe('mei');
  });
});
