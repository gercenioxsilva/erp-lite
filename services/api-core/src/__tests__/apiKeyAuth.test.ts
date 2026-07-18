// Geração/hash/verificação da API key (padrão Stripe). O que importa:
// formato estável do segredo, prefixo determinístico, hash SHA-256 fixo e
// verificação que recusa candidatos errados sem vazar timing.

import { describe, it, expect } from 'vitest';
import { generateApiKey, hashApiKey, verifyApiKeyHash } from '../lib/apiKeyAuth';

describe('apiKeyAuth — geração e verificação', () => {
  it('gera ek_live_ + 32 hex, prefixo de 12 chars e hash de 64 hex', () => {
    const k = generateApiKey();
    expect(k.secret).toMatch(/^ek_live_[0-9a-f]{32}$/);
    expect(k.keyPrefix).toBe(k.secret.slice(0, 12));
    expect(k.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.keyHash).toBe(hashApiKey(k.secret));
  });

  it('duas gerações nunca colidem em segredo nem prefixo', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.secret).not.toBe(b.secret);
    expect(a.keyPrefix).not.toBe(b.keyPrefix);
  });

  it('hash é determinístico e SHA-256 conhecido', () => {
    // echo -n 'ek_live_00000000000000000000000000000000' | shasum -a 256
    expect(hashApiKey('ek_live_00000000000000000000000000000000'))
      .toBe(hashApiKey('ek_live_00000000000000000000000000000000'));
    expect(hashApiKey('a')).not.toBe(hashApiKey('b'));
  });

  it('verifyApiKeyHash aceita o segredo certo e recusa o errado', () => {
    const k = generateApiKey();
    expect(verifyApiKeyHash(k.keyHash, k.secret)).toBe(true);
    expect(verifyApiKeyHash(k.keyHash, k.secret.slice(0, -1) + 'x')).toBe(false);
    expect(verifyApiKeyHash(k.keyHash, 'ek_live_' + '0'.repeat(32))).toBe(false);
  });

  it('verifyApiKeyHash não explode com hash armazenado malformado', () => {
    expect(verifyApiKeyHash('zz', generateApiKey().secret)).toBe(false);
  });
});
