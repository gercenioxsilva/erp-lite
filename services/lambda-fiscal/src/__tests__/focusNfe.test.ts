import { describe, it, expect } from 'vitest';
import { buildFocusPayload, FocusNfeClient } from '../lib/focusNfe';
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

describe('buildFocusPayload — consumidor_final (indFinal)', () => {
  function makeMsgWithDestinatario(destinatario: NfeEmitMessage['destinatario']): NfeEmitMessage {
    return { ...makeMsg(), destinatario };
  }

  it('[regressão SEFAZ — "Operação com não contribuinte deve indicar operação com consumidor final"] marca consumidor_final=1 pra CNPJ não contribuinte (indicador_ie=9, default de clients.icms_taxpayer)', () => {
    const payload = buildFocusPayload(makeMsgWithDestinatario({
      cnpj: '98765432000110', nome: 'Cliente PJ não contribuinte', indicador_ie: 9,
    })) as any;
    expect(payload.consumidor_final).toBe(1);
  });

  it('marca consumidor_final=1 pra pessoa física (CPF), como antes', () => {
    const payload = buildFocusPayload(makeMsgWithDestinatario({
      cpf: '12345678900', nome: 'Cliente PF',
    })) as any;
    expect(payload.consumidor_final).toBe(1);
  });

  it('marca consumidor_final=0 pra CNPJ contribuinte de ICMS (indicador_ie=1) — operação normal entre empresas', () => {
    const payload = buildFocusPayload(makeMsgWithDestinatario({
      cnpj: '98765432000110', nome: 'Cliente PJ contribuinte', indicador_ie: 1,
    })) as any;
    expect(payload.consumidor_final).toBe(0);
  });

  it('marca consumidor_final=0 pra CNPJ isento de IE (indicador_ie=2)', () => {
    const payload = buildFocusPayload(makeMsgWithDestinatario({
      cnpj: '98765432000110', nome: 'Cliente PJ isento', indicador_ie: 2,
    })) as any;
    expect(payload.consumidor_final).toBe(0);
  });
});

describe('buildFocusPayload — inscricao_estadual_destinatario', () => {
  function makeMsgWithDestinatario(destinatario: NfeEmitMessage['destinatario']): NfeEmitMessage {
    return { ...makeMsg(), destinatario };
  }

  it('[regressão SEFAZ — "IE do destinatário não informada"] envia a IE quando o destinatário é CNPJ contribuinte (indicador_ie=1)', () => {
    const payload = buildFocusPayload(makeMsgWithDestinatario({
      cnpj: '98765432000110', nome: 'Cliente PJ contribuinte', indicador_ie: 1,
      inscricao_estadual: '206.563.490.111',
    })) as any;
    expect(payload.inscricao_estadual_destinatario).toBe('206563490111'); // só dígitos
  });

  it('nunca envia a IE quando indicador_ie não é 1 (isento ou não contribuinte), mesmo se o valor estiver presente', () => {
    const payload = buildFocusPayload(makeMsgWithDestinatario({
      cnpj: '98765432000110', nome: 'Cliente PJ isento', indicador_ie: 2,
      inscricao_estadual: '206563490111',
    })) as any;
    expect(payload.inscricao_estadual_destinatario).toBeUndefined();
  });

  it('omite o campo quando o cliente é contribuinte mas não tem IE cadastrada (nunca envia string vazia)', () => {
    const payload = buildFocusPayload(makeMsgWithDestinatario({
      cnpj: '98765432000110', nome: 'Cliente sem IE', indicador_ie: 1,
    })) as any;
    expect(payload.inscricao_estadual_destinatario).toBeUndefined();
  });
});

