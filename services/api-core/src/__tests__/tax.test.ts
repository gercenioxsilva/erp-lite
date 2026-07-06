import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({}) }),
}));

const state: {
  nfeConfig: { uf: string } | null;
  tenant:    { simples_rbt12: string | null } | null;
} = {
  nfeConfig: { uf: 'SP' },
  tenant:    { simples_rbt12: null },
};

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');

  function makeSelectChain(table: unknown) {
    return {
      from: (fromTable: unknown) => ({
        where: () => {
          if (fromTable === actual.nfeConfigs) return Promise.resolve(state.nfeConfig ? [state.nfeConfig] : []);
          if (fromTable === actual.tenants)    return Promise.resolve(state.tenant    ? [state.tenant]    : []);
          return Promise.resolve([]);
        },
      }),
    };
  }

  return {
    ...actual,
    db: { select: vi.fn(() => makeSelectChain(undefined)) },
  };
});

const mockResolveAndCalculateTaxes = vi.fn();
vi.mock('../lib/taxCalculationService', () => ({
  resolveAndCalculateTaxes: (...args: unknown[]) => mockResolveAndCalculateTaxes(...args),
}));

const mockGetSimplesEffectiveRate = vi.fn();
vi.mock('../lib/taxRulesResolver', async () => {
  const actual = await vi.importActual<any>('../lib/taxRulesResolver');
  return {
    ...actual,
    getSimplesEffectiveRate: (...args: unknown[]) => mockGetSimplesEffectiveRate(...args),
  };
});

describe('Tax routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    state.nfeConfig = { uf: 'SP' };
    state.tenant    = { simples_rbt12: null };
    mockResolveAndCalculateTaxes.mockReset();
    mockGetSimplesEffectiveRate.mockReset();
  });

  beforeEach(async () => { app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  describe('POST /v1/tax/calculate', () => {
    it('returns 401 without a Bearer token', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/tax/calculate',
        payload: { tax_regime: 'lucro_presumido', lines: [{ quantity: 1, unit_price: 10 }] },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for an invalid tax_regime', async () => {
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'POST', url: '/v1/tax/calculate',
        headers: { authorization: `Bearer ${token}` },
        payload: { tax_regime: 'invalid_regime', lines: [{ quantity: 1, unit_price: 10 }] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('defaults origin_state from nfe_configs.uf when not provided', async () => {
      state.nfeConfig = { uf: 'BA' };
      mockResolveAndCalculateTaxes.mockResolvedValue({ ok: true });
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'POST', url: '/v1/tax/calculate',
        headers: { authorization: `Bearer ${token}` },
        payload: { tax_regime: 'lucro_presumido', lines: [{ quantity: 1, unit_price: 10 }] },
      });
      expect(res.statusCode).toBe(200);
      expect(mockResolveAndCalculateTaxes).toHaveBeenCalledWith(
        expect.objectContaining({ origin_state: 'BA', destination_state: 'BA' }),
        expect.anything(),
      );
    });

    it('[multi-empresa] honors an explicit company_id, overriding the default company UF (regra 40)', async () => {
      state.nfeConfig = { uf: 'RJ', is_active: true } as any;
      mockResolveAndCalculateTaxes.mockResolvedValue({ ok: true });
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'POST', url: '/v1/tax/calculate',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          tax_regime: 'lucro_presumido', company_id: 'company-rj',
          lines: [{ quantity: 1, unit_price: 10 }],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(mockResolveAndCalculateTaxes).toHaveBeenCalledWith(
        expect.objectContaining({ origin_state: 'RJ' }),
        expect.anything(),
      );
    });

    it('falls back to SP when there is no nfe_configs row', async () => {
      state.nfeConfig = null;
      mockResolveAndCalculateTaxes.mockResolvedValue({ ok: true });
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'POST', url: '/v1/tax/calculate',
        headers: { authorization: `Bearer ${token}` },
        payload: { tax_regime: 'lucro_presumido', lines: [{ quantity: 1, unit_price: 10 }] },
      });
      expect(res.statusCode).toBe(200);
      expect(mockResolveAndCalculateTaxes).toHaveBeenCalledWith(
        expect.objectContaining({ origin_state: 'SP' }),
        expect.anything(),
      );
    });

    it('passes explicit destination_state, icms_taxpayer and consumer_type through', async () => {
      mockResolveAndCalculateTaxes.mockResolvedValue({ ok: true });
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'POST', url: '/v1/tax/calculate',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          tax_regime: 'lucro_presumido', destination_state: 'rj',
          icms_taxpayer: '9', consumer_type: '1',
          lines: [{ quantity: 1, unit_price: 10 }],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(mockResolveAndCalculateTaxes).toHaveBeenCalledWith(
        expect.objectContaining({ destination_state: 'RJ', icms_taxpayer: '9', consumer_type: '1' }),
        expect.anything(),
      );
    });

    it('passes class_trib through per line (Reforma Tributária, regra 44)', async () => {
      mockResolveAndCalculateTaxes.mockResolvedValue({ ok: true });
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'POST', url: '/v1/tax/calculate',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          tax_regime: 'lucro_presumido',
          lines: [{ quantity: 1, unit_price: 10, class_trib: '200001' }],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(mockResolveAndCalculateTaxes).toHaveBeenCalledWith(
        expect.objectContaining({ lines: [expect.objectContaining({ class_trib: '200001' })] }),
        expect.anything(),
      );
    });

    it('returns 422 with the error code when a tax rule is missing', async () => {
      const { TaxRuleNotFoundError } = await import('../lib/taxRulesResolver');
      mockResolveAndCalculateTaxes.mockRejectedValue(
        new TaxRuleNotFoundError('icms_internal_rate_not_found', { uf: 'SP' }),
      );
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'POST', url: '/v1/tax/calculate',
        headers: { authorization: `Bearer ${token}` },
        payload: { tax_regime: 'lucro_presumido', lines: [{ quantity: 1, unit_price: 10 }] },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('icms_internal_rate_not_found');
    });
  });

  describe('GET /v1/tax/simples-effective-rate', () => {
    it('returns null when the tenant has no simples_rbt12 configured', async () => {
      state.tenant = { simples_rbt12: null };
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'GET', url: '/v1/tax/simples-effective-rate',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ rbt12: null, effective_rate: null });
    });

    it('returns the effective rate computed from RBT12', async () => {
      state.tenant = { simples_rbt12: '250000.00' };
      mockGetSimplesEffectiveRate.mockResolvedValue(4.924);
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'GET', url: '/v1/tax/simples-effective-rate',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ rbt12: 250000, effective_rate: 4.924 });
    });
  });
});
