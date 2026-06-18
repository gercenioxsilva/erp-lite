-- clients: commercial end-customers of each tenant.
-- Supports both Pessoa Jurídica (PJ / CNPJ) and Pessoa Física (PF / CPF)
-- following Brazilian government rules for NF-e emission.

CREATE TABLE IF NOT EXISTS clients (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- ── Person type ────────────────────────────────────────────────────────
  -- 'PJ' = Pessoa Jurídica (company)
  -- 'PF' = Pessoa Física   (individual)
  person_type       VARCHAR(2)  NOT NULL DEFAULT 'PJ'
                    CHECK (person_type IN ('PJ','PF')),

  -- ── PJ — Pessoa Jurídica ───────────────────────────────────────────────
  company_name      VARCHAR(255),            -- Razão Social
  trade_name        VARCHAR(255),            -- Nome Fantasia
  cnpj              VARCHAR(14),             -- digits only, 14 chars
  state_reg         VARCHAR(30),             -- Inscrição Estadual (IE)
  municipal_reg     VARCHAR(30),             -- Inscrição Municipal (IM)
  suframa           VARCHAR(20),             -- SUFRAMA (Zona Franca de Manaus)

  -- ── PF — Pessoa Física ─────────────────────────────────────────────────
  full_name         VARCHAR(255),            -- Nome completo
  cpf               VARCHAR(11),             -- digits only, 11 chars
  birth_date        DATE,
  rg                VARCHAR(20),             -- Registro Geral
  rg_issuer         VARCHAR(30),             -- Órgão emissor (SSP/SP etc.)
  rg_issue_date     DATE,

  -- ── Contact ────────────────────────────────────────────────────────────
  email             VARCHAR(255),
  phone             VARCHAR(20),             -- digits only
  mobile            VARCHAR(20),             -- digits only

  -- ── Address ────────────────────────────────────────────────────────────
  zip_code          VARCHAR(8),              -- CEP digits only
  street            VARCHAR(255),
  street_number     VARCHAR(20),
  complement        VARCHAR(100),
  neighborhood      VARCHAR(100),
  city              VARCHAR(100),
  state             CHAR(2),                 -- UF (SP, RJ, MG …)
  country           CHAR(2)     NOT NULL DEFAULT 'BR',

  -- ── NF-e fiscal classification ─────────────────────────────────────────
  -- ICMS taxpayer indicator (indIEDest in NF-e XML):
  --   '1' = Contribuinte ICMS
  --   '2' = Contribuinte Isento
  --   '9' = Não Contribuinte (consumidor final / PF)
  icms_taxpayer     CHAR(1)     NOT NULL DEFAULT '9'
                    CHECK (icms_taxpayer IN ('1','2','9')),

  -- Consumer type for NF-e:
  --   '0' = Normal (B2B)
  --   '1' = Consumidor Final (B2C / always '1' when person_type='PF')
  consumer_type     CHAR(1)     NOT NULL DEFAULT '0'
                    CHECK (consumer_type IN ('0','1')),

  -- ── Metadata ───────────────────────────────────────────────────────────
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  notes             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- PJ must have company_name; PF must have full_name
  CONSTRAINT chk_pj_name CHECK (person_type <> 'PJ' OR company_name IS NOT NULL),
  CONSTRAINT chk_pf_name CHECK (person_type <> 'PF' OR full_name    IS NOT NULL),

  -- PF is always consumidor final when type='PF'
  -- (validated at application layer — not enforced here to allow overrides)

  -- Document uniqueness per tenant (NULLs are not considered duplicates in PG)
  CONSTRAINT uq_client_cnpj UNIQUE (tenant_id, cnpj),
  CONSTRAINT uq_client_cpf  UNIQUE (tenant_id, cpf)
);

CREATE INDEX IF NOT EXISTS idx_clients_tenant      ON clients (tenant_id);
CREATE INDEX IF NOT EXISTS idx_clients_person_type ON clients (tenant_id, person_type);
CREATE INDEX IF NOT EXISTS idx_clients_name        ON clients (tenant_id, company_name text_pattern_ops, full_name text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_clients_active      ON clients (tenant_id, is_active);

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
