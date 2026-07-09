-- Agendamento de Sessões com Pacotes (design em docs/superpowers/specs/2026-07-09-scheduling-module-design.md)
-- Módulo opcional 'scheduling' (tenant_modules), desligado por padrão.
--
-- Modelo: configuração por tenant + profissionais (staff agendável, login opcional)
-- + áreas de atuação (recurso paralelo dentro de um profissional) + vínculo
-- profissional↔área + disponibilidade (grade semanal e exceções por data)
-- + modelos de pacote + pacotes do cliente (nunca deletados; saldo derivado)
-- + sessões (intervalo meio-aberto [início, fim) em HH:mm) + movimentos de
-- pacote (append-only, débito atômico na conclusão).
--
-- Horários são wall-clock do tenant (scheduling_settings.timezone), gravados
-- como varchar(5) 'HH:mm' zero-padded: comparação lexicográfica ≡ cronológica.
-- Única tabela existente alterada: users (client_id para o papel 'client').

CREATE TABLE scheduling_settings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  business_name        varchar(255),
  business_type        varchar(120),
  allow_self_booking   boolean NOT NULL DEFAULT false,
  min_advance_hours    integer NOT NULL DEFAULT 12,
  cancel_window_hours  integer NOT NULL DEFAULT 0,
  timezone             varchar(64) NOT NULL DEFAULT 'America/Sao_Paulo',
  onboarding_complete  boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_settings_min_advance_check CHECK (min_advance_hours >= 0),
  CONSTRAINT scheduling_settings_cancel_window_check CHECK (cancel_window_hours >= 0)
);

CREATE TABLE scheduling_professionals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  name        varchar(255) NOT NULL,
  email       varchar(255),
  phone       varchar(20),
  bio         text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduling_professionals_tenant ON scheduling_professionals(tenant_id);
CREATE INDEX idx_scheduling_professionals_active ON scheduling_professionals(tenant_id, is_active);
CREATE UNIQUE INDEX uq_scheduling_professionals_user
  ON scheduling_professionals(tenant_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE scheduling_areas (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                      varchar(120) NOT NULL,
  description               text,
  default_duration_minutes  integer NOT NULL,
  default_price             decimal(15,2) NOT NULL DEFAULT 0,
  rules_text                text,
  is_active                 boolean NOT NULL DEFAULT true,
  created_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_areas_duration_check CHECK (default_duration_minutes > 0)
);

CREATE INDEX idx_scheduling_areas_tenant ON scheduling_areas(tenant_id);
CREATE INDEX idx_scheduling_areas_active ON scheduling_areas(tenant_id, is_active);

CREATE TABLE scheduling_professional_areas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id  uuid NOT NULL REFERENCES scheduling_professionals(id) ON DELETE CASCADE,
  area_id          uuid NOT NULL REFERENCES scheduling_areas(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_scheduling_professional_areas UNIQUE (professional_id, area_id)
);

CREATE INDEX idx_scheduling_professional_areas_tenant ON scheduling_professional_areas(tenant_id);
CREATE INDEX idx_scheduling_professional_areas_area   ON scheduling_professional_areas(tenant_id, area_id);

-- Grade semanal: weekday 0=domingo … 6=sábado (mesma convenção de
-- Date.getUTCDay() no domínio). HH:mm zero-padded validado por regex;
-- start < end lexicográfico ≡ cronológico. Faixas sobrepostas no mesmo dia
-- são permitidas — mergeRanges normaliza na leitura.
CREATE TABLE scheduling_availability_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id  uuid NOT NULL REFERENCES scheduling_professionals(id) ON DELETE CASCADE,
  weekday          smallint NOT NULL,
  start_time       varchar(5) NOT NULL,
  end_time         varchar(5) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_availability_rules_weekday_check CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT scheduling_availability_rules_time_check CHECK (
    start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
    end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
    start_time < end_time
  )
);

CREATE INDEX idx_scheduling_availability_rules_tenant ON scheduling_availability_rules(tenant_id);
CREATE INDEX idx_scheduling_availability_rules_prof   ON scheduling_availability_rules(professional_id, weekday);

