import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateTechnician, resendTechnicianInvite, TechnicianServiceError } from '../services/technicianService';

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
