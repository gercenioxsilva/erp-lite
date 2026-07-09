import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listProfiles, createProfile, updateProfile, deleteProfile, setProfilePermissions,
  assignUserProfile, getEffectivePermissions,
} from '../services/accessControlService';
import type { DrizzleDB } from '../services/accessControlService';

// accessControlService.ts orquestra o RBAC: seed idempotente de perfis
// padrão, replace-all de grants + auditoria, atribuição de perfil bloqueando
// owner/technician como alvo, e resolução de permissões efetivas — tudo com
// assertActorIsOwner() como segunda camada de defesa (a rota já teria
// bloqueado um não-owner via requireRole, mas o serviço nunca confia só nisso).

const TENANT_ID  = 'tenant-1';
const PROFILE_ID = 'profile-1';
const USER_ID    = 'user-1';

function valuesChain(returningRows: unknown[] = []) {
  const p: any = Promise.resolve(undefined);
  p.returning = () => Promise.resolve(returningRows);
  return p;
}

function baseProfileRow(overrides: Record<string, unknown> = {}) {
  return { id: PROFILE_ID, tenant_id: TENANT_ID, name: 'Financeiro', description: null, is_system: false, ...overrides };
}

function makeMockDb(opts: {
  profilesRows?: Record<string, unknown>[];
  profileRow?: Record<string, unknown> | null;
  usersCount?: number;
  targetUserRow?: Record<string, unknown> | null;
  effectiveUserRow?: Record<string, unknown> | null;
  grantsRows?: Record<string, unknown>[];
}) {
  const insertedProfiles: Record<string, unknown>[] = [];
  const insertedPermissions: Record<string, unknown>[] = [];
  const insertedEvents: Record<string, unknown>[] = [];
  const updatedRows: Record<string, unknown>[] = [];
  const deletedTables: string[] = [];

  const selectQueue: unknown[][] = [];
  if (opts.profilesRows !== undefined) selectQueue.push(opts.profilesRows);
  if (opts.profileRow !== undefined) selectQueue.push(opts.profileRow ? [opts.profileRow] : []);
  if (opts.usersCount !== undefined) selectQueue.push([{ count: opts.usersCount }]);
  if (opts.targetUserRow !== undefined) selectQueue.push(opts.targetUserRow ? [opts.targetUserRow] : []);
  if (opts.effectiveUserRow !== undefined) selectQueue.push(opts.effectiveUserRow ? [opts.effectiveUserRow] : []);
  if (opts.grantsRows !== undefined) selectQueue.push(opts.grantsRows);

  const db: any = {
    transaction: async (cb: any) => cb(db),
    select: vi.fn(() => {
      const rows = selectQueue.length ? selectQueue.shift()! : [];
      return { from: () => ({ where: () => Promise.resolve(rows) }) };
    }),
    insert: vi.fn((_table: unknown) => ({
      values: (data: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(data) ? data : [data];
        for (const row of rows) {
          if ('type' in row) { insertedEvents.push(row); continue; }
          if ('resource' in row && 'action' in row) { insertedPermissions.push(row); continue; }
          insertedProfiles.push(row);
        }
        const returningRow = Array.isArray(data)
          ? rows.map(r => ({ id: 'new-1', ...r }))
          : [{ id: 'new-1', ...data }];
        return valuesChain(returningRow);
      },
    })),
    update: vi.fn(() => ({
      set: (data: Record<string, unknown>) => {
        updatedRows.push(data);
        return { where: () => ({ returning: () => Promise.resolve([{ ...baseProfileRow(), ...data }]) }) };
      },
    })),
    delete: vi.fn((table: unknown) => {
      deletedTables.push(String(table));
      return { where: () => Promise.resolve(undefined) };
    }),
  };

  return { db: db as DrizzleDB, insertedProfiles, insertedPermissions, insertedEvents, updatedRows, deletedTables };
}

