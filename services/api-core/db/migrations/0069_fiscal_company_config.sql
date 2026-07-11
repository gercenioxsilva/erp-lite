-- Migration 0069: Módulo Fiscal — cadastro fiscal por empresa (CNPJ).
--
-- fiscal_company_config é tabela FILHA 1:1 de nfe_configs (a entidade Empresa),
-- não colunas novas em nfe_configs: o cadastro profundo do Simples fica atrás
-- do módulo 'fiscal' sem acoplar ao CRUD base de empresa que todo tenant usa.
-- Campos que JÁ existem em nfe_configs (regime_tributario, inscricao_municipal,
-- codigo_municipio_ibge, aliquota_iss_padrao, codigo_servico_padrao) são lidos
-- por JOIN — nunca duplicados aqui.
--
-- Certificado A1: credentials jsonb em texto puro — mesmo padrão documentado de
-- bank_accounts.credentials/marketplace_connections (migration 0048/0064);
-- envelope encryption via KMS fica para a Fase 2. Mascarado na leitura, nunca
-- logado (fiscalAuditService sanitiza payloads).

CREATE TABLE fiscal_company_config (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id                UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE UNIQUE,
  -- MEI recolhe DAS-SIMEI FIXO (não percentual): a apuração percentual é
  -- BLOQUEADA para MEI no MVP em vez de calcular errado silenciosamente.
  enquadramento             VARCHAR(3) NOT NULL DEFAULT 'ME' CHECK (enquadramento IN ('MEI','ME','EPP')),
  optante_simples           BOOLEAN NOT NULL DEFAULT false,
  data_opcao_simples        DATE,
  -- Data de abertura: início de atividade (<12 meses) proporcionaliza o RBT12
  -- (LC123 art.18 §§1-2).
  data_abertura             DATE,
  anexo_padrao              SMALLINT CHECK (anexo_padrao BETWEEN 1 AND 5),
  fator_r_aplicavel         BOOLEAN NOT NULL DEFAULT false,
  regime_apuracao           VARCHAR(12) NOT NULL DEFAULT 'competencia' CHECK (regime_apuracao IN ('caixa','competencia')),
  iss_retido_padrao         BOOLEAN NOT NULL DEFAULT false,
  iss_fixo                  BOOLEAN NOT NULL DEFAULT false,
  iss_fixo_valor            DECIMAL(15,2),
  retencao_federal          BOOLEAN NOT NULL DEFAULT false,
  retencoes                 JSONB,
  -- Bootstrap de RBT12 no período de transição (documentos internos não
  -- existem para competências anteriores à adoção do sistema).
  receita_acumulada_abertura DECIMAL(15,2),
  rbt12_manual              DECIMAL(15,2),
  -- Provedor NFS-e por empresa; 'focus' mantido como fallback na transição.
  nfse_provider             VARCHAR(16) NOT NULL DEFAULT 'focus' CHECK (nfse_provider IN ('focus','abrasf','nacional','saopaulo')),
  nfse_provider_profile     VARCHAR(24),
  rps_serie                 VARCHAR(5)  NOT NULL DEFAULT '1',
  rps_proximo_numero        INTEGER     NOT NULL DEFAULT 1,
  lote_proximo_numero       INTEGER     NOT NULL DEFAULT 1,
  created_by                UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE fiscal_company_cnae (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  codigo       VARCHAR(9)   NOT NULL, -- normalizado: 7 dígitos (ex.: 9602501)
  descricao    VARCHAR(255),
  is_principal BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, codigo)
);
-- 1 CNAE principal por empresa (mesmo padrão do is_default de nfe_configs).
CREATE UNIQUE INDEX uq_fiscal_cnae_principal ON fiscal_company_cnae (company_id) WHERE is_principal;

CREATE TABLE fiscal_company_service_code (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id       UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  codigo_lc116     VARCHAR(10) NOT NULL,  -- item da lista LC 116/2003 (ex.: 14.01)
  codigo_municipal VARCHAR(20),           -- código tributário do município, quando difere
  descricao        VARCHAR(255),
  aliquota_iss     DECIMAL(5,2),
  iss_retido       BOOLEAN NOT NULL DEFAULT false,
  anexo            SMALLINT CHECK (anexo BETWEEN 1 AND 5), -- override do anexo_padrao por serviço
  is_default       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, codigo_lc116)
);
CREATE UNIQUE INDEX uq_fiscal_service_code_default ON fiscal_company_service_code (company_id) WHERE is_default;

-- Folha + pró-labore por competência: insumo rolling-12m do Fator R.
-- Entrada manual no MVP; integração com o módulo payroll é fase futura.
CREATE TABLE fiscal_company_payroll_month (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  competencia       CHAR(7) NOT NULL, -- 'YYYY-MM'
  folha_amount      DECIMAL(15,2) NOT NULL DEFAULT 0,
  pro_labore_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  source            VARCHAR(14) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','payroll_module')),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, competencia)
);

-- Certificado digital A1 (.pfx) por empresa — pré-condição de emissão NFS-e
-- própria. credentials = {pfx_base64, senha} (texto puro, decisão registrada);
-- metadados (cn/validade/thumbprint) extraídos via node-forge no upload.
CREATE TABLE fiscal_certificates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  credentials JSONB NOT NULL,
  cn          VARCHAR(255),
  not_before  TIMESTAMPTZ,
  not_after   TIMESTAMPTZ,
  thumbprint  VARCHAR(64),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 1 certificado ativo por empresa; trocar = desativar o anterior + inserir novo
-- (histórico preservado para auditoria).
CREATE UNIQUE INDEX uq_fiscal_certificates_active ON fiscal_certificates (company_id) WHERE is_active;
CREATE INDEX idx_fiscal_certificates_expiry ON fiscal_certificates (not_after) WHERE is_active;
