import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type * as PermSvc from '../rbac/permissionService';
import { ALL_PERMISSION_KEYS } from '../rbac/permissions';

// '../db' é mockado só para não abrir conexão real no import — o serviço aceita
// um `db` injetável, então passamos um fake nos testes.
vi.mock('../db', () => ({ db: {}, roles: { t: 'roles' }, rolePermissions: { t: 'rp' } }));

// O setup global (rbac.setup.ts) mocka o permissionService; aqui testamos a
// implementação REAL, carregada via importActual (em beforeAll p/ evitar
// top-level await, que o tsc do projeto não aceita).
let getPermissionsForUser: typeof PermSvc.getPermissionsForUser;
let invalidatePermissionCache: typeof PermSvc.invalidatePermissionCache;

beforeAll(async () => {
  const real = await vi.importActual<typeof PermSvc>('../rbac/permissionService');
  getPermissionsForUser = real.getPermissionsForUser;
  invalidatePermissionCache = real.invalidatePermissionCache;
});

// Fake db: resolveFromDb faz, em ordem, um select de roles e depois um de
// role_permissions. Entregamos as linhas por uma fila e contamos os selects.
function makeDb(sequence: unknown[][]) {
  const state = { selects: 0 };
  const db = {
    select: () => {
      const rows = sequence[state.selects] ?? [];
      state.selects++;
      return { from: () => ({ where: () => Promise.resolve(rows) }) };
    },
  };
  return { db, state };
}

beforeEach(() => invalidatePermissionCache());

describe('getPermissionsForUser', () => {
  it('owner recebe todas as permissões sem tocar no banco', async () => {
    const throwing = { select: () => { throw new Error('não deveria consultar o banco'); } };
    const perms = await getPermissionsForUser('t1', 'owner', throwing as any);
    expect(perms.size).toBe(ALL_PERMISSION_KEYS.length);
    expect(perms.has('roles:manage')).toBe(true);
  });

  it('resolve permissões de um papel a partir do banco', async () => {
    const { db } = makeDb([
      [{ id: 'r1', tenant_id: null }],                              // roles
      [{ permission_key: 'clients:view' }, { permission_key: 'clients:create' }], // role_permissions
    ]);
    const perms = await getPermissionsForUser('t1', 'manager', db as any);
    expect([...perms].sort()).toEqual(['clients:create', 'clients:view']);
  });

  it('papel inexistente → conjunto vazio (nega tudo)', async () => {
    const { db } = makeDb([[]]);
    const perms = await getPermissionsForUser('t1', 'ghost', db as any);
    expect(perms.size).toBe(0);
  });

  it('cacheia por (tenant, role) e reconsulta após invalidar', async () => {
    const { db, state } = makeDb([
      [{ id: 'r1', tenant_id: null }], [{ permission_key: 'clients:view' }],
    ]);
    await getPermissionsForUser('t1', 'manager', db as any);
    const afterFirst = state.selects;               // 2 (roles + perms)
    await getPermissionsForUser('t1', 'manager', db as any);
    expect(state.selects).toBe(afterFirst);          // cache hit → sem novos selects

    invalidatePermissionCache('t1');
    await getPermissionsForUser('t1', 'manager', db as any);
    expect(state.selects).toBeGreaterThan(afterFirst); // voltou a consultar
  });
});
