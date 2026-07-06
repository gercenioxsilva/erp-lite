-- Reforma Tributária (LC 214/2025) — campos de IBS/CBS na NF-e e NFC-e.
-- Desde 1º/jan/2026 os documentos fiscais precisam trazer estes campos (mesmo
-- em regime de teste); a Receita já iniciou validação ativa em 1º/abr/2026 e o
-- preenchimento se torna mandatório em 3/ago/2026. Fora de escopo nesta
-- migration: NFS-e (layout nacional de IBS/CBS ainda em piloto restrito).
--
-- Alíquotas de teste 2026 (fixas para o ano, art. 343 LC 214/2025): CBS 0,9%
-- (federal, não varia por UF) + IBS 0,1% (estadual/municipal combinado — a
-- proporção oficial de split UF x Município para a fase de teste não está
-- publicada; o valor agregado de 0,1% é o que importa para o XML). CBS é
-- replicado por UF só para manter a mesma assinatura de resolver que
-- ICMS/FCP já usam (getIcmsRate/getFcpRate) — não é normalização perfeita,
-- é consistência de padrão (ver taxRulesResolver.ts).
--
-- IBS/CBS em 2026 são só informativos no XML — não somam ao total cobrado do
-- cliente (compensáveis com PIS/COFINS este ano, mesmo padrão que
-- invoices.tax_total já usa hoje para o breakdown ICMS/FCP/DIFAL/PIS/COFINS).

-- ── tax_ibs_cbs_rates — alíquotas de teste por UF ─────────────────────────────
CREATE TABLE IF NOT EXISTS tax_ibs_cbs_rates (
  uf       CHAR(2)       PRIMARY KEY,
  ibs_rate NUMERIC(6,3)  NOT NULL DEFAULT 0.100,
  cbs_rate NUMERIC(6,3)  NOT NULL DEFAULT 0.900
);

INSERT INTO tax_ibs_cbs_rates (uf, ibs_rate, cbs_rate) VALUES
  ('AC', 0.100, 0.900), ('AL', 0.100, 0.900), ('AP', 0.100, 0.900), ('AM', 0.100, 0.900),
  ('BA', 0.100, 0.900), ('CE', 0.100, 0.900), ('DF', 0.100, 0.900), ('ES', 0.100, 0.900),
  ('GO', 0.100, 0.900), ('MA', 0.100, 0.900), ('MT', 0.100, 0.900), ('MS', 0.100, 0.900),
  ('MG', 0.100, 0.900), ('PA', 0.100, 0.900), ('PB', 0.100, 0.900), ('PR', 0.100, 0.900),
  ('PE', 0.100, 0.900), ('PI', 0.100, 0.900), ('RJ', 0.100, 0.900), ('RN', 0.100, 0.900),
  ('RS', 0.100, 0.900), ('RO', 0.100, 0.900), ('RR', 0.100, 0.900), ('SC', 0.100, 0.900),
  ('SP', 0.100, 0.900), ('SE', 0.100, 0.900), ('TO', 0.100, 0.900)
ON CONFLICT (uf) DO NOTHING;

-- ── materials.class_trib — override por produto (mesmo padrão de cfop/cst_csosn) ─
-- cClassTrib não tem mapeamento 1:1 com NCM/CFOP (depende de contexto/regime) —
-- nunca derivar automaticamente. Default de sistema é '000001' (tributação
-- integral), aplicado em código quando a coluna está NULL.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS class_trib VARCHAR(6);

-- ── invoice_items / invoices — IBS/CBS por item e agregado (NF-e) ─────────────
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS class_trib VARCHAR(6);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ibs_base   NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ibs_rate   NUMERIC(6,3)  NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ibs_value  NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cbs_base   NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cbs_rate   NUMERIC(6,3)  NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cbs_value  NUMERIC(15,2) NOT NULL DEFAULT 0;

-- Agregados informativos — nunca somados a invoices.total (mesmo padrão de
-- fcp_total/icms_difal_total).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ibs_total NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cbs_total NUMERIC(15,2) NOT NULL DEFAULT 0;

-- ── pos_sale_items — classificação para IBS/CBS (NFC-e/PDV, regra 44) ────────
-- Só a classificação (class_trib) é persistida aqui, copiada de materials no
-- addItem() — mesmo padrão já usado hoje para cst_csosn/cfop/ncm. A alíquota e
-- o valor de IBS/CBS são resolvidos e calculados na hora da emissão
-- (buildNfcePayload), nunca persistidos — mesmo comportamento que o ICMS da
-- NFC-e já tem hoje (icmsAliquota é resolvido fresh, não fica em coluna).
ALTER TABLE pos_sale_items ADD COLUMN IF NOT EXISTS class_trib VARCHAR(6);
