-- Configuração de notificação de vencimento
ALTER TABLE notification_configs
  ADD COLUMN notify_receivable_due_days SMALLINT NOT NULL DEFAULT 3;

-- Flag de controle para evitar reenvio
ALTER TABLE receivables
  ADD COLUMN due_notification_sent BOOLEAN NOT NULL DEFAULT FALSE;
