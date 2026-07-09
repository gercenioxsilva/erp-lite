import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FastifyRequest, FastifyReply } from 'fastify';

const mockDb = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

import { tenantActivationGuard } from '../middleware/tenantActivationGuard';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function makeRequest(url: string, user?: Record<string, unknown>): FastifyRequest {
  return { url, user, log: { warn: vi.fn() } } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply & { _code?: number; _body?: unknown } {
  const reply: any = {};
  reply.code = vi.fn((c: number) => { reply._code = c; return reply; });
  reply.send = vi.fn((b: unknown) => { reply._body = b; return reply; });
  return reply;
}

describe('tenantActivationGuard', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['/health', '/v1/auth/login', '/v1/auth/verify-email', '/v1/subscription/checkout-session', '/v1/public/proposals/abc'])(
    'bypassa o prefixo excluído %s sem consultar o banco (mesma allowlist do subscriptionGuard)',
    async (url) => {
      const request = makeRequest(url, { tenantId: TENANT_ID });
      const reply = makeReply();

      await tenantActivationGuard(request, reply);

      expect(mockDb.execute).not.toHaveBeenCalled();
      expect(reply.code).not.toHaveBeenCalled();
    },
  );

  it('libera requests não autenticadas (tratadas em outro lugar)', async () => {
    const request = makeRequest('/v1/orders', undefined);
    const reply = makeReply();

    await tenantActivationGuard(request, reply);

    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('libera quando o tenant não é encontrado (não é responsabilidade deste guard)', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });
    const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
    const reply = makeReply();

    await tenantActivationGuard(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('403 EmailNotVerified quando activated_at é null (tenant novo, ainda não confirmou o e-mail)', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ activated_at: null }] });
    const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
    const reply = makeReply();

    await tenantActivationGuard(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'EmailNotVerified' }));
  });

  it('libera quando activated_at está preenchido (tenant já ativado normalmente)', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ activated_at: '2026-01-01T00:00:00.000Z' }] });
    const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
    const reply = makeReply();

    await tenantActivationGuard(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('fail-open: erro de infraestrutura na própria query nunca vira 500 (não é o mecanismo de isolamento multi-tenant)', async () => {
    mockDb.execute.mockRejectedValue(new Error('connection terminated'));
    const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
    const reply = makeReply();

    await expect(tenantActivationGuard(request, reply)).resolves.toBeUndefined();
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('ambiguidade: linha sem a chave activated_at (mock genérico reaproveitado de outra query) nunca é tratada como bloqueio', async () => {
    // No Postgres real, uma coluna timestamptz NULL sempre vira `null`, nunca
    // `undefined` — a chave sempre existe. `undefined` só surge aqui quando o
    // mock de teste de OUTRA rota devolve uma linha de formato diferente
    // (ex.: uma linha de seller/cost-center/purchase-order, sem essa coluna)
    // pro mesmo `db.execute` genérico. Nesse caso, o guard nunca bloqueia.
    mockDb.execute.mockResolvedValue({ rows: [{ id: 'cc-1', code: '001', name: 'Obra A' }] });
    const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
    const reply = makeReply();

    await tenantActivationGuard(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('regressão: tenant existente antes desta feature (backfill activated_at=created_at) nunca fica bloqueado', async () => {
    // Simula exatamente o resultado do backfill da migration 0061 — qualquer
    // timestamp não-nulo, mesmo muito antigo, libera o acesso normalmente.
    mockDb.execute.mockResolvedValue({ rows: [{ activated_at: '2020-01-01T00:00:00.000Z' }] });
    const request = makeRequest('/v1/clients', { tenantId: TENANT_ID });
    const reply = makeReply();

    await tenantActivationGuard(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });
});
