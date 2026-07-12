// Cliente Anthropic — molde de stripeClient: lazy singleton gated por env.
// Sem ANTHROPIC_API_KEY o assistente fica inerte (rota devolve 503).

import Anthropic from '@anthropic-ai/sdk';

let _anthropic: Anthropic | null = null;

export function getAnthropic(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

export function isAssistantEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Lido a cada chamada (não em módulo-load) para não depender da ordem do dotenv.
export function assistantModel(): string {
  return process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
}
