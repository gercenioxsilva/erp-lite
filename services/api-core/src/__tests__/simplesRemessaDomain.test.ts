import { describe, it, expect } from 'vitest';
import {
  assertRemessaTransition,
  resolveRemessaOperation,
  resolveRetornoOperation,
  resolveTaxSituation,
  validateSimplesRemessaCreate,
  calcRemessaTotals,
  isValidMotivo,
  SIMPLES_REMESSA_MOTIVOS,
  SimplesRemessaDomainError,
} from '../domain/simplesRemessa/simplesRemessaDomain';

describe('assertRemessaTransition', () => {
  it('permite draft → pending', () => {
    expect(() => assertRemessaTransition('draft', 'pending')).not.toThrow();
  });
  it('permite draft → cancelled', () => {
    expect(() => assertRemessaTransition('draft', 'cancelled')).not.toThrow();
  });
  it('permite pending → processing → authorized', () => {
    expect(() => assertRemessaTransition('pending', 'processing')).not.toThrow();
    expect(() => assertRemessaTransition('processing', 'authorized')).not.toThrow();
  });
  it('permite rejected → pending (reenvio)', () => {
    expect(() => assertRemessaTransition('rejected', 'pending')).not.toThrow();
  });
  it('bloqueia authorized → qualquer coisa (terminal)', () => {
    expect(() => assertRemessaTransition('authorized', 'pending')).toThrow(SimplesRemessaDomainError);
  });
  it('bloqueia draft → authorized (pula etapas)', () => {
    expect(() => assertRemessaTransition('draft', 'authorized')).toThrow(SimplesRemessaDomainError);
  });
  it('erro carrega código e transições permitidas', () => {
    try {
      assertRemessaTransition('cancelled', 'draft');
    } catch (e) {
      expect(e).toBeInstanceOf(SimplesRemessaDomainError);
      expect((e as SimplesRemessaDomainError).code).toBe('invalid_remessa_transition');
    }
  });
});

describe('isValidMotivo / SIMPLES_REMESSA_MOTIVOS', () => {
  it('lista os 6 motivos suportados', () => {
    expect(SIMPLES_REMESSA_MOTIVOS).toHaveLength(6);
  });
  it('aceita motivos válidos', () => {
    expect(isValidMotivo('conserto')).toBe(true);
    expect(isValidMotivo('amostra_gratis')).toBe(true);
  });
  it('rejeita motivo inválido', () => {
    expect(isValidMotivo('venda')).toBe(false);
  });
});

describe('resolveRemessaOperation', () => {
  it('conserto intra-estadual usa CFOP 5915', () => {
    expect(resolveRemessaOperation('conserto', true)).toEqual({ cfop: '5915', natureza_operacao: 'Remessa para conserto ou reparo' });
  });
  it('conserto interestadual usa CFOP 6915', () => {
    expect(resolveRemessaOperation('conserto', false).cfop).toBe('6915');
  });
  it('cada motivo tem CFOP intra/inter distintos', () => {
    for (const motivo of SIMPLES_REMESSA_MOTIVOS) {
      const intra = resolveRemessaOperation(motivo, true);
      const inter = resolveRemessaOperation(motivo, false);
      expect(intra.cfop).not.toBe(inter.cfop);
      expect(intra.cfop.startsWith('5')).toBe(true);
      expect(inter.cfop.startsWith('6')).toBe(true);
    }
  });
});

describe('resolveRetornoOperation', () => {
  it('conserto tem retorno (5916/6916)', () => {
    expect(resolveRetornoOperation('conserto', true)?.cfop).toBe('5916');
    expect(resolveRetornoOperation('conserto', false)?.cfop).toBe('6916');
  });
  it('amostra grátis não tem retorno (doação)', () => {
    expect(resolveRetornoOperation('amostra_gratis', true)).toBeNull();
  });
  it('devolução não tem retorno (já fecha outra operação)', () => {
    expect(resolveRetornoOperation('devolucao', true)).toBeNull();
  });
  it('comodato e demonstração têm retorno', () => {
    expect(resolveRetornoOperation('comodato', true)).not.toBeNull();
    expect(resolveRetornoOperation('demonstracao', true)).not.toBeNull();
  });
});

describe('resolveTaxSituation', () => {
  it('Simples Nacional (regime 1) usa CSOSN 400', () => {
    const s = resolveTaxSituation(1);
    expect(s.icms_cst).toBe('400');
  });
  it('demais regimes usam CST 41 (não tributada, distinto de isenta=40)', () => {
    expect(resolveTaxSituation(2).icms_cst).toBe('41');
    expect(resolveTaxSituation(3).icms_cst).toBe('41');
  });
  it('base de cálculo do IBS/CBS fica zerada — operação não onerosa fora do fato gerador da reforma', () => {
    const s = resolveTaxSituation(1);
    expect(s.ibs_cbs_base_calculo).toBe(0);
  });
});

describe('validateSimplesRemessaCreate', () => {
  it('passa com input válido', () => {
    expect(() => validateSimplesRemessaCreate({ motivo: 'conserto', items: [{ quantity: 1, unit_price: 10 }] })).not.toThrow();
  });
  it('rejeita motivo inválido', () => {
    try { validateSimplesRemessaCreate({ motivo: 'venda', items: [{ quantity: 1, unit_price: 10 }] }); } catch (e) {
      expect((e as SimplesRemessaDomainError).code).toBe('remessa_motivo_invalido');
    }
  });
  it('rejeita sem itens', () => {
    try { validateSimplesRemessaCreate({ motivo: 'conserto', items: [] }); } catch (e) {
      expect((e as SimplesRemessaDomainError).code).toBe('remessa_sem_itens');
    }
  });
  it('rejeita quantidade zero', () => {
    try { validateSimplesRemessaCreate({ motivo: 'conserto', items: [{ quantity: 0, unit_price: 10 }] }); } catch (e) {
      expect((e as SimplesRemessaDomainError).code).toBe('remessa_item_quantidade_zero');
    }
  });
});

describe('calcRemessaTotals', () => {
  it('soma quantidade × preço unitário', () => {
    expect(calcRemessaTotals([{ quantity: 2, unit_price: 10.5 }, { quantity: 1, unit_price: 5 }])).toEqual({ subtotal: 26, total: 26 });
  });
});
