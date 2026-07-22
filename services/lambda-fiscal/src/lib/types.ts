/** Full NF-e payload pushed to SQS nfe-requests by api-core.
 *  Lambda fiscal never touches RDS — all data is here. */
export interface NfeEmitMessage {
  invoice_id: string;
  tenant_id:  string;
  focus_ref:  string;  // unique Focus NF-e reference — we use the invoice UUID
  ambiente:    1 | 2;  // 1 = produção, 2 = homologação
  focus_token?: string; // per-tenant token; falls back to FOCUS_NFE_TOKEN env var in Lambda if absent

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
    inscricao_estadual?: string; // obrigatória na SEFAZ quando indicador_ie=1
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

  // Plano de Pagamento (regra 75, migration 0086) — grupo cobr/dup da NF-e,
  // opcional: só presente quando a nota tem um plano de pagamento com mais
  // de 1 parcela escolhido (routes/nfe.ts). Ausente = nota sem plano,
  // comportamento idêntico ao de sempre.
  //
  // ⚠️ Nomes de campo (duplicatas/numero/data_vencimento/valor) seguem a
  // documentação pública do Focus NF-e v2 — ainda não confirmados contra uma
  // emissão real em homologação; validar/ajustar no primeiro teste real
  // antes de usar em produção.
  duplicatas?: NfeDuplicata[];

  // Observação digitada na tela de emissão (invoices.notes) — antes ficava
  // só gravada no banco, nunca saía na nota de verdade (bug real: o tenant
  // digitava a observação e ela nunca chegava no XML/DANFE). Mapeia pro
  // grupo infAdic/infCpl da NF-e.
  //
  // ⚠️ Nome de campo (`informacoes_adicionais_contribuinte`) segue a
  // documentação pública do Focus NF-e v2 pelo meu conhecimento geral — sem
  // precedente em nenhum outro lugar deste código (NFC-e/NFS-e também nunca
  // mandaram observação nenhuma pro Focus) pra confirmar contra uma emissão
  // real; validar/ajustar no primeiro teste em homologação, mesma ressalva
  // já feita pra `duplicatas` acima.
  informacoes_adicionais_contribuinte?: string;

  // Transportadora (migration 0089) — grupo transporta/vol da NF-e, opcional:
  // só presente quando a nota/remessa tem uma transportadora escolhida
  // (routes/nfe.ts, simplesRemessaService.ts). Ausente = modalidade_frete=9
  // ("sem transporte") como sempre, payload idêntico ao de antes desta
  // feature pra quem não usa.
  //
  // ⚠️ Nomes de campo (`transportadora`/`cnpj_transportadora`/
  // `nome_transportadora`/`volumes`) seguem a documentação pública do Focus
  // NF-e v2 pelo meu conhecimento geral — não confirmados contra uma emissão
  // real; validar/ajustar no primeiro teste em homologação, mesma ressalva
  // de duplicatas/informacoes_adicionais_contribuinte.
  transportadora?: {
    cnpj?:    string;
    cpf?:     string;
    nome:     string;
    ie?:      string;
    endereco?: string;
    municipio?: string;
    uf?:      string;
    // 0=CIF (emitente) 1=FOB (destinatário) 2=terceiros 3=próprio(emitente)
    // 4=próprio(destinatário) 9=sem transporte — enum SEFAZ, escolhido por
    // nota, nunca herdado do cadastro da transportadora.
    modalidade_frete: 0 | 1 | 2 | 3 | 4 | 9;
  };
  volumes?: Array<{
    quantidade?:   number;
    especie?:      string;
    marca?:        string;
    numeracao?:    string;
    peso_liquido?: number;
    peso_bruto?:   number;
  }>;
}

export interface NfeDuplicata {
  numero:          string; // ex.: "001", "002"...
  data_vencimento: string; // YYYY-MM-DD
  valor:           number;
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
  // IBS/CBS — Reforma Tributária (regra 44). Informativos em 2026: entram no
  // XML mas não alteram valor_bruto/totais cobrados do destinatário.
  class_trib?:       string; // cClassTrib, 6 dígitos — default '000001' se ausente
  ibs_base_calculo?: number;
  ibs_aliquota?:     number;
  ibs_valor?:        number;
  cbs_base_calculo?: number;
  cbs_aliquota?:     number;
  cbs_valor?:        number;
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

/** NFS-e emit message — same SQS queue as NF-e, discriminated by type='nfse' */
export interface NfseEmitMessage {
  type:        'nfse';
  nfse_id:     string;
  tenant_id:   string;
  focus_ref:   string;
  ambiente:    1 | 2;
  focus_token?: string;

  prestador: {
    cnpj:                string;
    razao_social:        string;
    inscricao_municipal: string;
    codigo_municipio:    string;
    logradouro:          string;
    numero:              string;
    complemento?:        string;
    bairro:              string;
    municipio:           string;
    uf:                  string;
    cep:                 string;
    telefone?:           string;
    email?:              string;
  };

  tomador: {
    cnpj?:        string;
    cpf?:         string;
    razao_social: string;
    email?:       string;
    logradouro?:  string;
    numero?:      string;
    complemento?: string;
    bairro?:      string;
    municipio?:   string;
    uf?:          string;
    cep?:         string;
    telefone?:    string;
  };

  servicos: [{
    descricao:                     string;
    codigo_tributario_municipio:   string;
    aliquota:                      number;
    valor_servicos:                number;
    base_calculo:                  number;
    valor_iss:                     number;
    deducoes?:                     number;
  }];

