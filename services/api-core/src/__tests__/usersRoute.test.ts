import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Regressão de segurança (RBAC): antes desta entrega, GET /v1/users confiava
// em tenant_id da query string, e PATCH/DELETE não filtravam tenant_id
// nenhum — um usuário de QUALQUER tenant conseguia listar/editar/desativar
// usuários de OUTRO tenant. Estes testes provam que tenant_id vem sempre de
// request.user.tenantId (JWT), nunca de query/param/body, e que o owner
// nunca pode ser desabilitado. Os gates de ação são requirePermission()
// (users:create/edit/delete) — mockados grant-all pelo rbac.setup.ts, como
// em todos os testes de rota; a matriz papel→permissão tem testes próprios.

const mockDb = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), insert: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '99999999-9999-9999-9999-999999999999';
const TARGET_USER_ID = '22222222-2222-2222-2222-222222222222';

function ownerToken(app: FastifyInstance, tenantId = TENANT_A) {
  return app.jwt.sign({ tenantId, userId: 'owner-1', role: 'owner' });
}
function userToken(app: FastifyInstance, tenantId = TENANT_A) {
  return app.jwt.sign({ tenantId, userId: 'user-1', role: 'user' });
}

function chain(rows: unknown[]): any {
  const p: any = Promise.resolve(rows);
  p.orderBy = () => chain(rows);
  p.limit   = () => chain(rows);
  p.offset  = () => chain(rows);
  return p;
}

// As expressões WHERE do Drizzle (eq/and) têm uma referência circular de
// volta pra PgTable — JSON.stringify puro estoura. Este replacer troca ciclos
// já visitados por um marcador, preservando os valores primitivos (incluindo
// os UUIDs de tenant_id) que realmente nos interessam pra asserção.
function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  });
}

/** Fila de resultados por chamada de db.select(), na ordem em que a rota as
 * dispara — captura também a expressão WHERE de cada chamada (select E
 * update), pra provar qual tenant_id foi realmente usado na query. */
function setupDb(selectQueue: unknown[][], updateResult: { rowCount?: number } = { rowCount: 1 }) {
  const whereExprs: unknown[] = [];
  const insertedValues: Record<string, unknown>[] = [];
  mockDb.select.mockImplementation(() => ({
    from: () => ({
      where: (expr: unknown) => { whereExprs.push(expr); return chain(selectQueue.length ? selectQueue.shift()! : []); },
    }),
  }));
  mockDb.update.mockImplementation(() => ({
    set: () => ({
      where: (expr: unknown) => {
        whereExprs.push(expr);
        const p: any = Promise.resolve(updateResult);
        p.returning = () => Promise.resolve([{ id: TARGET_USER_ID, email: 'x@ex.com', name: 'X', role: 'user', status: 'active' }]);
        return p;
      },
    }),
  }));
  mockDb.insert.mockImplementation(() => ({
    values: (data: Record<string, unknown>) => {
      insertedValues.push(data);
      return { returning: () => Promise.resolve([{ id: 'new-user-1', ...data }]) };
    },
  }));
  return { whereExprs, insertedValues };
}

describe('GET /v1/users — isolamento multi-tenant', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('usa sempre o tenant_id do JWT, ignorando um tenant_id malicioso na query string', async () => {
    const { whereExprs } = setupDb([[{ id: 'u1', name: 'Fulano' }], [{ count: 1 }]]);

    const res = await app.inject({
      method: 'GET', url: `/v1/users?tenant_id=${TENANT_B}`,
      headers: { authorization: `Bearer ${userToken(app, TENANT_A)}` },
    });

    expect(res.statusCode).toBe(200);
    const whereJson = safeStringify(whereExprs);
    expect(whereJson).toContain(TENANT_A);
    expect(whereJson).not.toContain(TENANT_B);
  });
});

