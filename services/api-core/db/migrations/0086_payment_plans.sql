-- Migration 0086: Plano de Pagamento por pedido de venda (regra 75).
-- Catálogo configurável por tenant ("À Vista", "3x sem juros", "30/60/90
-- dias corridos"), escolhido no pedido, herdado pela nota fiscal, e é a
-- autorização da NF-e (não a confirmação do pedido) que gera os N
-- recebíveis — reaproveita createReceivableFromInvoice().

CREATE TABLE IF NOT EXISTS payment_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(80) NOT NULL,
  description VARCHAR(255),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_plans_tenant ON payment_plans(tenant_id);

CREATE TABLE IF NOT EXISTS payment_plan_installments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_plan_id     UUID NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  installment_number  SMALLINT NOT NULL,
  days_offset         SMALLINT NOT NULL,
  percentage          DECIMAL(5,2) NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_plan_installments_number
  ON payment_plan_installments(payment_plan_id, installment_number);

-- Escolha no pedido; a nota herda a escolha (frontend copia, mesmo padrão de
-- seller_id/cost_center_id) — payment_plan_id em invoices é a fonte de
-- verdade lida em routes/nfe.ts e nfeResultsWorker.ts.
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS payment_plan_id UUID REFERENCES payment_plans(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_plan_id UUID REFERENCES payment_plans(id) ON DELETE SET NULL;

-- Parcelamento em receivables (mesmo padrão de payables, migration 0051,
-- regra 47) — installment_group_id não é FK, só correlaciona.
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS installment_number smallint NOT NULL DEFAULT 1;
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS installment_total  smallint NOT NULL DEFAULT 1;
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS installment_group_id uuid;

-- UNIQUE(invoice_id) vira UNIQUE(invoice_id, installment_number) — o caso de
-- hoje (sem plano) sempre grava installment_number=1, então a garantia "no
-- máximo 1 recebível por nota" continua idêntica; N parcelas viram N linhas
-- distintas (invoice_id, 1), (invoice_id, 2)... installment_number NUNCA é
-- NULL de propósito: um UNIQUE com NULL não bloqueia duplicata no Postgres
-- (cada NULL conta como distinto), o que quebraria a idempotência de sempre.
DROP INDEX IF EXISTS uq_receivables_invoice;
CREATE UNIQUE INDEX IF NOT EXISTS uq_receivables_invoice_installment
  ON receivables(invoice_id, installment_number) WHERE invoice_id IS NOT NULL;

-- Seed do plano padrão "À Vista" para todo tenant já existente — mesmo
-- padrão de backfill da regra 71 (contratos de serviço). Todo tenant NOVO
-- ganha o mesmo seed dentro da transação de registro (routes/auth.ts).
INSERT INTO payment_plans (tenant_id, name, description, is_active, is_default)
SELECT id, 'À Vista', 'Pagamento integral, sem parcelamento', true, true
FROM tenants
WHERE NOT EXISTS (
  SELECT 1 FROM payment_plans pp WHERE pp.tenant_id = tenants.id
);

INSERT INTO payment_plan_installments (payment_plan_id, installment_number, days_offset, percentage)
SELECT pp.id, 1, 0, 100.00
FROM payment_plans pp
WHERE pp.name = 'À Vista' AND pp.is_default = true
  AND NOT EXISTS (
    SELECT 1 FROM payment_plan_installments ppi WHERE ppi.payment_plan_id = pp.id
  );
