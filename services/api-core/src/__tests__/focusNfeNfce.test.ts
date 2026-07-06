import { describe, it, expect, vi, beforeEach } from 'vitest';

// Prova de regressão + prova do fix da Reforma Tributária (regra 44) no
// caminho síncrono de NFC-e/PDV — diferente do NF-e assíncrono, aqui o ICMS
// (e agora IBS/CBS) é resolvido fresh na hora da emissão, nunca persistido.

const mockDb = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

import { buildNfcePayload } from '../services/fiscal/focusNfe';
import { clearTaxRulesCache } from '../lib/taxRulesResolver';

const SALE_ID   = 'sale-1';
const TENANT_ID = 'tenant-1';

function queryText(query: unknown): string {
  return JSON.stringify((query as { queryChunks?: unknown })?.queryChunks ?? query ?? '');
}

function setupMocks(overrides: {
  saleRow?: Record<string, unknown>;
  itemRows?: Record<string, unknown>[];
  payRows?: Record<string, unknown>[];
  cfgRow?: Record<string, unknown>;
  terminalRow?: Record<string, unknown>;
  ibsCbsRow?: { ibs_rate: string; cbs_rate: string } | null;
  icmsInternalRate?: string;
} = {}) {
  const saleRow = overrides.saleRow ?? {
    id: SALE_ID, customer_doc: null, customer_name: null, terminal_id: 'term-1', total: '1000.00',
  };
  const itemRows = overrides.itemRows ?? [{
    description: 'Produto Teste', quantity: '10.0000', unit_price: '100.00', total: '1000.00',
    ncm: '12345678', cfop: '5102', cst_csosn: '00', unit: 'UN', class_trib: null,
  }];
  const payRows = overrides.payRows ?? [{ method: 'cash', amount: '1000.00' }];
  const terminalRow = overrides.terminalRow ?? { nfce_series: 1 };

  mockDb.execute.mockImplementation(async (query: unknown) => {
    const text = queryText(query);
    if (/FROM pos_sales/.test(text))         return { rows: saleRow ? [saleRow] : [] };
    if (/FROM pos_sale_items/.test(text))    return { rows: itemRows };
    if (/FROM pos_sale_payments/.test(text)) return { rows: payRows };
    if (/FROM pos_terminals/.test(text))     return { rows: [terminalRow] };
    if (/tax_icms_internal_rates/.test(text)) {
      return { rows: overrides.icmsInternalRate !== undefined ? [{ rate: overrides.icmsInternalRate }] : [{ rate: '18.00' }] };
    }
    if (/tax_ibs_cbs_rates/.test(text)) {
      return { rows: overrides.ibsCbsRow ? [overrides.ibsCbsRow] : [] };
    }
    return { rows: [] };
  });

  const cfgRow = overrides.cfgRow ?? {
    uf: 'SP', regime_tributario: 2, cnpj: '12345678000190', razao_social: 'Empresa Teste',
    nome_fantasia: null, logradouro: 'Rua A', numero: '100', complemento: null,
    bairro: 'Centro', municipio: 'SAO PAULO', cep: '01001000', telefone: null, email: null,
  };
  mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([cfgRow]) }) });
}

describe('buildNfcePayload — IBS/CBS (Reforma Tributária, regra 44)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTaxRulesCache();
  });

  it('applies the 2026 test rates as defaults when no tax_ibs_cbs_rates row exists for the UF', async () => {
    setupMocks({ ibsCbsRow: null });
    const payload = await buildNfcePayload(SALE_ID, TENANT_ID) as any;
    const item = payload.itens[0];

    expect(item.ibs_uf_aliquota).toBe(0.1);
    expect(item.ibs_uf_valor).toBe(1);   // 1000 * 0.1%
    expect(item.cbs_aliquota).toBe(0.9);
    expect(item.cbs_valor).toBe(9);      // 1000 * 0.9%
  });

  it('defaults class_trib to "000001" when the sold item has no override', async () => {
    setupMocks();
    const payload = await buildNfcePayload(SALE_ID, TENANT_ID) as any;
    const item = payload.itens[0];
    expect(item.ibs_cbs_classificacao_tributaria).toBe('000001');
    expect(item.ibs_cbs_situacao_tributaria).toBe('000');
  });

  it('uses the class_trib copied from materials at addItem() time when present', async () => {
    setupMocks({ itemRows: [{
      description: 'Produto Teste', quantity: '10.0000', unit_price: '100.00', total: '1000.00',
      ncm: '12345678', cfop: '5102', cst_csosn: '00', unit: 'UN', class_trib: '200001',
    }] });
    const payload = await buildNfcePayload(SALE_ID, TENANT_ID) as any;
    expect(payload.itens[0].ibs_cbs_classificacao_tributaria).toBe('200001');
    expect(payload.itens[0].ibs_cbs_situacao_tributaria).toBe('200');
  });

  it('never changes valor_bruto/valor_total — IBS/CBS are informational, not additive, in 2026', async () => {
    setupMocks();
    const payload = await buildNfcePayload(SALE_ID, TENANT_ID) as any;
    expect(payload.itens[0].valor_bruto).toBe(1000);
    expect(payload.valor_total).toBe(1000);
  });

  it('does not block emission when getIbsCbsRates fails — falls back to the 2026 test-rate defaults', async () => {
    mockDb.execute.mockImplementation(async (query: unknown) => {
      const text = queryText(query);
      if (/FROM pos_sales/.test(text))         return { rows: [{ id: SALE_ID, customer_doc: null, customer_name: null, terminal_id: 'term-1', total: '1000.00' }] };
      if (/FROM pos_sale_items/.test(text))    return { rows: [{ description: 'X', quantity: '1', unit_price: '1000.00', total: '1000.00', ncm: '1', cfop: '5102', cst_csosn: '00', unit: 'UN', class_trib: null }] };
      if (/FROM pos_sale_payments/.test(text)) return { rows: [{ method: 'cash', amount: '1000.00' }] };
      if (/FROM pos_terminals/.test(text))     return { rows: [{ nfce_series: 1 }] };
      if (/tax_icms_internal_rates/.test(text)) return { rows: [{ rate: '18.00' }] };
      if (/tax_ibs_cbs_rates/.test(text)) throw new Error('db unavailable');
      return { rows: [] };
    });
    mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{
      uf: 'SP', regime_tributario: 2, cnpj: '12345678000190', razao_social: 'Empresa Teste',
      logradouro: 'Rua A', numero: '100', bairro: 'Centro', municipio: 'SAO PAULO', cep: '01001000',
    }]) }) });

    const payload = await buildNfcePayload(SALE_ID, TENANT_ID) as any;
    expect(payload.itens[0].ibs_uf_aliquota).toBe(0.1);
    expect(payload.itens[0].cbs_aliquota).toBe(0.9);
  });
});
