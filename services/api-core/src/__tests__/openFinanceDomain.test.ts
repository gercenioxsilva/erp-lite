// Normalização Pluggy → ledger de importação (pura). O que importa: sinal do
// amount preservado, contraparte certa por direção (crédito=payer,
// débito=receiver), documento só com dígitos, dedup key estável e janela de
// sync com overlap.

import { describe, it, expect } from 'vitest';
import {
  normalizePluggyTransaction, dedupKeyForPluggy, syncWindowStart,
} from '../domain/import/openFinanceDomain';

const PIX_CREDIT = {
  id: 'tx-1', accountId: 'acc-1', date: '2026-07-15T10:00:00Z',
  description: 'PIX RECEBIDO', amount: 350, type: 'CREDIT' as const, status: 'POSTED',
  paymentData: {
    paymentMethod: 'PIX',
    payer: { name: 'Cliente Demo LTDA', documentNumber: { value: '11.222.333/0001-44' } },
    receiver: { name: 'Nós Mesmos', documentNumber: { value: '48.994.778/0001-90' } },
  },
};

describe('normalizePluggyTransaction', () => {
  it('crédito: contraparte é o PAYER, documento vira dígitos, método em minúsculas', () => {
    const n = normalizePluggyTransaction(PIX_CREDIT);
    expect(n.source).toBe('bank');
    expect(n.source_kind).toBe('openfinance');
    expect(n.amount).toBe(350);
    expect(n.customer_name).toBe('Cliente Demo LTDA');
    expect(n.customer_document).toBe('11222333000144');
    expect(n.payment_method).toBe('pix');
    expect(n.dedup_key).toBe('of:acc-1:tx-1');
    expect(n.occurred_at?.toISOString()).toBe('2026-07-15T10:00:00.000Z');
  });

  it('débito: contraparte é o RECEIVER e o sinal negativo é preservado', () => {
    const n = normalizePluggyTransaction({
      id: 'tx-2', accountId: 'acc-1', date: '2026-07-15T11:00:00Z',
      description: 'PAGAMENTO FORNECEDOR', amount: -120.5, type: 'DEBIT',
      paymentData: {
        paymentMethod: 'TED',
        payer: { name: 'Nós', documentNumber: { value: '48994778000190' } },
        receiver: { name: 'Fornecedor X', documentNumber: { value: '99.888.777/0001-66' } },
      },
    });
    expect(n.amount).toBe(-120.5);
    expect(n.customer_name).toBe('Fornecedor X');
    expect(n.customer_document).toBe('99888777000166');
  });

  it('sem paymentData nada explode — campos de contraparte ficam null', () => {
    const n = normalizePluggyTransaction({
      id: 'tx-3', accountId: 'acc-2', date: '2026-07-10T00:00:00Z',
      description: 'TARIFA', amount: -39.9, paymentData: null,
    });
    expect(n.customer_name).toBeNull();
    expect(n.customer_document).toBeNull();
    expect(n.payment_method).toBeNull();
    expect(n.trn_type).toBe('DEBIT'); // derivado do sinal quando type falta
  });

  it('documento fora de 11-14 dígitos é descartado (nunca lixo no ledger)', () => {
    const n = normalizePluggyTransaction({
      ...PIX_CREDIT, id: 'tx-4',
      paymentData: { paymentMethod: 'PIX', payer: { name: 'X', documentNumber: { value: '123' } } },
    });
    expect(n.customer_document).toBeNull();
  });
});

describe('dedupKeyForPluggy', () => {
  it('é estável e cabe no VARCHAR(200) mesmo com ids longos', () => {
    const key = dedupKeyForPluggy('a'.repeat(60), 'b'.repeat(60));
    expect(key).toBe(`of:${'a'.repeat(60)}:${'b'.repeat(60)}`);
    expect(key.length).toBeLessThanOrEqual(200);
  });
});

describe('syncWindowStart', () => {
  const NOW = new Date('2026-07-17T12:00:00Z');

  it('1º sync: 90 dias', () => {
    expect(syncWindowStart(null, NOW).toISOString().slice(0, 10)).toBe('2026-04-18');
  });

  it('syncs seguintes: last_synced_at − 3 dias (overlap; o dedup absorve)', () => {
    const last = new Date('2026-07-16T23:59:00Z');
    expect(syncWindowStart(last, NOW).toISOString().slice(0, 10)).toBe('2026-07-13');
  });
});
