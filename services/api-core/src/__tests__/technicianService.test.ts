import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  updateTechnician, resendTechnicianInvite, findLinkableUser, createTechnician, TechnicianServiceError,
} from '../services/technicianService';
import { users, technicians } from '../db/schema';

// Edição de técnico (nunca senha) e reenvio de convite — corrigem o problema
// real de onboarding: tenant com baixa maturidade digital digita e-mail/CPF
// errado na hora do cadastro e não tem como corrigir sem recriar o técnico.

vi.mock('../lib/notificationsClient', () => ({ sendSystemNotification: vi.fn().mockResolvedValue(undefined) }));

const TENANT_ID = 'tenant-1';
const TECH_ID   = 'tech-1';
const USER_ID   = 'user-1';

function baseTechnicianRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TECH_ID, tenant_id: TENANT_ID, user_id: USER_ID,
    name: 'João Silva', email: 'joao@example.com', phone: '11999999999',
    cpf: '52998224725', specialty: 'Ar condicionado', is_active: true,
    ...overrides,
  };
}

function makeMockDb(opts: { technicianRow?: Record<string, unknown> | null }) {
  // updateTechnician()/resendTechnicianInvite() só fazem UM select (o
  // técnico) — nunca consultam users — então o mock não precisa discriminar
  // por tabela na leitura, só na escrita (assertions distinguem pelo shape
  // dos dados, não pela tabela em si).
  const rows = opts.technicianRow !== undefined ? [opts.technicianRow].filter(Boolean) : [baseTechnicianRow()];
  const updateSetCalls: Record<string, unknown>[] = [];

  const db: any = {
    transaction: async (cb: any) => cb(db),
    select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve(rows) }) })),
    update: vi.fn(() => ({
      set: (data: Record<string, unknown>) => {
        updateSetCalls.push(data);
        return { where: () => Promise.resolve(undefined) };
      },
    })),
  };

  return { db, updateSetCalls };
}

describe('updateTechnician', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lança technician_not_found quando o técnico não existe', async () => {
    const { db } = makeMockDb({ technicianRow: null });
    await expect(updateTechnician(TECH_ID, TENANT_ID, { name: 'Novo Nome' }, db))
      .rejects.toMatchObject({ code: 'technician_not_found' });
  });

  it('lança invalid_cpf quando o CPF informado é inválido', async () => {
    const { db } = makeMockDb({});
    await expect(updateTechnician(TECH_ID, TENANT_ID, { cpf: '11111111111' }, db))
      .rejects.toMatchObject({ code: 'invalid_cpf' });
  });

  it('lança name_required quando o nome vem vazio', async () => {
    const { db } = makeMockDb({});
    await expect(updateTechnician(TECH_ID, TENANT_ID, { name: '   ' }, db))
      .rejects.toMatchObject({ code: 'name_required' });
  });

  it('atualiza nome/telefone/especialidade e propaga nome pro users (login)', async () => {
    const { db, updateSetCalls } = makeMockDb({});
    await updateTechnician(TECH_ID, TENANT_ID, { name: 'João S. Silva', phone: '11988887777', specialty: 'Elétrica' }, db);

    const techniciansUpdate = updateSetCalls.find(c => c.name === 'João S. Silva' && 'phone' in c);
    expect(techniciansUpdate).toBeTruthy();
    expect(techniciansUpdate!.phone).toBe('11988887777');
    expect(techniciansUpdate!.specialty).toBe('Elétrica');

    const usersUpdate = updateSetCalls.find(c => c.name === 'João S. Silva' && !('phone' in c));
    expect(usersUpdate).toBeTruthy();
  });

  it('erro de duplicidade de e-mail vira email_already_registered', async () => {
    const { db } = makeMockDb({});
    (db.update as any).mockImplementation(() => ({
      set: () => ({ where: () => { const err: any = new Error('dup'); err.code = '23505'; throw err; } }),
    }));
    await expect(updateTechnician(TECH_ID, TENANT_ID, { email: 'outro@example.com' }, db))
      .rejects.toMatchObject({ code: 'email_already_registered' });
  });

  it('sem nenhum campo informado, devolve o técnico como está sem escrever', async () => {
    const { db, updateSetCalls } = makeMockDb({});
    const result = await updateTechnician(TECH_ID, TENANT_ID, {}, db);
    expect(result).toMatchObject({ id: TECH_ID });
    expect(updateSetCalls).toHaveLength(0);
  });
});

describe('resendTechnicianInvite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lança technician_not_found quando o técnico não existe', async () => {
    const { db } = makeMockDb({ technicianRow: null });
    await expect(resendTechnicianInvite(TECH_ID, TENANT_ID, db))
      .rejects.toMatchObject({ code: 'technician_not_found' });
  });

  it('gera um novo token e reenvia o e-mail de convite', async () => {
    const { db, updateSetCalls } = makeMockDb({});
    const { sendSystemNotification } = await import('../lib/notificationsClient');

    await resendTechnicianInvite(TECH_ID, TENANT_ID, db);

    const tokenUpdate = updateSetCalls.find(c => 'password_reset_token' in c);
    expect(tokenUpdate).toBeTruthy();
    expect(typeof tokenUpdate!.password_reset_token).toBe('string');
    expect((tokenUpdate!.password_reset_token as string).length).toBeGreaterThan(0);
    expect(sendSystemNotification).toHaveBeenCalledTimes(1);
    const call = (sendSystemNotification as any).mock.calls[0][0];
    expect(call.type).toBe('technician_welcome');
    expect(call.data.set_password_link).toContain(tokenUpdate!.password_reset_token);
  });
});