  valor_servicos: number;
  valor_iss:      number;
  data_emissao:   string;
  periodo_servico?: { data_inicial: string; data_final: string };
}

/** Result from NFS-e Lambda processing */
export interface NfseResultMessage {
  type:                'nfse';
  nfse_id:             string;
  tenant_id:           string;
  nfse_status:         'authorized' | 'rejected';
  nfse_number?:        string;
  nfse_chave?:         string;
  nfse_verify_code?:   string;
  nfse_protocol?:      string;
  nfse_auth_date?:     string;
  nfse_pdf_url?:       string;
  nfse_xml_s3_key?:    string;
  nfse_reject_reason?: string;
}

/**
 * NF-e de Simples Remessa emit message — same SQS queue as NF-e/NFS-e,
 * discriminated by type='remessa'. Same modelo 55 endpoint as regular NF-e
 * (conserto/demonstração/comodato/industrialização/amostra grátis/devolução)
 * — só o CFOP/natureza_operacao/situação tributária dos itens mudam, já
 * resolvidos pelo domínio de remessa em api-core antes de chegar aqui.
 */
export interface RemessaEmitMessage {
  type:        'remessa';
  remessa_id:  string;
  tenant_id:   string;
  focus_ref:   string;
  ambiente:    1 | 2;
  focus_token?: string;

  emitente:     NfeEmitMessage['emitente'];
  destinatario: NfeEmitMessage['destinatario'];

  natureza_operacao: string;
  data_emissao:      string;

  itens:      NfeItem[];
  pagamentos: NfePagamento[];
}

/** Result from Simples Remessa Lambda processing */
export interface RemessaResultMessage {
  type:                'remessa';
  remessa_id:          string;
  tenant_id:           string;
  nfe_status:          'authorized' | 'rejected' | 'error';
  nfe_chave?:          string;
  nfe_protocol?:       string;
  nfe_auth_date?:      string;
  xml_s3_key?:         string;
  danfe_url?:          string;
  nfe_reject_reason?:  string;
}

/**
 * Cancelamento de NF-e junto à SEFAZ — mesma fila nfe-requests, discriminada
 * por type='nfe_cancel'. Nunca cancela nada localmente (isso já acontece de
 * forma síncrona em routes/invoices.ts antes de enfileirar, com reversão de
 * estoque/comissão) — esta mensagem só formaliza o lado fiscal junto ao
 * emissor, e só existe pra notas que já estavam 'authorized'.
 */
export interface NfeCancelEmitMessage {
  type:          'nfe_cancel';
  invoice_id:    string;
  tenant_id:     string;
  focus_ref:     string;
  ambiente:      1 | 2;
  focus_token?:  string;
  justificativa: string; // mínimo 15 caracteres (regra SEFAZ)
}

/** Result do cancelamento — consumido por nfeResultsWorker.ts */
export interface NfeCancelResultMessage {
  type:                  'nfe_cancel';
  invoice_id:            string;
  tenant_id:             string;
  cancel_status:         'cancelled' | 'rejected';
  cancel_protocol?:      string;
  cancel_reject_reason?: string;
}

/**
 * Carta de Correção Eletrônica (CC-e) — mesma fila, discriminada por
 * type='cce'. Só corrige dado acessório (nunca valor/imposto/quantidade/
 * partes) — SEFAZ registra como aditivo, nunca reprocessa a nota.
 *
 * ⚠️ Endpoint (`/v2/nfe/{ref}/carta_correcao`) e nome de campo (`correcao`)
 * seguem a documentação pública do Focus NF-e v2 pelo meu conhecimento geral
 * — sem nenhum precedente no restante deste código pra confirmar contra uma
 * emissão real; validar/ajustar no primeiro teste em homologação antes de
 * qualquer uso em produção, mesma ressalva já feita pra duplicatas/
 * informacoes_adicionais_contribuinte em NfeEmitMessage.
 */
export interface CceEmitMessage {
  type:            'cce';
  invoice_id:      string;
  tenant_id:       string;
  focus_ref:       string;
  ambiente:        1 | 2;
  focus_token?:    string;
  sequencia:       number;
  correction_text: string;
}

/** Result da CC-e — consumido por nfeResultsWorker.ts */
export interface CceResultMessage {
  type:               'cce';
  invoice_id:         string;
  tenant_id:          string;
  sequencia:          number;
  cce_status:         'registered' | 'rejected';
  cce_protocol?:      string;
  cce_reject_reason?: string;
}

/**
 * Registro assíncrono da empresa no emissor fiscal — mesma fila nfe-requests,
 * discriminado por type='company_registration' (regra 70). Sem focus_token:
 * ao contrário de nfe/nfse/remessa, aqui não existe token por empresa ainda
 * (é justamente o que este fluxo cria) — a Lambda usa sempre o token mestre
 * (FOCUS_NFE_TOKEN / app.config.focusToken).
 */
export interface CompanyRegistrationEmitMessage {
  type:           'company_registration';
  registration_id: string; // = nfe_configs.id — 1 registro de empresa por vez
  tenant_id:      string;
  focus_ref:      string;
  ambiente:       1 | 2;

  empresa: {
    cnpj:                 string;
    razao_social:         string;
    nome_fantasia?:       string;
    regime_tributario:    1 | 2 | 3;
    inscricao_estadual?:  string;
    inscricao_municipal?: string;
    logradouro:           string;
    numero:               string;
    complemento?:         string;
    bairro:               string;
    municipio:            string;
    codigo_municipio_ibge?: string;
    uf:                   string;
    cep:                  string;
    telefone?:            string;
    email?:               string;
    habilita_nfe:         boolean;
    habilita_nfse:        boolean;
  };
}

/** Result from company-registration Lambda processing */
export interface CompanyRegistrationResultMessage {
  type:                 'company_registration';
  registration_id:      string;
  tenant_id:            string;
  registration_status:  'registered' | 'error';
  fiscal_integration_ref?: string;
  token_producao?:      string;
  token_homologacao?:   string;
  registration_error?:  string;
}
