// Shared NFS-e helpers for building the SQS emit message that is consumed by
// lambda-fiscal. NFS-e reuses the NF-e requests queue, discriminated by
// `type: 'nfse'`. Keep the shape in sync with
// services/lambda-fiscal/src/lib/types.ts → NfseEmitMessage.

export interface NfseEmitMessageInput {
  nfse_id: string;
  tenant_id: string;
  description: string;
  amount: number;
  iss_rate: number;
  iss_value: number;
  service_code: string;
  period_start?: string | null;
  period_end?: string | null;
  /** nfe_configs row (prestador / emitente data) */
  cfg: {
    cnpj: string;
    razao_social: string;
    inscricao_municipal: string | null;
    codigo_municipio_ibge: string | null;
    logradouro: string;
    numero: string;
    complemento: string | null;
    bairro: string;
    municipio: string;
    uf: string;
    cep: string;
    telefone: string | null;
    email: string | null;
    focus_ambiente: number;
    focus_token_homologacao: string | null;
    focus_token_producao: string | null;
  };
  /** client row (tomador data) */
  client: {
    person_type: string | null;
    cnpj: string | null;
    cpf: string | null;
    company_name: string | null;
    full_name: string | null;
    email: string | null;
    street: string | null;
    street_number: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
    phone: string | null;
  };
}

export interface NfseEmitMessage {
  type: 'nfse';
  nfse_id: string;
  tenant_id: string;
  focus_ref: string;
  ambiente: 1 | 2;
  focus_token?: string;
  prestador: Record<string, unknown>;
  tomador: Record<string, unknown>;
  servicos: Array<Record<string, unknown>>;
  valor_servicos: number;
  valor_iss: number;
  data_emissao: string;
  periodo_servico?: { data_inicial: string; data_final: string };
}

export function buildNfseEmitMessage(input: NfseEmitMessageInput): NfseEmitMessage {
  const { cfg, client } = input;

  const focusToken = cfg.focus_ambiente === 1
    ? (cfg.focus_token_producao ?? undefined)
    : (cfg.focus_token_homologacao ?? undefined);

  const tomadorNome = client.person_type === 'PJ'
    ? (client.company_name ?? '')
    : (client.full_name ?? '');

  const msg: NfseEmitMessage = {
    type:      'nfse',
    nfse_id:   input.nfse_id,
    tenant_id: input.tenant_id,
    focus_ref: input.nfse_id,
    ambiente:  cfg.focus_ambiente as 1 | 2,
    focus_token: focusToken,
    prestador: {
      cnpj:                cfg.cnpj,
      razao_social:        cfg.razao_social,
      inscricao_municipal: cfg.inscricao_municipal ?? '',
      codigo_municipio:    cfg.codigo_municipio_ibge ?? '3550308',
      logradouro:          cfg.logradouro,
      numero:              cfg.numero,
      complemento:         cfg.complemento ?? undefined,
      bairro:              cfg.bairro,
      municipio:           cfg.municipio,
      uf:                  cfg.uf,
      cep:                 cfg.cep,
      telefone:            cfg.telefone ?? undefined,
      email:               cfg.email ?? undefined,
    },
    tomador: {
      cnpj:         client.person_type === 'PJ' ? (client.cnpj ?? undefined) : undefined,
      cpf:          client.person_type === 'PF' ? (client.cpf ?? undefined)  : undefined,
      razao_social: tomadorNome,
      email:        client.email ?? undefined,
      logradouro:   client.street ?? undefined,
      numero:       client.street_number ?? undefined,
      complemento:  client.complement ?? undefined,
      bairro:       client.neighborhood ?? undefined,
      municipio:    client.city ?? undefined,
      uf:           client.state ?? undefined,
      cep:          client.zip_code ?? undefined,
      telefone:     client.phone ?? undefined,
    },
    servicos: [{
      descricao:                   input.description,
      codigo_tributario_municipio: input.service_code,
      aliquota:                    input.iss_rate,
      valor_servicos:              input.amount,
      base_calculo:                input.amount,
      valor_iss:                   input.iss_value,
    }],
    valor_servicos: input.amount,
    valor_iss:      input.iss_value,
    data_emissao:   new Date().toISOString(),
  };

  if (input.period_start && input.period_end) {
    msg.periodo_servico = { data_inicial: input.period_start, data_final: input.period_end };
  }

  return msg;
}
