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
  it('sends the exact field names documented by the Focus NF-e API, deriving valor from base×aliquota with the 2026 test rates as defaults', () => {
    const payload = buildFocusPayload(makeMsg()) as any;
    const item = payload.items[0];

    expect(item.ibs_cbs_situacao_tributaria).toBe('000');
    expect(item.ibs_cbs_classificacao_tributaria).toBe('000001');
    expect(item.ibs_cbs_base_calculo).toBe(1000);
    expect(item.cbs_aliquota).toBe(0.9);
    expect(item.cbs_valor).toBe(9);       // 1000 * 0.9%
    expect(item.ibs_uf_aliquota).toBe(0.1);
    expect(item.ibs_uf_valor).toBe(1);    // 1000 * 0.1%
    // Split UF/Município não publicado para 2026 — simplificação documentada.
    expect(item.ibs_mun_aliquota).toBe(0);
    expect(item.ibs_mun_valor).toBe(0);
  });

  it('[regressão SEFAZ — "Valor do IBS da UF difere do calculado"] nunca confia num ibs_valor/cbs_valor zerado persistido — sempre deriva de base×aliquota', () => {
    // Reproduz o cenário real de produção: o frontend ainda não envia ibs_rate/
    // ibs_value ao criar a nota, então invoice_items.ibs_value/cbs_value ficam
    // '0' — routes/nfe.ts mapeia isso para `undefined` (Number(0) || undefined),
    // então o item chega aqui SEM ibs_valor/cbs_valor, só com valor_bruto.
    const payload = buildFocusPayload(makeMsg([makeItem({
      ibs_aliquota: undefined, ibs_valor: undefined,
      cbs_aliquota: undefined, cbs_valor: undefined,
    })])) as any;
    const item = payload.items[0];

    // Antes do fix, isso era 0 — descasando de ibs_uf_aliquota=0.1 e causando
    // a rejeição do SEFAZ. Agora precisa bater com base(1000) × aliquota(0.1%).
    expect(item.ibs_uf_valor).toBe(1);
    expect(item.cbs_valor).toBe(9);
    expect(item.ibs_uf_valor).toBe(round2(item.ibs_cbs_base_calculo * item.ibs_uf_aliquota / 100));
    expect(item.cbs_valor).toBe(round2(item.ibs_cbs_base_calculo * item.cbs_aliquota / 100));
  });

  it('uses the class_trib override from the item when provided, splitting the 3-digit CST prefix', () => {
    const payload = buildFocusPayload(makeMsg([makeItem({ class_trib: '200001' })])) as any;
    const item = payload.items[0];
    expect(item.ibs_cbs_situacao_tributaria).toBe('200');
    expect(item.ibs_cbs_classificacao_tributaria).toBe('200001');
  });

  it('ignores a passed-in ibs_valor/cbs_valor and always re-derives from base×aliquota (single source of truth at the SEFAZ boundary)', () => {
    // Mesmo se vier um valor (ex.: calculado por uma versão antiga do
    // taxEngine, ou adulterado), o Lambda nunca confia — sempre recalcula.
    const payload = buildFocusPayload(makeMsg([makeItem({
      ibs_base_calculo: 1000, ibs_aliquota: 0.1, ibs_valor: 999,   // valor deliberadamente errado
      cbs_base_calculo: 1000, cbs_aliquota: 0.9, cbs_valor: 999,   // valor deliberadamente errado
    })])) as any;
    const item = payload.items[0];
    expect(item.ibs_uf_valor).toBe(1);  // recalculado, não 999
    expect(item.cbs_valor).toBe(9);     // recalculado, não 999
  });

  it('never changes valor_bruto — IBS/CBS are informational, not additive, in 2026', () => {
    const payload = buildFocusPayload(makeMsg([makeItem({
      ibs_valor: 1, cbs_valor: 9,
    })])) as any;
    expect(payload.items[0].valor_bruto).toBe(1000);
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
