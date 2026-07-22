// POST /v1/whatsapp/account/test — mesma abordagem de leadCaptureKeysRoute
// .test.ts: mocka o service inteiro (já testado em
// whatsappAccountService.test.ts) e o gate de módulo, verifica só o
// contrato HTTP.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { tenantModules } from '../db/schema';

vi.mock('../services/whatsappAccountService', () => ({
  getWhatsAppAccount: vi.fn(),
  upsertWhatsAppAccount: vi.fn(),
  disconnectWhatsAppAccount: vi.fn(),
  testWhatsAppConnection: vi.fn(),
  WhatsAppDomainError: class WhatsAppDomainError extends Error {
    code: string; payload?: Record<string, unknown>;
    constructor(code: string, payload?: Record<string, unknown>) { super(code); this.code = code; this.payload = payload; }
  },
}));

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const state: { moduleRows: any[] } = { moduleRows: [{ enabled: true }] };

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({
        from: (table: unknown) => ({
          where: () => Promise.resolve(table === tenantModules ? state.moduleRows : []),
        }),
      })),
    },
  };
});

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('POST /v1/whatsapp/account/test', () => {
  let app: FastifyInstance;
  let testWhatsAppConnection: ReturnType<typeof vi.fn>;
  let WhatsAppDomainError: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    state.moduleRows = [{ enabled: true }];
    const mod = await import('../services/whatsappAccountService');
    testWhatsAppConnection = mod.testWhatsAppConnection as any;
    WhatsAppDomainError = mod.WhatsAppDomainError;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('200 {ok:true} quando a conexão funciona', async () => {
    testWhatsAppConnection.mockResolvedValue({ ok: true });

    const res = await app.inject({
      method: 'POST', url: '/v1/whatsapp/account/test',
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('200 {ok:false, reason} quando as credenciais são inválidas (nunca lança erro HTTP pra falha de conectividade)', async () => {
    testWhatsAppConnection.mockResolvedValue({ ok: false, reason: 'Account SID ou Auth Token inválidos' });

    const res = await app.inject({
      method: 'POST', url: '/v1/whatsapp/account/test',
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
  });

  it('400 quando não existe conta WhatsApp cadastrada ainda', async () => {
    testWhatsAppConnection.mockRejectedValue(new WhatsAppDomainError('account_not_connected'));

    const res = await app.inject({
      method: 'POST', url: '/v1/whatsapp/account/test',
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('403 quando o módulo whatsapp está desligado', async () => {
    state.moduleRows = [{ enabled: false }];

    const res = await app.inject({
      method: 'POST', url: '/v1/whatsapp/account/test',
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(403);
    expect(testWhatsAppConnection).not.toHaveBeenCalled();
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/whatsapp/account/test' });
    expect(res.statusCode).toBe(401);
  });
});
