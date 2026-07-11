// Consolidação (0073): determinismo do grouping_key por cadência,
// sub-agrupamento por service_code e especificidade de regra.

import { describe, it, expect } from 'vitest';
import {
  computeGroupingKey, resolveRule, competencyOf, weekAnchor, SaleForGrouping,
} from '../domain/consolidation/consolidationDomain';

const sale = (over: Partial<SaleForGrouping> = {}): SaleForGrouping => ({
  transactionId: 'tx1', companyId: 'co1', clientId: 'cl1', contractId: null,
  saleDate: new Date('2026-07-02T15:30:00'), serviceCode: '14.01', ...over,
});

describe('computeGroupingKey', () => {
  it('é determinística: mesma venda+regra → mesma chave', () => {
    expect(computeGroupingKey('monthly', sale())).toBe(computeGroupingKey('monthly', sale()));
  });

  it('cadências produzem partições corretas', () => {
    expect(computeGroupingKey('per_sale', sale())).toContain('tx:tx1');
    expect(computeGroupingKey('daily', sale())).toContain('d:2026-07-02');
    expect(computeGroupingKey('monthly', sale())).toContain('m:2026-07');
    expect(computeGroupingKey('per_client', sale())).toContain('cl:cl1');
    // semanas: 2026-07-02 (qui) e 2026-06-29 (seg) compartilham a âncora
    expect(computeGroupingKey('weekly', sale()))
      .toBe(computeGroupingKey('weekly', sale({ saleDate: new Date('2026-06-29T08:00:00') })));
  });

  it('service_code diferente NUNCA agrupa na mesma nota (LC116 heterogêneo)', () => {
    expect(computeGroupingKey('monthly', sale({ serviceCode: '14.01' })))
      .not.toBe(computeGroupingKey('monthly', sale({ serviceCode: '7.02' })));
  });

  it('competencyOf e weekAnchor estáveis', () => {
    expect(competencyOf(new Date('2026-01-31T23:00:00'))).toBe('2026-01');
    expect(weekAnchor(new Date('2026-07-05T10:00:00'))).toBe(weekAnchor(new Date('2026-06-29T10:00:00'))); // dom→seg da mesma semana ISO? (dom 05/07 pertence à semana de 29/06)
  });
});

describe('resolveRule — especificidade contrato > cliente > empresa', () => {
  const rules = [
    { id: 'r-company',  companyId: 'co1', clientId: null,  contractId: null,  strategy: 'monthly' as const, serviceCode: null },
    { id: 'r-client',   companyId: 'co1', clientId: 'cl1', contractId: null,  strategy: 'per_client' as const, serviceCode: null },
    { id: 'r-contract', companyId: 'co1', clientId: null,  contractId: 'ct1', strategy: 'per_contract' as const, serviceCode: null },
  ];

  it('contrato vence cliente que vence empresa', () => {
    expect(resolveRule(rules, { companyId: 'co1', clientId: 'cl1', contractId: 'ct1' })?.id).toBe('r-contract');
    expect(resolveRule(rules, { companyId: 'co1', clientId: 'cl1', contractId: null })?.id).toBe('r-client');
    expect(resolveRule(rules, { companyId: 'co1', clientId: 'outro', contractId: null })?.id).toBe('r-company');
  });

  it('empresa sem regra → null (serviço aplica default monthly)', () => {
    expect(resolveRule(rules, { companyId: 'co2', clientId: null, contractId: null })).toBeNull();
  });
});
