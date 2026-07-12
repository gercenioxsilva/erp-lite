// E6: gates do assistente que não dependem da API externa —
// feature-flag por ANTHROPIC_API_KEY e sanitização do histórico.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runAssistant, sanitizeHistory, AssistantError, AssistantHistoryMessage } from '../services/fiscalAssistantService';
import { isAssistantEnabled, getAnthropic } from '../lib/anthropicClient';

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
