import axios, { AxiosInstance, AxiosError } from 'axios';
import type { NfeEmitMessage, NfeItem, NfseEmitMessage } from './types';

export interface FocusResponse {
  status:                   string;  // processando | autorizado | erro | denegado | cancelado
  chave_nfe?:               string;
  numero_protocolo?:        string;
  protocolo?:               string;  // Focus v2 retorna o protocolo neste campo
  data_autorizacao?:        string;
  caminho_xml_nota_fiscal?: string;
  caminho_danfe?:           string;
  erros?: Array<{ codigo: string; mensagem: string }>;
  mensagem_sefaz?:          string;
  // Erros de autenticação/permissão do Focus chegam neste formato (sem `status`)
  codigo?:                  string;
  mensagem?:                string;
}

// Tokens com este prefixo ativam o modo de simulação local (sem rede).
// `local-reject*` simula uma rejeição; qualquer outro `local-*` simula autorização.
const SIMULATE_PREFIX = 'local-';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const onlyDigits = (s: string): string => s.replace(/\D/g, '');

/** Chave de acesso de 44 dígitos determinística a partir do ref (apenas para simulação). */
function mockChaveAcesso(ref: string): string {
  const base = (onlyDigits(ref) || '0').repeat(44);
  return ('35' + base).slice(0, 44);  // '35' = código de SP, restante derivado do ref
}

export class FocusNfeClient {
  private http: AxiosInstance;
  private simulate: boolean;
  private simulateReject: boolean;

