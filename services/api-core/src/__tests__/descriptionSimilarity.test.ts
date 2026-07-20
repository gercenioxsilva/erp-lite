// Similaridade lexical de descrições — fallback/pré-filtro da conciliação
// semântica. Invariantes: simétrica, 0..1, ignora acento/número/ruído bancário,
// alta para mesma contraparte, baixa para contrapartes distintas.

import { describe, it, expect } from 'vitest';
import {
  normalizeDescription, tokenize, lexicalSimilarity, SEMANTIC_KEY_FLOOR,
} from '../domain/reconciliation/descriptionSimilarity';

describe('normalizeDescription', () => {
  it('remove acento, caixa, dígitos e pontuação', () => {
    expect(normalizeDescription('PAGTO Fulano LTDA — NF 123')).toBe('pagto fulano ltda nf');
    expect(normalizeDescription('Café & Cia. 2026/07')).toBe('cafe cia');
    expect(normalizeDescription(null)).toBe('');
    expect(normalizeDescription('   ')).toBe('');
  });
});

describe('tokenize', () => {
  it('descarta ruído bancário e tokens curtos (< 3 letras)', () => {
    expect(tokenize(normalizeDescription('PAGTO FULANO LTDA'))).toEqual(['fulano']);
    expect(tokenize(normalizeDescription('Fulano Ltda NF 123'))).toEqual(['fulano']);
    expect(tokenize(normalizeDescription('PIX TED DOC'))).toEqual([]);
  });
});

describe('lexicalSimilarity', () => {
  it('é 0 quando falta descrição de um dos lados', () => {
    expect(lexicalSimilarity(null, 'Fulano')).toBe(0);
    expect(lexicalSimilarity('Fulano', '')).toBe(0);
    expect(lexicalSimilarity('PIX', 'TED')).toBe(0); // só ruído → sem token
  });

  it('mesma contraparte com ruído distinto → alta (acima do piso semântico)', () => {
    const s = lexicalSimilarity('PAGTO FULANO LTDA', 'Fulano Ltda — NF 123');
    expect(s).toBeGreaterThanOrEqual(SEMANTIC_KEY_FLOOR);
  });

  it('é simétrica', () => {
    const a = lexicalSimilarity('Mercado Silva Alimentos', 'silva alimentos mercado');
    const b = lexicalSimilarity('silva alimentos mercado', 'Mercado Silva Alimentos');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(SEMANTIC_KEY_FLOOR);
  });

  it('contrapartes semanticamente próximas mas lexicalmente distantes → baixa (caso da IA)', () => {
    // "Mensalidade academia" × "Plano fitness mensal": sentido próximo, léxico
    // distante — é exatamente o caso que só a IA resolve.
    const s = lexicalSimilarity('Mensalidade academia', 'Plano fitness mensal');
    expect(s).toBeLessThan(SEMANTIC_KEY_FLOOR);
  });

  it('contrapartes de fato diferentes → próxima de zero', () => {
    expect(lexicalSimilarity('Padaria do João', 'Auto Peças Central')).toBeLessThan(0.2);
  });
});
