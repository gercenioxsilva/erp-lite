# RBAC — Auditoria e Guia de Autorização (Orquestra ERP)

> Controle de Acesso por Perfis dirigido por banco. Backend é a autoridade;
> o frontend esconde por conveniência de UX. Este documento é o entregável de
> auditoria + o mapa de referência de rotas, menus e permissões.

## 1. Modelo

- **Permissões**: strings `modulo:acao` (ex.: `clients:create`). Catálogo é a
  fonte da verdade em código: [`services/api-core/src/rbac/permissions.ts`](../services/api-core/src/rbac/permissions.ts).
- **Papéis (roles)**: tabela `roles` — 5 de sistema (`owner`, `admin`, `manager`,
  `user`, `technician`, `tenant_id NULL`) semeados no boot, mais papéis **custom
  por tenant**. Vínculos em `role_permissions`. `users.role` continua sendo a
  chave do papel.
- **Runtime**: permissões NÃO vão no JWT. São resolvidas no servidor por request
  (cache ~60s, `owner` = todas por código) e devolvidas ao frontend em
  `/auth/login`, `/auth/register` e `/auth/me`. Trocar papel/permissões reflete
  sem reemitir token.

## 2. Perfis-semente (ponto de partida — editável na tela de Perfis)

| Papel | Resumo |
|---|---|
| **owner** (Super Admin) | Todas as permissões, incluindo `billing:manage` e `roles:manage`. |
| **admin** | Tudo, exceto `billing:manage`. |
| **manager** (Gestor) | Operação completa (comercial, estoque, financeiro, PDV, campo, relatórios). Sem `users`, `roles`, `billing:manage`, `tenant_modules:manage`; `company:view`. |
| **user** (Operador) | `view`+`create`+`edit` no dia a dia (clientes, pedidos, propostas, notas, materiais, estoque, financeiro, PDV, OS). Sem excluir, sem exportar, sem administração. |
| **technician** | Apenas `portal:access` (portal de visitas). |

## 3. Auditoria — antes × depois

**Antes:** autenticação existia, mas autorização não. Todo usuário logado
acessava qualquer rota/menu/botão. Único controle de papel: `technicianRoleGuard`.
Diversas rotas **sem autenticação** confiavam em `tenant_id` do cliente.

**Riscos encontrados (críticos):**
- `routes/users.ts` era totalmente aberto — qualquer chamador criava/editava/
  excluía usuários (inclusive `owner`) sem login. **Corrigido** (authenticate +
  RBAC + tenant do JWT + escopo por tenant no PATCH/DELETE).
- Rotas sem `authenticate` que confiavam em `tenant_id` do cliente: `orders`,
  `invoices`, `nfe`, `nfse`, `clientContacts`, `serviceContracts`,
  `materialImages`, `notificationConfig`, e o CRUD de `materials`/`clients`.
  **Corrigido (hotfix de segurança, 2026-07-08)** — ver seção 3.1. Estava ativo
  em produção com clientes reais; a maioria não filtrava por tenant algum (não
  era "precisa adivinhar `tenant_id`" — um UUID de recurso já bastava).
- `routes/customers.ts` fazia CRUD direto na tabela `tenants` (lista/edita/
  cancela qualquer empresa do SaaS), sem autenticação e sem nenhum caller
  conhecido no repo. **Corrigido** — plugin desregistrado em `app.ts` em vez de
  virar RBAC tenant-scoped (é cross-tenant por natureza; nenhum papel deveria
  ter esse poder). Reversível — ver comentário em `app.ts`.
- Bug latente: `routes/proposals.ts` lê `user.id`/`user.email` (undefined; o token
  só tem `userId`). **Follow-up** (não fazia parte do escopo do hotfix).

### 3.1 Hotfix de segurança (2026-07-08) — detalhe