-- Exceções por data: kind='block' sem horários = dia inteiro bloqueado;
-- 'block' com horários = bloqueio parcial; 'open' = abertura extra (horários
-- obrigatórios, soma-se à grade semanal).
CREATE TABLE scheduling_availability_exceptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id  uuid NOT NULL REFERENCES scheduling_professionals(id) ON DELETE CASCADE,
  date             date NOT NULL,
  kind             varchar(10) NOT NULL,
  start_time       varchar(5),
  end_time         varchar(5),
  note             varchar(255),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_availability_exceptions_kind_check CHECK (kind IN ('block', 'open')),
  CONSTRAINT scheduling_availability_exceptions_pair_check CHECK (
    (start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL)
  ),
  CONSTRAINT scheduling_availability_exceptions_open_check CHECK (
    kind <> 'open' OR start_time IS NOT NULL
  ),
  CONSTRAINT scheduling_availability_exceptions_time_check CHECK (
    start_time IS NULL OR (
      start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
      end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
      start_time < end_time
    )
  )
);

CREATE INDEX idx_scheduling_availability_exceptions_tenant    ON scheduling_availability_exceptions(tenant_id);
CREATE INDEX idx_scheduling_availability_exceptions_prof_date ON scheduling_availability_exceptions(professional_id, date);

CREATE TABLE scheduling_package_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           varchar(120) NOT NULL,
  area_id        uuid REFERENCES scheduling_areas(id) ON DELETE SET NULL,
  session_count  integer NOT NULL,
  price          decimal(15,2) NOT NULL DEFAULT 0,
  validity_days  integer,
  is_active      boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_package_templates_count_check CHECK (session_count > 0),
  CONSTRAINT scheduling_package_templates_validity_check CHECK (validity_days IS NULL OR validity_days > 0)
);

CREATE INDEX idx_scheduling_package_templates_tenant ON scheduling_package_templates(tenant_id);
CREATE INDEX idx_scheduling_package_templates_active ON scheduling_package_templates(tenant_id, is_active);

-- Pacote do cliente: histórico financeiro, NUNCA deletado (sem rota de delete).
-- Saldo é sempre derivado (total_sessions - used_sessions); o CHECK garante
-- que o débito jamais deixa o saldo negativo, mesmo sob corrida.
-- area_id NULL = pacote vale para qualquer área. Campos são snapshot do
-- modelo no momento da concessão (modelo pode mudar depois sem afetar).
CREATE TABLE scheduling_client_packages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  template_id     uuid REFERENCES scheduling_package_templates(id) ON DELETE SET NULL,
  area_id         uuid REFERENCES scheduling_areas(id) ON DELETE SET NULL,
  name            varchar(120) NOT NULL,
  total_sessions  integer NOT NULL,
  used_sessions   integer NOT NULL DEFAULT 0,
  price           decimal(15,2) NOT NULL DEFAULT 0,
  payment_status  varchar(10) NOT NULL DEFAULT 'pending',
  status          varchar(12) NOT NULL DEFAULT 'active',
  valid_until     date,
  notes           text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_client_packages_total_check   CHECK (total_sessions > 0),
  CONSTRAINT scheduling_client_packages_balance_check CHECK (used_sessions >= 0 AND used_sessions <= total_sessions),
  CONSTRAINT scheduling_client_packages_payment_check CHECK (payment_status IN ('pending', 'partial', 'paid')),
  CONSTRAINT scheduling_client_packages_status_check  CHECK (status IN ('active', 'exhausted', 'expired', 'canceled'))
);

CREATE INDEX idx_scheduling_client_packages_tenant ON scheduling_client_packages(tenant_id);
CREATE INDEX idx_scheduling_client_packages_client ON scheduling_client_packages(tenant_id, client_id);
CREATE INDEX idx_scheduling_client_packages_status ON scheduling_client_packages(tenant_id, status);

-- Sessão: intervalo meio-aberto [start_time, end_time) na data. Conflito =
-- mesmo profissional + mesma área + overlap, apenas em status que seguram
-- horário ('pending' segura como 'confirmed'). area_id NOT NULL + RESTRICT:
-- área usada em sessão não pode ser hard-deletada (23503 → 409 area_in_use);
-- desativar (is_active=false) é o caminho preferencial.
CREATE TABLE scheduling_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id  uuid NOT NULL REFERENCES scheduling_professionals(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  client_name      varchar(255) NOT NULL,
  area_id          uuid NOT NULL REFERENCES scheduling_areas(id) ON DELETE RESTRICT,
  package_id       uuid REFERENCES scheduling_client_packages(id) ON DELETE SET NULL,
  date             date NOT NULL,
  start_time       varchar(5) NOT NULL,
  end_time         varchar(5) NOT NULL,
  status           varchar(10) NOT NULL DEFAULT 'confirmed',
  requested_by     varchar(15) NOT NULL DEFAULT 'professional',
  decline_reason   text,
  cancel_reason    text,
  canceled_at      timestamptz,
  canceled_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at     timestamptz,
  notes            text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_sessions_status_check CHECK (status IN ('pending', 'confirmed', 'completed', 'canceled', 'declined')),
  CONSTRAINT scheduling_sessions_requested_by_check CHECK (requested_by IN ('professional', 'client')),
  CONSTRAINT scheduling_sessions_time_check CHECK (
    start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
    end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
    start_time < end_time
  )
);

