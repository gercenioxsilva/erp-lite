import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { consultarNFeRecebida } from '../services/fiscal/focusNfe';
import type { Company } from '../services/companyService';

// consultarNFeRecebida() nunca deve lançar erro pra cima — qualquer falha
// (token ausente, 404, erro de rede) precisa cair em { found: false, reason }
// pra nunca bloquear o cadastro manual da NF-e de entrada.

function baseCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-1', tenant_id: 'tenant-1', is_default: true, is_active: true,
    cnpj: '11444777000161', razao_social: 'Empresa Teste Ltda', nome_fantasia: null,
    regime_tributario: 1, logradouro: 'Rua A', numero: '1', complemento: null,
    bairro: 'Centro', municipio: 'SAO PAULO', uf: 'SP', cep: '01000000',
    telefone: null, email: null, cfop_padrao: '5102', cfop_interestadual: '6102',
    natureza_operacao: 'Venda de mercadoria', focus_ambiente: 2,
    focus_token_homologacao: 'hml-token', focus_token_producao: null,
    inscricao_municipal: null, codigo_municipio_ibge: '3550308',
    aliquota_iss_padrao: '5.00', codigo_servico_padrao: null,
    ...overrides,
  } as Company;
}

const CHAVE = '1'.repeat(44);

describe('consultarNFeRecebida', () => {
  const originalFetch = global.fetch;

  beforeEach(() => { global.fetch = vi.fn() as any; });
  afterEach(() => { global.fetch = originalFetch; });

  it('retorna found:false quando a empresa não tem token Focus configurado para o ambiente', async () => {
    const result = await consultarNFeRecebida(CHAVE, baseCompany({ focus_token_homologacao: null }));
    expect(result.found).toBe(false);
    expect(result.reason).toMatch(/Token Focus NF-e não configurado/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('retorna found:false quando o Focus responde 404 (nota não distribuída ou MDe inativo)', async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 404 });
    const result = await consultarNFeRecebida(CHAVE, baseCompany());
    expect(result.found).toBe(false);
    expect(result.reason).toMatch(/não foi distribuída|MDe/);
  });

  it('retorna found:false quando o Focus responde outro erro HTTP', async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 500 });
    const result = await consultarNFeRecebida(CHAVE, baseCompany());
    expect(result.found).toBe(false);
    expect(result.reason).toMatch(/HTTP 500/);
  });

  it('nunca lança quando fetch rejeita (erro de rede) — retorna found:false', async () => {
    (global.fetch as any).mockRejectedValue(new Error('network down'));
    const result = await consultarNFeRecebida(CHAVE, baseCompany());
    expect(result.found).toBe(false);
    expect(result.reason).toMatch(/network down/);
  });

  it('mapeia emitente, nfe e itens quando a nota é encontrada', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        numero: '123', serie: '1', data_emissao: '2026-07-01T10:00:00-03:00', valor_total: 500.5,
        emitente: {
          cnpj: '22333444000155', razao_social: 'Fornecedor XYZ',
          logradouro: 'Av. B', numero: '99', bairro: 'Centro', municipio: 'Rio de Janeiro', uf: 'RJ', cep: '20000000',
        },
        itens: [
          { descricao: 'Parafuso M6', ncm: '73181500', cfop: '5102', unidade_comercial: 'UN', quantidade_comercial: 10, valor_unitario_comercial: 2.5 },
        ],
      }),
    });

    const result = await consultarNFeRecebida(CHAVE, baseCompany({ focus_ambiente: 2 }));

    expect(result.found).toBe(true);
    expect(result.emitente).toEqual({
      cnpj: '22333444000155', razao_social: 'Fornecedor XYZ',
      logradouro: 'Av. B', numero: '99', bairro: 'Centro', municipio: 'Rio de Janeiro', uf: 'RJ', cep: '20000000',
    });
    expect(result.nfe).toEqual({
      chave: CHAVE, numero: '123', serie: '1', data_emissao: '2026-07-01T10:00:00-03:00', valor_total: 500.5,
    });
    expect(result.items).toEqual([
      { name: 'Parafuso M6', ncm_code: '73181500', cfop: '5102', unit: 'UN', quantity: 10, unit_price: 2.5 },
    ]);
  });

  it('usa o token e a URL de produção quando focus_ambiente=1', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ numero: '1', serie: '1', valor_total: 10, emitente: { cnpj: '22333444000155', razao_social: 'X' }, itens: [] }),
    });

    await consultarNFeRecebida(CHAVE, baseCompany({ focus_ambiente: 1, focus_token_producao: 'prod-token', focus_token_homologacao: null }));

    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(url).toContain('https://api.focusnfe.com.br');
    expect(opts.headers.Authorization).toBe('Basic ' + Buffer.from('prod-token:').toString('base64'));
  });
});
