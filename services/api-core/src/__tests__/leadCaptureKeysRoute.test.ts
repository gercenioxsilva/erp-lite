// Rotas internas (JWT) de autogestão de chaves de Captação de Leads —
// mesma trava de bank_accounts:manage/engine:manage (owner/admin). O
// service (createKey/listKeys/revokeKey/usageSummary) já é testado
// isoladamente em engineKeyService.test.ts — aqui mockamos o service
// inteiro e verificamos gates (módulo, RBAC) + contrato HTTP + que este
// escopo (leads:create) nunca vaza pro escopo do Engine e vice-versa.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { tenantModules } from '../db/schema';

vi.mock('../services/engineKeyService', () => ({
  createKey: vi.fn(),
  listKeys: vi.fn(),
  revokeKey: vi.fn(),
  usageSummary: vi.fn(),
  EngineKeyError: class EngineKeyError extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  },
}));

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const state: { moduleRows: any[] } = { moduleRows: [{ enabled: true }] };

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({
        from: (table: unknown) => ({
          where: () => Promise.resolve(table === tenantModules ? state.moduleRows : []),
        }),
      })),
    },
  };
});

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('rotas de gestão de chaves de Captação de Leads', () => {
  let app: FastifyInstance;
  let createKey: ReturnType<typeof vi.fn>;
  let listKeys: ReturnType<typeof vi.fn>;
  let revokeKey: ReturnType<typeof vi.fn>;
  let usageSummary: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    state.moduleRows = [{ enabled: true }];
    const svc = await import('../services/engineKeyService');
    createKey = svc.createKey as any;
    listKeys = svc.listKeys as any;
    revokeKey = svc.revokeKey as any;
    usageSummary = svc.usageSummary as any;
    createKey.mockReset(); listKeys.mockReset(); revokeKey.mockReset(); usageSummary.mockReset();
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('401 sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/lead-capture-keys' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('403 module_disabled quando o tenant desliga o módulo lead_capture', async () => {
    state.moduleRows = [{ enabled: false }];
    const res = await app.inject({
      method: 'GET', url: '/v1/lead-capture-keys',
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('ModuleNotEnabled');
  });

  describe('POST /v1/lead-capture-keys', () => {
    it('201 cria a chave sempre como publishable, escopo fixo leads:create', async () => {
      createKey.mockResolvedValue({
        id: 'key-1', name: 'Landing Page X', secret: 'pk_live_xxx',
        key_prefix: 'pk_live_xxx1', rate_limit_per_min: 10, created_at: new Date(),
      });

      const res = await app.inject({
        method: 'POST', url: '/v1/lead-capture-keys',
        headers: { authorization: `Bearer ${token(app)}` },
        payload: { name: 'Landing Page X' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.secret).toBe('pk_live_xxx');
      expect(createKey).toHaveBeenCalledWith(TENANT_ID, 'Landing Page X', 'user-1', undefined, {
        scopes: ['leads:create'], keyType: 'publishable',
        rateLimitPerMin: 10, allowedOrigins: null,
      });
    });

    it('repassa allowed_origins quando informado (restrição de origem opcional)', async () => {
      createKey.mockResolvedValue({
        id: 'key-1', name: 'X', secret: 'pk_live_xxx', key_prefix: 'pk_live_xxx1',
        rate_limit_per_min: 10, created_at: new Date(),
      });

      await app.inject({
        method: 'POST', url: '/v1/lead-capture-keys',
        headers: { authorization: `Bearer ${token(app)}` },
        payload: { name: 'X', allowed_origins: ['https://minhalandingpage.com'] },
      });

      expect(createKey).toHaveBeenCalledWith(TENANT_ID, 'X', 'user-1', undefined, expect.objectContaining({
        allowedOrigins: ['https://minhalandingpage.com'],
      }));
    });

    it('422 key_name_required quando o service rejeita', async () => {
      const { EngineKeyError } = await import('../services/engineKeyService');
      createKey.mockRejectedValue(new (EngineKeyError as any)('key_name_required'));

      const res = await app.inject({
        method: 'POST', url: '/v1/lead-capture-keys',
        headers: { authorization: `Bearer ${token(app)}` }, payload: {},
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('key_name_required');
    });
  });

  it('GET /v1/lead-capture-keys filtra pelo escopo leads:create — nunca mistura com chaves do Engine', async () => {
    listKeys.mockResolvedValue([{ id: 'key-1', key_type: 'publishable', scopes: ['leads:create'] }]);

    const res = await app.inject({
      method: 'GET', url: '/v1/lead-capture-keys',
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(listKeys).toHaveBeenCalledWith(TENANT_ID, undefined, 'leads:create');
  });

  describe('DELETE /v1/lead-capture-keys/:id', () => {
    it('200 revoga passando o mesmo scopeFilter — não revoga chave de outro escopo', async () => {
      revokeKey.mockResolvedValue({ id: 'key-1', status: 'revoked' });

      const res = await app.inject({
        method: 'DELETE', url: '/v1/lead-capture-keys/key-1',
        headers: { authorization: `Bearer ${token(app)}` },
      });

      expect(res.statusCode).toBe(200);
      expect(revokeKey).toHaveBeenCalledWith(TENANT_ID, 'key-1', undefined, 'leads:create');
    });

    it('404 key_not_found quando a chave é de outro escopo ou não existe', async () => {
      const { EngineKeyError } = await import('../services/engineKeyService');
      revokeKey.mockRejectedValue(new (EngineKeyError as any)('key_not_found'));

      const res = await app.inject({
        method: 'DELETE', url: '/v1/lead-capture-keys/engine-key-1',
        headers: { authorization: `Bearer ${token(app)}` },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('key_not_found');
    });
  });

  it('GET /v1/lead-capture-keys/usage clampa days entre 1 e 90', async () => {
    usageSummary.mockResolvedValue([{ dia: '2026-07-01', endpoint: '/v1/public/leads', total: 3 }]);

    const res = await app.inject({
      method: 'GET', url: '/v1/lead-capture-keys/usage?days=9999',
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(usageSummary).toHaveBeenCalledWith(TENANT_ID, 90);
  });
});
