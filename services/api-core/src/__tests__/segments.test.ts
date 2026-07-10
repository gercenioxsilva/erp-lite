// Validação das chaves de segmento + cor hex usadas por /auth/register e
// PATCH /v1/tenant (branding, migration 0065). O catálogo completo (nomes,
// paletas, labels) vive no frontend; o backend só precisa validar a chave.

import { describe, it, expect } from 'vitest';
import { SEGMENT_KEYS, isValidSegmentKey, HEX_COLOR_RE } from '../lib/segments';

describe('isValidSegmentKey', () => {
  it('aceita todas as chaves do catálogo', () => {
    for (const key of SEGMENT_KEYS) expect(isValidSegmentKey(key)).toBe(true);
  });

  it('rejeita chave desconhecida', () => {
    expect(isValidSegmentKey('padaria')).toBe(false);
    expect(isValidSegmentKey('')).toBe(false);
    expect(isValidSegmentKey('GENERIC')).toBe(false); // case-sensitive
  });

  it('inclui os segmentos-semente esperados', () => {
    expect(SEGMENT_KEYS).toContain('generic');
    expect(SEGMENT_KEYS).toContain('barbershop');
    expect(SEGMENT_KEYS).toContain('driving_school');
    expect(SEGMENT_KEYS).toContain('compressors');
  });
});

describe('HEX_COLOR_RE — cor de branding #RRGGBB', () => {
  it('aceita hex de 6 dígitos (maiúsculo/minúsculo)', () => {
    expect(HEX_COLOR_RE.test('#3B5CE4')).toBe(true);
    expect(HEX_COLOR_RE.test('#ffffff')).toBe(true);
  });

  it('rejeita formatos inválidos (3 dígitos, sem #, com alfa, texto)', () => {
    for (const bad of ['#FFF', '3B5CE4', '#3B5CE4FF', '#GGGGGG', 'red', '']) {
      expect(HEX_COLOR_RE.test(bad)).toBe(false);
    }
  });
});
