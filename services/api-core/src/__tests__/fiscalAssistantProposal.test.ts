// E7: tool propose_nfse — o assistente monta um RASCUNHO (action) validando o
// cliente server-side; nunca emite. Cliente de outro tenant não vira proposta.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createMock, recordMock, resolveCompanyMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  recordMock: vi.fn(),
  resolveCompanyMock: vi.fn(),
}));

vi.mock('../lib/anthropicClient', () => ({
  getAnthropic: () => ({ messages: { create: createMock } }),
  isAssistantEnabled: () => true,
  assistantModel: () => 'claude-sonnet-5',
}));
vi.mock('../services/fiscalScoreService', () => ({ computeScore: vi.fn() }));
vi.mock('../services/simuladorService', () => ({ getProjecao: vi.fn() }));
const { listApuracoesMock } = vi.hoisted(() => ({ listApuracoesMock: vi.fn() }));
vi.mock('../services/apuracaoService', () => ({ listApuracoes: listApuracoesMock }));
vi.mock('../services/fiscalAlertService', () => ({ listAlerts: vi.fn(async () => []) }));
vi.mock('../services/fiscalRevenueService', () => ({ revenueByCompetencia: vi.fn(async () => ({})) }));
vi.mock('../services/companyService', () => ({
  resolveCompanyId: resolveCompanyMock,
  CompanyDomainError: class CompanyDomainError extends Error {},
}));
vi.mock('../services/fiscalAuditService', () => ({ record: recordMock }));

import { runAssistant } from '../services/fiscalAssistantService';

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const USER = '00000000-0000-0000-0000-0000000000bb';

const proposeResponse = (input: Record<string, unknown>) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'tp1', name: 'propose_nfse', input }],
  usage: { input_tokens: 200, output_tokens: 40 },
});
const textResponse = (text: string) => ({
  stop_reason: 'end_turn', content: [{ type: 'text', text }],
  usage: { input_tokens: 80, output_tokens: 20 },
});

/** db fake que devolve respostas na ORDEM das queries do fluxo. */
function queuedDb(responses: Array<{ rows: any[] }>) {
  const q = [...responses];
  return { execute: vi.fn(async () => q.shift() ?? { rows: [] }) } as any;
}

beforeEach(() => {
  createMock.mockReset();
  recordMock.mockReset(); recordMock.mockResolvedValue({ duplicate: false, event: null });
  resolveCompanyMock.mockReset();
  resolveCompanyMock.mockResolvedValue({ id: 'comp-1', aliquota_iss_padrao: '5', codigo_servico_padrao: '0107' });
  listApuracoesMock.mockReset(); listApuracoesMock.mockResolvedValue([]);
});

describe('propose_nfse', () => {
  it('cliente válido → devolve action nfse_proposal com defaults resolvidos server-side', async () => {
    createMock
      .mockResolvedValueOnce(proposeResponse({ client_id: 'client-1', amount: 1500 }))
      .mockResolvedValueOnce(textResponse('Rascunho pronto — confirme na tela.'));
    // Ordem das queries: cap diário → assertClientInTenant → lastEmissionDefaults.
    const db = queuedDb([
      { rows: [{ n: 0 }] },
      { rows: [{ id: 'client-1', nome: 'ACME Ltda' }] },
      { rows: [{ service_code: '0107', iss_rate: '5.00', iss_retido: false, description: 'Consultoria', amount: '1000.00' }] },
    ]);

    const r = await runAssistant({ tenantId: TENANT, userId: USER, message: 'gera nota pra ACME de 1500' }, db);

    expect(r.action?.type).toBe('nfse_proposal');
    const draft = (r.action as any).draft;
    expect(draft).toMatchObject({
      client_id: 'client-1', client_name: 'ACME Ltda', company_id: 'comp-1',
      amount: 1500, service_code: '0107', iss_rate: 5, iss_retido: false, description: 'Consultoria',
    });
    expect(draft.idempotency_key).toBeTruthy();
    // §8(c): auditoria guarda só o TIPO da ação, nunca dados do cliente.
    const payload = (recordMock.mock.calls[0][0] as any).responsePayload;
    expect(payload.action_type).toBe('nfse_proposal');
    expect(JSON.stringify(payload)).not.toContain('ACME');
  });

  it('cliente de outro tenant (não encontrado) → is_error, NENHUMA proposta', async () => {
    createMock
      .mockResolvedValueOnce(proposeResponse({ client_id: 'estranho', amount: 999 }))
      .mockResolvedValueOnce(textResponse('Não encontrei esse cliente.'));
    const db = queuedDb([
      { rows: [{ n: 0 }] },
      { rows: [] }, // assertClientInTenant não acha
    ]);

    const r = await runAssistant({ tenantId: TENANT, userId: USER, message: 'gera nota pro cliente estranho' }, db);

    expect(r.action).toBeUndefined();
    const toolResult = createMock.mock.calls[1][0].messages.at(-1).content[0];
    expect(toolResult.is_error).toBe(true);
  });

  it('valor inválido não vira proposta', async () => {
    createMock
      .mockResolvedValueOnce(proposeResponse({ client_id: 'client-1', amount: 0 }))
      .mockResolvedValueOnce(textResponse('Valor precisa ser maior que zero.'));
    const db = queuedDb([{ rows: [{ n: 0 }] }, { rows: [{ id: 'client-1', nome: 'ACME' }] }]);

    const r = await runAssistant({ tenantId: TENANT, userId: USER, message: 'gera nota de zero' }, db);
    expect(r.action).toBeUndefined();
  });
});

describe('get_guia_impostos', () => {
  const guiaResponse = (competencia: string) => ({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 'tg1', name: 'get_guia_impostos', input: { competencia } }],
    usage: { input_tokens: 100, output_tokens: 20 },
  });

  it('competência apurada → action open_guia com DAS e vencimento', async () => {
    listApuracoesMock.mockResolvedValue([{ id: 'ap-1', competencia: '2026-06', das_total: '4040.00' }]);
    createMock
      .mockResolvedValueOnce(guiaResponse('2026-06'))
      .mockResolvedValueOnce(textResponse('Aqui está sua guia de junho.'));
    const db = queuedDb([{ rows: [{ n: 0 }] }]);

    const r = await runAssistant({ tenantId: TENANT, userId: USER, message: 'gera a guia de junho' }, db);
    expect(r.action).toEqual({ type: 'open_guia', apuracaoId: 'ap-1', competencia: '2026-06', dasTotal: 4040, vencimento: '2026-07-20' });
  });

  it('competência não apurada → sem action (instrui a apurar)', async () => {
    listApuracoesMock.mockResolvedValue([]);
    createMock
      .mockResolvedValueOnce(guiaResponse('2026-06'))
      .mockResolvedValueOnce(textResponse('Apure a competência primeiro.'));
    const db = queuedDb([{ rows: [{ n: 0 }] }]);

    const r = await runAssistant({ tenantId: TENANT, userId: USER, message: 'guia de junho' }, db);
    expect(r.action).toBeUndefined();
  });
});
