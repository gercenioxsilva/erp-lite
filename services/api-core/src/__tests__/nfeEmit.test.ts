import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Prova de regressão + prova do fix de multi-empresa (regra 40) no ponto mais
// crítico do sistema: POST /v1/invoices/:id/emit — é aqui que o CNPJ/token
// Focus realmente sai no XML da NF-e.

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({}) }),
}));

const mockDb = vi.hoisted(() => ({
  execute: vi.fn(),
  select:  vi.fn(),
  update:  vi.fn(),
}));

let companyRows: unknown[] = [];

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  // Só resolveCompanyId (via companyService) faz SELECT em nfe_configs neste
  // fluxo — comparar a tabela (não a ordem de chamada) evita acoplamento com
  // workers de background que também rodam durante buildApp() (ex.: ContractBillingWorker).
  mockDb.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => Promise.resolve(table === actual.nfeConfigs ? companyRows : []),
    }),
  }));
  return { ...actual, db: mockDb };
});

const TENANT_ID    = '11111111-1111-1111-1111-111111111111';
const INVOICE_ID   = '22222222-2222-2222-2222-222222222222';
const COMPANY_DEFAULT = '33333333-3333-3333-3333-333333333333';
const COMPANY_OTHER   = '44444444-4444-4444-4444-444444444444';

function baseInvoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID, status: 'draft', nfe_status: null, total: '100.00',
    person_type: 'PF', full_name: 'Cliente Teste', client_state: 'SP',
    company_id: null,
    ...overrides,
  };
}

const updateChain = () => ({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) });

// app.ts também dispara workers em background (ex.: ContractBillingWorker) que
// chamam db.execute() no boot, fora de ordem em relação à requisição de teste —
// por isso discriminamos por conteúdo da query, nunca por ordem de chamada.
function mockExecuteByQuery(invoiceRow: unknown, itemRows: unknown[]) {
  mockDb.execute.mockImplementation(async (query: any) => {
    const text = JSON.stringify(query?.queryChunks ?? query ?? '');
    if (/invoice_items/i.test(text))                        return { rows: itemRows };
    if (/FROM invoices i JOIN clients/i.test(text))          return { rows: invoiceRow ? [invoiceRow] : [] };
    return { rows: [] }; // demais queries de background (ex.: ContractBillingWorker) — inofensivas aqui
  });
}

