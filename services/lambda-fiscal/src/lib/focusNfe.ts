import axios, { AxiosInstance, AxiosError } from 'axios';
import type { NfeEmitMessage, NfeItem } from './types';

export interface FocusResponse {
  status:                   string;  // processando | autorizado | erro | denegado | cancelado
  chave_nfe?:               string;
  numero_protocolo?:        string;
  data_autorizacao?:        string;
  caminho_xml_nota_fiscal?: string;
  caminho_danfe?:           string;
  erros?: Array<{ codigo: string; mensagem: string }>;
  mensagem_sefaz?:          string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class FocusNfeClient {
  private http: AxiosInstance;

  constructor(token: string, ambiente: 1 | 2) {
    const baseURL = ambiente === 1
      ? 'https://api.focusnfe.com.br'
      : 'https://homologacao.focusnfe.com.br';

    this.http = axios.create({
      baseURL,
      auth:    { username: token, password: '' },
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async emitir(ref: string, payload: object): Promise<FocusResponse> {
    try {
      const res = await this.http.post(`/v2/nfe?ref=${encodeURIComponent(ref)}`, payload);
      return res.data as FocusResponse;
    } catch (err) {
      const e = err as AxiosError<FocusResponse>;
      if (e.response?.data) return e.response.data;  // 422 with structured error body
      throw err;
    }
  }

  async consultar(ref: string): Promise<FocusResponse> {
    const res = await this.http.get(`/v2/nfe/${encodeURIComponent(ref)}`);
    return res.data as FocusResponse;
  }

  async downloadXml(ref: string): Promise<string> {
    const res = await this.http.get<string>(
      `/v2/nfe/${encodeURIComponent(ref)}/xml`,
      { responseType: 'text' },
    );
    return res.data;
  }

  /** Poll until Focus NF-e returns a terminal status (not 'processando').
   *  SEFAZ NF-e v4.0 synchronous mode typically responds in 1-5s. */
  async aguardarAutorizacao(ref: string, timeoutMs = 60_000): Promise<FocusResponse> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = await this.consultar(ref);
      if (r.status !== 'processando') return r;
      await sleep(2_000);
    }
    throw new Error(`Timeout aguardando Focus NF-e após ${timeoutMs}ms — ref=${ref}`);
  }
}

// ── Focus NF-e payload builder ───────────────────────────────────────────────

function icmsModalidade(cst?: string, csosn?: string): string {
  if (csosn) return 'simples_nacional';
  if (!cst || cst === '40' || cst === '41') return 'isento';
  return 'tributado_percentual';
}

function pisModalidade(cst?: string): string {
  if (!cst || ['07', '08', '09'].includes(cst)) return 'nao_tributado';
  return 'tributado_percentual';
}

function cofinsModalidade(cst?: string): string {
  if (!cst || ['70', '71', '72'].includes(cst)) return 'nao_tributado';
  return 'tributado_percentual';
}

function buildItem(item: NfeItem) {
  const base: Record<string, unknown> = {
    numero_item:              item.numero_item,
    codigo_produto:           item.codigo_produto,
    descricao:                item.descricao,
    ncm:                      (item.ncm ?? '00000000').replace(/\D/g, ''),
    cfop:                     item.cfop,
    unidade_comercial:        item.unidade_comercial ?? 'UN',
    quantidade_comercial:     item.quantidade_comercial,
    valor_unitario_comercial: item.valor_unitario_comercial,
    valor_bruto:              item.valor_bruto,
    icms_modalidade:          icmsModalidade(item.icms_cst, item.icms_csosn),
    icms_origem:              0,
  };

  if (item.icms_csosn) {
    base.icms_csosn = item.icms_csosn;
  } else if (item.icms_cst) {
    base.icms_cst = item.icms_cst;
    if (item.icms_cst === '00' && item.icms_base_calculo) {
      base.icms_base_calculo = item.icms_base_calculo;
      base.icms_aliquota     = item.icms_aliquota;
      base.icms_valor        = item.icms_valor;
    }
  }

  base.pis_modalidade = pisModalidade(item.pis_cst);
  base.pis_cst        = item.pis_cst ?? '07';
  if (base.pis_modalidade === 'tributado_percentual') {
    base.pis_base_calculo        = item.pis_base_calculo;
    base.pis_aliquota_percentual = item.pis_aliquota_percentual;
    base.pis_valor               = item.pis_valor;
  }

  base.cofins_modalidade = cofinsModalidade(item.cofins_cst);
  base.cofins_cst        = item.cofins_cst ?? '70';
  if (base.cofins_modalidade === 'tributado_percentual') {
    base.cofins_base_calculo        = item.cofins_base_calculo;
    base.cofins_aliquota_percentual = item.cofins_aliquota_percentual;
    base.cofins_valor               = item.cofins_valor;
  }

  if (item.ipi_valor && item.ipi_valor > 0) {
    base.ipi_cst      = '50';
    base.ipi_aliquota = item.ipi_aliquota;
    base.ipi_valor    = item.ipi_valor;
  }

  return base;
}

export function buildFocusPayload(msg: NfeEmitMessage): object {
  const { emitente, destinatario, natureza_operacao, data_emissao, itens, pagamentos } = msg;

  return {
    natureza_operacao,
    data_emissao,
    tipo_documento:     1,
    presenca_comprador: 9,
    finalidade_emissao: 1,
    consumidor_final:   destinatario.cpf ? 1 : 0,
    local_destino:      emitente.uf === (destinatario.uf ?? emitente.uf) ? 1 : 2,

    emitente: {
      cnpj:              emitente.cnpj.replace(/\D/g, ''),
      nome:              emitente.razao_social,
      nome_fantasia:     emitente.nome_fantasia,
      logradouro:        emitente.logradouro,
      numero:            emitente.numero,
      complemento:       emitente.complemento,
      bairro:            emitente.bairro,
      municipio:         emitente.municipio,
      uf:                emitente.uf,
      cep:               emitente.cep.replace(/\D/g, ''),
      telefone:          emitente.telefone?.replace(/\D/g, ''),
      email:             emitente.email,
      regime_tributario: emitente.regime_tributario,
    },

    destinatario: {
      cnpj:         destinatario.cnpj?.replace(/\D/g, ''),
      cpf:          destinatario.cpf?.replace(/\D/g, ''),
      nome:         destinatario.nome,
      indicador_ie: destinatario.indicador_ie ?? 9,
      logradouro:   destinatario.logradouro,
      numero:       destinatario.numero,
      complemento:  destinatario.complemento,
      bairro:       destinatario.bairro,
      municipio:    destinatario.municipio,
      uf:           destinatario.uf,
      cep:          destinatario.cep?.replace(/\D/g, ''),
      telefone:     destinatario.telefone?.replace(/\D/g, ''),
      email:        destinatario.email,
    },

    items: itens.map(buildItem),

    forma_pagamento: pagamentos,
  };
}
