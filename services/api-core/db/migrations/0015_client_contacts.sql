-- Migration 0015: Client Contacts
-- Lista de contatos por cliente (comercial, jurídico, compras, manutenção, comprador)

CREATE TABLE client_contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_type VARCHAR(30) NOT NULL DEFAULT 'comercial',
  name         VARCHAR(255),
  email        VARCHAR(255),
  phone        VARCHAR(20),
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_client_contacts_tenant ON client_contacts(tenant_id);
CREATE INDEX idx_client_contacts_client ON client_contacts(client_id, is_active);

CREATE TRIGGER update_client_contacts_updated_at
  BEFORE UPDATE ON client_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
