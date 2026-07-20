import { describe, it, expect } from 'vitest';
import { buildNfseEmitMessage, NfseEmitMessageInput } from '../lib/nfse';

// Regressão do bug crítico de consolidação: consolidationService.ts passava
// chaves camelCase (nfseId/issRate/…) onde o contrato pede snake_case
// (nfse_id/iss_rate/…), com um `as any` no literal calando o tsc. O resultado
// era focus_ref="undefined" e a nota presa em `processing` para sempre. Aqui
// pinamos o contrato: o builder tem de produzir chaves definidas, e falhar
// alto quando as obrigatórias faltam (a defesa que teria pego o bug).

const baseInput = (): NfseEmitMessageInput => ({
  nfse_id: 'nfse-123',
  tenant_id: 'tenant-abc',
  description: 'Serviços consolidados 2026-02',
  amount: 2800,
  iss_rate: 2,
  iss_value: 56,
  service_code: '01.05',
  cfg: {
    cnpj: '48994778000190', razao_social: 'WLAD MYR A', inscricao_municipal: '12345',
    codigo_municipio_ibge: '2510808', logradouro: 'Rua X', numero: '1', complemento: null,
    bairro: 'Centro', municipio: 'Patos', uf: 'PB', cep: '58700000', telefone: null, email: null,
    focus_ambiente: 2, focus_token_homologacao: 'local-tok', focus_token_producao: null,
  },
  client: {
    person_type: 'PJ', cnpj: '11222333000181', cpf: null, company_name: 'Cliente LTDA',
    full_name: null, email: null, street: null, street_number: null, complement: null,
    neighborhood: null, city: null, state: null, zip_code: null, phone: null,
  },
});

describe('buildNfseEmitMessage', () => {
  it('produz nfse_id/focus_ref/tenant_id e o serviço com aliquota e valor_iss definidos', () => {
    const msg = buildNfseEmitMessage(baseInput());

    expect(msg.nfse_id).toBe('nfse-123');
    expect(msg.focus_ref).toBe('nfse-123');
    expect(msg.tenant_id).toBe('tenant-abc');
    expect(msg.valor_iss).toBe(56);
    expect(msg.servicos[0].aliquota).toBe(2);
    expect(msg.servicos[0].codigo_tributario_municipio).toBe('01.05');
  });

  it('sobrevive ao round-trip JSON sem chaves undefined nas obrigatórias', () => {
    const msg = JSON.parse(JSON.stringify(buildNfseEmitMessage(baseInput())));
    expect(msg.nfse_id).toBeDefined();
    expect(msg.focus_ref).toBeDefined();
    expect(msg.tenant_id).toBeDefined();
    expect(msg.focus_ref).not.toBe('undefined');
  });

  it('estoura quando nfse_id falta (evita enfileirar mensagem que nunca fecha)', () => {
    const bad = { ...baseInput(), nfse_id: '' };
    expect(() => buildNfseEmitMessage(bad)).toThrow(/nfse_id/);
  });

  it('estoura quando tenant_id falta', () => {
    const bad = { ...baseInput(), tenant_id: '' };
    expect(() => buildNfseEmitMessage(bad)).toThrow(/tenant_id/);
  });
});
