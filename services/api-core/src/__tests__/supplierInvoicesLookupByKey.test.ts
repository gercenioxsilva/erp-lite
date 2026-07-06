import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// POST /v1/supplier-invoices/lookup-by-key é só leitura: nunca cria fornecedor
// nem grava a NF-e. Isso é o que garante que a busca automática pela chave
// nunca surpreende o usuário com um cadastro criado sem confirmação.

vi.mock('../services/fiscal/focusNfe', () => ({
  consultarNFeRecebida: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));

let companyRows: unknown[] = [];
let supplierRows: unknown[] = [];

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  mockDb.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => Promise.resolve(
        table === actual.nfeConfigs ? companyRows :
        table === actual.suppliers  ? supplierRows : [],
      ),
    }),
  }));
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CHAVE     = '2'.repeat(44);

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function defaultCompany() {
  return {
    id: 'company-1', tenant_id: TENANT_ID, is_default: true, is_active: true,
    cnpj: '11444777000161', focus_ambiente: 2, focus_token_homologacao: 'hml-token', focus_token_producao: null,
  };
}

describe('POST /v1/supplier-invoices/lookup-by-key', () => {
  let app: FastifyInstance;
  let consultarNFeRecebida: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    companyRows = [defaultCompany()];
    supplierRows = [];
    consultarNFeRecebida = (await import('../services/fiscal/focusNfe')).consultarNFeRecebida as any;
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('rejeita chave com formato inválido sem chamar o Focus', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/supplier-invoices/lookup-by-key',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { chave_acesso: '123' },
    });
    expect(res.statusCode).toBe(400);
    expect(consultarNFeRecebida).not.toHaveBeenCalled();
  });

  it('sem empresa configurada, retorna 400 com mensagem clara', async () => {
    companyRows = [];
    const res = await app.inject({
      method: 'POST', url: '/v1/supplier-invoices/lookup-by-key',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { chave_acesso: CHAVE },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Empresa → Fiscal/);
  });

  it('nota não encontrada → 200 com found:false e o motivo (nunca 4xx/5xx)', async () => {
    consultarNFeRecebida.mockResolvedValue({ found: false, reason: 'Nota não distribuída ainda' });
    const res = await app.inject({
      method: 'POST', url: '/v1/supplier-invoices/lookup-by-key',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { chave_acesso: CHAVE },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ found: false, reason: 'Nota não distribuída ainda' });
  });

  it('nota encontrada + fornecedor já cadastrado (por CNPJ) → supplier.matched=true, nunca cria fornecedor', async () => {
    supplierRows = [{ id: 'sup-1', company_name: 'Fornecedor Já Cadastrado' }];
    consultarNFeRecebida.mockResolvedValue({
      found: true,
      emitente: { cnpj: '22333444000155', razao_social: 'Fornecedor Já Cadastrado' },
      nfe: { chave: CHAVE, numero: '123', serie: '1', data_emissao: '2026-07-01', valor_total: 500 },
      items: [{ name: 'Item 1', ncm_code: '12345678', cfop: '5102', unit: 'UN', quantity: 1, unit_price: 500 }],
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/supplier-invoices/lookup-by-key',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { chave_acesso: CHAVE },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.found).toBe(true);
    expect(body.supplier).toEqual({ matched: true, id: 'sup-1', name: 'Fornecedor Já Cadastrado' });
    expect(body.nfe.numero).toBe('123');
    expect(body.items).toHaveLength(1);
  });

  it('nota encontrada + fornecedor NÃO cadastrado → devolve dados crus com matched:false (não cria nada)', async () => {
    supplierRows = [];
    consultarNFeRecebida.mockResolvedValue({
      found: true,
      emitente: { cnpj: '22333444000155', razao_social: 'Fornecedor Novo', logradouro: 'Rua X', numero: '10', bairro: 'Bairro', municipio: 'SP', uf: 'SP', cep: '01000000' },
      nfe: { chave: CHAVE, numero: '124', serie: '1', data_emissao: null, valor_total: 300 },
      items: [],
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/supplier-invoices/lookup-by-key',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { chave_acesso: CHAVE },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.supplier).toEqual({
      matched: false, cnpj: '22333444000155', name: 'Fornecedor Novo',
      street: 'Rua X', street_number: '10', neighborhood: 'Bairro', city: 'SP', state: 'SP', zip_code: '01000000',
    });
  });

  it('retorna 401 sem token de autenticação', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/supplier-invoices/lookup-by-key',
      payload: { chave_acesso: CHAVE },
    });
    expect(res.statusCode).toBe(401);
  });
});