Auditoria dedicada (11 sub-agentes, um por arquivo) confirmou severidade
CRITICAL em 9 dos 11 arquivos e HIGH nos 2 restantes — a maioria das rotas não
tinha filtro de tenant NENHUM nas queries (não apenas ausência de `authenticate`).
Exemplos de exploração encontrados: `PUT /nfe-config` permitia injetar o token
Focus NFe do atacante na config fiscal de outro tenant; `POST /nfse/:id/emit` e
`POST /invoices/:id/issue` disparavam emissão fiscal real sem qualquer controle;
`orders.ts`/`materials.ts` permitiam cancelar pedidos e mexer em estoque de
qualquer tenant.

Correção aplicada em todos os endpoints (exceto `customers.ts`, tratado à parte):
`onRequest:[authenticate]` + `preHandler:[requirePermission(...)]` + `tenantId`
sempre de `(request as any).user.tenantId` (nunca de body/query/params) +
filtro de tenant adicionado em toda query que não tinha nenhum. Decisão de
compatibilidade: `tenant_id` **não foi removido** dos JSON schemas de
body/query (fica aceito-mas-ignorado) — o backend passou a ignorar o valor
enviado pelo cliente e usar o do JWT, então nenhuma mudança de frontend foi
necessária para o hotfix entrar em vigor. Nenhum endpoint foi removido
(inclusive candidatos a código morto como `GET /materials/:id/stock`) —
decisão foi proteger tudo, não remover, sob pressão de incidente; limpeza
fica para depois. Nenhuma chave de permissão nova foi criada — o catálogo já
cobria todos os casos.

## 4. Enforcement no backend

- Middleware [`requirePermission(...)`](../services/api-core/src/lib/requirePermission.ts)
  (`preHandler`), 403 padronizado `{ error: 'PermissionDenied', message, required }`
  + `request.log.warn({ event: 'rbac_denied', ... })` (log de tentativa negada).
- Aplicado em **todas as rotas já autenticadas**: financeiro (receivables,
  payables, boleto), comercial (proposals), estoque (`/stock`), fornecedores,
  compras, centros de custo, vendedores, PDV, campo (OS/técnicos), marketplace,
  relatórios (`reports:view`), assinatura (`billing:*`), empresa/tenant
  (`company:*`), módulos (`tenant_modules:manage`).
- Endpoints de administração: [`routes/rbac.ts`](../services/api-core/src/routes/rbac.ts)
  — `GET /v1/rbac/permissions`, `GET/POST/PATCH/DELETE /v1/rbac/roles`,
  `PUT /v1/rbac/roles/:id/permissions` (gated `roles:view`/`roles:manage`).
- **Aberto de propósito** (não exige permissão): `GET /v1/tenant/modules` (o menu
  precisa para todos os papéis) e as calculadoras `/tax/*` (usadas em vários
  fluxos de criação).

## 5. Enforcement no frontend

- `AuthContext` guarda `permissions[]` e expõe `refreshPermissions()`.
- Helpers em [`apps/backoffice/src/rbac/`](../apps/backoffice/src/rbac/):
  `usePermissions()` (`can/canAny/canAll`), `<Can permission=…>`, `<ProtectedRoute>`.
- **Rotas**: cada rota privada em `App.tsx` envolvida por `<ProtectedRoute permission="modulo:view">`; sem acesso → **`/403`** (`AccessDeniedPage`).
- **Menu**: `Layout.tsx` filtra itens por `can()`; esconde o grupo pai sem filhos
  visíveis; novo item **Perfis de Acesso** (`/roles`).
- **API**: `lib/api.ts` faz auto-logout no **401** com token (sessão expirada);
  **403** continua no modal "Sem permissão".
- **Botões/ações**: `<Can>` nos botões de criar/editar/excluir/exportar/emitir/
  enviar/etc. em ~30 páginas; export de relatórios gated centralmente no
  `ExportButton`.
- **Tela de Perfis** (`RolesPage`): cria/edita papéis custom e marca permissões
  por módulo (consome `/v1/rbac/*`).

## 6. Mapa rota → permissão de acesso (frontend)

