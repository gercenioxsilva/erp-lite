-- Migration 0089: Transportadora (frete/volumes em NF-e e Simples Remessa),
-- Cancelamento de NF-e junto à SEFAZ (Focus) e Carta de Correção Eletrônica
-- (CC-e).
--
-- Cancelamento estende a máquina de estados já documentada de invoices.nfe_status
-- (draft->queued->processing->authorized) com os valores novos
-- 'cancel_pending' -> 'cancelled' | 'cancel_rejected' — um único campo de
-- verdade pro ciclo de vida fiscal da nota, em vez de um campo paralelo que
-- poderia divergir. invoices.status='cancelled' (local, já existente) e
-- nfe_status='cancelled' (fiscal, novo) são eixos independentes: a primeira
-- é sempre imediata (routes/invoices.ts), a segunda só depois da confirmação
-- assíncrona do SEFAZ.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS nfe_cancel_protocol      VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS nfe_cancel_date          TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS nfe_cancel_reason        TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS nfe_cancel_reject_reason TEXT;

-- ── Carta de Correção Eletrônica ────────────────────────────────────────────
-- Tabela própria (não uma linha em nfe_events) porque uma CC-e é um
-- documento fiscal de primeira classe com ciclo de vida e PDF próprios
-- (SEFAZ exige poder reimprimir cada uma), não só um evento de auditoria —
-- mesmo raciocínio que já levou payment_plans a ser tabela própria em vez de
-- sobrecarregar orders. sequencia é por nota, incremental, nunca reaproveitado.
CREATE TABLE IF NOT EXISTS nfe_correction_letters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL,
  sequencia        SMALLINT NOT NULL,
  correction_text  VARCHAR(1000) NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | registered | rejected
  protocol         VARCHAR(50),
  reject_reason    TEXT,
  pdf_s3_key       VARCHAR(500),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nfe_correction_letters_sequencia
  ON nfe_correction_letters(invoice_id, sequencia);
CREATE INDEX IF NOT EXISTS idx_nfe_correction_letters_tenant ON nfe_correction_letters(tenant_id);

-- ── Transportadora ───────────────────────────────────────────────────────────
-- Catálogo core por tenant (sem gate de módulo — mesmo precedente de
-- payment_plans/regra 75: "catálogo core, não add-on pago"). Pode ser PJ
-- (transportadora de verdade, CNPJ) ou PF (transportador autônomo, CPF) —
-- mesma dualidade de clients.person_type.
CREATE TABLE IF NOT EXISTS transportadoras (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_type    VARCHAR(2) NOT NULL DEFAULT 'PJ', -- 'PJ' | 'PF'
  name           VARCHAR(160) NOT NULL,
  document       VARCHAR(20),                       -- CNPJ (PJ) ou CPF (PF), só dígitos
  state_reg      VARCHAR(20),                        -- inscrição estadual, isento permitido
  rntc           VARCHAR(20),                        -- registro ANTT, opcional
  street         VARCHAR(255),
  street_number  VARCHAR(20),
  complement     VARCHAR(100),
  neighborhood   VARCHAR(100),
  city           VARCHAR(100),
  state          VARCHAR(2),
  zip_code       VARCHAR(9),
  phone          VARCHAR(20),
  email          VARCHAR(255),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transportadoras_tenant ON transportadoras(tenant_id);

-- ── Frete e volumes em invoices e simples_remessas ─────────────────────────
-- transportadora_id: mesmo padrão de payment_plan_id/seller_id/cost_center_id
-- (nullable, ON DELETE SET NULL — nunca trava a exclusão/inativação da
-- transportadora por uma nota antiga já emitida).
-- modalidade_frete é escolha POR NOTA (enum SEFAZ 0-9: quem paga o frete),
-- não herdada do cadastro da transportadora — a mesma transportadora pode
-- ser usada com frete CIF numa venda e FOB noutra. NULL = comportamento de
-- sempre (buildFocusPayload já manda modalidade_frete=9 quando ausente,
-- zero regressão pra quem não usa a feature).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transportadora_id UUID REFERENCES transportadoras(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS modalidade_frete  SMALLINT;

ALTER TABLE simples_remessas ADD COLUMN IF NOT EXISTS transportadora_id UUID REFERENCES transportadoras(id) ON DELETE SET NULL;
ALTER TABLE simples_remessas ADD COLUMN IF NOT EXISTS modalidade_frete  SMALLINT;

-- Volumes (grupo vol da NF-e) — tabelas espelhadas e isoladas por tipo de
-- documento (nunca uma tabela compartilhada entre NF-e e Remessa), mesmo
-- princípio de isolamento já usado entre nfe_events/simples_remessa_events
-- (regra 24: NF-e e Remessa nunca se misturam, nem em log nem em detalhe).
CREATE TABLE IF NOT EXISTS invoice_volumes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  quantidade    INTEGER,
  especie       VARCHAR(60),
  marca         VARCHAR(60),
  numeracao     VARCHAR(60),
  peso_liquido  DECIMAL(15,3),
  peso_bruto    DECIMAL(15,3),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_volumes_invoice ON invoice_volumes(invoice_id);

CREATE TABLE IF NOT EXISTS simples_remessa_volumes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simples_remessa_id  UUID NOT NULL REFERENCES simples_remessas(id) ON DELETE CASCADE,
  quantidade          INTEGER,
  especie             VARCHAR(60),
  marca               VARCHAR(60),
  numeracao           VARCHAR(60),
  peso_liquido        DECIMAL(15,3),
  peso_bruto          DECIMAL(15,3),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_simples_remessa_volumes_remessa ON simples_remessa_volumes(simples_remessa_id);
