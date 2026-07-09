import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Rotas de Perfis de Acesso são finas — mockamos o service inteiro (já
// testado isoladamente em accessControlService.test.ts) e verificamos só o
// contrato HTTP: status codes, gate requireRole('owner') (diferente de
// requireModule — não consulta banco, só lê request.user.role do JWT),
// mapeamento de erro de domínio.

vi.mock('../services/accessControlService', () => ({
  listProfiles: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(), deleteProfile: vi.fn(),
  listProfilePermissions: vi.fn(), setProfilePermissions: vi.fn(),
  AccessControlDomainError: class AccessControlDomainError extends Error {
    code: string; payload?: Record<string, unknown>;
    constructor(code: string, payload?: Record<string, unknown>) { super(code); this.code = code; this.payload = payload; }
  },
}));

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const PROFILE_ID = '22222222-2222-2222-2222-222222222222';

function ownerToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'owner-1', role: 'owner' });
}
function userToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'user' });
}

describe('rotas de /v1/access-profiles', () => {
  let app: FastifyInstance;
  let svc: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    svc = await import('../services/accessControlService') as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/access-profiles' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /access-profiles é aberto a qualquer usuário autenticado do tenant (não só owner)', async () => {
    svc.listProfiles.mockResolvedValue([{ id: PROFILE_ID, name: 'Financeiro' }]);
    const res = await app.inject({
      method: 'GET', url: '/v1/access-profiles',
      headers: { authorization: `Bearer ${userToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('POST /access-profiles 403 quando o ator não é owner', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/access-profiles',
      headers: { authorization: `Bearer ${userToken(app)}` },
      payload: { name: 'Vendas' },
    });
    expect(res.statusCode).toBe(403);
    expect(svc.createProfile).not.toHaveBeenCalled();
  });

  it('POST /access-profiles 201 quando o ator é owner', async () => {
    svc.createProfile.mockResolvedValue({ id: PROFILE_ID, name: 'Vendas' });
    const res = await app.inject({
      method: 'POST', url: '/v1/access-profiles',
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { name: 'Vendas' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(PROFILE_ID);
  });

  it('PATCH /access-profiles/:id 422 quando o service lança erro de domínio', async () => {
    const { AccessControlDomainError } = await import('../services/accessControlService');
    svc.updateProfile.mockRejectedValue(new (AccessControlDomainError as any)('profile_name_required'));
    const res = await app.inject({
      method: 'PATCH', url: `/v1/access-profiles/${PROFILE_ID}`,
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('profile_name_required');
  });

  it('DELETE /access-profiles/:id 403 pra não-owner', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/v1/access-profiles/${PROFILE_ID}`,
      headers: { authorization: `Bearer ${userToken(app)}` },
    });
    expect(res.statusCode).toBe(403);
    expect(svc.deleteProfile).not.toHaveBeenCalled();
  });

  it('DELETE /access-profiles/:id 204 quando owner e perfil não está em uso', async () => {
    svc.deleteProfile.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'DELETE', url: `/v1/access-profiles/${PROFILE_ID}`,
      headers: { authorization: `Bearer ${ownerToken(app)}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it('DELETE /access-profiles/:id 422 quando o perfil está em uso', async () => {
    const { AccessControlDomainError } = await import('../services/accessControlService');
    svc.deleteProfile.mockRejectedValue(new (AccessControlDomainError as any)('profile_in_use', { usersCount: 3 }));
    const res = await app.inject({
      method: 'DELETE', url: `/v1/access-profiles/${PROFILE_ID}`,
      headers: { authorization: `Bearer ${ownerToken(app)}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'profile_in_use', usersCount: 3 });
  });

  it('PUT /access-profiles/:id/permissions 400 sem grants como array', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/v1/access-profiles/${PROFILE_ID}/permissions`,
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(svc.setProfilePermissions).not.toHaveBeenCalled();
  });

  it('PUT /access-profiles/:id/permissions 200 quando owner envia grants válidos', async () => {
    svc.setProfilePermissions.mockResolvedValue([{ resource: 'clients', action: 'view' }]);
    const res = await app.inject({
      method: 'PUT', url: `/v1/access-profiles/${PROFILE_ID}/permissions`,
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { grants: [{ resource: 'clients', action: 'view' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('GET /access-profiles/catalog devolve os recursos e ações conhecidos', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/access-profiles/catalog',
      headers: { authorization: `Bearer ${userToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.resources).toContain('clients');
    expect(body.actions).toEqual(['view', 'manage']);
  });
});
