// Janela deslizante do Engine — o relógio entra por parâmetro, então os
// testes são determinísticos sem fake timers.

import { describe, it, expect, beforeEach } from 'vitest';
import { allowRequest, remainingRequests, resetRateLimiter } from '../lib/rateLimiter';

const T0 = 1_700_000_000_000;

describe('rateLimiter — janela deslizante por chave', () => {
  beforeEach(() => resetRateLimiter());

  it('aceita até o limite e recusa a partir dele', () => {
    for (let i = 0; i < 5; i++) expect(allowRequest('k1', 5, T0 + i)).toBe(true);
    expect(allowRequest('k1', 5, T0 + 10)).toBe(false);
  });

  it('a janela DESLIZA: chamadas com mais de 60s saem da conta', () => {
    for (let i = 0; i < 5; i++) expect(allowRequest('k1', 5, T0 + i)).toBe(true);
    expect(allowRequest('k1', 5, T0 + 30_000)).toBe(false);
    // 60s+1ms depois da 1ª chamada: uma vaga liberou.
    expect(allowRequest('k1', 5, T0 + 60_001)).toBe(true);
  });

  it('chaves são independentes', () => {
    for (let i = 0; i < 5; i++) allowRequest('k1', 5, T0 + i);
    expect(allowRequest('k1', 5, T0 + 10)).toBe(false);
    expect(allowRequest('k2', 5, T0 + 10)).toBe(true);
  });

  it('remainingRequests acompanha a janela', () => {
    expect(remainingRequests('k1', 5, T0)).toBe(5);
    allowRequest('k1', 5, T0);
    allowRequest('k1', 5, T0 + 1);
    expect(remainingRequests('k1', 5, T0 + 2)).toBe(3);
    expect(remainingRequests('k1', 5, T0 + 61_000)).toBe(5); // tudo expirou
  });

  it('recusa não consome vaga (a janela não é envenenada por 429s)', () => {
    for (let i = 0; i < 3; i++) allowRequest('k1', 3, T0 + i);
    for (let i = 0; i < 100; i++) expect(allowRequest('k1', 3, T0 + 100 + i)).toBe(false);
    // As 3 aceitas expiram normalmente apesar das 100 recusas no meio.
    expect(allowRequest('k1', 3, T0 + 60_005)).toBe(true);
  });
});
