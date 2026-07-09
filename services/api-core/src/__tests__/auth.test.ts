import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import jwt from '@fastify/jwt';

// Mock db before importing routes
vi.mock('../db/index', () => ({
  db: {
    select:      vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    insert:      vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })) })),
    update:      vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
    execute:     vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn(async (cb: any) => cb({
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: 'tenant-1' }]) })) })),
    })),
  },
  tenants: { id: 'id' },
  users:   { id: 'id', email: 'email', name: 'name', role: 'role', password_hash: 'password_hash',
             status: 'status', tenant_id: 'tenant_id' },
}));

vi.mock('drizzle-orm', () => ({
  eq:  vi.fn((a: any, b: any) => ({ col: a, val: b })),
  and: vi.fn((...args: any[]) => ({ and: args })),
  sql: vi.fn((strings: any) => ({ strings })),
}));

vi.mock('../lib/notificationsClient', () => ({
  sendSystemNotification: vi.fn().mockResolvedValue(undefined),
}));

import { authRoutes } from '../routes/auth';
import { db } from '../db/index';
import { sendSystemNotification } from '../lib/notificationsClient';

// Ativação de conta por e-mail: request.user normalmente vem do plugin real
// de JWT (fora do escopo deste arquivo, que testa só o contrato HTTP das
// rotas). Pra exercitar /auth/resend-verification (autenticado), o stub de
// authenticate aqui passa a ler dois headers de teste — nunca usado fora de
// teste, o app real (app.ts) sempre usa o decorator de JWT de verdade.
function testUserHeaders(userId: string, tenantId: string) {
  return { 'x-test-user-id': userId, 'x-test-tenant-id': tenantId };
}

describe('Auth Routes — schema validation', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(sensible);
    await app.register(jwt, { secret: 'test-secret' });
    app.decorate('authenticate', async (request: any) => {
      const userId   = request.headers['x-test-user-id'];
      const tenantId = request.headers['x-test-tenant-id'];
      if (userId) request.user = { userId, tenantId };
    });
    await app.register(authRoutes, { prefix: '/v1' });
    await app.ready();
  });

  afterAll(() => app.close());

  beforeEach(() => vi.clearAllMocks());

  describe('POST /v1/auth/login', () => {
    it('returns 400 when email format is invalid', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/login',
        payload: { email: 'not-an-email', password: 'password123' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is missing required fields', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/login',
        payload: { email: 'user@test.com' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 401 when user not found', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/login',
        payload: { email: 'notfound@test.com', password: 'password123' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /v1/auth/register', () => {
    it('returns 400 when company_name is missing', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/register',
        payload: { tax_id: '00000000000000', email: 'owner@test.com', password: 'password123' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when tax_id is missing', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/register',
        payload: { company_name: 'Test Corp', email: 'owner@test.com', password: 'password123' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when password is too short', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/register',
        payload: { company_name: 'Test Corp', tax_id: '00000000000000', email: 'owner@test.com', password: 'short' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /v1/auth/forgot-password', () => {
    it('returns 400 when email is missing', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/forgot-password',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 { ok: true } when email not found (never reveals existence)', async () => {
      // db.execute returns { rows: [] } by default (user not found)
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/forgot-password',
        payload: { email: 'notfound@example.com' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });

  describe('POST /v1/auth/reset-password', () => {
    it('returns 400 when body is empty', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/reset-password',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when token is missing', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/reset-password',
        payload: { password: 'newpassword123' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when password is too short (< 6 chars)', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/reset-password',
        payload: { token: 'sometoken', password: 'abc' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when token is invalid or expired', async () => {
      // db.execute still returns { rows: [] } — no matching token
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/reset-password',
        payload: { token: 'invalidtoken', password: 'newpassword123' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // Ativação de conta por e-mail — register agora gera um token de
  // verificação (48h) na MESMA transação e dispara o e-mail correspondente.
  describe('POST /v1/auth/register — ativação de e-mail', () => {
    it('201: gera token de verificação e dispara tenant_email_verification', async () => {
      const updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
      vi.mocked(db.transaction).mockImplementationOnce(async (cb: any) => cb({
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([
              { id: 'tenant-1', email: 'owner@test.com', name: 'Owner', role: 'owner' },
            ]),
          })),
        })),
        update: vi.fn(() => ({ set: updateSet })),
      }));

      const res = await app.inject({
        method: 'POST', url: '/v1/auth/register',
        payload: { company_name: 'Test Corp', tax_id: '00000000000000', email: 'owner@test.com', password: 'password123' },
      });

      expect(res.statusCode).toBe(201);
      expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ email_verification_token: expect.any(String) }));
      expect(sendSystemNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'tenant_email_verification', recipient: expect.objectContaining({ email: 'owner@test.com' }) }),
      );
    });
  });

  describe('POST /v1/auth/verify-email', () => {
    it('returns 400 when token is missing', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/auth/verify-email', payload: {} });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when token is invalid or expired (nunca 500)', async () => {
      vi.mocked(db.select).mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([]) }) } as any);
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/verify-email', payload: { token: 'ghost' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 { ok: true } and activates the tenant on a valid token', async () => {
      const userRow = {
        id: 'user-1', tenant_id: 'tenant-1', email: 'owner@test.com', name: 'Owner',
        email_verification_token: 'tok123', email_verification_expires: new Date(Date.now() + 60_000),
      };
      vi.mocked(db.select).mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([userRow]) }) } as any);
      vi.mocked(db.transaction).mockImplementationOnce(async (cb: any) => cb({
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: 'tenant-1' }]) })),
          })),
        })),
      }));

      const res = await app.inject({
        method: 'POST', url: '/v1/auth/verify-email', payload: { token: 'tok123' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });

  describe('POST /v1/auth/resend-verification (autenticado)', () => {
    it('returns 404 user_not_found when the authenticated user cannot be found in the tenant', async () => {
      vi.mocked(db.select).mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([]) }) } as any);
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/resend-verification',
        headers: testUserHeaders('user-1', 'tenant-1'),
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 429 resend_cooldown_active inside the 60s cooldown window', async () => {
      const recentExpires = new Date(Date.now() + 48 * 60 * 60 * 1000 - 5_000); // emitido ~5s atrás
      const userRow = { id: 'user-1', tenant_id: 'tenant-1', email: 'owner@test.com', name: 'Owner', email_verification_expires: recentExpires };
      vi.mocked(db.select).mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([userRow]) }) } as any);
      const res = await app.inject({
        method: 'POST', url: '/v1/auth/resend-verification',
        headers: testUserHeaders('user-1', 'tenant-1'),
      });
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toBe('resend_cooldown_active');
    });

    it('returns 200 and re-sends the verification e-mail outside the cooldown window', async () => {
      const oldExpires = new Date(Date.now() - 47 * 60 * 60 * 1000 + 5_000); // emitido ~1h atrás
      const userRow = { id: 'user-1', tenant_id: 'tenant-1', email: 'owner@test.com', name: 'Owner', email_verification_expires: oldExpires };
      vi.mocked(db.select).mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([userRow]) }) } as any);
      vi.mocked(db.update).mockReturnValueOnce({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) } as any);

      const res = await app.inject({
        method: 'POST', url: '/v1/auth/resend-verification',
        headers: testUserHeaders('user-1', 'tenant-1'),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(sendSystemNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'tenant_email_verification' }));
    });
  });
});