describe('POST /v1/users — tenant sempre do JWT, papel validado', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('403 quando um ator não-owner tenta atribuir o papel owner', async () => {
    setupDb([[{ id: 'role-owner' }]]); // isAssignableRole encontra o papel
    const res = await app.inject({
      method: 'POST', url: '/v1/users',
      headers: { authorization: `Bearer ${userToken(app)}` },
      payload: { email: 'novo@ex.com', password: 'senha1234', role: 'owner' },
    });
    expect(res.statusCode).toBe(403);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('201 e o novo usuário nasce sempre com tenant_id do JWT — tenant_id do body é IGNORADO', async () => {
    const { insertedValues } = setupDb([[{ id: 'role-user' }]]);
    const res = await app.inject({
      method: 'POST', url: '/v1/users',
      headers: { authorization: `Bearer ${ownerToken(app, TENANT_A)}` },
      payload: { email: 'novo@ex.com', password: 'senha1234', role: 'user', tenant_id: TENANT_B },
    });
    expect(res.statusCode).toBe(201);
    expect(insertedValues[0]).toMatchObject({ tenant_id: TENANT_A, role: 'user' });
  });

  it('400 quando o papel não existe (nem sistema, nem custom do tenant)', async () => {
    setupDb([[]]); // isAssignableRole não encontra nada
    const res = await app.inject({
      method: 'POST', url: '/v1/users',
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { email: 'novo@ex.com', password: 'senha1234', role: 'papel-fantasma' },
    });
    expect(res.statusCode).toBe(400);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe('PATCH /v1/users/:id — isolamento multi-tenant + proteção do owner', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('404 quando o usuário-alvo pertence a OUTRO tenant (nunca vaza edição cross-tenant)', async () => {
    // A busca por (id, tenant_id=TENANT_A) não encontra nada porque o usuário
    // de fato pertence ao TENANT_B — simula exatamente o cenário do bug antigo.
    setupDb([[]]);
    const res = await app.inject({
      method: 'PATCH', url: `/v1/users/${TARGET_USER_ID}`,
      headers: { authorization: `Bearer ${ownerToken(app, TENANT_A)}` },
      payload: { name: 'Nome adulterado' },
    });
    expect(res.statusCode).toBe(404);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('200 e usa o tenant_id do JWT na query de lookup e de update', async () => {
    const { whereExprs } = setupDb([
      [{ id: TARGET_USER_ID, role: 'user' }],
      [{ id: TARGET_USER_ID, email: 'x@ex.com', name: 'Novo nome', role: 'user', status: 'active', access_profile_id: null }],
    ]);
    const res = await app.inject({
      method: 'PATCH', url: `/v1/users/${TARGET_USER_ID}`,
      headers: { authorization: `Bearer ${ownerToken(app, TENANT_A)}` },
      payload: { name: 'Novo nome' },
    });
    expect(res.statusCode).toBe(200);
    const whereJson = safeStringify(whereExprs);
    expect(whereJson).toContain(TENANT_A);
  });

  it('422 ao tentar desabilitar o owner', async () => {
    setupDb([[{ id: TARGET_USER_ID, role: 'owner' }]]);
    const res = await app.inject({
      method: 'PATCH', url: `/v1/users/${TARGET_USER_ID}`,
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { status: 'disabled' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('cannot_disable_owner');
  });

  it('400 ao tentar trocar para um papel que não existe no tenant', async () => {
    setupDb([
      [{ id: TARGET_USER_ID, role: 'user' }], // lookup do alvo
      [],                                     // isAssignableRole: papel não existe
    ]);
    const res = await app.inject({
      method: 'PATCH', url: `/v1/users/${TARGET_USER_ID}`,
      headers: { authorization: `Bearer ${ownerToken(app)}` },
      payload: { role: 'papel-fantasma' },
    });
    expect(res.statusCode).toBe(400);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /v1/users/:id — isolamento multi-tenant + proteção do owner', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('404 quando o usuário-alvo pertence a outro tenant', async () => {
    setupDb([[]]);
    const res = await app.inject({
      method: 'DELETE', url: `/v1/users/${TARGET_USER_ID}`,
      headers: { authorization: `Bearer ${ownerToken(app, TENANT_A)}` },
    });
    expect(res.statusCode).toBe(404);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('422 ao tentar desabilitar o próprio owner', async () => {
    setupDb([[{ id: TARGET_USER_ID, role: 'owner' }]]);
    const res = await app.inject({
      method: 'DELETE', url: `/v1/users/${TARGET_USER_ID}`,
      headers: { authorization: `Bearer ${ownerToken(app)}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('cannot_disable_owner');
  });

  it('204 e usa tenant_id do JWT na query de update', async () => {
    const { whereExprs } = setupDb([[{ id: TARGET_USER_ID, role: 'user' }]]);
    const res = await app.inject({
      method: 'DELETE', url: `/v1/users/${TARGET_USER_ID}`,
      headers: { authorization: `Bearer ${ownerToken(app, TENANT_A)}` },
    });
    expect(res.statusCode).toBe(204);
    const whereJson = safeStringify(whereExprs);
    expect(whereJson).toContain(TENANT_A);
  });
});
