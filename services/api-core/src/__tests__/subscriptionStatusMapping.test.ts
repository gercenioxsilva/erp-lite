import { describe, it, expect, vi } from 'vitest';
import { mapStripeStatus } from '../routes/subscription';

// mapStripeStatus() nunca pode mascarar um status de problema como 'trial' —
// isso era a causa raiz de "todos os produtos voltando trial": assinaturas
// travadas em 'incomplete' (ex.: price_id desatualizado/inválido) caíam no
// default → 'trial', escondendo o problema real atrás de um rótulo errado.

describe('mapStripeStatus', () => {
  it('mapeia status conhecidos corretamente', () => {
    expect(mapStripeStatus('active')).toBe('active');
    expect(mapStripeStatus('trialing')).toBe('trial');
    expect(mapStripeStatus('past_due')).toBe('past_due');
    expect(mapStripeStatus('unpaid')).toBe('past_due');
    expect(mapStripeStatus('canceled')).toBe('canceled');
  });

  it('[regressão] "incomplete" nunca vira trial — vira past_due', () => {
    expect(mapStripeStatus('incomplete')).toBe('past_due');
  });

  it('[regressão] "paused" nunca vira trial — vira past_due', () => {
    expect(mapStripeStatus('paused')).toBe('past_due');
  });

  it('"incomplete_expired" vira canceled (nunca chegou a ativar e expirou)', () => {
    expect(mapStripeStatus('incomplete_expired')).toBe('canceled');
  });

  it('[regressão] status totalmente desconhecido nunca vira trial — vira past_due e loga um aviso', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapStripeStatus('some_future_status')).toBe('past_due');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('some_future_status'));
    warnSpy.mockRestore();
  });
});