describe('listProfiles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve os perfis existentes sem semear nada', async () => {
    const { db, insertedProfiles } = makeMockDb({ profilesRows: [baseProfileRow()] });
    const profiles = await listProfiles(TENANT_ID, db);
    expect(profiles).toHaveLength(1);
    expect(insertedProfiles).toHaveLength(0);
  });

  it('semeia os 3 perfis padrão na primeira leitura de um tenant sem nenhum (idempotente)', async () => {
    const { db, insertedProfiles } = makeMockDb({ profilesRows: [] });
    const profiles = await listProfiles(TENANT_ID, db);
    expect(profiles).toHaveLength(3);
    expect(insertedProfiles).toHaveLength(3);
  });
});

describe('createProfile / updateProfile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cria um perfil quando o ator é owner', async () => {
    const { db, insertedEvents } = makeMockDb({});
    const profile = await createProfile({ tenantId: TENANT_ID, actorRole: 'owner', name: 'Vendas' }, db);
    expect(profile).toMatchObject({ name: 'Vendas' });
    expect(insertedEvents[0]).toMatchObject({ type: 'created' });
  });

  it('bloqueia criar perfil quando o ator não é owner', async () => {
    const { db } = makeMockDb({});
    await expect(createProfile({ tenantId: TENANT_ID, actorRole: 'user', name: 'Vendas' }, db))
      .rejects.toMatchObject({ code: 'actor_not_owner' });
  });

  it('bloqueia nome vazio', async () => {
    const { db } = makeMockDb({});
    await expect(createProfile({ tenantId: TENANT_ID, actorRole: 'owner', name: '  ' }, db))
      .rejects.toMatchObject({ code: 'profile_name_required' });
  });

  it('atualizar loga renamed só quando o nome muda', async () => {
    const { db, insertedEvents } = makeMockDb({ profileRow: baseProfileRow() });
    await updateProfile(PROFILE_ID, TENANT_ID, { actorRole: 'owner', name: 'Financeiro 2' }, db);
    expect(insertedEvents[0]).toMatchObject({ type: 'renamed' });
  });

  it('bloqueia atualizar perfil inexistente', async () => {
    const { db } = makeMockDb({ profileRow: null });
    await expect(updateProfile('ghost', TENANT_ID, { actorRole: 'owner' }, db))
      .rejects.toMatchObject({ code: 'profile_not_found' });
  });
});

describe('deleteProfile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exclui um perfil sem usuários vinculados', async () => {
    const { db, deletedTables, insertedEvents } = makeMockDb({ profileRow: baseProfileRow(), usersCount: 0 });
    await deleteProfile(PROFILE_ID, TENANT_ID, 'owner', 'actor-1', db);
    expect(deletedTables.length).toBeGreaterThan(0);
    expect(insertedEvents[0]).toMatchObject({ type: 'deleted' });
  });

  it('bloqueia excluir perfil com usuários vinculados', async () => {
    const { db } = makeMockDb({ profileRow: baseProfileRow(), usersCount: 2 });
    await expect(deleteProfile(PROFILE_ID, TENANT_ID, 'owner', 'actor-1', db))
      .rejects.toMatchObject({ code: 'profile_in_use', payload: { usersCount: 2 } });
  });

  it('bloqueia quando o ator não é owner, antes mesmo de olhar o perfil', async () => {
    const { db } = makeMockDb({});
    await expect(deleteProfile(PROFILE_ID, TENANT_ID, 'user', 'actor-1', db))
      .rejects.toMatchObject({ code: 'actor_not_owner' });
  });
});

describe('setProfilePermissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('substitui todos os grants (replace-all) e loga a auditoria', async () => {
    const { db, insertedPermissions, insertedEvents, deletedTables } = makeMockDb({ profileRow: baseProfileRow() });
    const grants = [{ resource: 'clients', action: 'view' as const }, { resource: 'clients', action: 'manage' as const }];
    const result = await setProfilePermissions(PROFILE_ID, TENANT_ID, grants, 'owner', 'actor-1', db);

    expect(deletedTables.length).toBeGreaterThan(0);
    expect(insertedPermissions).toHaveLength(2);
    expect(insertedEvents[0]).toMatchObject({ type: 'permissions_changed' });
    expect(result).toHaveLength(2);
  });

  it('filtra silenciosamente recursos/ações desconhecidos', async () => {
    const { db, insertedPermissions } = makeMockDb({ profileRow: baseProfileRow() });
    const grants = [
      { resource: 'clients', action: 'view' as const },
      { resource: 'nao_existe', action: 'view' as any },
      { resource: 'clients', action: 'delete' as any },
    ];
    await setProfilePermissions(PROFILE_ID, TENANT_ID, grants, 'owner', 'actor-1', db);
    expect(insertedPermissions).toHaveLength(1);
  });

  it('bloqueia quando o ator não é owner', async () => {
    const { db } = makeMockDb({});
    await expect(setProfilePermissions(PROFILE_ID, TENANT_ID, [], 'user', 'actor-1', db))
      .rejects.toMatchObject({ code: 'actor_not_owner' });
  });
});

