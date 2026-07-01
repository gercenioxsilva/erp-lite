import { describe, it, expect } from 'vitest';
import {
  isValidCNPJ,
  isValidAlphanumericCNPJ,
  isValidNumericCNPJ,
  normalizeCNPJ,
  formatCNPJ,
  parseCNPJ,
} from '../domain/cnpj/cnpjDomain';

// ── CNPJs de referência ───────────────────────────────────────────────────────
// Computados pelo algoritmo correto (base-36, W2 com 13 pesos):
//   AAAAAA00000171  (base AAAAAA000001, dv1=7, dv2=1)
//   B2C3D4E5F6G185  (base B2C3D4E5F6G1, dv1=8, dv2=5)
//   ORQUESTRA202515 (base ORQUESTRA2025, dv1=1, dv2=5)
// CNPJs numéricos clássicos (mantêm validade retroativa):
//   11444777000161  (tradicional, bem conhecido)
// CNPJ estrutural (formato OK, dígitos errados):
//   UKPVME1E8HI996  (citado pelo CNPJ.ws como teste de API — NÃO valida digitalmente)

// ── normalizeCNPJ ─────────────────────────────────────────────────────────────

describe('normalizeCNPJ', () => {
  it('removes punctuation and uppercases', () => {
    expect(normalizeCNPJ('11.444.777/0001-61')).toBe('11444777000161');
  });

  it('preserves letters (unlike digits())', () => {
    expect(normalizeCNPJ('AA.BBB.CCC/0001-12')).toBe('AABBBCCC000112');
  });

  it('uppercases lowercase input', () => {
    expect(normalizeCNPJ('aaaaaa00000171')).toBe('AAAAAA00000171');
  });

  it('strips spaces', () => {
    expect(normalizeCNPJ('11 444 777 0001 61')).toBe('11444777000161');
  });

  it('does NOT strip letters (critical difference from digits())', () => {
    const normalized = normalizeCNPJ('AB.CDE.FGH/1234-56');
    expect(normalized).toContain('A');
    expect(normalized).toContain('B');
    expect(normalized).not.toMatch(/[.\-\/]/);
  });
});

// ── formatCNPJ ────────────────────────────────────────────────────────────────

describe('formatCNPJ', () => {
  it('formats numeric CNPJ to XX.XXX.XXX/XXXX-XX', () => {
    expect(formatCNPJ('11444777000161')).toBe('11.444.777/0001-61');
  });

  it('formats alphanumeric CNPJ preserving letters', () => {
    expect(formatCNPJ('AAAAAA00000171')).toBe('AA.AAA.A00/0001-71');
  });

  it('handles already-formatted input', () => {
    expect(formatCNPJ('11.444.777/0001-61')).toBe('11.444.777/0001-61');
  });

  it('handles partial input gracefully', () => {
    expect(formatCNPJ('11')).toBe('11');
    expect(formatCNPJ('11444')).toBe('11.444');
    expect(formatCNPJ('11444777')).toBe('11.444.777');
  });
});

// ── isValidAlphanumericCNPJ ───────────────────────────────────────────────────

describe('isValidAlphanumericCNPJ', () => {
  it('validates AAAAAA00000171 (computed valid)', () => {
    expect(isValidAlphanumericCNPJ('AAAAAA00000171')).toBe(true);
  });

  it('validates B2C3D4E5F6G185 (computed valid)', () => {
    expect(isValidAlphanumericCNPJ('B2C3D4E5F6G185')).toBe(true);
  });

  it('validates ORQUESTRA01269 (computed valid, base ORQUESTRA012)', () => {
    expect(isValidAlphanumericCNPJ('ORQUESTRA01269')).toBe(true);
  });

  it('validates ZZTESTE0000198 (computed valid)', () => {
    expect(isValidAlphanumericCNPJ('ZZTESTE0000198')).toBe(true);
  });

  it('validates 11444777000161 (pure numeric is also valid via unified engine)', () => {
    expect(isValidAlphanumericCNPJ('11444777000161')).toBe(true);
  });

  it('rejects wrong check digit (AAAAAA00000172 vs correct 71)', () => {
    expect(isValidAlphanumericCNPJ('AAAAAA00000172')).toBe(false);
  });

  it('rejects wrong DV1 (AAAAAA00000181 vs correct 71)', () => {
    expect(isValidAlphanumericCNPJ('AAAAAA00000181')).toBe(false);
  });

  it('rejects input that is too short', () => {
    expect(isValidAlphanumericCNPJ('AAAAAA000001')).toBe(false);
  });

  it('rejects input that is too long (15 chars after normalize)', () => {
    // normalizeCNPJ does NOT truncate; length check in isValidAlphanumericCNPJ catches it.
    expect(isValidAlphanumericCNPJ('AAAAAA000001711')).toBe(false);
  });

  it('auto-normalizes lowercase to uppercase and validates', () => {
    // The domain normalizes input: lowercase is accepted (better UX).
    // Callers are responsible for storing the normalized (uppercase) version.
    expect(isValidAlphanumericCNPJ('aaaaaa00000171')).toBe(true);
  });

  it('accepts masked input (with punctuation)', () => {
    expect(isValidAlphanumericCNPJ('AA.AAA.A00/0001-71')).toBe(true);
  });

  it('rejects check digits that are not numeric (e.g., letters in positions 13-14)', () => {
    // Format requires [A-Z0-9]{12}[0-9]{2} — last 2 must be digits
    expect(isValidAlphanumericCNPJ('AAAAAA0000ABCD')).toBe(false);
  });

  it('UKPVME1E8HI996 is structural only — does NOT validate digitally', () => {
    // This CNPJ from CNPJ.ws API docs has correct FORMAT but wrong check digits.
    // It is a demo CNPJ for API structure testing, not for digit verification.
    expect(isValidAlphanumericCNPJ('UKPVME1E8HI996')).toBe(false);
  });
});

