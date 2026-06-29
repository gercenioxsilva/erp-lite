-- 0030_pos_fiscal_fix.sql — Corrige pos_sales: remove invoice_id, adiciona fiscal_* columns
-- Reverte alterações incorretas na tabela invoices do 0029

-- Remover FK errada de pos_sales
ALTER TABLE pos_sales DROP COLUMN IF EXISTS invoice_id;

-- Adicionar colunas fiscais em pos_sales (NFC-e Focus NF-e, resultado síncrono)
ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS focus_ref        VARCHAR(60),
  ADD COLUMN IF NOT EXISTS fiscal_status    VARCHAR(30) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS fiscal_chave     VARCHAR(44),
  ADD COLUMN IF NOT EXISTS fiscal_protocol  VARCHAR(40),
  ADD COLUMN IF NOT EXISTS fiscal_number    INTEGER,
  ADD COLUMN IF NOT EXISTS fiscal_series    INTEGER,
  ADD COLUMN IF NOT EXISTS fiscal_qrcode    TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_url_danfe TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_url_xml   TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_message   TEXT;

-- Índice único para idempotência Focus NF-e (só indexa quando focus_ref não é NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_sales_focus_ref
  ON pos_sales(tenant_id, focus_ref)
  WHERE focus_ref IS NOT NULL;

-- Índice para consultas de status fiscal (busca de pendentes/erros)
CREATE INDEX IF NOT EXISTS idx_pos_sales_fiscal
  ON pos_sales(tenant_id, fiscal_status)
  WHERE fiscal_status <> 'none';

-- Reverter colunas erradas adicionadas a invoices em 0029
-- (dados NFC-e ficam em pos_sales.fiscal_*, não em invoices)
ALTER TABLE invoices DROP COLUMN IF EXISTS model;
ALTER TABLE invoices DROP COLUMN IF EXISTS nfce_qrcode;
ALTER TABLE invoices DROP COLUMN IF EXISTS nfce_url_consulta;
