-- Migration 0074: Módulo Fiscal — motor NFS-e multi-provider (adapters próprios).
--
-- Estende nfse_invoices para o ciclo completo (provider, RPS, cancelamento,
-- substituição, PDF no S3, idempotência) e cria o registry GLOBAL
-- nfse_municipalities (sem tenant_id, regra 33): município → padrão →
-- endpoints → perfil de assinatura. Adicionar prefeitura = 1 linha de config
-- (vetor de revenda). Seed inicial: Patos/PB (WebISS, ABRASF 2.x).
-- Divisão de responsabilidade: api-core monta e ASSINA o XML (certificado
-- está no banco); lambda-fiscal só transporta (SOAP POST) e devolve resultado.

ALTER TABLE nfse_invoices ADD COLUMN provider        VARCHAR(16);
ALTER TABLE nfse_invoices ADD COLUMN municipio_ibge  VARCHAR(10);
ALTER TABLE nfse_invoices ADD COLUMN ambiente        SMALLINT NOT NULL DEFAULT 2;
ALTER TABLE nfse_invoices ADD COLUMN rps_numero      BIGINT;
ALTER TABLE nfse_invoices ADD COLUMN rps_serie       VARCHAR(5);
ALTER TABLE nfse_invoices ADD COLUMN lote_protocolo  VARCHAR(60);
ALTER TABLE nfse_invoices ADD COLUMN nfse_pdf_s3_key TEXT;
ALTER TABLE nfse_invoices ADD COLUMN cancel_reason   TEXT;
ALTER TABLE nfse_invoices ADD COLUMN cancel_date     TIMESTAMPTZ;
ALTER TABLE nfse_invoices ADD COLUMN substitute_of_id UUID REFERENCES nfse_invoices(id) ON DELETE SET NULL;
ALTER TABLE nfse_invoices ADD COLUMN iss_retido      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE nfse_invoices ADD COLUMN deducoes        NUMERIC(15,2);
ALTER TABLE nfse_invoices ADD COLUMN idempotency_key VARCHAR(160);

-- Numeração de RPS: única por empresa/série (invariante ABRASF).
CREATE UNIQUE INDEX uq_nfse_rps ON nfse_invoices (company_id, rps_serie, rps_numero)
  WHERE rps_numero IS NOT NULL;
CREATE UNIQUE INDEX uq_nfse_idempotency ON nfse_invoices (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Status novos (cancelled/substituted/error). O CHECK original de 0019 (se
-- existir) é recriado incluindo os novos estados.
ALTER TABLE nfse_invoices DROP CONSTRAINT IF EXISTS nfse_invoices_nfse_status_check;
ALTER TABLE nfse_invoices ADD CONSTRAINT nfse_invoices_nfse_status_check
  CHECK (nfse_status IS NULL OR nfse_status IN
    ('pending','processing','authorized','rejected','cancelled','substituted','error'));

-- Registry GLOBAL município → provider/versão/endpoints/assinatura.
CREATE TABLE nfse_municipalities (
  codigo_ibge        VARCHAR(10) PRIMARY KEY,
  uf                 CHAR(2)     NOT NULL,
  nome               VARCHAR(120) NOT NULL,
  provider           VARCHAR(16) NOT NULL CHECK (provider IN ('abrasf','nacional','saopaulo')),
  abrasf_versao      VARCHAR(8),
  perfil             VARCHAR(20),           -- webiss | issnet | generico
  endpoint_homolog   TEXT,
  endpoint_producao  TEXT,
  signature_algo     VARCHAR(12) NOT NULL DEFAULT 'rsa-sha1' CHECK (signature_algo IN ('rsa-sha1','rsa-sha256')),
  c14n               VARCHAR(10) NOT NULL DEFAULT 'inclusive' CHECK (c14n IN ('inclusive','exclusive')),
  lote_assincrono    BOOLEAN NOT NULL DEFAULT true,
  ativo              BOOLEAN NOT NULL DEFAULT true,
  notes              TEXT
);

-- Seed: Patos/PB (WebISS) — 1ª cidade-alvo; endpoints confirmados na
-- homologação real contra o webservice do município.
INSERT INTO nfse_municipalities
  (codigo_ibge, uf, nome, provider, abrasf_versao, perfil, endpoint_homolog, endpoint_producao, signature_algo, c14n, lote_assincrono, notes)
VALUES
  ('2510808', 'PB', 'Patos', 'abrasf', '2.02', 'webiss',
   'https://patospb.webiss.com.br/ws/homologacao', 'https://patospb.webiss.com.br/ws',
   'rsa-sha1', 'inclusive', true,
   'Endpoints a confirmar no manual WebISS do município durante a homologação.')
ON CONFLICT (codigo_ibge) DO NOTHING;