describe('POST /v1/invoices/:id/emit — resolução de empresa (regra 40)', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    companyRows = [];
    process.env.NFE_REQUESTS_QUEUE_URL = 'http://localhost/queue/nfe-requests';
    mockDb.update.mockReturnValue(updateChain());
    app = await buildApp();
    token = app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
  });

  afterEach(async () => {
    await app.close();
    delete process.env.NFE_REQUESTS_QUEUE_URL;
  });

  it('[regressão] tenant sem multi-empresa: invoice.company_id null resolve para a empresa padrão, exatamente como antes', async () => {
    mockExecuteByQuery(
      baseInvoiceRow({ company_id: null }),
      [{ ncm_code: '12345678', name: 'Item 1', quantity: '1', unit_price: '100.00' }],
    );
    companyRows = [{
      id: COMPANY_DEFAULT, is_default: true, is_active: true,
      cnpj: '11444777000161', razao_social: 'Empresa Padrão Ltda',
      focus_ambiente: 2, focus_token_homologacao: 'hml-token', focus_token_producao: null,
      uf: 'SP', cfop_padrao: '5102', cfop_interestadual: '6102', regime_tributario: 1,
      emite_nfe: true, emite_nfse: true,
    }];

    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/emit?tenant_id=${TENANT_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
  });

  it('[fix] invoice com company_id de uma empresa não-padrão emite com o CNPJ/token daquela empresa', async () => {
    mockExecuteByQuery(
      baseInvoiceRow({ company_id: COMPANY_OTHER }),
      [{ ncm_code: '12345678', name: 'Item 1', quantity: '1', unit_price: '100.00' }],
    );
    companyRows = [{
      id: COMPANY_OTHER, is_default: false, is_active: true,
      cnpj: 'B2C3D4E5F6G185', razao_social: 'Filial RJ Ltda',
      focus_ambiente: 2, focus_token_homologacao: 'hml-token-filial', focus_token_producao: null,
      uf: 'RJ', cfop_padrao: '5102', cfop_interestadual: '6102', regime_tributario: 1,
      emite_nfe: true, emite_nfse: true,
    }];

    const sqsMock = (await import('../lib/sqsClient')).getSqsClient();
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/emit?tenant_id=${TENANT_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
    const sentBody = JSON.parse((sqsMock.send as any).mock.calls[0][0].input.MessageBody);
    expect(sentBody.emitente.cnpj).toBe('B2C3D4E5F6G185');
    expect(sentBody.emitente.uf).toBe('RJ');
  });

  it('company_id da invoice não pertence a este tenant (isolamento) → bloqueia a emissão com mensagem clara', async () => {
    mockExecuteByQuery(
      baseInvoiceRow({ company_id: COMPANY_OTHER }),
      [{ ncm_code: '12345678', name: 'Item 1', quantity: '1', unit_price: '100.00' }],
    );
    companyRows = []; // resolveCompanyId não encontra (empresa de outro tenant)

    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/emit?tenant_id=${TENANT_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Configure os dados fiscais/);
  });

  it('[regra 53] company_id aponta pra uma empresa que existe mas não emite NF-e (só NFS-e) → bloqueia com mensagem específica', async () => {
    mockExecuteByQuery(
      baseInvoiceRow({ company_id: COMPANY_OTHER }),
      [{ ncm_code: '12345678', name: 'Item 1', quantity: '1', unit_price: '100.00' }],
    );
    companyRows = [{
      id: COMPANY_OTHER, is_default: false, is_active: true,
      cnpj: 'B2C3D4E5F6G185', razao_social: 'Filial de Serviços Ltda',
      focus_ambiente: 2, focus_token_homologacao: 'hml-token-filial', focus_token_producao: null,
      uf: 'RJ', cfop_padrao: '5102', cfop_interestadual: '6102', regime_tributario: 1,
      emite_nfe: false, emite_nfse: true, // só presta serviço — não pode emitir NF-e de venda
    }];

    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/emit?tenant_id=${TENANT_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/não está configurada para emitir NF-e/);
  });

  it('[Reforma Tributária] inclui class_trib e IBS/CBS por item na mensagem SQS, com default quando ausente (regra 44)', async () => {
    mockExecuteByQuery(
      baseInvoiceRow({ company_id: null }),
      [{
        ncm_code: '12345678', name: 'Item 1', quantity: '1', unit_price: '100.00', total: '100.00',
        class_trib: null, ibs_base: '100.00', ibs_rate: '0.100', ibs_value: '0.10',
        cbs_base: '100.00', cbs_rate: '0.900', cbs_value: '0.90',
      }],
    );
    companyRows = [{
      id: COMPANY_DEFAULT, is_default: true, is_active: true,
      cnpj: '11444777000161', razao_social: 'Empresa Padrão Ltda',
      focus_ambiente: 2, focus_token_homologacao: 'hml-token', focus_token_producao: null,
      uf: 'SP', cfop_padrao: '5102', cfop_interestadual: '6102', regime_tributario: 1,
      emite_nfe: true, emite_nfse: true,
    }];

    const sqsMock = (await import('../lib/sqsClient')).getSqsClient();
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/emit?tenant_id=${TENANT_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
    const sentBody = JSON.parse((sqsMock.send as any).mock.calls[0][0].input.MessageBody);
    const item = sentBody.itens[0];
    expect(item.class_trib).toBe('000001'); // default — item não tinha override
    expect(item.ibs_base_calculo).toBe(100);
    expect(item.ibs_aliquota).toBe(0.1);
    expect(item.ibs_valor).toBe(0.1);
    expect(item.cbs_aliquota).toBe(0.9);
    expect(item.cbs_valor).toBe(0.9);
  });

  it('[regressão SEFAZ — "IE do destinatário não informada"] cliente Contribuinte ICMS sem Inscrição Estadual bloqueia a emissão com mensagem clara, antes de enfileirar', async () => {
    mockExecuteByQuery(
      baseInvoiceRow({ company_id: null, person_type: 'PJ', company_name: 'Cliente PJ', icms_taxpayer: '1', client_state_reg: null }),
      [{ ncm_code: '12345678', name: 'Item 1', quantity: '1', unit_price: '100.00' }],
    );
    companyRows = [{
      id: COMPANY_DEFAULT, is_default: true, is_active: true,
      cnpj: '11444777000161', razao_social: 'Empresa Padrão Ltda',
      focus_ambiente: 2, focus_token_homologacao: 'hml-token', focus_token_producao: null,
      uf: 'SP', cfop_padrao: '5102', cfop_interestadual: '6102', regime_tributario: 1,
      emite_nfe: true, emite_nfse: true,
    }];

    const sqsMock = (await import('../lib/sqsClient')).getSqsClient();
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/emit?tenant_id=${TENANT_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Inscrição Estadual/);
    expect(sqsMock.send).not.toHaveBeenCalled();
  });

  it('propaga a Inscrição Estadual do cliente pra mensagem SQS quando ele é Contribuinte ICMS', async () => {
    mockExecuteByQuery(
      baseInvoiceRow({ company_id: null, person_type: 'PJ', company_name: 'Cliente PJ', icms_taxpayer: '1', client_state_reg: '206563490111' }),
      [{ ncm_code: '12345678', name: 'Item 1', quantity: '1', unit_price: '100.00' }],
    );
    companyRows = [{
      id: COMPANY_DEFAULT, is_default: true, is_active: true,
      cnpj: '11444777000161', razao_social: 'Empresa Padrão Ltda',
      focus_ambiente: 2, focus_token_homologacao: 'hml-token', focus_token_producao: null,
      uf: 'SP', cfop_padrao: '5102', cfop_interestadual: '6102', regime_tributario: 1,
      emite_nfe: true, emite_nfse: true,
    }];

    const sqsMock = (await import('../lib/sqsClient')).getSqsClient();
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/emit?tenant_id=${TENANT_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
    const sentBody = JSON.parse((sqsMock.send as any).mock.calls[0][0].input.MessageBody);
    expect(sentBody.destinatario.inscricao_estadual).toBe('206563490111');
    expect(sentBody.destinatario.indicador_ie).toBe(1);
  });

  it('[regressão SEFAZ — Rejeição 232, cadastro dessincronizado] cliente PJ com IE cadastrada mas icms_taxpayer ainda "9" (não contribuinte) emite mesmo assim, com indicador_ie derivado pra 1', async () => {
    // Reproduz o cenário real de produção: usuário preencheu a Inscrição
    // Estadual no cadastro do cliente mas não trocou o select "Contribuinte
    // ICMS" (continua '9' — o default). A SEFAZ cruza o CNPJ com o cadastro
    // oficial de contribuintes e rejeita com "IE do destinatário não
    // informada" se declararmos indIEDest=9 pra um CNPJ que tem IE ativa —
    // presença de IE sempre vence sobre o flag interno.
    mockExecuteByQuery(
      baseInvoiceRow({ company_id: null, person_type: 'PJ', company_name: 'Cliente PJ', icms_taxpayer: '9', client_state_reg: '206563490111' }),
      [{ ncm_code: '12345678', name: 'Item 1', quantity: '1', unit_price: '100.00' }],
    );
    companyRows = [{
      id: COMPANY_DEFAULT, is_default: true, is_active: true,
      cnpj: '11444777000161', razao_social: 'Empresa Padrão Ltda',
      focus_ambiente: 2, focus_token_homologacao: 'hml-token', focus_token_producao: null,
      uf: 'SP', cfop_padrao: '5102', cfop_interestadual: '6102', regime_tributario: 1,
      emite_nfe: true, emite_nfse: true,
    }];

    const sqsMock = (await import('../lib/sqsClient')).getSqsClient();
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/emit?tenant_id=${TENANT_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
    const sentBody = JSON.parse((sqsMock.send as any).mock.calls[0][0].input.MessageBody);
    expect(sentBody.destinatario.indicador_ie).toBe(1);
    expect(sentBody.destinatario.inscricao_estadual).toBe('206563490111');
  });

  it('cliente PJ sem Inscrição Estadual cadastrada mantém indicador_ie do flag interno (não força contribuinte sem dado nenhum)', async () => {
    mockExecuteByQuery(
      baseInvoiceRow({ company_id: null, person_type: 'PJ', company_name: 'Cliente PJ', icms_taxpayer: '9', client_state_reg: null }),
      [{ ncm_code: '12345678', name: 'Item 1', quantity: '1', unit_price: '100.00' }],
    );
    companyRows = [{
      id: COMPANY_DEFAULT, is_default: true, is_active: true,
      cnpj: '11444777000161', razao_social: 'Empresa Padrão Ltda',
      focus_ambiente: 2, focus_token_homologacao: 'hml-token', focus_token_producao: null,
      uf: 'SP', cfop_padrao: '5102', cfop_interestadual: '6102', regime_tributario: 1,
      emite_nfe: true, emite_nfse: true,
    }];

    const sqsMock = (await import('../lib/sqsClient')).getSqsClient();
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/emit?tenant_id=${TENANT_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
    const sentBody = JSON.parse((sqsMock.send as any).mock.calls[0][0].input.MessageBody);
    expect(sentBody.destinatario.indicador_ie).toBe(9);
    expect(sentBody.destinatario.inscricao_estadual).toBeUndefined();
  });

  it('retorna 404 quando a nota não existe (comportamento inalterado)', async () => {
    mockExecuteByQuery(null, []);

    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/emit?tenant_id=${TENANT_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
