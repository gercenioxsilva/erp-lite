import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetIcmsRate = vi.fn();
const mockGetFcpRate  = vi.fn();

vi.mock('../lib/taxRulesResolver', () => ({
  getIcmsRate: (...args: unknown[]) => mockGetIcmsRate(...args),
  getFcpRate:  (...args: unknown[]) => mockGetFcpRate(...args),
}));

import { resolveAndCalculateTaxes } from '../lib/taxCalculationService';
import type { DrizzleDB } from '../lib/taxRulesResolver';

const fakeDb = {} as DrizzleDB;

const BASE_INPUT = {
  origin_state: 'SP',
  destination_state: 'SP',
  tax_regime: 'lucro_presumido' as const,
  lines: [{ quantity: 10, unit_price: 100 }],
};

beforeEach(() => {
  mockGetIcmsRate.mockReset();
  mockGetFcpRate.mockReset();
  mockGetFcpRate.mockResolvedValue(0);
});

describe('resolveAndCalculateTaxes — intra-state', () => {
  it('uses the internal rate and never applies DIFAL', async () => {
    mockGetIcmsRate.mockResolvedValue(18);
    const result = await resolveAndCalculateTaxes(BASE_INPUT, fakeDb);
    expect(mockGetIcmsRate).toHaveBeenCalledWith('SP', 'SP', fakeDb);
    expect(result.applied_rates.icms).toBe(18);
    expect(result.applied_rates.icms_difal).toBe(0);
    // só uma chamada (icms origin->dest) — não deveria resolver alíquota interna do destino p/ DIFAL
    expect(mockGetIcmsRate).toHaveBeenCalledTimes(1);
  });
});

describe('resolveAndCalculateTaxes — interstate, contribuinte (B2B)', () => {
  it('does not apply DIFAL even though the sale is interstate', async () => {
    mockGetIcmsRate.mockResolvedValue(12);
    const result = await resolveAndCalculateTaxes({
      ...BASE_INPUT, destination_state: 'RJ',
      icms_taxpayer: '1', consumer_type: '0', // contribuinte, B2B
    }, fakeDb);
    expect(result.applied_rates.icms_difal).toBe(0);
    expect(mockGetIcmsRate).toHaveBeenCalledTimes(1);
  });
});

describe('resolveAndCalculateTaxes — interstate, não contribuinte, consumidor final (DIFAL)', () => {
  it('resolves the destination internal rate and applies the difference as DIFAL', async () => {
    mockGetIcmsRate
      .mockResolvedValueOnce(7)  // SP -> RJ interestadual
      .mockResolvedValueOnce(20); // RJ interno (para o DIFAL)

    const result = await resolveAndCalculateTaxes({
      ...BASE_INPUT, destination_state: 'RJ',
      icms_taxpayer: '9', consumer_type: '1', // não contribuinte, consumidor final
    }, fakeDb);

    expect(mockGetIcmsRate).toHaveBeenNthCalledWith(1, 'SP', 'RJ', fakeDb);
    expect(mockGetIcmsRate).toHaveBeenNthCalledWith(2, 'RJ', 'RJ', fakeDb);
    expect(result.applied_rates.icms).toBe(7);
    expect(result.applied_rates.icms_difal).toBe(13); // 20 - 7
    expect(result.lines[0].icms_difal_value).toBe(130); // 1000 * 13%
  });

  it('clamps DIFAL to 0 when destination rate is not higher than interstate', async () => {
    mockGetIcmsRate
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(7); // hipotético: interno do destino menor que interestadual

    const result = await resolveAndCalculateTaxes({
      ...BASE_INPUT, destination_state: 'BA',
      icms_taxpayer: '9', consumer_type: '1',
    }, fakeDb);

    expect(result.applied_rates.icms_difal).toBe(0);
  });
});

describe('resolveAndCalculateTaxes — interstate, não contribuinte, NÃO consumidor final', () => {
  it('does not apply DIFAL for resale operations (revenda)', async () => {
    mockGetIcmsRate.mockResolvedValue(12);
    const result = await resolveAndCalculateTaxes({
      ...BASE_INPUT, destination_state: 'RJ',
      icms_taxpayer: '9', consumer_type: '0', // não contribuinte mas não é consumidor final
    }, fakeDb);
    expect(result.applied_rates.icms_difal).toBe(0);
    expect(mockGetIcmsRate).toHaveBeenCalledTimes(1);
  });
});

describe('resolveAndCalculateTaxes — FCP', () => {
  it('always resolves FCP for the destination UF', async () => {
    mockGetIcmsRate.mockResolvedValue(18);
    mockGetFcpRate.mockResolvedValue(2);
    const result = await resolveAndCalculateTaxes(BASE_INPUT, fakeDb);
    expect(mockGetFcpRate).toHaveBeenCalledWith('SP', fakeDb);
    expect(result.applied_rates.fcp).toBe(2);
  });
});

describe('resolveAndCalculateTaxes — uppercases UFs', () => {
  it('normalizes lowercase state codes before resolving', async () => {
    mockGetIcmsRate.mockResolvedValue(18);
    await resolveAndCalculateTaxes({ ...BASE_INPUT, origin_state: 'sp', destination_state: 'sp' }, fakeDb);
    expect(mockGetIcmsRate).toHaveBeenCalledWith('SP', 'SP', fakeDb);
  });
});