  constructor(token: string, ambiente: 1 | 2) {
    // Modo simulação local: não chama a rede, devolve respostas mock.
    this.simulate       = token.toLowerCase().startsWith(SIMULATE_PREFIX);
    this.simulateReject = /reject/i.test(token);

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

  /** Resposta autorizada simulada (homologação local, sem SEFAZ). */
  private simulatedAuthorized(ref: string, payload: object): FocusResponse {
    const dataEmissao = (payload as { data_emissao?: string }).data_emissao;
    return {
      status:           'autorizado',
      chave_nfe:        mockChaveAcesso(ref),
      numero_protocolo: '135' + onlyDigits(ref).padEnd(12, '0').slice(0, 12),
      data_autorizacao: dataEmissao ?? new Date().toISOString(),
      caminho_danfe:           `/demo/danfe/${ref}.pdf`,
      caminho_xml_nota_fiscal: `/demo/xml/${ref}.xml`,
    };
  }

  async emitir(ref: string, payload: object): Promise<FocusResponse> {
    if (this.simulate) {
      if (this.simulateReject) {
        return {
          status: 'erro',
          erros: [{
            codigo:   '215',
            mensagem: 'Rejeição simulada (homologação local): falha de schema XML da NF-e',
          }],
        };
      }
      return this.simulatedAuthorized(ref, payload);
    }

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
    if (this.simulate) {
      return this.simulateReject
        ? { status: 'erro', erros: [{ codigo: '215', mensagem: 'Rejeição simulada (homologação local)' }] }
        : this.simulatedAuthorized(ref, {});
    }
    const res = await this.http.get(`/v2/nfe/${encodeURIComponent(ref)}`);
    return res.data as FocusResponse;
  }

  async downloadXml(ref: string): Promise<string> {
    if (this.simulate) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<nfeProc versao="4.00"><!-- DEMO/SIMULADO — ref ${ref} -->` +
        `<protNFe><infProt><chNFe>${mockChaveAcesso(ref)}</chNFe>` +
        `<nProt>${'135' + onlyDigits(ref).padEnd(12, '0').slice(0, 12)}</nProt>` +
        `<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e (simulado)</xMotivo>` +
        `</infProt></protNFe></nfeProc>`;
    }
    // Aceita o caminho completo retornado pelo Focus (caminho_xml_nota_fiscal)
    // ou um ref, montando o endpoint padrão nesse caso.
    const url = ref.startsWith('/') ? ref : `/v2/nfe/${encodeURIComponent(ref)}/xml`;
    const res = await this.http.get<string>(url, { responseType: 'text' });
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

// ── Focus NF-e payload builder (formato flat — Focus NF-e v2) ────────────────

function buildItem(item: NfeItem): Record<string, unknown> {
  // O sistema guarda o código de ICMS em icms_cst (CST p/ regime normal,
  // CSOSN p/ Simples). O Focus usa o mesmo campo icms_situacao_tributaria.
  const icmsSituacao   = item.icms_csosn || item.icms_cst || '102';
  const isCstTributado = !item.icms_csosn && item.icms_cst === '00';

  const base: Record<string, unknown> = {
    numero_item:               item.numero_item,
    codigo_produto:            item.codigo_produto,
    descricao:                 item.descricao,
    cfop:                      item.cfop,
    codigo_ncm:                (item.ncm ?? '00000000').replace(/\D/g, ''),
    unidade_comercial:         item.unidade_comercial ?? 'UN',
    quantidade_comercial:      item.quantidade_comercial,
    valor_unitario_comercial:  item.valor_unitario_comercial,
    valor_bruto:               item.valor_bruto,
    unidade_tributavel:        item.unidade_comercial ?? 'UN',
    quantidade_tributavel:     item.quantidade_comercial,
    valor_unitario_tributavel: item.valor_unitario_comercial,
    icms_origem:               0,
    icms_situacao_tributaria:  icmsSituacao,
    pis_situacao_tributaria:    item.pis_cst ?? '07',
    cofins_situacao_tributaria: item.cofins_cst ?? '07',
  };

  // Regime normal com CST tributado: enviar base/alíquota/valor de ICMS.
  if (isCstTributado) {
    base.icms_base_calculo = item.icms_base_calculo;
    base.icms_aliquota     = item.icms_aliquota;
    base.icms_valor        = item.icms_valor;
  }

  if (item.ipi_valor && item.ipi_valor > 0) {
    base.ipi_situacao_tributaria = '50';
    base.ipi_aliquota            = item.ipi_aliquota;
    base.ipi_valor               = item.ipi_valor;
  }

  return base;
}

export function buildFocusPayload(msg: NfeEmitMessage): object {
  const e = msg.emitente;
  const d = msg.destinatario;

  const payload: Record<string, unknown> = {
    natureza_operacao:  msg.natureza_operacao,
    data_emissao:       msg.data_emissao,
    tipo_documento:     1,
    finalidade_emissao: 1,
    consumidor_final:   d.cpf ? 1 : 0,
    presenca_comprador: 9,
    modalidade_frete:   9,

    // Emitente (campos flat). O Focus complementa IE/dados pelo cadastro.
    cnpj_emitente:              onlyDigits(e.cnpj),
    nome_emitente:              e.razao_social,
    nome_fantasia_emitente:     e.nome_fantasia,
    logradouro_emitente:        e.logradouro,
    numero_emitente:            e.numero,
    complemento_emitente:       e.complemento,
    bairro_emitente:            e.bairro,
    municipio_emitente:         e.municipio,
    uf_emitente:                e.uf,
    cep_emitente:               onlyDigits(e.cep),
    regime_tributario_emitente: e.regime_tributario,

    // Destinatário (campos flat).
    nome_destinatario:        d.nome,
    logradouro_destinatario:  d.logradouro,
    numero_destinatario:      d.numero,
    complemento_destinatario: d.complemento,
    bairro_destinatario:      d.bairro,
    municipio_destinatario:   d.municipio,
    uf_destinatario:          d.uf,
    cep_destinatario:         d.cep ? onlyDigits(d.cep) : undefined,

    items: msg.itens.map(buildItem),
  };

  // Documento do destinatário: CPF (não exige IE) ou CNPJ (com indicador de IE).
  if (d.cpf) {
    payload.cpf_destinatario = onlyDigits(d.cpf);
  } else if (d.cnpj) {
    payload.cnpj_destinatario = onlyDigits(d.cnpj);
    payload.indicador_inscricao_estadual_destinatario = String(d.indicador_ie ?? 9);
  }

  return payload;
}

// ── Focus NFS-e (Nota Fiscal de Serviços) ────────────────────────────────────
// NFS-e usa o endpoint /v2/nfse (ISS municipal), distinto do /v2/nfe (ICMS).
// O token Focus é o mesmo (token de conta).

export interface FocusNfseResponse {
  status:               string;  // processando | autorizado | erro | cancelado
  numero_nfse?:         string;
  codigo_verificacao?:  string;
  data_emissao?:        string;
  link_download_pdf?:   string;
  caminho_xml_nota_fiscal?: string;
  protocolo?:           string;
  numero_protocolo?:    string;
  chave?:               string;
  erros?: Array<{ codigo: string; mensagem: string }>;
  mensagem_sefaz?:      string;
  codigo?:              string;
  mensagem?:            string;
}

export class FocusNfseClient {
  private http: AxiosInstance;
  private simulate: boolean;
  private simulateReject: boolean;

  constructor(token: string, ambiente: 1 | 2) {
    this.simulate       = token.toLowerCase().startsWith(SIMULATE_PREFIX);
    this.simulateReject = /reject/i.test(token);

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

  /** Resposta autorizada simulada (homologação local, sem prefeitura). */
  private simulatedAuthorized(ref: string): FocusNfseResponse {
    return {
      status:             'autorizado',
      numero_nfse:        '000001',
      codigo_verificacao: 'DEMO' + ref.slice(0, 6).toUpperCase(),
      data_emissao:       new Date().toISOString(),
      link_download_pdf:  `/demo/nfse/${ref}.pdf`,
      caminho_xml_nota_fiscal: `/demo/nfse/${ref}.xml`,
    };
  }

  async emitir(ref: string, payload: object): Promise<FocusNfseResponse> {
    if (this.simulate) {
      if (this.simulateReject) {
        return {
          status: 'erro',
          erros: [{
            codigo:   'E101',
            mensagem: 'Rejeição simulada (homologação local): código de serviço inválido para o município',
          }],
        };
      }
      return this.simulatedAuthorized(ref);
    }

    try {
      const res = await this.http.post(`/v2/nfse?ref=${encodeURIComponent(ref)}`, payload);
      return res.data as FocusNfseResponse;
    } catch (err) {
      const e = err as AxiosError<FocusNfseResponse>;
      if (e.response?.data) return e.response.data;
      throw err;
    }
  }

  async consultar(ref: string): Promise<FocusNfseResponse> {
    if (this.simulate) {
      return this.simulateReject
        ? { status: 'erro', erros: [{ codigo: 'E101', mensagem: 'Rejeição simulada (homologação local)' }] }
        : this.simulatedAuthorized(ref);
    }
    const res = await this.http.get(`/v2/nfse/${encodeURIComponent(ref)}`);
    return res.data as FocusNfseResponse;
  }

  /** Poll until Focus NFS-e returns a terminal status (not 'processando'). */
  async aguardarAutorizacao(ref: string, timeoutMs = 60_000): Promise<FocusNfseResponse> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = await this.consultar(ref);
      if (r.status !== 'processando') return r;
      await sleep(2_000);
    }
    throw new Error(`Timeout aguardando Focus NFS-e após ${timeoutMs}ms — ref=${ref}`);
  }
}

/** Constrói o payload flat do Focus NFS-e a partir da mensagem de emissão. */
export function buildFocusNfsePayload(msg: NfseEmitMessage): object {
  const p = msg.prestador;
  const t = msg.tomador;
  const s = msg.servicos[0];

  const payload: Record<string, unknown> = {
    data_emissao:   msg.data_emissao,
    prestador: {
      cnpj:                onlyDigits(p.cnpj),
      inscricao_municipal: p.inscricao_municipal,
      codigo_municipio:    p.codigo_municipio,
    },
    tomador: {
      razao_social: t.razao_social,
      email:        t.email,
      endereco: {
        logradouro:       t.logradouro,
        numero:           t.numero,
        complemento:      t.complemento,
        bairro:           t.bairro,
        codigo_municipio: undefined,
        uf:               t.uf,
        cep:              t.cep ? onlyDigits(t.cep) : undefined,
      },
    },
    servico: {
      aliquota:                    s.aliquota,
      discriminacao:               s.descricao,
      iss_retido:                  false,
      item_lista_servico:          s.codigo_tributario_municipio,
      codigo_tributario_municipio: s.codigo_tributario_municipio,
      valor_servicos:              s.valor_servicos,
      base_calculo:                s.base_calculo,
      valor_iss:                   s.valor_iss,
      codigo_municipio:            p.codigo_municipio,
    },
  };

  // Documento do tomador: CPF ou CNPJ.
  const tomador = payload.tomador as Record<string, unknown>;
  if (t.cpf) {
    tomador.cpf = onlyDigits(t.cpf);
  } else if (t.cnpj) {
    tomador.cnpj = onlyDigits(t.cnpj);
  }

  return payload;
}
