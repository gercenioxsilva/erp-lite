// Builder puro da mensagem de registro assíncrono da empresa no emissor
// fiscal (regra 70) — mesma fila nfe-requests, discriminada por
// type='company_registration'. Mantenha a forma sincronizada com
// services/lambda-fiscal/src/lib/types.ts → CompanyRegistrationEmitMessage.

export interface CompanyRegistrationEmitMessageInput {
  tenant_id: string;
  /** nfe_configs row — única fonte de dados, nunca lida de novo dentro do builder. */
  cfg: {
    id: string;
    cnpj: string;
    razao_social: string;
    nome_fantasia: string | null;
    regime_tributario: number;
    inscricao_estadual: string | null;
    inscricao_municipal: string | null;
    logradouro: string;
    numero: string;
    complemento: string | null;
    bairro: string;
    municipio: string;
    codigo_municipio_ibge: string | null;
    uf: string;
    cep: string;
    telefone: string | null;
    email: string | null;
    focus_ambiente: number;
    emite_nfe: boolean;
    emite_nfse: boolean;
  };
}

export interface CompanyRegistrationEmitMessage {
  type: 'company_registration';
  registration_id: string;
  tenant_id: string;
  focus_ref: string;
  ambiente: 1 | 2;
  empresa: Record<string, unknown>;
}

export function buildCompanyRegistrationEmitMessage(input: CompanyRegistrationEmitMessageInput): CompanyRegistrationEmitMessage {
  const { cfg } = input;

  return {
    type:            'company_registration',
    registration_id: cfg.id,
    tenant_id:       input.tenant_id,
    focus_ref:       cfg.id,
    ambiente:        cfg.focus_ambiente as 1 | 2,
    empresa: {
      cnpj:                  cfg.cnpj,
      razao_social:          cfg.razao_social,
      nome_fantasia:         cfg.nome_fantasia ?? undefined,
      regime_tributario:     cfg.regime_tributario,
      inscricao_estadual:    cfg.inscricao_estadual ?? undefined,
      inscricao_municipal:   cfg.inscricao_municipal ?? undefined,
      logradouro:            cfg.logradouro,
      numero:                cfg.numero,
      complemento:           cfg.complemento ?? undefined,
      bairro:                cfg.bairro,
      municipio:             cfg.municipio,
      codigo_municipio_ibge: cfg.codigo_municipio_ibge ?? undefined,
      uf:                    cfg.uf,
      cep:                   cfg.cep,
      telefone:              cfg.telefone ?? undefined,
      email:                 cfg.email ?? undefined,
      habilita_nfe:          cfg.emite_nfe,
      habilita_nfse:         cfg.emite_nfse,
    },
  };
}
