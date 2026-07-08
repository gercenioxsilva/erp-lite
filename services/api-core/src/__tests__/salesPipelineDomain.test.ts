import { describe, it, expect } from 'vitest';
import {
  assertCanMarkWon, assertCanMarkLost, validateOpportunityValue, validateOpportunityTitle,
  isManualActivityType, DEFAULT_STAGES, SalesPipelineDomainError,
} from '../domain/salesPipeline/salesPipelineDomain';

describe('assertCanMarkWon / assertCanMarkLost', () => {
  it('permite ganhar/perder uma oportunidade em aberto', () => {
    expect(() => assertCanMarkWon('open')).not.toThrow();
    expect(() => assertCanMarkLost('open')).not.toThrow();
  });

  it('bloqueia marcar como ganha uma oportunidade já fechada (ganha ou perdida)', () => {
    expect(() => assertCanMarkWon('won')).toThrow(SalesPipelineDomainError);
    expect(() => assertCanMarkWon('lost')).toThrow(SalesPipelineDomainError);
  });

  it('bloqueia marcar como perdida uma oportunidade já fechada', () => {
    expect(() => assertCanMarkLost('won')).toThrow(SalesPipelineDomainError);
    expect(() => assertCanMarkLost('lost')).toThrow(SalesPipelineDomainError);
  });

  it('erro carrega o status atual no payload', () => {
    try {
      assertCanMarkWon('won');
    } catch (e) {
      expect(e).toBeInstanceOf(SalesPipelineDomainError);
      expect((e as SalesPipelineDomainError).code).toBe('opportunity_not_open');
      expect((e as SalesPipelineDomainError).payload).toEqual({ status: 'won' });
    }
  });
});

describe('validateOpportunityValue', () => {
  it('aceita valor zero e positivo', () => {
    expect(() => validateOpportunityValue(0)).not.toThrow();
    expect(() => validateOpportunityValue(1000.5)).not.toThrow();
  });

  it('rejeita valor negativo', () => {
    expect(() => validateOpportunityValue(-1)).toThrow(SalesPipelineDomainError);
  });

  it('rejeita NaN/Infinity', () => {
    expect(() => validateOpportunityValue(NaN)).toThrow(SalesPipelineDomainError);
    expect(() => validateOpportunityValue(Infinity)).toThrow(SalesPipelineDomainError);
  });
});

describe('validateOpportunityTitle', () => {
  it('aceita título não vazio', () => {
    expect(() => validateOpportunityTitle('Venda de peças')).not.toThrow();
  });

  it('rejeita título vazio ou só espaços', () => {
    expect(() => validateOpportunityTitle('')).toThrow(SalesPipelineDomainError);
    expect(() => validateOpportunityTitle('   ')).toThrow(SalesPipelineDomainError);
  });
});

describe('isManualActivityType', () => {
  it('aceita note/call/meeting', () => {
    expect(isManualActivityType('note')).toBe(true);
    expect(isManualActivityType('call')).toBe(true);
    expect(isManualActivityType('meeting')).toBe(true);
  });

  it('rejeita tipos automáticos (stage_change/won/lost/proposal_linked) — nunca logados à mão', () => {
    expect(isManualActivityType('stage_change')).toBe(false);
    expect(isManualActivityType('won')).toBe(false);
    expect(isManualActivityType('lost')).toBe(false);
    expect(isManualActivityType('proposal_linked')).toBe(false);
  });
});

describe('DEFAULT_STAGES', () => {
  it('nunca inclui Ganho/Perdido — são o status da oportunidade, não uma etapa', () => {
    expect(DEFAULT_STAGES).not.toContain('Ganho');
    expect(DEFAULT_STAGES).not.toContain('Perdido');
    expect(DEFAULT_STAGES.length).toBeGreaterThan(0);
  });
});
