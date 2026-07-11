-- WhatsApp — Cobranças e Notificações (módulo opcional pago, regra correspondente
-- no README). MVP: mensagens de template disparadas por evento (cobrança a
-- vencer/vencida, pagamento confirmado, nota fiscal emitida, proposta enviada)
-- via BSP (Twilio nesta fase — adapter isolado, trocável depois). Sem caixa de
-- entrada/chatbot, sem billing automático nesta fase (módulo é ligado pelo
-- mecanismo genérico de tenant_modules já existente).
--
-- Credenciais são POR TENANT (jsonb genérico, mesmo padrão de
-- bank_accounts.credentials — nunca um app Twilio compartilhado da
-- plataforma), nunca cacheadas, lidas fresh a cada mensagem.

-- 1 conta WhatsApp por tenant nesta fase (multi-número fica pra depois, mesmo
-- espírito de nfe_configs ser singleton antes da migration 0046).
CREATE TABLE whatsapp_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  provider      varchar(30) NOT NULL DEFAULT 'twilio',
  credentials   jsonb,
  whatsapp_number varchar(20),
  display_name  varchar(100),
  status        varchar(20) NOT NULL DEFAULT 'pending',
  connected_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_accounts_status_check CHECK (status IN ('pending', 'connected', 'disconnected'))
);

-- Conteúdo de template é fixo pelo sistema (nunca editável pelo tenant —
-- decisão deliberada, evita reprovação/uso indevido). O Content SID do
-- provedor é por tenant porque cada sender WhatsApp exige aprovação própria.
CREATE TABLE whatsapp_message_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_key        varchar(40) NOT NULL,
  provider_template_id varchar(100),
  status              varchar(20) NOT NULL DEFAULT 'pending_approval',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_message_templates_key_check CHECK (template_key IN (
    'invoice_due_soon', 'invoice_overdue', 'payment_confirmed',
    'fiscal_document_authorized', 'proposal_sent'
  )),
  CONSTRAINT whatsapp_message_templates_status_check CHECK (status IN ('pending_approval', 'approved', 'rejected')),
  CONSTRAINT whatsapp_message_templates_tenant_key_unique UNIQUE (tenant_id, template_key)
);

-- Uma linha por (tenant, template_key) — desligada por padrão, mesmo
-- comportamento leniente de módulo novo não mudar nada até o tenant ligar
-- explicitamente. config carrega {days_before}/{days_after} pros dois
-- eventos de proximidade de vencimento; vazio pros 3 eventos disparados na
-- hora (payment_confirmed/fiscal_document_authorized/proposal_sent).
CREATE TABLE whatsapp_automations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_key  varchar(40) NOT NULL,
  enabled       boolean NOT NULL DEFAULT false,
  config        jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_automations_key_check CHECK (template_key IN (
    'invoice_due_soon', 'invoice_overdue', 'payment_confirmed',
    'fiscal_document_authorized', 'proposal_sent'
  )),
  CONSTRAINT whatsapp_automations_tenant_key_unique UNIQUE (tenant_id, template_key)
);

-- 1 linha por mensagem enviada. Referências pro documento de origem são
-- nullable e mutuamente exclusivas na prática (nunca mais de uma preenchida
-- por mensagem) — mesmo padrão de FK nullable opcional já usado em
-- receivables.service_order_id.
CREATE TABLE whatsapp_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id           uuid REFERENCES clients(id) ON DELETE SET NULL,
  phone_e164          varchar(20) NOT NULL,
  template_key        varchar(40) NOT NULL,
  receivable_id       uuid REFERENCES receivables(id) ON DELETE SET NULL,
  invoice_id          uuid REFERENCES invoices(id) ON DELETE SET NULL,
  proposal_id         uuid REFERENCES proposals(id) ON DELETE SET NULL,
  provider_message_id varchar(100),
  status              varchar(20) NOT NULL DEFAULT 'queued',
  status_reason       text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_messages_key_check CHECK (template_key IN (
    'invoice_due_soon', 'invoice_overdue', 'payment_confirmed',
    'fiscal_document_authorized', 'proposal_sent'
  )),
  CONSTRAINT whatsapp_messages_status_check CHECK (status IN (
    'queued', 'sent', 'delivered', 'read', 'failed', 'undelivered'
  ))
);

CREATE INDEX idx_whatsapp_messages_tenant   ON whatsapp_messages(tenant_id, created_at DESC);
CREATE INDEX idx_whatsapp_messages_client   ON whatsapp_messages(client_id);
CREATE INDEX idx_whatsapp_messages_provider_id ON whatsapp_messages(provider_message_id);

-- Append-only, mesmo padrão de nfe_events/boleto_events.
CREATE TABLE whatsapp_message_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  whatsapp_message_id uuid NOT NULL REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
  event_type          varchar(30) NOT NULL,
  payload             jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_message_events_message ON whatsapp_message_events(whatsapp_message_id);

-- Idempotência de webhook inbound (status callback + mensagem recebida),
-- mesmo padrão de marketplace_webhook_events.
CREATE TABLE whatsapp_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        varchar(30) NOT NULL DEFAULT 'twilio',
  idempotency_key varchar(200) NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'received',
  error_message   text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  CONSTRAINT whatsapp_webhook_events_idempotency_key_unique UNIQUE (idempotency_key)
);

-- Consentimento LGPD — relação 1:1 com o cliente (mesmo raciocínio de
-- tenants.activated_at ser coluna direta em vez de tabela separada). MVP
-- manda mensagem só pro telefone principal do cliente, não por contato
-- avulso (client_contacts) — limitação documentada.
ALTER TABLE clients ADD COLUMN whatsapp_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN whatsapp_opt_in_at timestamptz;
ALTER TABLE clients ADD COLUMN whatsapp_opt_out_at timestamptz;
