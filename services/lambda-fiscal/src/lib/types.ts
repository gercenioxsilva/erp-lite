/** Full NF-e payload pushed to SQS nfe-requests by api-core.
 *  Lambda fiscal never touches RDS — all data is here. */
export interface NfeEmitMessage {
  invoice_id: string;
  tenant_id:  string;
  focus_ref:  string;  // unique Focus NF-e reference — we use the invoice UUID
  ambiente:   1 | 2;  // 1 = produção, 2 = homologação

  emitente: {
    cnpj:              string;
    razao_social:      string;
    nome_fantasia?:    string;
    logradouro:        string;
    numero:            string;
    complemento?:      string;
    bairro:            string;
    municipio:         string;
    uf:                string;
    cep:               string;
    telefone?:         string;
    email?:            string;
    regime_tributario: 1 | 2 | 3;  // 1=Simples Nacional, 2=Lucro Presumido, 3=Lucro Real
  };

  destinatario: {
    cnpj?:         string;
    cpf?:          string;
    nome:          string;
    indicador_ie?: 1 | 2 | 9;  // 1=contribuinte IE, 2=isento, 9=não contribuinte
    logradouro?:   string;
    numero?:       string;
    complemento?:  string;
    bairro?:       string;
    municipio?:    string;
    uf?:           string;
    cep?:          string;
    telefone?:     string;
    email?:        string;
  };

  natureza_operacao: string;
  data_emissao:      string;  // ISO-8601

  itens:      NfeItem[];
  pagamentos: NfePagamento[];
}

export interface NfeItem {
  numero_item:              number;
  codigo_produto:           string;
  descricao:                string;
  ncm?:                     string;
  cfop:                     string;
  unidade_comercial:        string;
  quantidade_comercial:     number;
  valor_unitario_comercial: number;
  valor_bruto:              number;
  // ICMS — LP/LR use CST; Simples Nacional uses CSOSN
  icms_cst?:                string;
  icms_csosn?:              string;
  icms_base_calculo?:       number;
  icms_aliquota?:           number;
  icms_valor?:              number;
  // PIS / COFINS
  pis_cst?:                  string;
  pis_base_calculo?:         number;
  pis_aliquota_percentual?:  number;
  pis_valor?:                number;
  cofins_cst?:               string;
  cofins_base_calculo?:      number;
  cofins_aliquota_percentual?: number;
  cofins_valor?:             number;
  // IPI (optional — "por fora")
  ipi_aliquota?: number;
  ipi_valor?:    number;
}

export interface NfePagamento {
  forma_pagamento: string;  // '01'=dinheiro '15'=boleto '17'=PIX '99'=outros
  valor_pagamento: number;
}

/** Result message published to SQS nfe-results, consumed by api-core polling worker */
export interface NfeResultMessage {
  invoice_id:         string;
  tenant_id:          string;
  nfe_status:         'authorized' | 'rejected' | 'error';
  nfe_chave?:         string;  // 44-digit access key (chave de acesso)
  nfe_protocol?:      string;  // nProt from SEFAZ
  nfe_auth_date?:     string;
  xml_s3_key?:        string;  // key inside our S3 bucket
  danfe_url?:         string;  // PDF URL from Focus NF-e
  nfe_reject_reason?: string;
}
