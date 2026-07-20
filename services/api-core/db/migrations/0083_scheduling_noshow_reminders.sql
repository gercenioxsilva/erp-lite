-- Migration 0083: Agendamento — status no_show + lembrete de sessão.
--
-- no_show: falta do cliente em sessão confirmada (clínica/barbearia vivem
-- disso). Terminal como 'canceled', NÃO debita pacote (falta não consome
-- crédito — política padrão; cobrança de no-show é decisão comercial fora do
-- sistema), não bloqueia agenda (BLOCKING_STATUSES segue pending/confirmed).
--
-- reminder_sent_at: idempotência do lembrete D-1 (worker varre sessões
-- confirmadas de amanhã sem lembrete enviado; re-run nunca duplica e-mail).

ALTER TABLE scheduling_sessions DROP CONSTRAINT IF EXISTS scheduling_sessions_status_check;
ALTER TABLE scheduling_sessions ADD CONSTRAINT scheduling_sessions_status_check
  CHECK (status IN ('pending','confirmed','completed','canceled','declined','no_show'));

ALTER TABLE scheduling_sessions ADD COLUMN reminder_sent_at TIMESTAMPTZ;
ALTER TABLE scheduling_sessions ADD COLUMN no_show_at TIMESTAMPTZ;

-- Varredura do worker de lembrete: confirmadas de uma data sem lembrete.
CREATE INDEX idx_scheduling_sessions_reminder
  ON scheduling_sessions (date)
  WHERE status = 'confirmed' AND reminder_sent_at IS NULL;