`/dashboard`→`dashboard:view` · `/clients`→`clients:view` · `/materials`→`materials:view`
· `/stock`→`stock:view` · `/users`→`users:view` · `/roles`→`roles:view`
· `/orders`→`orders:view` · `/invoices`→`invoices:view` · `/invoices/new`→`invoices:create`
· `/nfse`→`nfse:view` · `/receivables`→`receivables:view` · `/suppliers`→`suppliers:view`
· `/payables`→`payables:view` · `/company`→`company:view` · `/contracts`→`contracts:view`
· `/proposals`→`proposals:view` · `/reports/*` e `/dre`→`reports:view`
· `/cost-centers`→`cost_centers:view` · `/sellers`→`sellers:view`
· `/purchase-orders`→`purchase_orders:view` · `/supplier-invoices`→`supplier_invoices:view`
· `/billing`→`billing:manage` · `/pos`,`/pos/caixa`,`/pos/sales`,`/pos/sessions`→`pos:view`
· `/pos/terminals`→`pos:manage` · `/service-orders`→`service_orders:view`
· `/technicians`→`technicians:view`.

## 7. Testes

- Vitest backend: `rbacCatalog.test.ts` (invariantes catálogo/matriz),
  `permissionService.test.ts` (owner-fallback, resolução, cache/invalidate),
  `requirePermission.test.ts` (allow/deny/403/log/401/AND/OR). Suite: 598 verdes.
- Setup [`rbac.setup.ts`](../services/api-core/src/__tests__/rbac.setup.ts): concede
  todas as permissões nos testes de rota (RBAC não é o alvo ali).
- (1 suíte de integração exige Postgres real — não roda sem banco local; não é RBAC.)

## 8. Follow-up (não incluído neste entregável)

1. Corrigir `user.id`/`user.email` em `routes/proposals.ts`.
2. Gating fino de UX na aba "Módulos"/"Integrações" da página Empresa
   (Switches → `tenant_modules:manage` / connect → `marketplace:manage`).
3. `PATCH /orders/:id` não revalida que um `client_id` novo enviado no body
   pertence ao tenant do chamador (a checagem de posse só foi adicionada em
   `POST /orders`, criação — ver hotfix seção 3.1).
4. Se surgir um uso legítimo de `routes/customers.ts` (ex.: backoffice interno
   de sucesso do cliente), precisa de um conceito de permissão de plataforma
   separado do RBAC por tenant — não é um caso de `authenticate`+`requirePermission`
   comum, já que a rota opera cross-tenant por natureza.
5. Ruído de teste pré-existente (não causado pelo hotfix): `syncRbacCatalog`/
   `ContractBillingWorker` logam erro (`tx.execute is not a function`) quando
   `buildApp()` roda contra o `db` mockado dos testes de rota — não falha
   nenhum teste, só polui stderr. Considerar mockar `db.execute` no setup
   global ou não iniciar os workers em modo de teste.
6. `nfse.test.ts` — o teste "GET /v1/nfse requires tenant_id" ficou
   deliberadamente sem JWT no hotfix (a rota agora deriva o tenant do JWT, não
   da querystring, então autenticar quebraria a asserção original). O teste
   hoje só verifica "requisição sem auth → ≥400" por acidente; revisar o que
   ele deveria testar de fato ou removê-lo.
7. Limpeza de possível código morto identificado na auditoria (protegido, não
   removido, no hotfix): `GET /materials/:id`, `GET /materials/:id/stock`,
   `GET /materials/:id/stock/movements` — nenhum caller encontrado no repo.

## 9. Antes de deploy

- **Não fazer deploy só do backend** sem o frontend (papéis não-owner tomariam 403
  sem o menu/rota filtrados).
- Rodar `npm run migrate:dev` (aplica `0055_rbac.sql`); o seed dos papéis roda no
  boot (`syncRbacCatalog`, idempotente). Antes do seed, papéis não-owner resolvem
  vazio (negam) — `owner` sempre funciona.
