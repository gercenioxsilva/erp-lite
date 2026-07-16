// E6: gates do assistente que não dependem da API externa —
// feature-flag por ANTHROPIC_API_KEY e sanitização do histórico.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runAssistant, sanitizeHistory, dailyCap, AssistantError, AssistantHistoryMessage } from '../services/fiscalAssistantService';
import { isAssistantEnabled, getAnthropic, assistantModel } from '../lib/anthropicClient';

describe('anthropicClient (feature flag)', () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY; });
  afterEach(() => { if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved; });

  it('sem ANTHROPIC_API_KEY: desabilitado, cliente null e runAssistant lança assistant_disabled', async () => {
    expect(isAssistantEnabled()).toBe(false);
    expect(getAnthropic()).toBeNull();
    await expect(runAssistant({
      tenantId: '00000000-0000-0000-0000-000000000000', userId: '00000000-0000-0000-0000-000000000001',
      message: 'quanto vou pagar de DAS?',
    })).rejects.toMatchObject({ code: 'assistant_disabled' } satisfies Partial<AssistantError>);
  });
});

// docker-compose/ECS declaram env com `${VAR:-}`, que entrega STRING VAZIA e não
// variável ausente. `??` só pega null/undefined — vazio passaria direto e viraria
// modelo '' (chamada quebra) ou cap Number('')=0 (todo request 429). Env vazia
// tem que significar "não definida".
describe('env vazia = não definida', () => {
  const salvos: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ['ANTHROPIC_MODEL', 'ASSISTANT_DAILY_CAP']) salvos[k] = process.env[k];
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(salvos)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('ANTHROPIC_MODEL vazio cai no modelo default', () => {
    process.env.ANTHROPIC_MODEL = '';
    expect(assistantModel()).toBe('claude-sonnet-5');
  });

  it('ASSISTANT_DAILY_CAP vazio cai no cap default (nunca 0)', () => {
    process.env.ASSISTANT_DAILY_CAP = '';
    expect(dailyCap()).toBe(50);
  });

  it('valores explícitos continuam mandando', () => {
    process.env.ANTHROPIC_MODEL = 'claude-opus-4-8';
    process.env.ASSISTANT_DAILY_CAP = '7';
    expect(assistantModel()).toBe('claude-opus-4-8');
    expect(dailyCap()).toBe(7);
  });
});

describe('sanitizeHistory (gate de entrada)', () => {
  it('corta a 12 mensagens, remove vazias/roles inválidos e assistant na frente', () => {
    const long: AssistantHistoryMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'assistant' : 'user', content: `m${i}`,
    }));
    const out = sanitizeHistory(long);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out[0].role).toBe('user');

    expect(sanitizeHistory([
      { role: 'assistant', content: 'oi' },
      { role: 'user', content: '   ' },
      { role: 'system' as any, content: 'hack' },
      { role: 'user', content: 'pergunta' },
    ])).toEqual([{ role: 'user', content: 'pergunta' }]);

    expect(sanitizeHistory(undefined)).toEqual([]);
  });
});
