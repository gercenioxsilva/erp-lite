# Módulo de Agendamento de Sessões com Pacotes — Design

Data: 2026-07-09 · Branch base: `feature/rbac-backend` (depende do RBAC, PR #140) · Módulo: `scheduling`

## Contexto

Tenants do Orquestra ERP (autoescolas, barbearias, estúdios, prestadores solo) precisam agendar
sessões entre profissionais e clientes/alunos, controlar pacotes de sessões (cobrança combinada
fora do sistema) e, opcionalmente, permitir auto-agendamento pelo cliente em um portal próprio.
O sistema **apenas agenda** — não intermedia pagamento por agendamento; o pacote é vínculo e
controle de consumo, nunca gating de agendamento.

## Decisões fechadas com o usuário

1. **Acesso do cliente**: novo papel de sistema `client` + `users.client_id → clients`. Portal
   `/portal/*` no mesmo SPA, molde do portal do técnico. Profissional/admin provisiona o acesso.
2. **Valores**: `DECIMAL(15,2)` (convenção do repo), não centavos inteiros.
3. **Multi-profissional**: dono cadastra N profissionais (tabela própria, `user_id` opcional —
   profissional pode existir sem login). Cada profissional tem grade semanal + exceções próprias.
   Aluno escolhe o profissional. Dono/admin vê tudo; caso solo, o dono se cadastra como profissional.
4. **Área obrigatória** em todo agendamento (`area_id NOT NULL`). Consequência: pacote "qualquer
   área" não trata a agenda toda como ocupada — o fluxo de booking sempre resolve uma área concreta.
5. **Conflito** = mesmo profissional **e** mesma área **e** overlap meio-aberto `[início, fim)`.
   Mesmo profissional em áreas diferentes coexiste (carro×moto); profissionais diferentes nunca
   conflitam. Pendente segura horário como confirmada.
6. **Vínculo profissional↔áreas** (tabela de link); pickers filtram profissionais pela área.
7. **Permissões**: profissional gerencia só a própria agenda/disponibilidade, cadastra clientes,
   aprova/recusa solicitações e conclui as próprias sessões. Dono/admin gerencia tudo (áreas,
   pacotes, pagamento, config). Papel `client` só acessa `/v1/portal/*` (guard global).
8. **Sem gating de saldo no agendamento**: agendar é ilimitado; pacote é opcional na sessão
   (inclusive no auto-agendamento — cliente pode agendar avulso). Débito de saldo ocorre
   **apenas** na conclusão, atômico, e saldo nunca fica negativo.
9. **Janela de cancelamento** (`cancel_window_hours`) restringe só o cliente (próprio pending,
   fora da janela). Profissional/admin cancela qualquer não-concluída a qualquer momento.

## Regras críticas (backend é a fonte da verdade; UI é UX)

- Intervalos meio-abertos: fim 09:00 não conflita com início 09:00. Comparação lexicográfica de
  `HH:mm` zero-padded ≡ cronológica.
- Checagem final de conflito atômica com a gravação: `pg_advisory_xact_lock(hash(professional_id:date))`
  na transação + constraint `EXCLUDE USING gist` (btree_gist) como backstop
  (`professional_id =, area_id =, tsrange &&, WHERE status IN ('pending','confirmed')` → 23P01 mapeado
  para `session_conflict`). Erro de conflito cita cliente e horário conflitantes no payload.
- Conclusão atômica: na mesma transação `FOR UPDATE` da sessão → (se houver pacote) `FOR UPDATE` do
  pacote → débito de exatamente 1 + movimento imutável com `idempotency_key = session_completed:<id>`
  (UNIQUE) → sessão `completed`. Saldo 0 → pacote `exhausted`; sem saldo → erro; `completed` é imutável.
- Cancelar não consome saldo, libera horário (soft, auditado). Excluir só não-concluídas.
- Auto-agendamento (se `allow_self_booking`): pacote (opcional) → área → profissional (da área) →
  dia → slot. Slots = grade semanal − exceções − ocupados da mesma (profissional, área), fatiados na
  duração da área, respeitando `min_advance_hours` no fuso do tenant (`timezone`, default
  America/Sao_Paulo); resto < duração descartado; grade vazia = nada ofertado. Pedido nasce `pending`;
  aprovação **re-checa** conflito atomicamente; recusa exige motivo; cliente cancela só o próprio pending.
- Isolamento por tenant em toda query (tenant do JWT); papel `client` enxerga só os próprios dados.

## Banco — migration `0060_scheduling.sql` (+ registro em `src/scripts/migrate.ts`)

Tabelas (todas com `id uuid`, `tenant_id` FK cascade, `created_at/updated_at` + trigger, `idx_*_tenant`):

| Tabela | Pontos-chave |
|---|---|
| `scheduling_settings` | 1/tenant (UNIQUE); allow_self_booking, min_advance_hours (≥0, default 12), cancel_window_hours, timezone, onboarding_complete, business_name/type |
| `scheduling_professionals` | user_id opcional → users (SET NULL), UNIQUE parcial (tenant,user), is_active |
| `scheduling_areas` | default_duration_minutes >0, default_price, rules_text, is_active. Hard delete: sessões usam RESTRICT → 23503 vira 409 `area_in_use`; templates/pacotes usam SET NULL |
| `scheduling_professional_areas` | link UNIQUE (professional, area) |
| `scheduling_availability_rules` | weekday 0-6 (0=domingo), start/end varchar(5) HH:mm com CHECK regex + start<end |
| `scheduling_availability_exceptions` | kind block/open; block sem horários = dia inteiro; open exige horários |
| `scheduling_package_templates` | area_id NULL = qualquer área; session_count>0; validity_days; soft delete |
| `scheduling_client_packages` | nunca deletado; snapshot de nome/área/preço; used_sessions com CHECK 0≤used≤total (saldo é derivado); payment_status pending/partial/paid; status active/exhausted/expired/canceled; valid_until |
| `scheduling_sessions` | professional/client/area NOT NULL (RESTRICT), client_name denormalizado, package_id SET NULL, date + start/end HH:mm, status pending/confirmed/completed/canceled/declined, requested_by, decline_reason, cancel_* auditado, completed_at; índices (tenant,prof,date), (tenant,client,date), parcial pending; EXCLUDE de overlap |
| `scheduling_package_movements` | append-only; direction debit/credit, quantity, balance_after≥0, reason, idempotency_key UNIQUE por tenant |

Extra: `ALTER TABLE users ADD COLUMN client_id uuid REFERENCES clients(id) ON DELETE SET NULL`
(não-único de propósito: dois responsáveis podem ter login para o mesmo aluno).

## Domínio — `src/domain/scheduling/` (puro, zero I/O, `SchedulingDomainError(code, payload)`)

- `timeDomain.ts`: TIME_RE, hmToMinutes/minutesToHm, `overlaps(a,b) = a.start<b.end && b.start<a.end`,
  mergeRanges, subtractRange/subtractAll.
- `sessionDomain.ts`: BLOCKING_STATUSES=['pending','confirmed'], conflictsWith/findConflict
  (mesmo prof + mesma área + blocking + overlap), máquina de estados (assertCanApprove/Decline/
  Complete/Cancel/Edit/HardDelete/ClientCanCancel).
- `slotDomain.ts`: `computeFreeSlots({weeklyRanges, exceptions, occupied, durationMinutes, date, earliest})`
  — merge grade+aberturas, bloqueio dia inteiro zera, subtrai blocks e ocupados, corta por earliest,
  fatia ancorado no início de cada faixa, descarta resto < duração; `weekdayOf` via Date.UTC.
- `packageDomain.ts`: remainingSessions, assertPackageUsableForBooking (área/validade/status —
  informativo, não bloqueia agendamento sem pacote), applyDebit (+1; 0 restante → exhausted;
  débito sem saldo → `package_no_balance`).
- `advanceDomain.ts`: wallClockInTimezone (Intl en-CA, guarda hora '24'), earliestBookableInstant
  (soma horas em UTC, DST-safe, `now` injetável), violatesMinAdvance, withinCancelWindow.

## Services — `src/services/scheduling*.ts` (db injetável `= _db`; transações Drizzle)

settings (seed-on-read) · professionals (CRUD soft, setProfessionalAreas tx, provisionProfessionalUser
role='professional', getProfessionalByUserId p/ escopo) · areas (hard delete com 23503→area_in_use) ·
availability (replaceWeeklyGrid tx, exceções) · packages (grantPackage tx com snapshot + save_as_template,
setPaymentStatus, cancel, movements; sem delete) · sessions (list/get, createSession staff [sem exigir
grade — admin pode furar, UI avisa], requestSessionAsClient [revalida slot server-side, `pending`],
approveSession [re-checa conflito], declineSession [motivo obrigatório], completeSession [débito atômico],
updateSession [re-checa se mudou prof/área/horário], cancelSession soft, deleteSession hard não-concluída,
getAvailableSlots [admin sem min-advance; portal com]) · escopo own-agenda: sem `scheduling:manage_all`,
serviços filtram/rejeitam por professional_id do usuário (`not_own_agenda`).

## RBAC / Auth

- `MODULE_KEYS` += 'scheduling'; gate `requireModule('scheduling')` em todas as rotas do módulo.
- CATALOG_SPEC (backend + espelho no FE): `scheduling` (view, manage, complete, manage_all, settings),
  `scheduling_areas` (view/create/edit/delete), `scheduling_professionals` (view/create/edit/delete),
  `scheduling_packages` (view, manage, grant, payment), `scheduling_portal` (access).
- SYSTEM_ROLES += `professional` (agenda própria + clients view/create/edit) e `client`
  (`scheduling_portal:access` apenas).
- Novo `middleware/clientRoleGuard.ts` (cópia do technicianRoleGuard): role `client` só acessa
  `/health`, `/v1/auth/me`, `/v1/portal/`. Registrado em app.ts. Login reusa `/v1/auth/login`;
  `client_id` resolvido por request da linha de users (nunca do token).
- Provisão: `POST /v1/clients/:id/portal-user` (guard `clients:edit`, role hard-coded 'client') e
  `POST /v1/scheduling/professionals/:id/user` (guard `users:create`).

## Rotas (prefixo /v1; JSON Schema por rota; envelope paginado {data,total,page,per_page})

Admin/staff em `routes/scheduling.ts`: settings GET/PATCH · areas CRUD · professionals CRUD +
PUT :id/areas + POST :id/user + GET me + availability GET/PUT weekly/POST-DELETE exceptions ·
package-templates CRUD · client-packages GET/POST(grant)/PATCH/payment-status/cancel/movements ·
sessions GET/POST/PATCH/approve/decline/complete/cancel/DELETE · GET slots · GET dashboard
(sessões do dia + contagem de pendências p/ badge).

Portal em `routes/schedulingPortal.ts` (guard portal:access + clientRoleGuard): GET me · GET sessions ·
POST sessions/:id/cancel (pending próprio + janela) · GET packages · GET areas · GET professionals ·
GET slots (min-advance) · POST sessions (nasce pending; erros self_booking_disabled, slot_unavailable,
min_advance_violation, session_conflict...).

## Frontend (fases 6-8)

Admin (rotas gated em App.tsx + grupo no NAV do Layout, i18n `sched.*` em pt-BR e en): dashboard com
badge vivo (poll), calendário semanal/diário por profissional (novos DS: CalendarWeekGrid, SlotPicker,
AvailabilityWeekEditor, BalanceBar — estilo tokens index.css), inbox de solicitações, CRUD áreas/
profissionais/modelos (padrão drawer da ClientsPage), detalhe do cliente (pacotes com barra de saldo
segmentada + StatusPill de pagamento, histórico com concluir/editar/cancelar/excluir, conceder pacote
com pré-preencher/salvar-como-modelo/pagamento segmentado, provisionar portal), agendar em drawer
(conflito 422 citando cliente/horário; pacote pré-selecionado quando só 1 usável), configurações,
onboarding 3 passos (negócio → 1ª área → disponibilidade; cria profissional do dono no caso solo).

Portal (`/portal/*` fora do GuardedRoutes, PortalLayout molde TechnicianLayout + tab bar, i18n
`portal.*`): login, home, minhas sessões (cancelar pending na janela), agendar em 3 passos
(pacote/área → profissional+dia → slot/confirmar), meus pacotes read-only com barra de saldo, perfil.
Redirect pós-login role=client → /portal.

Sem lib de datas: `apps/backoffice/src/lib/schedulingTime.ts` (hmToMinutes, addDaysISO, weekdayOf,
formatDateBR via Intl, builder de semana).

## Testes (vitest; mapeamento 1:1 com critérios de aceite)

- Domínio puro: timeDomain (overlap meio-aberto), sessionDomain (faixas: carro×moto coexistem,
  carro×carro não, profs diferentes nunca; pending bloqueia; máquina de estados), slotDomain
  (bloqueio parcial fatia, dia inteiro zera, abertura mescla, resto descartado, antecedência corta,
  grade vazia), packageDomain (débito duplo falha, saldo nunca negativo, exhausted em 0),
  advanceDomain (fuso, meia-noite, now injetável).
- Services (mock db): ordem lock→select→insert, conflito com payload, approve re-checa, complete
  na mesma tx.
- Integração (PG real, CI já provê): corrida de criação concorrente (1 vence), backstop EXCLUDE 23P01,
  corrida de conclusão dupla (23505/23514), cross-tenant negado, portal (guard, janela, fluxo completo).

## Fases

1. DB + RBAC + guards (fundação) → 2. Domínio + testes → 3. Services/rotas de config →
4. Sessões (conflito/débito atômicos) → 5. API portal → 6. UI admin (config/CRUD/onboarding) →
7. UI admin (calendário/agendar/inbox/dashboard) → 8. UI portal.

## Riscos aceitos

- EXCLUDE com cast `(date + time)` a validar no PG16 do CI; fallback: advisory lock somente.
- Aprovações podem exceder saldo do pacote (decisão 8) — erro só na conclusão, por design.
- Sem DST no Brasil hoje; horários são wall-clock naive por design.
- Desativar profissional mantém sessões futuras; UI deve avisar (nicety de follow-up).
