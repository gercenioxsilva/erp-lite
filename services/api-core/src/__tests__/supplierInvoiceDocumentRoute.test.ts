import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// GET /v1/supplier-invoices/:id/document — busca o PDF/XML da nota de
// terceiro (via Focus). Sempre 200 mesmo quando o documento não está
// disponível (mesmo espírito de lookup-by-key: resultado esperado, não erro).

vi.mock('../services/fiscal/focusNfe', () => ({
  fetchNFeRecebidaDocument: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));

let siRows: unknown[] = [];
let companyRows: unknown[] = [];

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  mockDb.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => Promise.resolve(
        table === actual.nfeConfigs       ? companyRows :
        table === actual.supplierInvoices ? siRows      : [],
      ),
    }),
  }));
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SI_ID     = '22222222-2222-2222-2222-222222222222';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function defaultCompany() {
  return {
    id: 'company-1', tenant_id: TENANT_ID, is_default: true, is_active: true,
    cnpj: '11444777000161', focus_ambiente: 2, focus_token_homologacao: 'hml-token', focus_token_producao: null,
  };
}

describe('GET /v1/supplier-invoices/:id/document', () => {
  let app: FastifyInstance;
  let fetchNFeRecebidaDocument: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    siRows = []; companyRows = [defaultCompany()];
    fetchNFeRecebidaDocument = (await import('../services/fiscal/focusNfe')).fetchNFeRecebidaDocument as any;
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('rejeita format inválido', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/supplier-invoices/${SI_ID}/document?format=doc`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(400);
    expect(fetchNFeRecebidaDocument).not.toHaveBeenCalled();
  });

  it('404 quando a nota não existe', async () => {
    siRows = [];
    const res = await app.inject({
      method: 'GET', url: `/v1/supplier-invoices/${SI_ID}/document?format=pdf`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('retorna found:false quando a nota não tem chave de acesso', async () => {
    siRows = [{ nfe_key: null }];
    const res = await app.inject({
      method: 'GET', url: `/v1/supplier-invoices/${SI_ID}/document?format=pdf`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ found: false, reason: 'Esta nota não tem chave de acesso cadastrada' });
    expect(fetchNFeRecebidaDocument).not.toHaveBeenCalled();
  });

  it('sem empresa configurada, retorna 400 com mensagem clara', async () => {
    siRows = [{ nfe_key: '1'.repeat(44) }];
    companyRows = [];
    const res = await app.inject({
      method: 'GET', url: `/v1/supplier-invoices/${SI_ID}/document?format=pdf`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('devolve o resultado de fetchNFeRecebidaDocument quando tudo está ok', async () => {
    siRows = [{ nfe_key: '1'.repeat(44) }];
    fetchNFeRecebidaDocument.mockResolvedValue({ found: true, content_type: 'application/pdf', base64: 'AAAA' });

    const res = await app.inject({
      method: 'GET', url: `/v1/supplier-invoices/${SI_ID}/document?format=pdf`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ found: true, content_type: 'application/pdf', base64: 'AAAA' });
    expect(fetchNFeRecebidaDocument).toHaveBeenCalledWith('1'.repeat(44), expect.objectContaining({ id: 'company-1' }), 'pdf');
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/supplier-invoices/${SI_ID}/document?format=pdf` });
    expect(res.statusCode).toBe(401);
  });
});