describe('buildFocusPayload — ICMS CST 00 (tributado integralmente)', () => {
  it('[regressão SEFAZ — "Element vBC: This element is not expected. Expected is modBC"] sempre envia icms_modalidade_base_calculo junto com vBC/pICMS/vICMS', () => {
    // Reproduz o cenário real de produção: item com CST='00' (regime normal,
    // não-Simples) só mandava icms_base_calculo/icms_aliquota/icms_valor —
    // sem modBC, o Focus gera <vBC> sem <modBC> antes, e a SEFAZ rejeita por
    // ordem de elementos do XSD (ICMS00 exige orig, CST, modBC, vBC, pICMS, vICMS).
    const payload = buildFocusPayload(makeMsg([makeItem({
      icms_cst: '00', icms_base_calculo: 1000, icms_aliquota: 18, icms_valor: 180,
    })])) as any;
    const item = payload.items[0];

    // 3 = "Valor da operação" — icms_base (taxEngine.ts) é sempre o subtotal
    // do item, nunca uma base ajustada por margem (0) ou pauta (1/2).
    expect(item.icms_modalidade_base_calculo).toBe(3);
    expect(item.icms_base_calculo).toBe(1000);
    expect(item.icms_aliquota).toBe(18);
    expect(item.icms_valor).toBe(180);
  });

  it('não envia icms_modalidade_base_calculo para CSOSN (Simples Nacional) — modBC é exclusivo do regime normal', () => {
    const payload = buildFocusPayload(makeMsg([makeItem({ icms_csosn: '102', icms_cst: undefined })])) as any;
    expect(payload.items[0].icms_modalidade_base_calculo).toBeUndefined();
  });

  it('não envia icms_modalidade_base_calculo para outros CSTs não-tributados integralmente (ex.: 40 — isenta)', () => {
    const payload = buildFocusPayload(makeMsg([makeItem({ icms_cst: '40' })])) as any;
    expect(payload.items[0].icms_modalidade_base_calculo).toBeUndefined();
  });
});

describe('buildFocusPayload — duplicatas (Plano de Pagamento, regra 75)', () => {
  it('nota sem plano de pagamento não inclui "duplicatas" no payload (comportamento inalterado)', () => {
    const payload = buildFocusPayload(makeMsg()) as any;
    expect(payload.duplicatas).toBeUndefined();
  });

  it('nota com plano de pagamento inclui o quadro de duplicatas com os mesmos campos da mensagem', () => {
    const msg = makeMsg();
    msg.duplicatas = [
      { numero: '001', data_vencimento: '2026-07-20', valor: 33.34 },
      { numero: '002', data_vencimento: '2026-08-19', valor: 33.33 },
      { numero: '003', data_vencimento: '2026-09-18', valor: 33.33 },
    ];
    const payload = buildFocusPayload(msg) as any;
    expect(payload.duplicatas).toEqual(msg.duplicatas);
  });

  it('lista vazia de duplicatas não inclui a chave no payload (mesmo tratamento de ausente)', () => {
    const msg = makeMsg();
    msg.duplicatas = [];
    const payload = buildFocusPayload(msg) as any;
    expect(payload.duplicatas).toBeUndefined();
  });
});

describe('buildFocusPayload — informacoes_adicionais_contribuinte (observação da tela de emissão)', () => {
  it('nota sem observação não inclui a chave no payload (comportamento inalterado)', () => {
    const payload = buildFocusPayload(makeMsg()) as any;
    expect(payload.informacoes_adicionais_contribuinte).toBeUndefined();
  });

  it('nota com observação inclui exatamente o texto digitado na tela de emissão', () => {
    const msg = makeMsg();
    msg.informacoes_adicionais_contribuinte = 'Entrega agendada para a tarde, portaria B.';
    const payload = buildFocusPayload(msg) as any;
    expect(payload.informacoes_adicionais_contribuinte).toBe('Entrega agendada para a tarde, portaria B.');
  });

  it('string vazia não inclui a chave no payload (mesmo tratamento de ausente)', () => {
    const msg = makeMsg();
    msg.informacoes_adicionais_contribuinte = '';
    const payload = buildFocusPayload(msg) as any;
    expect(payload.informacoes_adicionais_contribuinte).toBeUndefined();
  });
});

