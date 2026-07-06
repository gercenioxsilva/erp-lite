import { describe, it, expect } from 'vitest';
import { buildFocusPayload } from '../lib/focusNfe';
import type { NfeEmitMessage, NfeItem } from '../lib/types';

function makeItem(overrides: Partial<NfeItem> = {}): NfeItem {
  return {
    numero_item: 1, codigo_produto: 'ITEM1', descricao: 'Produto Teste',
    ncm: '12345678', cfop: '5102', unidade_comercial: 'UN',
    quantidade_comercial: 10, valor_unitario_comercial: 100, valor_bruto: 1000,
    ...overrides,
  };
}

function makeMsg(itens: NfeItem[] = [makeItem()]): NfeEmitMessage {
  return {
    invoice_id: 'inv-1', tenant_id: 'tenant-1', focus_ref: 'inv-1', ambiente: 2,
    emitente: {
      cnpj: '12345678000190', razao_social: 'Emitente Teste',
      logradouro: 'Rua A', numero: '100', bairro: 'Centro',
      municipio: 'SAO PAULO', uf: 'SP', cep: '01001000',
      regime_tributario: 2,
    },
    destinatario: { nome: 'Cliente Teste', cpf: '12345678900' },
    natureza_operacao: 'Venda', data_emissao: '2026-06-01T00:00:00.000Z',
    itens, pagamentos: [{ forma_pagamento: '99', valor_pagamento: 1000 }],
  };
}

describe('buildFocusPayload — IBS/CBS (Reforma Tributária, regra 44)', () => {
  it('sends the exact field names documented by the Focus NF-e API, with the 2026 test rates as defaults', () => {
    const payload = buildFocusPayload(makeMsg()) as any;
    const item = payload.items[0];

    expect(item.ibs_cbs_situacao_tributaria).toBe('000');
    expect(item.ibs_cbs_classificacao_tributaria).toBe('000001');
    expect(item.ibs_cbs_base_calculo).toBe(1000);
    expect(item.cbs_aliquota).toBe(0.9);
    expect(item.cbs_valor).toBe(0);
    expect(item.ibs_uf_aliquota).toBe(0.1);
    expect(item.ibs_uf_valor).toBe(0);
    // Split UF/Município não publicado para 2026 — simplificação documentada.
    expect(item.ibs_mun_aliquota).toBe(0);
    expect(item.ibs_mun_valor).toBe(0);
  });

  it('uses the class_trib override from the item when provided, splitting the 3-digit CST prefix', () => {
    const payload = buildFocusPayload(makeMsg([makeItem({ class_trib: '200001' })])) as any;
    const item = payload.items[0];
    expect(item.ibs_cbs_situacao_tributaria).toBe('200');
    expect(item.ibs_cbs_classificacao_tributaria).toBe('200001');
  });

  it('forwards the resolved IBS/CBS base/rate/value computed by taxEngine (informational)', () => {
    const payload = buildFocusPayload(makeMsg([makeItem({
      ibs_base_calculo: 1000, ibs_aliquota: 0.1, ibs_valor: 1,
      cbs_base_calculo: 1000, cbs_aliquota: 0.9, cbs_valor: 9,
    })])) as any;
    const item = payload.items[0];
    expect(item.ibs_uf_valor).toBe(1);
    expect(item.cbs_valor).toBe(9);
  });

  it('never changes valor_bruto — IBS/CBS are informational, not additive, in 2026', () => {
    const payload = buildFocusPayload(makeMsg([makeItem({
      ibs_valor: 1, cbs_valor: 9,
    })])) as any;
    expect(payload.items[0].valor_bruto).toBe(1000);
  });
});
