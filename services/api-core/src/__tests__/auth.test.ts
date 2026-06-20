import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import jwt from '@fastify/jwt';

// Mock db before importing routes
vi.mock('../db/index', () => ({
  db: {
    select:      vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    insert:      vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })) })),
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
  sql: vi.fn((strings: any) => ({ strings })),
}));

import { authRoutes } from '../routes/auth';

describe('Auth Routes — schema validation', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(sensible);
    await app.register(jwt, { secret: 'test-secret' });
    app.decorate('authenticate', async () => {});
    await app.register(authRoutes, { prefix: '/v1' });
    await app.ready();
  });

  afterAll(() => app.close());

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
});