// ── Vínculo de usuário existente (regra 67) ─────────────────────────────────
// Cobre o bug real: operador tenta cadastrar como técnico alguém que já tem
// login no tenant (criado como 'user' comum) e o cadastro travava com 409
// "E-mail já cadastrado" sem nenhuma ação de recuperação.

const OWNER_USER  = { id: 'owner-1', name: 'Dona da Conta', role: 'owner' };
const NORMAL_USER = { id: 'user-2',  name: 'Yan Teste',     role: 'user' };

function makeLinkMockDb(opts: {
  userRow?:       Record<string, unknown> | null;
  technicianRow?: Record<string, unknown> | null;
}) {
  const insertedTechnicians: Record<string, unknown>[] = [];
  const userUpdates: Record<string, unknown>[] = [];

  const db: any = {
    transaction: async (cb: any) => cb(db),
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === users)       return Promise.resolve(opts.userRow ? [opts.userRow] : []);
          if (table === technicians) return Promise.resolve(opts.technicianRow ? [opts.technicianRow] : []);
          return Promise.resolve([]);
        },
      }),
    })),
    update: vi.fn(() => ({
      set: (data: Record<string, unknown>) => {
        userUpdates.push(data);
        return { where: () => Promise.resolve(undefined) };
      },
    })),
    insert: vi.fn(() => ({
      values: (data: Record<string, unknown>) => {
        insertedTechnicians.push(data);
        return { returning: () => Promise.resolve([{ id: 'new-tech-id', ...data }]) };
      },
    })),
  };

  return { db, insertedTechnicians, userUpdates };
}

describe('findLinkableUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve not_found quando nenhum usuário tem esse e-mail no tenant', async () => {
    const { db } = makeLinkMockDb({ userRow: null });
    await expect(findLinkableUser(TENANT_ID, 'novo@example.com', db))
      .resolves.toEqual({ linkable: false, reason: 'not_found' });
  });

  it('bloqueia o dono da conta — nunca vira técnico', async () => {
    const { db } = makeLinkMockDb({ userRow: OWNER_USER });
    const result = await findLinkableUser(TENANT_ID, 'owner@example.com', db);
    expect(result.linkable).toBe(false);
    expect(result.reason).toBe('is_owner');
    expect(result.user).toMatchObject({ id: OWNER_USER.id });
  });

  it('bloqueia quando o usuário já é técnico (duplicata de verdade)', async () => {
    const { db } = makeLinkMockDb({ userRow: NORMAL_USER, technicianRow: { id: 'tech-existing' } });
    const result = await findLinkableUser(TENANT_ID, 'yan@example.com', db);
    expect(result.linkable).toBe(false);
    expect(result.reason).toBe('already_technician');
  });

  it('devolve linkable=true para um usuário comum sem técnico vinculado ainda', async () => {
    const { db } = makeLinkMockDb({ userRow: NORMAL_USER, technicianRow: null });
    const result = await findLinkableUser(TENANT_ID, 'yan@example.com', db);
    expect(result).toEqual({ linkable: true, user: NORMAL_USER });
  });
});

describe('createTechnician — vínculo de usuário existente', () => {
  beforeEach(() => vi.clearAllMocks());

  it('vincula o usuário existente em vez de criar um login novo', async () => {
    const { db, insertedTechnicians, userUpdates } = makeLinkMockDb({ userRow: NORMAL_USER, technicianRow: null });
    const { sendSystemNotification } = await import('../lib/notificationsClient');

    const technician = await createTechnician({
      tenantId: TENANT_ID, name: 'Yan Teste', email: 'yan@example.com',
      cpf: '52998224725', specialty: 'Ar condicionado',
      linkExistingUserId: NORMAL_USER.id,
    }, db);

    expect(technician).toMatchObject({ user_id: NORMAL_USER.id });
    expect(insertedTechnicians).toHaveLength(1);
    expect(insertedTechnicians[0]).toMatchObject({ user_id: NORMAL_USER.id, tenant_id: TENANT_ID });

    // Nunca insere um novo users — só atualiza o papel/perfil do que já existe.
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0]).toMatchObject({ role: 'technician', access_profile_id: null });

    // Conta já existe e já tem senha própria — não é um convite novo.
    expect(sendSystemNotification).not.toHaveBeenCalled();
  });

  it('lança user_not_linkable quando o usuário não é mais elegível (ex.: virou técnico entre a checagem e o submit)', async () => {
    const { db } = makeLinkMockDb({ userRow: NORMAL_USER, technicianRow: { id: 'tech-existing' } });

    await expect(createTechnician({
      tenantId: TENANT_ID, name: 'Yan Teste', email: 'yan@example.com',
      cpf: '52998224725', linkExistingUserId: NORMAL_USER.id,
    }, db)).rejects.toMatchObject({ code: 'user_not_linkable' });
  });

  it('lança user_not_linkable quando o id enviado não bate com o usuário encontrado pelo e-mail', async () => {
    const { db } = makeLinkMockDb({ userRow: NORMAL_USER, technicianRow: null });

    await expect(createTechnician({
      tenantId: TENANT_ID, name: 'Yan Teste', email: 'yan@example.com',
      cpf: '52998224725', linkExistingUserId: 'outro-id-qualquer',
    }, db)).rejects.toMatchObject({ code: 'user_not_linkable' });
  });
});
