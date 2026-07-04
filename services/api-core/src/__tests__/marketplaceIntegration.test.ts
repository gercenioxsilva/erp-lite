import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { signState } from '../domain/marketplace/marketplaceDomain';

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const COMPANY_ID = '22222222-2222-2222-2222-222222222222';
const STATE_SECRET = 'test-marketplace-state-secret';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function selectOnce(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(rows) };
}

describe('GET /v1/integrations/mercadolivre/connections', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 401 without a Bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/integrations/mercadolivre/connections' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('lists connections without requiring the module (read-only, never gated)', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([
      { id: 'conn-1', company_id: COMPANY_ID, status: 'connected', access_token: 'abcdef123456', refresh_token: 'xyz789000111' },
    ]));

    const res = await app.inject({
      method: 'GET', url: '/v1/integrations/mercadolivre/connections',
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].access_token).toBe('****3456');
  });
});

describe('GET /v1/integrations/mercadolivre/connect', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.MARKETPLACE_STATE_SECRET = STATE_SECRET;
    process.env.MERCADOLIVRE_CLIENT_ID = 'app-123';
    process.env.MERCADOLIVRE_CLIENT_SECRET = 'client-secret';
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.MARKETPLACE_STATE_SECRET;
    delete process.env.MERCADOLIVRE_CLIENT_ID;
    delete process.env.MERCADOLIVRE_CLIENT_SECRET;
  });

  it('returns 403 when the mercadolivre module is disabled', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([])); // isModuleEnabled → false

    const res = await app.inject({
      method: 'GET', url: `/v1/integrations/mercadolivre/connect?company_id=${COMPANY_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when company_id does not belong to the tenant', async () => {
    mockDb.select
      .mockReturnValueOnce(selectOnce([{ enabled: true }])) // isModuleEnabled
      .mockReturnValueOnce(selectOnce([])); // resolveCompanyId não encontra

    const res = await app.inject({
      method: 'GET', url: `/v1/integrations/mercadolivre/connect?company_id=${COMPANY_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns a signed authorization_url when module enabled and company valid', async () => {
    mockDb.select
      .mockReturnValueOnce(selectOnce([{ enabled: true }]))
      .mockReturnValueOnce(selectOnce([{ id: COMPANY_ID, tenant_id: TENANT_ID, is_active: true }]));

    const res = await app.inject({
      method: 'GET', url: `/v1/integrations/mercadolivre/connect?company_id=${COMPANY_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const url = new URL(res.json().authorization_url);
    expect(url.searchParams.get('client_id')).toBe('app-123');
    expect(url.searchParams.get('state')).toBeTruthy();
  });
});

describe('GET /v1/public/integrations/mercadolivre/callback', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.MARKETPLACE_STATE_SECRET = STATE_SECRET;
    process.env.MERCADOLIVRE_CLIENT_ID = 'app-123';
    process.env.MERCADOLIVRE_CLIENT_SECRET = 'client-secret';
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
    delete process.env.MARKETPLACE_STATE_SECRET;
    delete process.env.MERCADOLIVRE_CLIENT_ID;
    delete process.env.MERCADOLIVRE_CLIENT_SECRET;
  });

  it('redirects with ml_status=error when state is tampered (never trusts an unsigned company_id)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/public/integrations/mercadolivre/callback?code=abc&state=forged.sig',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('ml_status=error');
    expect(res.headers.location).toContain('invalid_state');
  });

  it('redirects with ml_status=connected on a valid state + successful token exchange', async () => {
    const state = signState(COMPANY_ID, STATE_SECRET);
    mockDb.select.mockReturnValueOnce(selectOnce([{ id: COMPANY_ID, tenant_id: TENANT_ID, is_active: true }]));
    mockDb.select.mockReturnValueOnce(selectOnce([])); // sem conexão existente ainda
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'conn-1', status: 'connected' }]) }),
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok', refresh_token: 'ref', expires_in: 21600, user_id: 999 }),
    }));

    const res = await app.inject({
      method: 'GET', url: `/v1/public/integrations/mercadolivre/callback?code=abc&state=${encodeURIComponent(state)}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('ml_status=connected');
  });
});

describe('GET /v1/integrations/mercadolivre/status', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('returns connected:false when there is no connection yet', async () => {
    mockDb.select
      .mockReturnValueOnce(selectOnce([{ enabled: true }]))
      .mockReturnValueOnce(selectOnce([{ id: COMPANY_ID, tenant_id: TENANT_ID, is_active: true }]))
      .mockReturnValueOnce(selectOnce([]));

    const res = await app.inject({
      method: 'GET', url: `/v1/integrations/mercadolivre/status?company_id=${COMPANY_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().connected).toBe(false);
  });

  it('masks the access_token in the status response', async () => {
    mockDb.select
      .mockReturnValueOnce(selectOnce([{ enabled: true }]))
      .mockReturnValueOnce(selectOnce([{ id: COMPANY_ID, tenant_id: TENANT_ID, is_active: true }]))
      .mockReturnValueOnce(selectOnce([{ status: 'connected', nickname: 'Loja X', ml_user_id: '999', connected_at: new Date(), access_token: 'abcdef123456' }]));

    const res = await app.inject({
      method: 'GET', url: `/v1/integrations/mercadolivre/status?company_id=${COMPANY_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().access_token).toBe('****3456');
  });
});
