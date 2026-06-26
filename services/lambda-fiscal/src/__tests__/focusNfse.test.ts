import { describe, it, expect } from 'vitest';
import { FocusNfseClient, buildFocusNfsePayload } from '../lib/focusNfe';
import type { NfseEmitMessage } from '../lib/types';

function makeMsg(overrides: Partial<NfseEmitMessage> = {}): NfseEmitMessage {
  return {
    type:      'nfse',
    nfse_id:   'abc123def456',
    tenant_id: 'tenant-1',
    focus_ref: 'abc123def456',
    ambiente:  2,
    prestador: {
      cnpj:                '12.345.678/0001-90',
      razao_social:        'Prestadora LTDA',
      inscricao_municipal: '987654',
      codigo_municipio:    '3550308',
      logradouro:          'Rua A',
      numero:              '100',
      bairro:              'Centro',
      municipio:           'SAO PAULO',
      uf:                  'SP',
      cep:                 '01001000',
    },
    tomador: {
      cnpj:         '98.765.432/0001-10',
      razao_social: 'Cliente SA',
      email:        'cliente@example.com',
    },
    servicos: [{
      descricao:                   'Manutenção mensal',
      codigo_tributario_municipio: '14.01',
      aliquota:                    5,
      valor_servicos:              1000,
      base_calculo:                1000,
      valor_iss:                   50,
    }],
    valor_servicos: 1000,
    valor_iss:      50,
    data_emissao:   '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildFocusNfsePayload', () => {
  it('builds a flat payload with prestador, tomador, servico', () => {
    const payload = buildFocusNfsePayload(makeMsg()) as any;
    expect(payload.data_emissao).toBe('2026-06-01T00:00:00.000Z');
    expect(payload.prestador.cnpj).toBe('12345678000190'); // digits only
    expect(payload.prestador.inscricao_municipal).toBe('987654');
    expect(payload.servico.item_lista_servico).toBe('14.01');
    expect(payload.servico.valor_servicos).toBe(1000);
    expect(payload.servico.valor_iss).toBe(50);
    expect(payload.servico.aliquota).toBe(5);
  });

  it('uses CNPJ for tomador when present (digits only)', () => {
    const payload = buildFocusNfsePayload(makeMsg()) as any;
    expect(payload.tomador.cnpj).toBe('98765432000110');
    expect(payload.tomador.cpf).toBeUndefined();
  });

  it('uses CPF for tomador when no CNPJ', () => {
    const msg = makeMsg({ tomador: { cpf: '123.456.789-00', razao_social: 'Pessoa Física' } });
    const payload = buildFocusNfsePayload(msg) as any;
    expect(payload.tomador.cpf).toBe('12345678900');
    expect(payload.tomador.cnpj).toBeUndefined();
  });
});

describe('FocusNfseClient simulation mode', () => {
  it('returns autorizado for local-* tokens', async () => {
    const client = new FocusNfseClient('local-test', 2);
    const res = await client.emitir('abc123def456', {});
    expect(res.status).toBe('autorizado');
    expect(res.numero_nfse).toBe('000001');
    expect(res.codigo_verificacao).toContain('DEMO');
    expect(res.link_download_pdf).toContain('abc123def456');
  });

  it('returns erro for local-reject tokens', async () => {
    const client = new FocusNfseClient('local-reject', 2);
    const res = await client.emitir('abc123def456', {});
    expect(res.status).toBe('erro');
    expect(res.erros?.length).toBeGreaterThan(0);
  });

  it('aguardarAutorizacao resolves immediately in simulation', async () => {
    const client = new FocusNfseClient('local-test', 2);
    const res = await client.aguardarAutorizacao('abc123def456', 5000);
    expect(res.status).toBe('autorizado');
  });
});
