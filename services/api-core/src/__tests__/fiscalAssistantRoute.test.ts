// POST /v1/fiscal/assistant — contrato HTTP. O ponto crítico é a tradução de
// erro do provider: o SDK da Anthropic lança APIError carregando o status
// upstream (401 em key inválida/revogada), e o Fastify respeita err.statusCode.
// Repassar esse 401 é perigoso — o api.ts do backoffice faz auto-logout em
// QUALQUER 401 com token, então uma key mal configurada expulsaria o usuário do
// ERP inteiro ao perguntar algo ao assistente.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { buildApp } from '../app';

vi.mock('../services/fiscalAssistantService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/fiscalAssistantService');
  return { ...actual, runAssistant: vi.fn() };
});

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const selectOnce = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
const TENANT_ID = '11111111-1111-1111-1111-111111111111';

describe('POST /v1/fiscal/assistant', () => {
  let app: FastifyInstance;
  let runAssistant: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectOnce([{ enabled: true }]));
    runAssistant = (await import('../services/fiscalAssistantService')).runAssistant as any;
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  const ask = () => app.inject({
    method: 'POST',
    url: '/v1/fiscal/assistant',
    headers: { authorization: `Bearer ${app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'owner' })}` },
    payload: { message: 'Quanto vou pagar de DAS este mês?' },
  });

  it('key inválida (401 da Anthropic) NÃO vaza como 401 — vira 502', async () => {
    runAssistant.mockRejectedValue(
      new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', new Headers()),
    );

    const res = await ask();

    // 401 deslogaria o usuário; 403 também tem semântica de auth no client.
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'assistant_upstream_error' });
  });

  it('erro do provider não vaza a mensagem crua nem o request_id da Anthropic', async () => {
    // Corpo real que a Anthropic devolve em key inválida — o SDK compõe a
    // message a partir dele, então é assim que o texto vaza pro cliente.
    runAssistant.mockRejectedValue(
      new Anthropic.AuthenticationError(
        401,
        { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' }, request_id: 'req_011Cd5XJ' },
        undefined,
        new Headers(),
      ),
    );

    const res = await ask();

    expect(res.body).not.toContain('x-api-key');
    expect(res.body).not.toContain('req_011Cd5XJ');
  });

  it('rate limit da Anthropic (429 upstream) também vira 502 — não é o cap local', async () => {
    // O 429 do contrato é o cap diário do tenant (assistant_daily_cap). Um 429
    // vindo da Anthropic é falha de infra e não deve se disfarçar de cap.
    runAssistant.mockRejectedValue(
      new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers()),
    );

    const res = await ask();

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'assistant_upstream_error' });
  });
});
