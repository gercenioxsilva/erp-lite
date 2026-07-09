import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  issueVerificationToken, verifyEmail, resendVerification, TenantActivationDomainError,
} from '../services/tenantActivationService';
import type { DrizzleDB } from '../services/tenantActivationService';

vi.mock('../lib/notificationsClient', () => ({
  sendSystemNotification: vi.fn().mockResolvedValue(undefined),
}));

const TENANT_ID = 'tenant-1';
const USER_ID   = 'user-1';

function baseUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID, tenant_id: TENANT_ID, email: 'dono@ex.com', name: 'Dono',
    email_verification_token: 'tok123', email_verification_expires: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function chain(rows: unknown[]): any {
  const p: any = Promise.resolve(rows);
  p.where = () => chain(rows);
  return p;
}

function makeMockDb(opts: { selectRows?: unknown[] }) {
  const updatedValues: Record<string, unknown>[] = [];

  const db: any = {
    transaction: async (cb: any) => cb(db),
    select: vi.fn(() => ({ from: () => chain(opts.selectRows ?? []) })),
    update: vi.fn(() => ({
      set: (data: Record<string, unknown>) => {
        updatedValues.push(data);
        return { where: () => ({ returning: () => Promise.resolve([{ id: TENANT_ID, ...data }]) }) };
      },
    })),
  };

  return { db: db as DrizzleDB, updatedValues };
}

describe('issueVerificationToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gera um token novo e persiste na linha do usuário', async () => {
    const { db, updatedValues } = makeMockDb({});
    const result = await issueVerificationToken(USER_ID, db);
    expect(result.token).toMatch(/^[a-f0-9]{32}$/);
    expect(updatedValues[0]).toMatchObject({ email_verification_token: result.token });
  });
});

describe('verifyEmail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('confirma o e-mail: ativa o tenant e limpa o token', async () => {
    const { db, updatedValues } = makeMockDb({ selectRows: [baseUserRow()] });
    await verifyEmail('tok123', db);

    const userUpdate = updatedValues.find(v => 'email_verified_at' in v);
    expect(userUpdate).toMatchObject({ email_verification_token: null, email_verification_expires: null });

    const tenantUpdate = updatedValues.find(v => 'activated_at' in v);
    expect(tenantUpdate).toBeDefined();
  });

  it('rejeita token inexistente', async () => {
    const { db } = makeMockDb({ selectRows: [] });
    await expect(verifyEmail('ghost', db)).rejects.toMatchObject({ code: 'verification_token_invalid_or_expired' });
  });

  it('rejeita token expirado', async () => {
    const { db } = makeMockDb({
      selectRows: [baseUserRow({ email_verification_expires: new Date(Date.now() - 1000) })],
    });
    await expect(verifyEmail('tok123', db)).rejects.toMatchObject({ code: 'verification_token_invalid_or_expired' });
  });
});

describe('resendVerification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reenvia quando fora do cooldown (token expira em 48h — expires no futuro distante conta como "nunca reenviado recentemente")', async () => {
    // lastSentAt é derivado de expires - 48h; um expires bem no futuro (recém gerado
    // agora) cairia DENTRO do cooldown — simulamos um token antigo (expires já
    // passou de muito, ou seja, foi emitido há mais de 60s + 48h).
    const oldExpires = new Date(Date.now() - 47 * 60 * 60 * 1000 + 5000); // emitido ~1h atrás
    const { db, updatedValues } = makeMockDb({
      selectRows: [baseUserRow({ email_verification_expires: oldExpires })],
    });
    await resendVerification(USER_ID, TENANT_ID, db);
    expect(updatedValues.some(v => 'email_verification_token' in v)).toBe(true);
  });

  it('bloqueia reenvio dentro do cooldown de 60s', async () => {
    const recentExpires = new Date(Date.now() + 48 * 60 * 60 * 1000 - 5000); // emitido ~5s atrás
    const { db } = makeMockDb({ selectRows: [baseUserRow({ email_verification_expires: recentExpires })] });
    await expect(resendVerification(USER_ID, TENANT_ID, db)).rejects.toMatchObject({ code: 'resend_cooldown_active' });
  });

  it('lança user_not_found quando o usuário não existe no tenant', async () => {
    const { db } = makeMockDb({ selectRows: [] });
    await expect(resendVerification('ghost', TENANT_ID, db)).rejects.toMatchObject({ code: 'user_not_found' });
  });
});
