// Rate limiter de janela deslizante em memória — puro e testável (o relógio
// entra por parâmetro). Suficiente para o Engine v1: uma instância de
// api-core por ambiente. LIMITAÇÃO DOCUMENTADA: em multi-instância o limite
// vale POR INSTÂNCIA (limite efetivo = N × limite) — a versão distribuída
// (Redis) fica para quando houver mais de uma task no ECS.

const WINDOW_MS = 60_000;

// Timestamps das chamadas aceitas na última janela, por chave.
const hits = new Map<string, number[]>();

/** true = dentro do limite (a chamada é registrada); false = 429. */
export function allowRequest(key: string, limitPerMin: number, nowMs: number = Date.now()): boolean {
  const cutoff = nowMs - WINDOW_MS;
  const prev = (hits.get(key) ?? []).filter((t) => t > cutoff);
  if (prev.length >= limitPerMin) {
    hits.set(key, prev); // ainda poda os expirados — janela não cresce sem limite
    return false;
  }
  hits.set(key, [...prev, nowMs]);
  return true;
}

/** Chamadas restantes na janela corrente (para o header X-RateLimit-Remaining). */
export function remainingRequests(key: string, limitPerMin: number, nowMs: number = Date.now()): number {
  const cutoff = nowMs - WINDOW_MS;
  const inWindow = (hits.get(key) ?? []).filter((t) => t > cutoff).length;
  return Math.max(0, limitPerMin - inWindow);
}

/** Só para testes: zera o estado global. */
export function resetRateLimiter(): void {
  hits.clear();
}
