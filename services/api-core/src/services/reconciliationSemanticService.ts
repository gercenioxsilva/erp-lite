// Similaridade semântica de descrição para a conciliação (0086).
//
// Devolve, para uma transação (memo) e seus candidatos, um mapa
// candidateId → similaridade 0..1, usado como componente do score no domínio.
//
// Dois níveis, sempre com degradação graciosa (molde do fiscalAssistant):
//  1. LOCAL (sempre): similaridade lexical determinística — grátis, offline.
//  2. IA (opcional): quando use_ai_matching está ligado E há ANTHROPIC_API_KEY
//     E o caso é ambíguo, uma ÚNICA chamada ao Claude por transação eleva a
//     similaridade onde o léxico não vê o sentido ("academia" ~ "fitness").
// Resultado por candidato = max(local, ia). Sem chave/erro de IA → só o local.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, isAssistantEnabled, assistantModel } from '../lib/anthropicClient';
import { lexicalSimilarity } from '../domain/reconciliation/descriptionSimilarity';

export interface SemanticCandidate {
  id: string;
  description: string | null;
}

// Teto de candidatos enviados ao modelo por transação (controla tokens/custo);
// os candidatos aqui já vêm pré-filtrados por valor, então o conjunto é pequeno.
const MAX_AI_CANDIDATES = 15;
const AI_MAX_TOKENS = 600;

const SYSTEM_PROMPT =
  'Você compara a descrição de um lançamento bancário com descrições de títulos ' +
  '(contas a receber/pagar) de um ERP e estima, para cada candidato, a ' +
  'similaridade de CONTRAPARTE/FINALIDADE (mesma empresa, pessoa ou natureza do ' +
  'gasto/receita), ignorando datas, números de documento e jargão bancário ' +
  '(PIX, TED, PAGTO). Responda SOMENTE com um array JSON, sem texto ao redor: ' +
  '[{"id":"<id>","score":<0..1>}]. score 1 = quase certamente a mesma ' +
  'contraparte; 0 = sem relação.';

function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Extrai o primeiro array JSON de um texto do modelo, tolerante a ruído. */
function parseScores(text: string): Array<{ id: string; score: number }> {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({ id: String(r.id ?? ''), score: clamp01(r.score) }))
    .filter((r) => r.id !== '');
}

/** Camada local, pura — sempre disponível. */
function localMap(memo: string | null, candidates: SemanticCandidate[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of candidates) map.set(c.id, lexicalSimilarity(memo, c.description));
  return map;
}

async function aiScores(
  client: Anthropic, memo: string, candidates: SemanticCandidate[],
): Promise<Map<string, number>> {
  const list = candidates.slice(0, MAX_AI_CANDIDATES)
    .map((c) => ({ id: c.id, descricao: c.description ?? '' }));
  const userPrompt =
    `Lançamento bancário: ${JSON.stringify(memo)}\n` +
    `Candidatos: ${JSON.stringify(list)}\n` +
    'Responda o array JSON de {id,score}.';

  const res = await client.messages.create({
    model: assistantModel(),
    max_tokens: AI_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text).join('\n');

  const out = new Map<string, number>();
  for (const { id, score } of parseScores(text)) out.set(id, score);
  return out;
}

/**
 * Mapa candidateId → similaridade (0..1). Sempre resolve para TODOS os
 * candidatos (via camada local); a IA só refina quando habilitada e possível.
 * Nunca lança: falha de IA cai silenciosamente no local.
 */
export async function scoreDescriptions(
  memo: string | null,
  candidates: SemanticCandidate[],
  opts: { useAi: boolean },
): Promise<Map<string, number>> {
  const local = localMap(memo, candidates);
  if (candidates.length === 0) return local;

  const client = opts.useAi && isAssistantEnabled() ? getAnthropic() : null;
  const trimmedMemo = (memo ?? '').trim();
  if (!client || trimmedMemo === '') return local;

  try {
    const ai = await aiScores(client, trimmedMemo, candidates);
    for (const c of candidates) {
      const merged = Math.max(local.get(c.id) ?? 0, ai.get(c.id) ?? 0);
      local.set(c.id, merged);
    }
    return local;
  } catch (err) {
    // Degradação graciosa: registra e segue só com o local (nunca derruba a rodada).
    console.error(JSON.stringify({ level: 'warn', msg: 'reconciliation_ai_similarity_failed', err: String(err) }));
    return local;
  }
}
