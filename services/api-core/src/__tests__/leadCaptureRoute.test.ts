// POST /v1/public/leads — contrato HTTP + auth por X-API-Key (mesmo
// mecanismo do Fiscal Engine, ver engineRoutes.test.ts). A lógica de
// dedup/merge já é testada isoladamente em leadCaptureService.test.ts — aqui
// mockamos o service inteiro e verificamos só status codes/gates.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { tenantModules } from '../db/schema';
import { hashApiKey } from '../lib/apiKeyAuth';
import { resetRateLimiter } from '../lib/rateLimiter';

vi.mock('../services/leadCaptureService', () => ({
  findOrCreateLeadClient: vi.fn(),
  LeadCaptureDomainError: class LeadCaptureDomainError extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  },
}));

const SECRET = 'pk_live_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const state: { keyRows: any[]; moduleRows: any[] } = { keyRows: [], moduleRows: [{ enabled: true }] };

function activeKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1', tenant_id: 'tenant-1', name: 'Landing Page X',
    key_prefix: SECRET.slice(0, 12), key_hash: hashApiKey(SECRET),
    scopes: ['leads:create'], key_type: 'publishable', rate_limit_per_min: 10,
    status: 'active', allowed_origins: null,
    ...overrides,
  };
}

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return {
    ...actual,
    db: {
      execute: vi.fn(async () => ({ rows: [] })),
      select: vi.fn(() => ({
        from: (table: unknown) => ({
          where: () => Promise.resolve(table === tenantModules ? state.moduleRows : state.keyRows),
        }),
      })),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
      insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
      transaction: vi.fn(),
    },
  };
});

describe('POST /v1/public/leads', () => {
  let app: FastifyInstance;
  let findOrCreateLeadClient: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    state.keyRows = [activeKeyRow()];
    state.moduleRows = [{ enabled: true }];
    resetRateLimiter();
    findOrCreateLeadClient = (await import('../services/leadCaptureService')).findOrCreateLeadClient as any;
    findOrCreateLeadClient.mockReset();
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  const post = (payload: unknown, key: string | null = SECRET, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST', url: '/v1/public/leads', payload: payload as any,
      headers: { ...(key ? { 'x-api-key': key } : {}), ...headers },
    });

  describe('autenticação por X-API-Key', () => {
    it('401 sem chave', async () => {
      const res = await post({ name: 'Ana' }, null);
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('api_key_missing');
    });

    it('401 com chave revogada', async () => {
      state.keyRows = [activeKeyRow({ status: 'revoked' })];
      const res = await post({ name: 'Ana' });
      expect(res.statusCode).toBe(401);
    });

    it('403 quando a chave não tem o escopo leads:create', async () => {
      state.keyRows = [activeKeyRow({ scopes: ['engine'] })];
      const res = await post({ name: 'Ana' });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('api_key_scope_denied');
    });

    it('403 module_disabled quando o tenant desliga o módulo lead_capture', async () => {
      state.moduleRows = [{ enabled: false }];
      const res = await post({ name: 'Ana' });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('module_disabled');
    });

    it('403 api_key_origin_denied quando a chave restringe origem e o Origin não bate (defesa em profundidade)', async () => {
      state.keyRows = [activeKeyRow({ allowed_origins: ['https://minhalandingpage.com'] })];
      const res = await post({ name: 'Ana' }, SECRET, { origin: 'https://outro-site.com' });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('api_key_origin_denied');
    });

    it('200 quando o Origin bate com o allowlist da chave', async () => {
      state.keyRows = [activeKeyRow({ allowed_origins: ['https://minhalandingpage.com'] })];
      findOrCreateLeadClient.mockResolvedValue({ client: { id: 'client-1' }, created: true });
      const res = await post({ name: 'Ana' }, SECRET, { origin: 'https://minhalandingpage.com/contato' });
      expect(res.statusCode).toBe(201);
    });

    it('429 acima do rate limit da chave', async () => {
      state.keyRows = [activeKeyRow({ rate_limit_per_min: 1 })];
      findOrCreateLeadClient.mockResolvedValue({ client: { id: 'client-1' }, created: true });
      await post({ name: 'Ana' });
      const res = await post({ name: 'Ana' });
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toBe('rate_limit_exceeded');
    });
  });

  describe('captura do lead', () => {
    it('201 quando cria um lead novo', async () => {
      findOrCreateLeadClient.mockResolvedValue({ client: { id: 'client-1' }, created: true });
      const res = await post({ name: 'Ana', email: 'ana@ex.com' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ success: true, data: { id: 'client-1', created: true } });
      expect(findOrCreateLeadClient).toHaveBeenCalledWith('tenant-1', {
        name: 'Ana', email: 'ana@ex.com', phone: undefined,
        company_name: undefined, cnpj: undefined, message: undefined,
      });
    });

    it('200 (não 201) quando o lead já existia e foi mesclado', async () => {
      findOrCreateLeadClient.mockResolvedValue({ client: { id: 'client-1' }, created: false });
      const res = await post({ name: 'Ana', email: 'ana@ex.com' });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.created).toBe(false);
    });

    it('422 quando o domínio rejeita a entrada (ex.: sem e-mail nem telefone)', async () => {
      const { LeadCaptureDomainError } = await import('../services/leadCaptureService');
      findOrCreateLeadClient.mockRejectedValue(new (LeadCaptureDomainError as any)('lead_contact_required'));
      const res = await post({ name: 'Ana' });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('lead_contact_required');
    });

    // tenant_id nunca vem do body — regra 4, só que resolvido por chave em
    // vez de JWT. Mesmo se o body tentar mandar tenant_id, é ignorado.
    it('ignora um tenant_id malicioso no body — tenant vem só da chave', async () => {
      findOrCreateLeadClient.mockResolvedValue({ client: { id: 'client-1' }, created: true });
      await post({ name: 'Ana', email: 'ana@ex.com', tenant_id: 'outro-tenant' });
      expect(findOrCreateLeadClient).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ name: 'Ana' }));
    });
  });
});
