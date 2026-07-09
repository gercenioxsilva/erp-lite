import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Teste de ponta a ponta do RBAC — sem mock de service/domínio (só o banco é
// mockado): sobe o Fastify real e percorre a jornada completa via HTTP —
// owner cria perfil, concede permissão, cria usuário com esse perfil, o
// próprio usuário consulta suas permissões efetivas (GET /v1/auth/permissions)
// e usa uma rota real gated por requirePermission() — e prova que um usuário
// sem perfil é bloqueado na mesma rota, e que owner nunca é bloqueável.
// "E2E" aqui é via app.inject() (mesmo padrão já usado em todo o projeto,
// sem Playwright/Cypress — decisão confirmada com o usuário).

const mockDb = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const PROFILE_ID = '22222222-2222-2222-2222-222222222222';
const NEW_USER_ID = '33333333-3333-3333-3333-333333333333';

function ownerToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'owner-1', role: 'owner' });
}
function userToken(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId, role: 'user' });
}

function chain(rows: unknown[]): any {
  const p: any = Promise.resolve(rows);
  p.orderBy = () => chain(rows);
  return p;
}

function valuesChain(returningRows: unknown[] = []) {
  const p: any = Promise.resolve(undefined);
  p.returning = () => Promise.resolve(returningRows);
  return p;
}

/** Fila de resultados por chamada de db.select(), na ordem em que o request
 * dispara — cada teste conhece a sequência exata (mesmo padrão dos outros
 * testes de rota desta sessão), já que estamos exercitando o código real de
 * accessControlService.ts/tenantModuleService.ts, não um mock deles. */
function setupDb(selectQueue: unknown[][]) {
  mockDb.transaction.mockImplementation(async (cb: any) => cb(mockDb));
  mockDb.select.mockImplementation(() => ({
    from: () => ({ where: () => chain(selectQueue.length ? selectQueue.shift()! : []) }),
  }));
  mockDb.insert.mockImplementation((_table: unknown) => ({
    values: (data: unknown) => valuesChain(Array.isArray(data) ? data.map((d, i) => ({ id: `new-${i}`, ...d })) : [{ id: 'new-1', ...(data as object) }]),
  }));
  mockDb.update.mockImplementation(() => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }));
  mockDb.delete.mockImplementation(() => ({ where: () => Promise.resolve(undefined) }));
}

describe('RBAC — jornada completa via HTTP', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('owner cria perfil, concede company:manage, cria usuário com o perfil, e o usuário enxerga a permissão em GET /v1/auth/permissions', async () => {
    // 1) POST /v1/access-profiles — createProfile: 2 inserts (profile + event), 0 selects.
    setupDb([]);
    const createRes = await app.inject({
      method: 'POST', url: '/v1/access-profiles',
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { name: 'Administrativo', description: 'Gerencia módulos' },
    });
    expect(createRes.statusCode).toBe(201);

    // 2) PUT /v1/access-profiles/:id/permissions — setProfilePermissions:
    //    1 select (getProfileOrThrow) + delete + 2 inserts (grants + event).
    setupDb([[{ id: PROFILE_ID, tenant_id: TENANT_ID, name: 'Administrativo' }]]);
    const grantRes = await app.inject({
      method: 'PUT', url: `/v1/access-profiles/${PROFILE_ID}/permissions`,
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { grants: [{ resource: 'company', action: 'manage' }] },
    });
    expect(grantRes.statusCode).toBe(200);

    // 3) POST /v1/users — 1 insert direto, sem select.
    setupDb([]);
    const userRes = await app.inject({
      method: 'POST', url: '/v1/users',
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { email: 'novo@ex.com', password: 'senha1234', access_profile_id: PROFILE_ID },
    });
    expect(userRes.statusCode).toBe(201);

    // 4) GET /v1/auth/permissions, como o usuário recém-criado —
    //    getEffectivePermissions: 1 select (role+profile) + 1 select (grants).
    setupDb([
      [{ role: 'user', access_profile_id: PROFILE_ID }],
      [{ resource: 'company', action: 'manage' }],
    ]);
    const permsRes = await app.inject({
      method: 'GET', url: '/v1/auth/permissions',
      headers: { authorization: `Bearer ${userToken(app, NEW_USER_ID)}` },
    });
    expect(permsRes.statusCode).toBe(200);
    const perms = permsRes.json().permissions;
    expect(perms.company).toEqual({ view: true, manage: true });
    expect(perms.clients).toEqual({ view: false, manage: false });
  });

  it('usuário com company:manage consegue alternar um módulo (rota real gated por requirePermission)', async () => {
    // requirePermission: 1 select (role+profile) + 1 select (grants) → can=true.
    // setModuleEnabled: 1 select (existing=none) + 1 insert.
    setupDb([
      [{ role: 'user', access_profile_id: PROFILE_ID }],
      [{ resource: 'company', action: 'manage' }],
      [],
    ]);
    const res = await app.inject({
      method: 'PATCH', url: '/v1/tenant/modules/pos',
      headers: { authorization: `Bearer ${userToken(app, NEW_USER_ID)}` },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it('usuário sem perfil atribuído é bloqueado (403) na mesma rota', async () => {
    // getEffectivePermissions retorna cedo (access_profile_id null) — só 1 select.
    setupDb([[{ role: 'user', access_profile_id: null }]]);
    const res = await app.inject({
      method: 'PATCH', url: '/v1/tenant/modules/pos',
      headers: { authorization: `Bearer ${userToken(app, 'no-profile-user')}` },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('PermissionDenied');
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('owner sempre pode alternar módulo, mesmo sem nenhum perfil atribuído (bypass nunca depende de grants)', async () => {
    // getEffectivePermissions: 1 select (role=owner) → bypass, sem 2ª query.
    // setModuleEnabled: 1 select (existing=none) + 1 insert.
    setupDb([[{ role: 'owner', access_profile_id: null }], []]);
    const res = await app.inject({
      method: 'PATCH', url: '/v1/tenant/modules/pos',
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
  });
});
