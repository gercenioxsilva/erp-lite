import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Rotas de Integração Fiscal (regra 70) são finas — mockamos o service
// inteiro (já testado isoladamente via fiscalIntegrationDomain.test.ts +
// companyRegistrationService.test.ts no lambda-fiscal) e verificamos só o
// contrato HTTP: status codes, mapeamento de erro de domínio, autenticação.

vi.mock('../services/fiscalIntegrationService', () => ({
  registerCompanyFiscalIntegration: vi.fn(),
  uploadCompanyCertificate:         vi.fn(),
  testCompanyFiscalConnection:      vi.fn(),
  FiscalIntegrationDomainError: class FiscalIntegrationDomainError extends Error {
    code: string; payload?: Record<string, unknown>;
    constructor(code: string, payload?: Record<string, unknown>) { super(code); this.code = code; this.payload = payload; }
  },
}));

const mockDb = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const COMPANY_ID = '22222222-2222-2222-2222-222222222222';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('POST /v1/companies/:id/fiscal-integration/register', () => {
  let app: FastifyInstance;
  let registerCompanyFiscalIntegration: ReturnType<typeof vi.fn>;
  let FiscalIntegrationDomainError: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../services/fiscalIntegrationService');
    registerCompanyFiscalIntegration = mod.registerCompanyFiscalIntegration as any;
    FiscalIntegrationDomainError = mod.FiscalIntegrationDomainError;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('202 com o estado processing quando o registro é aceito', async () => {
    registerCompanyFiscalIntegration.mockResolvedValue({ companyId: COMPANY_ID, status: 'pending', registrationError: null, certificadoCnpj: null, certificadoValidoAte: null });

    const res = await app.inject({
      method: 'POST', url: `/v1/companies/${COMPANY_ID}/fiscal-integration/register`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(202);
    expect(registerCompanyFiscalIntegration).toHaveBeenCalledWith(TENANT_ID, COMPANY_ID);
  });

  it('409 quando já existe um registro em andamento', async () => {
    registerCompanyFiscalIntegration.mockRejectedValue(new FiscalIntegrationDomainError('registration_in_progress'));

    const res = await app.inject({
      method: 'POST', url: `/v1/companies/${COMPANY_ID}/fiscal-integration/register`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/companies/${COMPANY_ID}/fiscal-integration/register` });
    expect(res.statusCode).toBe(401);
    expect(registerCompanyFiscalIntegration).not.toHaveBeenCalled();
  });
});

describe('POST /v1/companies/:id/fiscal-integration/certificate', () => {
  let app: FastifyInstance;
  let uploadCompanyCertificate: ReturnType<typeof vi.fn>;
  let FiscalIntegrationDomainError: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../services/fiscalIntegrationService');
    uploadCompanyCertificate = mod.uploadCompanyCertificate as any;
    FiscalIntegrationDomainError = mod.FiscalIntegrationDomainError;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('200 com o novo estado quando o upload é aceito', async () => {
    uploadCompanyCertificate.mockResolvedValue({ companyId: COMPANY_ID, status: 'active', registrationError: null, certificadoCnpj: '12345678000190', certificadoValidoAte: '2027-01-01' });

    const res = await app.inject({
      method: 'POST', url: `/v1/companies/${COMPANY_ID}/fiscal-integration/certificate`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { certificado_base64: 'YWJj', senha_certificado: 'segredo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('active');
  });

  it('422 quando a empresa ainda não foi registrada', async () => {
    uploadCompanyCertificate.mockRejectedValue(new FiscalIntegrationDomainError('registration_required'));

    const res = await app.inject({
      method: 'POST', url: `/v1/companies/${COMPANY_ID}/fiscal-integration/certificate`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { certificado_base64: 'YWJj', senha_certificado: 'segredo' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('registration_required');
  });

  it('422 com o motivo do emissor quando o upload é rejeitado', async () => {
    uploadCompanyCertificate.mockRejectedValue(new FiscalIntegrationDomainError('certificate_upload_failed', { reason: 'Senha do certificado inválida' }));

    const res = await app.inject({
      method: 'POST', url: `/v1/companies/${COMPANY_ID}/fiscal-integration/certificate`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { certificado_base64: 'YWJj', senha_certificado: 'errada' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('Senha do certificado inválida');
  });
});

describe('POST /v1/companies/:id/fiscal-integration/test', () => {
  let app: FastifyInstance;
  let testCompanyFiscalConnection: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../services/fiscalIntegrationService');
    testCompanyFiscalConnection = mod.testCompanyFiscalConnection as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('200 {ok:true} quando a conexão funciona', async () => {
    testCompanyFiscalConnection.mockResolvedValue({ ok: true });

    const res = await app.inject({
      method: 'POST', url: `/v1/companies/${COMPANY_ID}/fiscal-integration/test`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('200 {ok:false, reason} quando a conexão falha (nunca lança erro HTTP pra falha de conectividade)', async () => {
    testCompanyFiscalConnection.mockResolvedValue({ ok: false, reason: 'Empresa não encontrada na integração fiscal' });

    const res = await app.inject({
      method: 'POST', url: `/v1/companies/${COMPANY_ID}/fiscal-integration/test`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
  });
});