// ── isValidNumericCNPJ ────────────────────────────────────────────────────────

describe('isValidNumericCNPJ', () => {
  it('validates classic 11444777000161', () => {
    expect(isValidNumericCNPJ('11444777000161')).toBe(true);
  });

  it('validates with mask 11.444.777/0001-61', () => {
    expect(isValidNumericCNPJ('11.444.777/0001-61')).toBe(true);
  });

  it('rejects all-same-digit CNPJ (00000000000000)', () => {
    expect(isValidNumericCNPJ('00000000000000')).toBe(false);
  });

  it('rejects wrong check digit (11444777000162)', () => {
    expect(isValidNumericCNPJ('11444777000162')).toBe(false);
  });

  it('rejects string with letters', () => {
    expect(isValidNumericCNPJ('AAAAAA00000171')).toBe(false);
  });
});

// ── isValidCNPJ (ponto de entrada principal) ──────────────────────────────────

describe('isValidCNPJ (unified — numeric + alphanumeric)', () => {
  // Numeric (backward compat)
  it('validates classic numeric CNPJ', () => {
    expect(isValidCNPJ('11.444.777/0001-61')).toBe(true);
  });

  it('rejects all-same-digit numeric CNPJ', () => {
    expect(isValidCNPJ('00000000000000')).toBe(false);
    expect(isValidCNPJ('11111111111111')).toBe(false);
  });

  // Alphanumeric (new format)
  it('validates alphanumeric CNPJ AAAAAA00000171', () => {
    expect(isValidCNPJ('AAAAAA00000171')).toBe(true);
  });

  it('validates alphanumeric CNPJ ORQUESTRA01269', () => {
    expect(isValidCNPJ('ORQUESTRA01269')).toBe(true);
  });

  it('validates alphanumeric with mask AA.AAA.A00/0001-71', () => {
    expect(isValidCNPJ('AA.AAA.A00/0001-71')).toBe(true);
  });

  it('rejects alphanumeric with wrong digits', () => {
    expect(isValidCNPJ('AAAAAA00000100')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidCNPJ('')).toBe(false);
  });

  it('rejects string too short', () => {
    expect(isValidCNPJ('123456789')).toBe(false);
  });

  it('auto-uppercases lowercase before validation', () => {
    expect(isValidCNPJ('aaaaaa00000171')).toBe(true);
  });

  // Structural CNPJ.ws test — format valid, digits wrong
  it('rejects UKPVME1E8HI996 (format-valid structural demo, wrong check digits)', () => {
    expect(isValidCNPJ('UKPVME1E8HI996')).toBe(false);
  });
});

// ── parseCNPJ ─────────────────────────────────────────────────────────────────

describe('parseCNPJ', () => {
  it('returns full parse result for valid numeric CNPJ', () => {
    const result = parseCNPJ('11.444.777/0001-61');
    expect(result.isValid).toBe(true);
    expect(result.normalized).toBe('11444777000161');
    expect(result.formatted).toBe('11.444.777/0001-61');
    expect(result.isAlphanumeric).toBe(false);
    expect(result.dv1).toBe(6);
    expect(result.dv2).toBe(1);
  });

  it('returns full parse result for valid alphanumeric CNPJ', () => {
    const result = parseCNPJ('AAAAAA00000171');
    expect(result.isValid).toBe(true);
    expect(result.normalized).toBe('AAAAAA00000171');
    expect(result.isAlphanumeric).toBe(true);
    expect(result.dv1).toBe(7);
    expect(result.dv2).toBe(1);
  });

  it('returns isValid=false for invalid CNPJ', () => {
    const result = parseCNPJ('AAAAAA00000100');
    expect(result.isValid).toBe(false);
    expect(result.dv1).toBeUndefined();
    expect(result.dv2).toBeUndefined();
  });
});
