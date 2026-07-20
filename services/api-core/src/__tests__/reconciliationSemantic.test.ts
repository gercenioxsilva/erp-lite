// Serviço de similaridade semântica da conciliação (0086). Invariantes:
// sempre resolve para todos os candidatos (via local), a IA só refina quando
// habilitada, e falha de IA degrada para o local sem lançar.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do cliente Anthropic — controlamos habilitação e resposta por teste.
const create = vi.fn();
let enabled = false;
let client: unknown = null;

vi.mock('../lib/anthropicClient', () => ({
  getAnthropic: () => client,
  isAssistantEnabled: () => enabled,
  assistantModel: () => 'claude-haiku-4-5-20251001',
}));

import { scoreDescriptions } from '../services/reconciliationSemanticService';

const candidates = [
  { id: 'a', description: 'Mensalidade academia' },
  { id: 'b', description: 'Auto Peças Central' },
];

beforeEach(() => {
  create.mockReset();
  enabled = false;
  client = null;
});

describe('scoreDescriptions', () => {
  it('IA desligada (useAi=false) → só local, sem chamar o modelo', async () => {
    enabled = true; client = { messages: { create } }; // habilitado, mas não deve ser usado
    const map = await scoreDescriptions('PIX Plano fitness mensal', candidates, { useAi: false });
    expect(create).not.toHaveBeenCalled();
    expect(map.size).toBe(2);
    expect(map.get('a')).toBeGreaterThanOrEqual(0);
  });

  it('sem ANTHROPIC_API_KEY (isAssistantEnabled=false) → só local', async () => {
    enabled = false; client = null;
    const map = await scoreDescriptions('Plano fitness mensal', candidates, { useAi: true });
    expect(create).not.toHaveBeenCalled();
    expect(map.size).toBe(2);
  });

  it('IA habilitada refina com max(local, ia)', async () => {
    enabled = true; client = { messages: { create } };
    create.mockResolvedValue({ content: [{ type: 'text', text: '[{"id":"a","score":0.92},{"id":"b","score":0.01}]' }] });
    const map = await scoreDescriptions('Plano fitness mensal', candidates, { useAi: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(map.get('a')).toBeCloseTo(0.92, 2); // IA enxerga o sentido que o léxico perde
    // 'b' é lexicalmente ~0 e a IA deu 0.01 → fica ~0
    expect(map.get('b')!).toBeLessThan(0.1);
  });

  it('resposta com ruído ao redor do JSON ainda é parseada', async () => {
    enabled = true; client = { messages: { create } };
    create.mockResolvedValue({ content: [{ type: 'text', text: 'Claro:\n[{"id":"a","score":0.8}]\nEspero ajudar.' }] });
    const map = await scoreDescriptions('academia', candidates, { useAi: true });
    expect(map.get('a')).toBeCloseTo(0.8, 2);
  });

  it('falha da IA degrada para o local sem lançar', async () => {
    enabled = true; client = { messages: { create } };
    create.mockRejectedValue(new Error('529 overloaded'));
    const map = await scoreDescriptions('academia mensal', candidates, { useAi: true });
    expect(map.size).toBe(2); // continua respondendo
  });

  it('memo vazio não chama a IA', async () => {
    enabled = true; client = { messages: { create } };
    const map = await scoreDescriptions('   ', candidates, { useAi: true });
    expect(create).not.toHaveBeenCalled();
    expect(map.size).toBe(2);
  });

  it('lista de candidatos vazia → mapa vazio', async () => {
    enabled = true; client = { messages: { create } };
    const map = await scoreDescriptions('qualquer', [], { useAi: true });
    expect(create).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });
});
