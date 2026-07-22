import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// POST /v1/invoices/:id/cancel estendido (migration 0089) — cancelamento
// local continua imediato; o que é novo é a exigência de justificativa
// (≥15 chars) e o enfileiramento do cancelamento junto à SEFAZ quando
// nfe_status já era 'authorized'. Mocka companyService/costCenterStock/
// commissionService/SQS inteiros (services próprios, já testados
// isoladamente) — aqui só o contrato HTTP e o encadeamento.
//
// db.select() usa mockImplementation (nunca mockReturnValueOnce): buildApp()
// dispara sync de RBAC e outros workers em background que também chamam
// select() fora de ordem — um retorno estável por chamada é resiliente a
// isso, mesmo padrão de nfeEmit.test.ts/sellers.test.ts.

vi.mock('../services/companyService', () => ({
  resolveCompanyId: vi.fn(),
  companyResolutionErrorMessage: vi.fn(() => 'erro de resolução de empresa'),
  CompanyDomainError: class CompanyDomainError extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  },
}));
vi.mock('../services/costCenterStock', () => ({ applyEntry: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/commissionService', () => ({ cancelCommission: vi.fn().mockResolvedValue(undefined) }));

const mockSqsSend = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('../lib/sqsClient', () => ({ getSqsClient: vi.fn(() => ({ send: mockSqsSend })) }));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(), update: vi.fn(), insert: vi.fn(), transaction: vi.fn(), execute: vi.fn(),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const INVOICE_ID = '22222222-2222-2222-2222-222222222222';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

const state: { invoiceRow: Record<string, unknown> | null } = { invoiceRow: null };

function makeInvoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID, order_id: null, status: 'issued', nfe_status: null,
    cost_center_id: null, tenant_id: TENANT_ID, company_id: null,
    ...overrides,
  };
}

describe('POST /v1/invoices/:id/cancel — cancelamento local + fiscal (regra 0089)', () => {
  let app: FastifyInstance;
  let resolveCompanyId: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    state.invoiceRow = null;
    process.env.NFE_REQUESTS_QUEUE_URL = 'http://localhost/queue/nfe-requests';
    mockDb.select.mockImplementation(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(state.invoiceRow ? [state.invoiceRow] : []),
    }));
    mockDb.transaction.mockImplementation(async (fn: any) => fn(mockDb));
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) });
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockDb.execute.mockResolvedValue({ rows: [] });
    const companyServiceMod = await import('../services/companyService');
    resolveCompanyId = companyServiceMod.resolveCompanyId as any;
    resolveCompanyId.mockResolvedValue({ focus_ambiente: 2, focus_token_homologacao: 'tok-homolog' });
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('404 quando a nota não existe', async () => {
    state.invoiceRow = null;
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/cancel`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 quando a nota já está cancelada', async () => {
    state.invoiceRow = makeInvoiceRow({ status: 'cancelled' });
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/cancel`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('nota nunca autorizada: cancela local sem exigir justificativa nem chamar SEFAZ', async () => {
    state.invoiceRow = makeInvoiceRow({ nfe_status: null });
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/cancel`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'cancelled' });
    expect(mockSqsSend).not.toHaveBeenCalled();
    expect(resolveCompanyId).not.toHaveBeenCalled();
  });

  it('nota autorizada sem justificativa: 422, nunca chega a cancelar nem a chamar SEFAZ', async () => {
    state.invoiceRow = makeInvoiceRow({ nfe_status: 'authorized' });
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/cancel`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('nfe_cancel_justificativa_invalid');
    // Não chega a cancelar nada localmente nem a chamar o SEFAZ — o único
    // update possível seria dentro da transação de cancelamento.
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  it('nota autorizada com justificativa curta: 422', async () => {
    state.invoiceRow = makeInvoiceRow({ nfe_status: 'authorized' });
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/cancel`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ justificativa: 'curto' }),
    });
    expect(res.statusCode).toBe(422);
  });

  it('nota autorizada com justificativa válida: cancela local e enfileira o cancelamento fiscal', async () => {
    state.invoiceRow = makeInvoiceRow({ nfe_status: 'authorized' });
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/cancel`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ justificativa: 'Cliente desistiu da compra' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'cancelled' });
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(mockSqsSend.mock.calls[0][0].input.MessageBody);
    expect(sentBody).toMatchObject({
      type: 'nfe_cancel', invoice_id: INVOICE_ID, tenant_id: TENANT_ID, focus_ref: INVOICE_ID,
      justificativa: 'Cliente desistiu da compra',
    });
  });

  it('falha ao enfileirar: reverte nfe_status pra authorized e registra o evento, mas o cancelamento local continua valendo', async () => {
    state.invoiceRow = makeInvoiceRow({ nfe_status: 'authorized' });
    mockSqsSend.mockRejectedValueOnce(new Error('SQS indisponível'));

    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/cancel`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ justificativa: 'Cliente desistiu da compra' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'cancelled' });
    // update revertendo nfe_status e insert do evento de falha aconteceram
    // fora da transação — mockDb.update/insert são chamados de novo (além
    // da chamada já feita dentro da transação).
    expect(mockDb.update.mock.calls.length).toBeGreaterThan(1);
    expect(mockDb.insert).toHaveBeenCalled();
  });
});

describe('POST /v1/invoices/:id/cce — Carta de Correção Eletrônica (regra 0089)', () => {
  let app: FastifyInstance;
  let resolveCompanyId: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    state.invoiceRow = null;
    process.env.NFE_REQUESTS_QUEUE_URL = 'http://localhost/queue/nfe-requests';
    mockDb.select.mockImplementation(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(state.invoiceRow ? [state.invoiceRow] : []),
    }));
    mockDb.insert.mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'cce-1' }]) }) });
    mockDb.execute.mockResolvedValue({ rows: [] });
    const companyServiceMod = await import('../services/companyService');
    resolveCompanyId = companyServiceMod.resolveCompanyId as any;
    resolveCompanyId.mockResolvedValue({ focus_ambiente: 2, focus_token_homologacao: 'tok-homolog' });
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('422 quando o texto é curto demais', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/cce`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ correction_text: 'curto' }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('nfe_correction_text_invalid');
  });

  it('404 quando a nota não existe', async () => {
    state.invoiceRow = null;
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/cce`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ correction_text: 'Corrige o endereço de entrega do destinatário' }),
    });
    expect(res.statusCode).toBe(404);
  });

  it('422 quando a nota não está autorizada', async () => {
    state.invoiceRow = { id: INVOICE_ID, nfe_status: 'draft', company_id: null };
    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/cce`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ correction_text: 'Corrige o endereço de entrega do destinatário' }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('nfe_correction_requires_authorized');
  });

  it('202 e enfileira a CC-e quando a nota está autorizada', async () => {
    state.invoiceRow = { id: INVOICE_ID, nfe_status: 'authorized', company_id: null };

    const res = await app.inject({
      method: 'POST', url: `/v1/invoices/${INVOICE_ID}/cce`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ correction_text: 'Corrige o endereço de entrega do destinatário' }),
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ ok: true, sequencia: 1, status: 'pending' });
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(mockSqsSend.mock.calls[0][0].input.MessageBody);
    expect(sentBody).toMatchObject({ type: 'cce', invoice_id: INVOICE_ID, sequencia: 1 });
  });
});
