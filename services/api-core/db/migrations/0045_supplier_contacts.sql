-- Migration 0045: Supplier Contacts
-- Lista de contatos por fornecedor (comercial, financeiro, suporte, logística) —
-- mesmo conceito de client_contacts (migration 0015), adaptado aos papéis que
-- fazem sentido do lado do fornecedor (não reaproveita os mesmos rótulos de
-- client_contacts: "comprador"/"compras" descreve quem COMPRA de nós, não faz
-- sentido para o contato de um fornecedor).

CREATE TABLE supplier_contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  supplier_id  UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  contact_type VARCHAR(30) NOT NULL DEFAULT 'comercial',
  name         VARCHAR(255),
  email        VARCHAR(255),
  phone        VARCHAR(20),
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_supplier_contacts_tenant   ON supplier_contacts(tenant_id);
CREATE INDEX idx_supplier_contacts_supplier ON supplier_contacts(supplier_id, is_active);

CREATE TRIGGER update_supplier_contacts_updated_at
  BEFORE UPDATE ON supplier_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