CREATE INDEX idx_scheduling_sessions_tenant    ON scheduling_sessions(tenant_id);
CREATE INDEX idx_scheduling_sessions_prof_date ON scheduling_sessions(tenant_id, professional_id, date);
CREATE INDEX idx_scheduling_sessions_client    ON scheduling_sessions(tenant_id, client_id, date);
CREATE INDEX idx_scheduling_sessions_pending   ON scheduling_sessions(tenant_id) WHERE status = 'pending';

-- Backstop físico da regra de conflito (defesa em profundidade — a checagem
-- primária é na aplicação, dentro de transação com advisory lock, porque ela
-- produz o erro amigável citando cliente/horário). Casts text::time/::date são
-- STABLE e não podem entrar em índice; esta função IMMUTABLE converte 'HH:mm'
-- em minutos e o int4range default [) reproduz exatamente o meio-aberto.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION scheduling_hm_to_minutes(t varchar) RETURNS integer
  LANGUAGE sql IMMUTABLE STRICT
  AS $$ SELECT substring(t from 1 for 2)::integer * 60 + substring(t from 4 for 2)::integer $$;

ALTER TABLE scheduling_sessions ADD CONSTRAINT scheduling_sessions_no_overlap
  EXCLUDE USING gist (
    professional_id WITH =,
    area_id         WITH =,
    date            WITH =,
    int4range(scheduling_hm_to_minutes(start_time), scheduling_hm_to_minutes(end_time)) WITH &&
  ) WHERE (status IN ('pending', 'confirmed'));

-- Trilha append-only de consumo de pacote (precedente: cost_center_stock).
-- idempotency_key UNIQUE ('session_completed:<session_id>') é o backstop
-- físico contra débito duplo da mesma conclusão. Imutável: sem updated_at.
CREATE TABLE scheduling_package_movements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_id       uuid NOT NULL REFERENCES scheduling_client_packages(id) ON DELETE RESTRICT,
  session_id       uuid REFERENCES scheduling_sessions(id) ON DELETE SET NULL,
  direction        varchar(6) NOT NULL,
  quantity         integer NOT NULL DEFAULT 1,
  balance_after    integer NOT NULL,
  reason           varchar(30) NOT NULL,
  idempotency_key  varchar(80) NOT NULL,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_package_movements_direction_check CHECK (direction IN ('debit', 'credit')),
  CONSTRAINT scheduling_package_movements_quantity_check  CHECK (quantity > 0),
  CONSTRAINT scheduling_package_movements_balance_check   CHECK (balance_after >= 0),
  CONSTRAINT uq_scheduling_package_movements_idem UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX idx_scheduling_package_movements_tenant  ON scheduling_package_movements(tenant_id);
CREATE INDEX idx_scheduling_package_movements_package ON scheduling_package_movements(package_id);

-- Papel 'client' (portal): vincula o login ao cadastro comercial. Não-único
-- de propósito — dois responsáveis podem ter login para o mesmo aluno.
ALTER TABLE users ADD COLUMN client_id uuid REFERENCES clients(id) ON DELETE SET NULL;
CREATE INDEX idx_users_client ON users(client_id) WHERE client_id IS NOT NULL;

CREATE TRIGGER trg_scheduling_settings_updated_at BEFORE UPDATE ON scheduling_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_scheduling_professionals_updated_at BEFORE UPDATE ON scheduling_professionals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_scheduling_areas_updated_at BEFORE UPDATE ON scheduling_areas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_scheduling_availability_rules_updated_at BEFORE UPDATE ON scheduling_availability_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_scheduling_availability_exceptions_updated_at BEFORE UPDATE ON scheduling_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_scheduling_package_templates_updated_at BEFORE UPDATE ON scheduling_package_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_scheduling_client_packages_updated_at BEFORE UPDATE ON scheduling_client_packages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_scheduling_sessions_updated_at BEFORE UPDATE ON scheduling_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
