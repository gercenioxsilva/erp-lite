-- Agenda do Técnico (regra 78): visão de calendário das visitas técnicas, no
-- mesmo espírito visual do módulo de Agendamento (regra 65), mas mantendo
-- service_visits/technicians como domínio próprio — nunca fundido com
-- scheduling_sessions/scheduling_professionals (contextos de negócio
-- diferentes: checklist/foto/assinatura de campo vs. sessão com pacote).
--
-- duration_minutes: service_visits só guardava um instante (scheduled_at),
-- sem hora de término — impossível desenhar um bloco de calendário sem
-- duração. Default 60 preserva 100% do comportamento de quem já cria visita
-- sem informar duração (mesmo raciocínio de todo default aditivo do projeto).
ALTER TABLE service_visits ADD COLUMN IF NOT EXISTS duration_minutes smallint NOT NULL DEFAULT 60;

CREATE INDEX IF NOT EXISTS idx_service_visits_technician_scheduled
  ON service_visits(tenant_id, technician_id, scheduled_at);

-- Decisão deliberada: SEM `EXCLUDE USING gist` física aqui (diferente de
-- scheduling_sessions_no_overlap, migration 0063). Lá o backstop era seguro
-- porque scheduling_sessions nasceu na MESMA migration que o adicionou —
-- zero linhas pré-existentes possíveis. `service_visits` já existe desde a
-- migration 0044 e pode ter dado real em produção; se qualquer par histórico
-- de visitas do mesmo técnico já se sobrepuser sob a duração default de
-- 60min (nunca validado antes de existir este conceito), `ADD CONSTRAINT
-- ... EXCLUDE` falharia a validação retroativa e travaria o deploy inteiro —
-- exatamente o risco que este projeto nunca aceita numa migration (nunca
-- destrutiva, nunca arriscando falhar contra dado real). A checagem de
-- conflito atômica em serviceVisitService.ts::scheduleVisit() (advisory
-- lock por técnico, dentro da transação) é a única gravadora de
-- service_visits para agendamento — suficiente para correção, sem o
-- backstop físico.