describe('assignUserProfile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('atribui um perfil a um usuário comum', async () => {
    const { db, updatedRows, insertedEvents } = makeMockDb({
      targetUserRow: { id: USER_ID, role: 'user' }, profileRow: baseProfileRow(),
    });
    await assignUserProfile(USER_ID, TENANT_ID, PROFILE_ID, 'owner', 'actor-1', db);
    expect(updatedRows[0]).toMatchObject({ access_profile_id: PROFILE_ID });
    expect(insertedEvents[0]).toMatchObject({ type: 'user_assigned' });
  });

  it('bloqueia atribuir perfil a um usuário owner', async () => {
    const { db } = makeMockDb({ targetUserRow: { id: USER_ID, role: 'owner' } });
    await expect(assignUserProfile(USER_ID, TENANT_ID, PROFILE_ID, 'owner', 'actor-1', db))
      .rejects.toMatchObject({ code: 'role_does_not_use_profile' });
  });

  it('bloqueia atribuir perfil a um usuário technician', async () => {
    const { db } = makeMockDb({ targetUserRow: { id: USER_ID, role: 'technician' } });
    await expect(assignUserProfile(USER_ID, TENANT_ID, PROFILE_ID, 'owner', 'actor-1', db))
      .rejects.toMatchObject({ code: 'role_does_not_use_profile' });
  });

  it('lança user_not_found quando o usuário não existe no tenant', async () => {
    const { db } = makeMockDb({ targetUserRow: null });
    await expect(assignUserProfile('ghost', TENANT_ID, PROFILE_ID, 'owner', 'actor-1', db))
      .rejects.toMatchObject({ code: 'user_not_found' });
  });

  it('bloqueia quando o ator não é owner', async () => {
    const { db } = makeMockDb({});
    await expect(assignUserProfile(USER_ID, TENANT_ID, PROFILE_ID, 'user', 'actor-1', db))
      .rejects.toMatchObject({ code: 'actor_not_owner' });
  });
});

describe('getEffectivePermissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('owner tem bypass total mesmo sem perfil', async () => {
    const { db } = makeMockDb({ effectiveUserRow: { role: 'owner', access_profile_id: null } });
    const effective = await getEffectivePermissions(USER_ID, TENANT_ID, db);
    expect(effective.can('clients', 'manage')).toBe(true);
  });

  it('usuário sem perfil atribuído não pode nada', async () => {
    const { db } = makeMockDb({ effectiveUserRow: { role: 'user', access_profile_id: null } });
    const effective = await getEffectivePermissions(USER_ID, TENANT_ID, db);
    expect(effective.can('clients', 'view')).toBe(false);
  });

  it('usuário com perfil herda os grants do perfil', async () => {
    const { db } = makeMockDb({
      effectiveUserRow: { role: 'user', access_profile_id: PROFILE_ID },
      grantsRows: [{ resource: 'clients', action: 'manage' }],
    });
    const effective = await getEffectivePermissions(USER_ID, TENANT_ID, db);
    expect(effective.can('clients', 'manage')).toBe(true);
    expect(effective.can('materials', 'view')).toBe(false);
  });

  it('usuário inexistente não pode nada (fail-closed)', async () => {
    const { db } = makeMockDb({ effectiveUserRow: null });
    const effective = await getEffectivePermissions('ghost', TENANT_ID, db);
    expect(effective.can('clients', 'view')).toBe(false);
  });
});
