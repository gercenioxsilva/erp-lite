import { describe, it, expect } from 'vitest';
import {
  signState, verifyState, buildAuthorizationUrl, mapMlOrderToErpOrder,
  MarketplaceDomainError,
} from '../domain/marketplace/marketplaceDomain';

const SECRET = 'test-secret-key';
const COMPANY_ID = '11111111-1111-1111-1111-111111111111';

describe('signState / verifyState', () => {
  it('accepts a state it just signed', () => {
    const state = signState(COMPANY_ID, SECRET);
    const result = verifyState(state, SECRET);
    expect(result.valid).toBe(true);
    expect(result.companyId).toBe(COMPANY_ID);
  });

  it('rejects a tampered state (different secret)', () => {
    const state = signState(COMPANY_ID, SECRET);
    const result = verifyState(state, 'wrong-secret');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('tampered');
  });

  it('rejects a malformed token', () => {
    expect(verifyState('not-a-valid-token', SECRET).valid).toBe(false);
    expect(verifyState('a.b.c', SECRET).valid).toBe(false);
  });

  it('rejects an expired state', () => {
    const state = signState(COMPANY_ID, SECRET);
    const elevenMinutesLater = Date.now() + 11 * 60 * 1000;
    const result = verifyState(state, SECRET, elevenMinutesLater);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects a state signed for a different company when payload is swapped', () => {
    const stateA = signState(COMPANY_ID, SECRET);
    const [, sig] = stateA.split('.');
    const forgedPayload = Buffer.from(`22222222-2222-2222-2222-222222222222.${Date.now()}`, 'utf8').toString('base64url');
    const forged = `${forgedPayload}.${sig}`;
    expect(verifyState(forged, SECRET).valid).toBe(false);
  });
});

describe('buildAuthorizationUrl', () => {
  it('builds a valid ML authorization URL with all params', () => {
    const url = buildAuthorizationUrl({
      authUrl: 'https://auth.mercadolivre.com.br/authorization',
      clientId: 'app-123',
      redirectUri: 'https://orquestraerp.com.br/v1/public/integrations/mercadolivre/callback',
      state: 'abc.def',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://auth.mercadolivre.com.br/authorization');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('app-123');
    expect(parsed.searchParams.get('state')).toBe('abc.def');
  });
});

describe('mapMlOrderToErpOrder', () => {
  const links = [
    { material_id: 'mat-1', ml_item_id: 'MLB123', ml_variation_id: null },
    { material_id: 'mat-2', ml_item_id: 'MLB456', ml_variation_id: 'VAR-1' },
  ];

  it('maps a matched order correctly', () => {
    const result = mapMlOrderToErpOrder({
      id: 'ML-ORDER-1',
      items: [{ ml_item_id: 'MLB123', quantity: 2, unit_price: 50, title: 'Produto A' }],
    }, links);
    expect(result.marketplace_order_id).toBe('ML-ORDER-1');
    expect(result.items).toEqual([{ material_id: 'mat-1', quantity: 2, unit_price: 50, name: 'Produto A' }]);
  });

  it('matches by ml_item_id + ml_variation_id when the item has a variation', () => {
    const result = mapMlOrderToErpOrder({
      id: 'ML-ORDER-2',
      items: [{ ml_item_id: 'MLB456', ml_variation_id: 'VAR-1', quantity: 1, unit_price: 100 }],
    }, links);
    expect(result.items[0].material_id).toBe('mat-2');
  });

  it('throws MarketplaceDomainError instead of creating an orphan item when unmatched', () => {
    expect(() => mapMlOrderToErpOrder({
      id: 'ML-ORDER-3',
      items: [{ ml_item_id: 'MLB999', quantity: 1, unit_price: 10 }],
    }, links)).toThrow(MarketplaceDomainError);
  });

  it('throws when the variation does not match even if the item id does', () => {
    expect(() => mapMlOrderToErpOrder({
      id: 'ML-ORDER-4',
      items: [{ ml_item_id: 'MLB456', ml_variation_id: 'VAR-2', quantity: 1, unit_price: 10 }],
    }, links)).toThrow(MarketplaceDomainError);
  });
});