describe('buildFocusPayload — transportadora e volumes (migration 0089)', () => {
  it('nota sem transportadora mantém modalidade_frete=9 (comportamento inalterado)', () => {
    const payload = buildFocusPayload(makeMsg()) as any;
    expect(payload.modalidade_frete).toBe(9);
    expect(payload.nome_transportadora).toBeUndefined();
    expect(payload.volumes).toBeUndefined();
  });

  it('nota com transportadora PJ inclui o grupo transportadora e substitui modalidade_frete', () => {
    const msg = makeMsg();
    msg.transportadora = {
      cnpj: '11.444.777/0001-61', nome: 'Transportadora Rápida', ie: '123456789',
      endereco: 'Rod. BR-101, km 10', municipio: 'SAO PAULO', uf: 'SP',
      modalidade_frete: 0,
    };
    const payload = buildFocusPayload(msg) as any;
    expect(payload.modalidade_frete).toBe(0);
    expect(payload.nome_transportadora).toBe('Transportadora Rápida');
    expect(payload.cnpj_transportadora).toBe('11444777000161');
    expect(payload.cpf_transportadora).toBeUndefined();
  });

  it('nota com transportadora PF (autônomo) usa cpf_transportadora, nunca cnpj', () => {
    const msg = makeMsg();
    msg.transportadora = { cpf: '111.444.777-35', nome: 'João Motorista', modalidade_frete: 1 };
    const payload = buildFocusPayload(msg) as any;
    expect(payload.cpf_transportadora).toBe('11144477735');
    expect(payload.cnpj_transportadora).toBeUndefined();
  });

  it('volumes vazios não incluem a chave no payload (mesmo tratamento de duplicatas ausentes)', () => {
    const msg = makeMsg();
    msg.volumes = [];
    const payload = buildFocusPayload(msg) as any;
    expect(payload.volumes).toBeUndefined();
  });

  it('volumes presentes mapeiam pros campos flat do Focus', () => {
    const msg = makeMsg();
    msg.volumes = [{ quantidade: 2, especie: 'Caixa', peso_liquido: 10.5, peso_bruto: 12 }];
    const payload = buildFocusPayload(msg) as any;
    expect(payload.volumes).toEqual([{
      quantidade_volumes: 2, especie_volumes: 'Caixa', marca_volumes: undefined,
      numeracao_volumes: undefined, peso_liquido_volumes: 10.5, peso_bruto_volumes: 12,
    }]);
  });
});

describe('FocusNfeClient — cancelar / cartaCorrecao (modo simulação local)', () => {
  it('cancelar() devolve status "cancelado" pra token local-* comum', async () => {
    const client = new FocusNfeClient('local-test', 2);
    const result = await client.cancelar('inv-1', 'Cancelamento solicitado pelo cliente');
    expect(result.status).toBe('cancelado');
    expect(result.numero_protocolo).toBeTruthy();
  });

  it('cancelar() devolve erro simulado pra token local-reject', async () => {
    const client = new FocusNfeClient('local-reject', 2);
    const result = await client.cancelar('inv-1', 'Cancelamento solicitado pelo cliente');
    expect(result.status).toBe('erro');
    expect(result.erros?.length).toBeGreaterThan(0);
  });

  it('cartaCorrecao() devolve status "registrada" pra token local-* comum', async () => {
    const client = new FocusNfeClient('local-test', 2);
    const result = await client.cartaCorrecao('inv-1', 'Correção do endereço de entrega do destinatário');
    expect(result.status).toBe('registrada');
    expect(result.numero_protocolo).toBeTruthy();
  });

  it('cartaCorrecao() devolve erro simulado pra token local-reject', async () => {
    const client = new FocusNfeClient('local-reject', 2);
    const result = await client.cartaCorrecao('inv-1', 'Correção do endereço de entrega do destinatário');
    expect(result.status).toBe('erro');
    expect(result.erros?.length).toBeGreaterThan(0);
  });
});
