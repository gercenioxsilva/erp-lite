// E6: loop tool-use do assistente com cliente Anthropic MOCKADO — cobre os
// gates dinâmicos: identidade da closure (nunca do modelo), truncamento de
// tool output, tool desconhecida vira is_error, cap diário, refusal e o
// teto de 6 iterações. Complementa fiscalAssistant.test.ts (gates estáticos).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted: os factories de vi.mock rodam antes dos imports do módulo sob
// teste — mocks declarados com const comum cairiam em TDZ.
const { createMock, computeScoreMock, recordMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  computeScoreMock: vi.fn(),
  recordMock: vi.fn(),
}));

vi.mock('../lib/anthropicClient', () => ({
  getAnthropic: () => ({ messages: { create: createMock } }),
  isAssistantEnabled: () => true,
  assistantModel: () => 'claude-sonnet-5',
}));
vi.mock('../services/fiscalScoreService', () => ({ computeScore: computeScoreMock }));
vi.mock('../services/simuladorService', () => ({ getProjecao: vi.fn(async () => ({ projecao: { dasProjetado: 4040 } })) }));
vi.mock('../services/apuracaoService', () => ({ listApuracoes: vi.fn(async () => []) }));
vi.mock('../services/fiscalAlertService', () => ({ listAlerts: vi.fn(async () => []) }));
vi.mock('../services/fiscalRevenueService', () => ({ revenueByCompetencia: vi.fn(async () => ({})) }));
vi.mock('../services/companyService', () => ({ resolveCompanyId: vi.fn(async () => ({ id: 'comp-1' })) }));
vi.mock('../services/fiscalAuditService', () => ({ record: recordMock }));

import { runAssistant } from '../services/fiscalAssistantService';

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const USER = '00000000-0000-0000-0000-0000000000bb';

// db fake: só o execute do cap diário é usado pelo serviço.
const dbWithUsage = (used: number) => ({ execute: vi.fn(async () => ({ rows: [{ n: used }] })) }) as any;

const textResponse = (text: string, stop = 'end_turn') => ({
  stop_reason: stop, content: [{ type: 'text', text }],
  usage: { input_tokens: 100, output_tokens: 50 },
});
const toolUseResponse = (name: string, id = 'tu1') => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name, input: {} }],
  usage: { input_tokens: 200, output_tokens: 30 },
});

const lastMessage = (messages: any[]) => messages[messages.length - 1];

const run = (overrides: Partial<Parameters<typeof runAssistant>[0]> = {}, db = dbWithUsage(0)) =>
  runAssistant({ tenantId: TENANT, userId: USER, message: 'quanto vou pagar de DAS?', ...overrides }, db);

beforeEach(() => {
  createMock.mockReset();
  recordMock.mockReset();
  recordMock.mockResolvedValue({ duplicate: false, event: null });
  computeScoreMock.mockReset();
  computeScoreMock.mockResolvedValue({ score: 96, breakdown: [], findings: [] });
});

describe('runAssistant — loop tool-use', () => {
  it('resposta direta (end_turn): devolve o texto e loga só metadata', async () => {
    createMock.mockResolvedValueOnce(textResponse('Seu DAS projetado é R$ 4.040,00 (2026-07, simulador).'));
    const r = await run();
    expect(r.reply).toContain('4.040');
    expect(r.tools_used).toEqual([]);
    expect(r.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
    // LGPD: o evento carrega tokens/tools, nunca o conteúdo da conversa.
    const payload = (recordMock.mock.calls[0][0] as any).responsePayload;
    expect(payload).toMatchObject({ input_tokens: 100, output_tokens: 50, tools_used: [] });
    expect(JSON.stringify(payload)).not.toContain('quanto vou pagar');
  });

  it('tool_use: executa com tenant/company da CLOSURE e devolve tool_result ao modelo', async () => {
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_score'))
      .mockResolvedValueOnce(textResponse('Score 96/100 (fonte: get_score).'));
    const r = await run({ companyId: 'comp-9' });

    expect(r.tools_used).toEqual(['get_score']);
    // Identidade vem dos args do JWT, nunca do input do modelo:
    expect(computeScoreMock).toHaveBeenCalledWith(TENANT, 'comp-9', expect.anything());
    // 2ª chamada recebe assistant(tool_use) + user(tool_result) no fim:
    const msgs = createMock.mock.calls[1][0].messages;
    const toolResult = msgs[msgs.length - 1];
    expect(toolResult.role).toBe('user');
    expect(toolResult.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1' });
    expect(toolResult.content[0].content).toContain('96');
    // Tokens acumulam pelas 2 iterações:
    expect(r.usage).toEqual({ input_tokens: 300, output_tokens: 80 });
  });

  it('tool desconhecida (alucinada) vira tool_result is_error genérico — nunca executa', async () => {
    createMock
      .mockResolvedValueOnce(toolUseResponse('drop_tables'))
      .mockResolvedValueOnce(textResponse('Não consegui consultar.'));
    await run();
    const toolResult = lastMessage(createMock.mock.calls[1][0].messages).content[0];
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).not.toContain('drop_tables'); // sem vazar detalhe ao modelo
  });

  it('tool output gigante é truncado a ~4KB', async () => {
    computeScoreMock.mockResolvedValueOnce({ score: 96, blob: 'x'.repeat(20_000) } as any);
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_score'))
      .mockResolvedValueOnce(textResponse('ok'));
    await run();
    const content: string = lastMessage(createMock.mock.calls[1][0].messages).content[0].content;
    expect(content.length).toBeLessThan(4_100);
    expect(content.endsWith('…[truncado]')).toBe(true);
  });

  it('cap diário estourado → assistant_daily_cap sem chamar o modelo', async () => {
    await expect(run({}, dbWithUsage(50))).rejects.toMatchObject({ code: 'assistant_daily_cap' });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('refusal vira mensagem fixa de recusa', async () => {
    createMock.mockResolvedValueOnce(textResponse('', 'refusal'));
    const r = await run();
    expect(r.reply).toContain('Não consigo responder');
  });

  it('modelo insistindo em tools para no teto de 6 iterações', async () => {
    createMock.mockResolvedValue(toolUseResponse('get_score'));
    await run();
    expect(createMock).toHaveBeenCalledTimes(6);
  });

  it('parâmetros do create: modelo, max_tokens 1500 e SEM temperature', async () => {
    createMock.mockResolvedValueOnce(textResponse('oi'));
    await run();
    const params = createMock.mock.calls[0][0];
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.max_tokens).toBe(1500);
    expect(params).not.toHaveProperty('temperature');
    expect(params.system).toContain('NUNCA calcule');
  });
});
