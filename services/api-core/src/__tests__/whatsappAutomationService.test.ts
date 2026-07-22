import { describe, it, expect, vi, beforeEach } from 'vitest';

// dispatch() (regra 83) — visibilidade do disparo automático. Bug real:
// falha de elegibilidade (conta não conectada, template não aprovado,
// cliente sem opt-in, telefone inválido) era só um console.warn perdido,
// nunca visível pro tenant. Agora toda tentativa REAL (automação habilitada
// + não já disparada) grava last_attempt_status/last_skip_reason na própria
// linha de whatsapp_automations.

const mockSendTemplateMessage = vi.hoisted(() => vi.fn());
vi.mock('../services/whatsappMessageService', () => ({
  sendTemplateMessage: mockSendTemplateMessage,
}));

const mockDb = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

import { notifyFiscalDocumentAuthorized } from '../services/whatsappAutomationService';
import { WhatsAppDomainError } from '../domain/whatsapp/whatsappDomain';

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID  = '22222222-2222-2222-2222-222222222222';
const INVOICE_ID = '33333333-3333-3333-3333-333333333333';

function selectChain(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return { id: INVOICE_ID, client_id: CLIENT_ID, number: '00001', total: '150.00', ...overrides };
}

describe('dispatch() via notifyFiscalDocumentAuthorized — registro de tentativa (regra 83)', () => {
  let updateSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    updateSet = vi.fn().mockReturnValue({ where: () => Promise.resolve(undefined) });
    mockDb.update.mockReturnValue({ set: updateSet });
  });

  it('automação desligada: nem chega a chamar sendTemplateMessage nem grava tentativa', async () => {
    mockDb.select
      .mockReturnValueOnce(selectChain([{ enabled: false }])); // isAutomationEnabled

    await notifyFiscalDocumentAuthorized(TENANT_ID, makeInvoice());

    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('já disparado antes (idempotência): não chama sendTemplateMessage nem regrava tentativa', async () => {
    mockDb.select
      .mockReturnValueOnce(selectChain([{ enabled: true }]))   // isAutomationEnabled
      .mockReturnValueOnce(selectChain([{ id: 'msg-1' }]));    // alreadyDispatched

    await notifyFiscalDocumentAuthorized(TENANT_ID, makeInvoice());

    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('envio com sucesso: grava last_attempt_status=sent, last_skip_reason=null', async () => {
    mockDb.select
      .mockReturnValueOnce(selectChain([{ enabled: true }]))
      .mockReturnValueOnce(selectChain([]));
    mockSendTemplateMessage.mockResolvedValue(undefined);

    await notifyFiscalDocumentAuthorized(TENANT_ID, makeInvoice());

    expect(mockSendTemplateMessage).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      last_attempt_status: 'sent', last_skip_reason: null,
    }));
  });

  it('conta não conectada: grava last_attempt_status=skipped com o código do erro de domínio', async () => {
    mockDb.select
      .mockReturnValueOnce(selectChain([{ enabled: true }]))
      .mockReturnValueOnce(selectChain([]));
    mockSendTemplateMessage.mockRejectedValue(new WhatsAppDomainError('account_not_connected'));

    await notifyFiscalDocumentAuthorized(TENANT_ID, makeInvoice());

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      last_attempt_status: 'skipped', last_skip_reason: 'account_not_connected',
    }));
  });

  it('template não aprovado: grava o código correspondente', async () => {
    mockDb.select
      .mockReturnValueOnce(selectChain([{ enabled: true }]))
      .mockReturnValueOnce(selectChain([]));
    mockSendTemplateMessage.mockRejectedValue(new WhatsAppDomainError('template_not_approved'));

    await notifyFiscalDocumentAuthorized(TENANT_ID, makeInvoice());

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      last_attempt_status: 'skipped', last_skip_reason: 'template_not_approved',
    }));
  });

  it('erro não mapeado (ex.: exceção genérica) grava last_skip_reason=unknown_error, nunca lança pro chamador', async () => {
    mockDb.select
      .mockReturnValueOnce(selectChain([{ enabled: true }]))
      .mockReturnValueOnce(selectChain([]));
    mockSendTemplateMessage.mockRejectedValue(new Error('boom'));

    await expect(notifyFiscalDocumentAuthorized(TENANT_ID, makeInvoice())).resolves.toBeUndefined();

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      last_attempt_status: 'skipped', last_skip_reason: 'unknown_error',
    }));
  });

  it('invoice sem client_id: nem chega a checar automação (edge case pré-existente, sem regressão)', async () => {
    await notifyFiscalDocumentAuthorized(TENANT_ID, makeInvoice({ client_id: null }));

    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});
