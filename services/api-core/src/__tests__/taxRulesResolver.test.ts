import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getIcmsRate, getFcpRate, getStRule, getSimplesEffectiveRate, getIbsCbsRates,
  clearTaxRulesCache, TaxRuleNotFoundError,
} from '../lib/taxRulesResolver';
import type { DrizzleDB } from '../lib/taxRulesResolver';

// ── mock db ───────────────────────────────────────────────────────────────────

function queryText(query: unknown): string {
  return JSON.stringify((query as { queryChunks?: unknown })?.queryChunks ?? query ?? '');
}

function makeMockDb(fixtures: {
  internalRate?:      string;
  interstateRate?:    string;
  fcpRate?:           string;
  stRule?:             { mva_percent: string };
  simplesBracket?:     { aliquota_nominal: string; parcela_deduzir: string };
  ibsCbsRate?:         { ibs_rate: string; cbs_rate: string };
}) {
  const execute = vi.fn(async (query: unknown) => {
    const text = queryText(query);
    if (/tax_icms_internal_rates/.test(text)) {
      return { rows: fixtures.internalRate !== undefined ? [{ rate: fixtures.internalRate }] : [] };
    }
    if (/tax_icms_interstate_rates/.test(text)) {
      return { rows: fixtures.interstateRate !== undefined ? [{ rate: fixtures.interstateRate }] : [] };
    }
    if (/tax_fcp_rates/.test(text)) {
      return { rows: fixtures.fcpRate !== undefined ? [{ rate: fixtures.fcpRate }] : [] };
    }
    if (/tax_st_rules/.test(text)) {
      return { rows: fixtures.stRule ? [fixtures.stRule] : [] };
    }
    if (/tax_simples_nacional_brackets/.test(text)) {
      return { rows: fixtures.simplesBracket ? [fixtures.simplesBracket] : [] };
    }
    if (/tax_ibs_cbs_rates/.test(text)) {
      return { rows: fixtures.ibsCbsRate ? [fixtures.ibsCbsRate] : [] };
    }
    return { rows: [] };
  });
  const db = { execute } as unknown as DrizzleDB;
  return { db, execute };
}

beforeEach(() => {
  clearTaxRulesCache();
});

// ── getIcmsRate ───────────────────────────────────────────────────────────────

describe('getIcmsRate', () => {
  it('queries internal rates table when origin === dest', async () => {
    const { db, execute } = makeMockDb({ internalRate: '18.00' });
    const rate = await getIcmsRate('SP', 'SP', db);
    expect(rate).toBe(18);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('queries interstate rates table when origin !== dest', async () => {
    const { db } = makeMockDb({ interstateRate: '7.00' });
    const rate = await getIcmsRate('SP', 'BA', db);
    expect(rate).toBe(7);
  });

  it('throws TaxRuleNotFoundError when internal rate is missing', async () => {
    const { db } = makeMockDb({});
    await expect(getIcmsRate('XX', 'XX', db)).rejects.toMatchObject({
      code: 'icms_internal_rate_not_found',
    });
  });

  it('throws TaxRuleNotFoundError when interstate rate is missing', async () => {
    const { db } = makeMockDb({});
    await expect(getIcmsRate('SP', 'XX', db)).rejects.toBeInstanceOf(TaxRuleNotFoundError);
  });

  it('caches the result — second call does not hit the db again', async () => {
    const { db, execute } = makeMockDb({ internalRate: '18.00' });
    await getIcmsRate('SP', 'SP', db);
    await getIcmsRate('SP', 'SP', db);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ── getFcpRate ────────────────────────────────────────────────────────────────

describe('getFcpRate', () => {
  it('returns 0 when no FCP rule is configured for the UF', async () => {
    const { db } = makeMockDb({});
    const rate = await getFcpRate('SP', db);
    expect(rate).toBe(0);
  });

  it('returns the configured rate when present', async () => {
    const { db } = makeMockDb({ fcpRate: '2.00' });
    const rate = await getFcpRate('RJ', db);
    expect(rate).toBe(2);
  });
});

// ── getStRule ─────────────────────────────────────────────────────────────────

describe('getStRule', () => {
  it('returns null when no ST rule is configured', async () => {
    const { db } = makeMockDb({});
    const rule = await getStRule('12345678', 'SP', 'RJ', db);
    expect(rule).toBeNull();
  });

  it('returns the MVA percent when a rule exists', async () => {
    const { db } = makeMockDb({ stRule: { mva_percent: '40.00' } });
    const rule = await getStRule('12345678', 'SP', 'RJ', db);
    expect(rule).toEqual({ mvaPercent: 40 });
  });
});

// ── getSimplesEffectiveRate ─────────────────────────────────────────────────

describe('getSimplesEffectiveRate', () => {
  it('returns 0 for rbt12 <= 0 without querying the db', async () => {
    const { db, execute } = makeMockDb({});
    const rate = await getSimplesEffectiveRate(0, db);
    expect(rate).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('computes the official LC 123 formula for a known bracket', async () => {
    // Faixa 2 do Anexo I: aliquota nominal 7.30%, parcela a deduzir 5940.
    // RBT12 = 250000 → efetiva = 7.30 - (5940*100/250000) = 7.30 - 2.376 = 4.924%
    const { db } = makeMockDb({ simplesBracket: { aliquota_nominal: '7.30', parcela_deduzir: '5940.00' } });
    const rate = await getSimplesEffectiveRate(250000, db);
    expect(rate).toBeCloseTo(4.924, 3);
  });

  it('throws TaxRuleNotFoundError when no bracket matches', async () => {
    const { db } = makeMockDb({});
    await expect(getSimplesEffectiveRate(999999999, db)).rejects.toMatchObject({
      code: 'simples_bracket_not_found',
    });
  });
});

// ── getIbsCbsRates ────────────────────────────────────────────────────────────

describe('getIbsCbsRates', () => {
  it('returns the 2026 test-rate defaults (IBS 0.1% + CBS 0.9%) when no rule is configured for the UF', async () => {
    const { db } = makeMockDb({});
    const rates = await getIbsCbsRates('SP', db);
    expect(rates).toEqual({ ibsRate: 0.1, cbsRate: 0.9 });
  });

  it('returns the configured rate when present', async () => {
    const { db } = makeMockDb({ ibsCbsRate: { ibs_rate: '0.200', cbs_rate: '1.500' } });
    const rates = await getIbsCbsRates('RJ', db);
    expect(rates).toEqual({ ibsRate: 0.2, cbsRate: 1.5 });
  });

  it('caches the result — second call does not hit the db again', async () => {
    const { db, execute } = makeMockDb({ ibsCbsRate: { ibs_rate: '0.100', cbs_rate: '0.900' } });
    await getIbsCbsRates('SP', db);
    await getIbsCbsRates('SP', db);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
