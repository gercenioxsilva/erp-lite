# Orquestra ERP — SaaS Multi-tenant ERP on AWS

> **Este README é o prompt principal para geração de código por IA.**
> Antes de implementar qualquer funcionalidade, leia este arquivo na íntegra.
> Ele define a fonte da verdade sobre schema, rotas, componentes e convenções
> — tanto para o backoffice **web** quanto para o **app mobile Flutter**.

---

## Protocolo Anti-alucinação (leia primeiro)

Regras que toda IA assistindo este projeto DEVE seguir antes de gerar código:

1. **Nunca inventar tabelas ou colunas.** O schema de banco de dados está documentado neste README e nos arquivos `services/api-core/db/migrations/000N_*.sql`. Tabelas existentes: `tenants`, `users`, `materials`, `material_images`, `inventory`, `inventory_movements`, `clients`, `client_contacts`, `orders`, `order_items`, `invoices`, `invoice_items`, `nfe_configs`, `nfe_events`, `notification_configs`, `receivables`, `receivable_payments`, `payables`, `payable_payments`, `boletos`, `boleto_events`, `service_contracts`, `contract_billings`, `nfse_invoices`, `nfse_events`, `suppliers`, `proposals`, `proposal_items`, `cost_centers`, `cost_center_stock`, `cost_center_movements`. Colunas adicionadas em v10.0: `users.password_reset_token`, `users.password_reset_expires`; `receivables.due_notification_sent`; `payables.recurrence`, `payables.recurrence_day`, `payables.recurrence_end_date`, `payables.recurrence_last_generated`, `payables.parent_payable_id`; `notification_configs.notify_receivable_due_days`. Colunas adicionadas em v11.0: `tenants.itau_client_id`, `tenants.itau_client_secret`. Colunas adicionadas em v13.0: `payables.cost_center_id`, `orders.cost_center_id`, `invoices.cost_center_id`, `receivables.cost_center_id`. Antes de usar qualquer tabela/coluna, confirme que ela existe.

2. **Nunca inventar rotas de API.** Todas as rotas autenticadas usam `onRequest: [(fastify as any).authenticate]` e extraem `tenantId` do JWT. Os fluxos de integração entre serviços estão detalhados na seção "Diagramas de Fluxo de Negócio". Rotas existentes:
   - `POST /v1/auth/login` · `POST /v1/auth/register` · `GET /v1/auth/me`
   - `POST /v1/auth/forgot-password` · `POST /v1/auth/reset-password`
   - `GET|POST|PATCH|DELETE /v1/clients(/:id)?` · `POST /v1/clients/import`
   - `GET /v1/clients/:id/contacts` · `POST|PATCH|DELETE /v1/clients/:id/contacts(/:cid)?`
   - `GET /v1/clients/:id/history` — pedidos + notas + recebíveis do cliente (360°)
   - `GET|POST|PATCH /v1/materials(/:id)?` · `POST /v1/materials/import`
   - `GET|POST|PATCH|DELETE /v1/materials/:id/images(/:iid)?`
   - `GET /v1/stock` · `GET /v1/stock/movements` · `GET /v1/stock/alerts`
   - `POST /v1/materials/:id/stock/movements`
   - `GET|POST|PATCH /v1/orders(/:id)?` · `POST /v1/orders/:id/confirm` · `POST /v1/orders/:id/deliver` · `POST /v1/orders/:id/cancel`
   - `GET|POST|PATCH /v1/invoices(/:id)?` · `POST /v1/invoices/:id/emit` · `POST /v1/invoices/:id/cancel`
   - `GET /v1/invoices/:id/nfe-status` · `GET /v1/invoices/:id/events`
   - `POST /v1/tax/calculate`
   - `GET|PUT /v1/nfe-config`
   - `GET|POST|PATCH /v1/nfse(/:id)?` · `POST /v1/nfse/:id/emit`
   - `GET|POST|PATCH|DELETE /v1/receivables(/:id)?` · `POST /v1/receivables/:id/payments` · `DELETE /v1/receivables/:id/payments/:pid`
   - `POST /v1/receivables/:id/emit-boleto` · `POST /v1/receivables/:id/expire-boleto`
   - `GET|POST|PATCH|DELETE /v1/payables(/:id)?` · `POST /v1/payables/:id/payments` · `DELETE /v1/payables/:id/payments/:pid`
   - `GET|POST|PATCH|DELETE /v1/suppliers(/:id)?` · `GET /v1/suppliers/:id/payables`
   - `GET|POST|PATCH /v1/service-contracts(/:id)?` · `POST /v1/service-contracts/:id/billings`
   - `GET|POST|PATCH|DELETE /v1/users(/:id)?`
   - `GET|PATCH /v1/tenant` · `PUT|DELETE /v1/tenant/logo`
   - `GET|POST|PATCH /v1/notification-config`
   - `GET|POST|PATCH|DELETE /v1/proposals(/:id)?`
   - `POST /v1/proposals/:id/send` · `POST /v1/proposals/:id/convert` · `POST /v1/proposals/:id/duplicate` · `POST /v1/proposals/:id/cancel`
   - `GET /v1/public/proposals/:token` · `POST /v1/public/proposals/:token/accept` · `POST /v1/public/proposals/:token/reject`
   - `GET /v1/dashboard` · `GET /v1/dashboard/cashflow` — KPIs + fluxo de caixa projetado (próximas 12 semanas)
   - `GET /v1/reports/overdue` — contas a receber vencidas com nome do cliente
   - `GET /v1/reports/top-products?days=30` — ranking de produtos por faturamento
   - `GET /v1/cost-centers` · `POST /v1/cost-centers` · `GET /v1/cost-centers/active`
   - `GET /v1/cost-centers/:id` · `PATCH /v1/cost-centers/:id` · `DELETE /v1/cost-centers/:id`
   - `GET /v1/cost-centers/:id/stock` · `GET /v1/cost-centers/:id/movements`
   - `POST /v1/cost-centers/:id/entries` · `POST /v1/cost-centers/:id/adjustments`
   - Se uma rota não está nesta lista, ela não existe — crie antes de usar.

3. **Nunca inventar componentes, hooks ou classes CSS.** Os componentes React existentes estão em `apps/backoffice/src/components/` e `apps/backoffice/src/pages/`. As classes CSS existem em `apps/backoffice/src/index.css` — leia o arquivo antes de usar qualquer classe. O padrão de abas nas páginas usa **inline styles** (não classes CSS): `borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent'` — ver `CompanyPage.tsx` como referência.

4. **Nunca usar `tenant_id` do body da requisição em código de produção.** O `tenant_id` vem sempre do JWT (`request.user.tenantId`). A exceção atual (tenant_id no body) é temporária enquanto o auth Lambda não está integrado.

5. **Nunca assumir que uma biblioteca está instalada** sem verificar `package.json`. O projeto usa exatamente o que está declarado em `services/api-core/package.json` e `apps/backoffice/package.json`.

6. **Sempre ler o arquivo antes de editá-lo.** Usar o conteúdo real como base — não o que você imagina que está lá.

7. **Sempre adicionar chaves de i18n nos dois arquivos:** `apps/backoffice/src/i18n/pt-BR.ts` (source of truth para `TKey`) e `apps/backoffice/src/i18n/en.ts` (deve ter todas as mesmas chaves, ou o TypeScript dará erro de compilação).

8. **Nunca deletar fisicamente registros.** Todos os soft-deletes estão documentados por módulo abaixo.

9. **Nunca concatenar strings em SQL.** As rotas usam Drizzle ORM (`db.select/insert/update/transaction`). Para SQL bruto, usar `sql\`... ${valor} ...\`` (tagged template literal do Drizzle — parametrização automática e segura). Nunca interpolar strings diretamente em queries.

10. **Ao adicionar um novo módulo**, seguir o checklist completo da seção "Adicionando um novo módulo".

11. **Nunca carregar dropdowns do drawer em event handlers.** O padrão correto é `useEffect([drawerOpen, tenantId])` com flag de cancelamento. Chamar `loadDropdowns()` de `openCreate()` cria stale-closure que não retenta quando `tenantId` resolve depois. Usar `noValidate` no `<form>` e `role="alert"` no div de erro.

12. **Nunca usar `per_page` acima de 100.** A API impõe `Math.min(per_page, 100)` em todas as rotas de listagem. Valores maiores são silenciosamente truncados para 100.

13. **Importação em lote: parsear no frontend, enviar JSON.** O padrão do projeto é usar SheetJS (`xlsx`) no browser para converter `.xlsx` em array JSON e enviar para `POST /v1/clients/import` ou `POST /v1/materials/import`. Nunca fazer upload de arquivo binário para o servidor.

14. **Cálculo de impostos: sempre usar taxEngine.ts (stateless).** O módulo `services/api-core/src/lib/taxEngine.ts` é a fonte da verdade para ICMS, PIS, COFINS de São Paulo. O frontend chama `POST /v1/tax/calculate` e armazena os valores calculados antes de salvar a NF-e. ICMS/PIS/COFINS são impostos "por dentro". IPI é "por fora". Total NF-e = subtotal + ipi_total.

15. **Lambda container images: sempre usar `platforms: linux/amd64` + `provenance: false`** nos steps `docker/build-push-action` do CI/CD. Sem isso, Docker Buildx gera um manifest list que o AWS Lambda rejeita. Lambda exige Docker Image Manifest V2 Schema 2 single-platform.

16. **Nunca definir variáveis reservadas do Lambda runtime em `environment.variables` do Terraform.** O runtime injeta automaticamente: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, e outras variáveis `AWS_LAMBDA_*`. Tentar definir qualquer uma resulta em `InvalidParameterValueException`.

17. **O arquivo `GaxLogo.tsx` é o logo Orquestra ERP.** O componente renderiza arco 270° com gradiente `#3B5CE4→#00B4D8`, nó central, dois braços com pontos, wordmark "Orquestra" + subtítulo "ERP". **Não recriar nem renomear o arquivo.** Tamanhos: `sm=28`, `md=36`, `lg=48`, `xl=64`, `xxl=88` (px de altura).

18. **Domínio público: `orquestraerp.com.br`.** A URL pública de produção é `https://orquestraerp.com.br`. Nunca usar o domínio `*.cloudfront.net` como URL pública para o usuário final.

19. **Variáveis CSS foram atualizadas para o tema Orquestra ERP.** Paleta atual em `apps/backoffice/src/index.css`: `--primary: #3B5CE4` (azul Orquestra), `--primary-h: #2945C8`, `--accent: #00B4D8` (ciano). Nunca usar cores da identidade anterior.

20. **PostgreSQL `ALTER TABLE` multi-coluna: nunca usar parênteses.** A sintaxe `ADD COLUMN (col1, col2)` é MySQL — o PostgreSQL rejeita com `syntax error at "("`. A forma correta é uma cláusula `ADD COLUMN` por coluna, separadas por vírgula, sem parênteses englobante.

21. **SSL do Pool pg: nunca usar `ssl: false` quando PGSSLMODE=require está no ambiente.** A forma correta: `ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false`.

22. **Formulários aninhados (`<form>` dentro de `<form>`) são inválidos em HTML.** Sempre usar `<div>` para o container interno e `type="button" onClick={handler}` no botão de submit interno.

23. **Notificações de sistema vs. notificações de tenant.** Dois helpers em `services/api-core/src/lib/notificationsClient.ts`: `sendNotificationIfEnabled(payload)` verifica `notification_configs` do tenant (eventos de negócio). `sendSystemNotification(payload)` envia direto sem verificar config (e-mails sistêmicos). Tipos: `user_welcome`, `password_reset`, `receivable_due_soon`, `proposal_sent`, `proposal_accepted`, `proposal_rejected`. Fire-and-forget; nunca bloqueia a resposta da API.

24. **NFS-e vs NF-e: nunca misturar os dois tipos.** NFS-e usa `/v2/nfse`, imposto ISS, requer `inscricao_municipal` + `codigo_servico`. NF-e usa `/v2/nfe`, ICMS federal/estadual, requer NCM/CFOP. Ambos usam a mesma fila SQS e a mesma Lambda, discriminados por `type: 'nfse'`.

25. **CEP automático via ViaCEP — nunca criar endpoint backend para isso.** A função `fetchAddressByCEP(cep)` existe em `apps/backoffice/src/lib/brazil.ts`. Ela chama `https://viacep.com.br/ws/{cep}/json/` direto do browser.

26. **Workers ECS in-process — nunca criar nova infra AWS para workers.** Workers rodam dentro do container `api-core` no ECS, inicializados no hook `onReady` do Fastify.

27. **Modal de feedback: nunca usar `modal.error()` para exibir sucesso.** O `ModalContext` tem três métodos: `confirm()`, `error(err)`, `success(message, title?)`.

28. **lambda-notifications: sempre reimplantar ao adicionar tipos de notificação.** O código é um container ECR. Sem rebuild + redeploy, a mensagem SQS vai ao DLQ.

29. **Focus NF-e: `caminho_danfe` retorna path relativo, não URL absoluta.** Usar `toDanfeAbsoluteUrl` em `InvoicesPage.tsx` para converter. Nunca exibir o path relativo.

30. **Centro de Custo: motor de estoque é server-authoritative.** O serviço `costCenterStock.ts` é a única fonte de verdade para saldo de materiais. Toda escrita usa `SELECT FOR UPDATE` dentro de `db.transaction()`. A chave de idempotência tem formato `${source}:${sourceId}:${materialId}` e é UNIQUE por `(tenant_id, idempotency_key)`. Custo médio ponderado usa `toFixed(4)`. Saldo negativo é bloqueado por padrão (HTTP 422) — override por `allow_negative = true` no centro de custo. O gatilho de saída (OUT) é ativado quando `nfe_status = 'authorized'` pelo `nfeResultsWorker`. O estorno é ativado no cancelamento de NF-e autorizada. Nunca chamar `applyEntry`/`applyExit`/`applyAdjustment` diretamente nas rotas — usar apenas via transação existente no serviço.

31. **App mobile Flutter: nunca criar rotas de API exclusivas para o mobile.** O app consome as mesmas rotas da regra 2. O `tenant_id` vem do JWT Bearer injetado via interceptor Dio. Todas as convenções de negócio (soft-delete, status machines, paginação ≤ 100) se aplicam igualmente ao app.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│  Usuário final (browser / app mobile)                           │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼───────────────────────────────────────┐
│  CloudFront (CDN)                                               │
│  ├─ /           → S3 (React SPA: apps/backoffice build)         │
│  ├─ /p/:token   → S3 (rota pública de propostas, sem auth)      │
│  └─ /v1/*       → NLB → ECS Fargate Spot (api-core)            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  ECS Fargate Spot  —  api-core (Fastify + Drizzle ORM)          │
│                                                                 │
│  Workers in-process (onReady/onClose):                         │
│  ├─ nfeResultsWorker     (SQS long-poll → UPDATE invoices)      │
│  ├─ boletoResultsWorker  (SQS long-poll → UPDATE boletos)       │
│  ├─ contractBillingWorker(SQS long-poll → INSERT billings)      │
│  ├─ recurringPayablesWorker (23h interval → INSERT payables)    │
│  └─ dueSoonWorker        (23h interval → SQS notifications)     │
│                                                                 │
│  → RDS PostgreSQL 16 (SSL PGSSLMODE=require)                   │
│  → SQS: nfe-requests, billing-requests, notifications           │
└─────────────────────────────────────────────────────────────────┘

┌───────────────────────┐  ┌────────────────────────┐  ┌──────────────────────────┐
│  Lambda: lambda-fiscal│  │ Lambda: lambda-billing │  │ Lambda: lambda-notifications│
│  (ECR container)      │  │ (ECR container)        │  │ (ECR container)          │
│  SQS trigger          │  │ SQS trigger            │  │ SQS trigger              │
│  → Focus NF-e API     │  │ → Itaú API v2 OAuth2   │  │ → SESv2 (e-mail HTML)   │
│  → SEFAZ              │  │ → Boleto + PIX          │  │ Templates: welcome,      │
│  → S3 (XML)           │  │ → S3 (PDF boleto)       │  │ reset, nfe, boleto,      │
│  → SQS nfe-results    │  │ → SQS billing-results   │  │ proposta, vencimento     │
└───────────────────────┘  └────────────────────────┘  └──────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  App Mobile Flutter  (apps/mobile)                              │
│  Android & iOS — mesma API REST /v1/* — JWT Bearer              │
└─────────────────────────────────────────────────────────────────┘

Infraestrutura (Terraform):
  Route 53 → ACM us-east-1 → CloudFront → NLB → ECS
  ECR: api-core, lambda-fiscal, lambda-billing, lambda-notifications
  SQS: nfe-requests/results, billing-requests/results, notifications, notifications-dlq
  S3: static (SPA), nfe-xml (lifecycle 5 anos), billing-pdf (lifecycle 7 anos)
  RDS: PostgreSQL 16, db.t3.micro, single-AZ, backup 7 dias
  Scheduler (EventBridge): RDS auto-stop 20h→08h seg-sex (dev only)
```

### Stack tecnológico

| Camada | Tecnologia |
|--------|-----------|
| Frontend Web | React 18, TypeScript, React Router v6, SheetJS (XLSX), Vite |
| App Mobile | Flutter 3.x, Dart 3.x, Riverpod 2.x, Dio, GoRouter |
| Backend API | Node 22, Fastify, Drizzle ORM, `@fastify/jwt`, `@fastify/sensible` |
| Banco de dados | PostgreSQL 16 (RDS), Drizzle schema em `src/db/schema.ts` |
| Lambdas | Node 22, AWS SDK v3, ECR container images |
| Infra | Terraform, GitHub Actions CI/CD, ECS Fargate Spot |
| Fiscal | Focus NF-e API (`api.focusnfe.com.br` / `homologacao.focusnfe.com.br`) |
| E-mail | Amazon SES v2, SQS → lambda-notifications |
| Cobrança | Itaú API v2 OAuth2 `client_credentials` → boleto + PIX |

---

## Diagramas de Fluxo de Negócio

> Os diagramas abaixo usam **Mermaid** e são renderizados automaticamente pelo GitHub.

---

### C4 Level 1 — Contexto do Sistema

```mermaid
C4Context
    title C4 Level 1 — Contexto do Orquestra ERP

    Person(user, "Usuário ERP", "Gestor, vendedor ou financeiro — acessa via browser ou app mobile")
    Person_Ext(client, "Cliente Final", "Recebe proposta comercial por e-mail e acessa o portal público")

    System(erp, "Orquestra ERP", "SaaS multi-tenant: pedidos, NF-e, NFS-e, financeiro, propostas, centros de custo, relatórios")

    System_Ext(focus, "Focus NF-e API", "Gateway fiscal que abstrai SEFAZ (NF-e) e prefeituras (NFS-e)")
    System_Ext(sefaz, "SEFAZ / Prefeitura", "Autoridade fiscal federal/estadual/municipal")
    System_Ext(itau, "Itaú API v2", "Emissão de boleto bancário registrado e PIX via OAuth2")
    System_Ext(ses, "Amazon SES v2", "Relay de e-mail transacional")
    System_Ext(viacep, "ViaCEP", "Consulta de endereço por CEP — chamado direto do browser, sem backend")
    System_Ext(fcm, "Firebase Cloud Messaging", "Push notifications para o app mobile")

    Rel(user, erp, "Opera via browser ou app mobile", "HTTPS")
    Rel(client, erp, "Acessa portal /p/:token", "HTTPS (sem autenticação)")
    Rel(erp, focus, "Emite NF-e e NFS-e", "REST HTTPS")
    Rel(focus, sefaz, "Transmite e autoriza notas", "SOAP/REST HTTPS")
    Rel(erp, itau, "Emite boleto e PIX", "REST HTTPS OAuth2 client_credentials")
    Rel(erp, ses, "Envia e-mails transacionais", "AWS SDK SQS → Lambda → SES")
    Rel(erp, fcm, "Envia push notifications", "Firebase Admin SDK")
    Rel(erp, client, "Notifica por e-mail", "SES")
    Rel(user, viacep, "Consulta CEP (browser direto)", "REST HTTPS")
```

---

### C4 Level 2 — Containers

```mermaid
C4Container
    title C4 Level 2 — Containers do Orquestra ERP

    Person(user, "Usuário ERP", "Opera o backoffice ou o app mobile")
    Person_Ext(client, "Cliente Final", "Acessa portal de propostas")

    Container_Boundary(aws, "AWS Cloud") {
        Container(cdn, "CloudFront + S3 Static", "AWS CDN / S3", "Entrega a SPA e assets. Roteia /v1/* para NLB. Certificado ACM us-east-1")
        Container(spa, "React SPA", "React 18 · TypeScript · Vite", "Backoffice completo + portal público /p/:token")
        Container(mobile, "App Mobile", "Flutter 3.x · Dart 3.x", "Android & iOS — consome API /v1/*. JWT Bearer. Push via FCM")
        Container(api, "api-core", "Node 22 · Fastify · Drizzle ORM · ECS Fargate Spot", "API REST multi-tenant. Workers in-process: nfeResults, boletoResults, recurringPayables, dueSoon")
        ContainerDb(db, "RDS PostgreSQL 16", "PostgreSQL · SSL obrigatório", "Todos os dados isolados por tenant_id. Migrations em db/migrations/")
        ContainerDb(sqs, "SQS Queues", "Amazon SQS", "nfe-requests · nfe-results · billing-requests · billing-results · notifications · notifications-dlq")
        ContainerDb(s3data, "S3 Data Buckets", "Amazon S3", "nfe-xml (lifecycle 5 anos) · billing-pdf (lifecycle 7 anos)")
        Container(lfiscal, "lambda-fiscal", "Node 22 · ECR Container", "Emite NF-e e NFS-e via Focus. Discrimina por {type:'nfse'}. Salva XML no S3")
        Container(lbilling, "lambda-billing", "Node 22 · ECR Container", "Emite boleto/PIX via Itaú OAuth2. Salva PDF no S3")
        Container(lnotif, "lambda-notifications", "Node 22 · ECR Container", "Renderiza templates HTML e envia via SES v2. Rebuild obrigatório ao adicionar tipo")
    }

    System_Ext(focus, "Focus NF-e API", "Gateway fiscal")
    System_Ext(itau, "Itaú API v2", "Boleto + PIX")
    System_Ext(ses, "Amazon SES v2", "Relay de e-mail")
    System_Ext(fcm, "Firebase Cloud Messaging", "Push notifications")

    Rel(user, cdn, "Acessa via browser", "HTTPS")
    Rel(user, mobile, "Acessa via app", "iOS / Android")
    Rel(client, cdn, "Acessa /p/:token", "HTTPS")
    Rel(cdn, spa, "Serve SPA", "S3 origin")
    Rel(cdn, api, "Proxia /v1/*", "HTTPS → NLB → ECS")
    Rel(spa, api, "Chama API autenticada", "REST HTTPS · JWT Bearer")
    Rel(mobile, api, "Chama API autenticada", "REST HTTPS · JWT Bearer")
    Rel(api, db, "Lê e escreve dados", "Drizzle ORM · SSL TCP 5432")
    Rel(api, sqs, "Publica + consome mensagens", "AWS SDK v3")
    Rel(api, fcm, "Push notifications", "Firebase Admin SDK")
    Rel(sqs, lfiscal, "Trigger nfe-requests", "SQS Event Source Mapping")
    Rel(sqs, lbilling, "Trigger billing-requests", "SQS Event Source Mapping")
    Rel(sqs, lnotif, "Trigger notifications", "SQS Event Source Mapping")
    Rel(lfiscal, focus, "POST /v2/nfe ou /v2/nfse", "REST HTTPS")
    Rel(lfiscal, s3data, "Salva XML", "AWS SDK PutObject")
    Rel(lbilling, itau, "OAuth2 token + POST /boletos", "REST HTTPS")
    Rel(lbilling, s3data, "Salva PDF", "AWS SDK PutObject")
    Rel(lnotif, ses, "SendEmail com template HTML", "AWS SDK v3")
```

---

### Emissão de NF-e (Nota Fiscal Eletrônica de Produto)

```mermaid
sequenceDiagram
    actor U as Usuário
    participant F as Frontend (React)
    participant A as api-core (ECS)
    participant Q as SQS nfe-requests
    participant L as lambda-fiscal
    participant FX as Focus NF-e API
    participant SF as SEFAZ
    participant S3
    participant R as SQS nfe-results

    U->>F: Preenche dados da NF-e (itens, NCM, CFOP)
    F->>A: POST /v1/invoices
    A-->>F: 201 {id, status: "draft"}

    U->>F: Clica "Emitir NF-e"
    F->>A: POST /v1/invoices/:id/emit
    A->>Q: sendMessage — payload SPED completo
    A-->>F: 200 {status: "queued"}

    Q-->>L: Trigger SQS Event Source Mapping
    L->>FX: POST /v2/nfe {chave, itens, impostos...}
    FX->>SF: Transmite XML assinado digitalmente
    SF-->>FX: Protocolo de autorização + chave 44 dígitos
    FX-->>L: {status, chave_nfe, caminho_danfe}
    L->>L: toAbsoluteUrl(caminho_danfe) → URL Focus completa
    L->>S3: PutObject — XML da nota (lifecycle 5 anos)
    L->>R: sendMessage — resultado com chave e url_danfe

    Note over A: nfeResultsWorker (long-poll SQS, in-process ECS)
    R-->>A: Mensagem de resultado
    A->>A: UPDATE invoices SET status='authorized', chave_nfe=..., url_danfe=...
    A->>A: Se invoice.cost_center_id → applyExit por item (OUT de estoque)
    A->>A: sendNotificationIfEnabled(nfe_authorized)

    Note over A,R: Status machine: draft → queued → processing → authorized
    Note over A,R: Em caso de erro: status='rejected', motivo em nfe_events (append-only)
```

---

### Emissão de NFS-e (Nota Fiscal de Serviços Eletrônica)

```mermaid
sequenceDiagram
    actor U as Usuário
    participant F as Frontend (React)
    participant A as api-core (ECS)
    participant Q as SQS nfe-requests
    participant L as lambda-fiscal
    participant FX as Focus NF-e API
    participant PF as Prefeitura Municipal

    U->>F: Preenche NFS-e (código serviço LC116, ISS, inscrição municipal)
    F->>A: POST /v1/nfse
    A-->>F: 201 {id, status: "draft"}

    U->>F: Clica "Emitir NFS-e"
    F->>A: POST /v1/nfse/:id/emit
    A->>Q: sendMessage {type:"nfse", inscricao_municipal, codigo_servico, ...}
    A-->>F: 200 {status: "queued"}

    Q-->>L: Trigger SQS Event Source Mapping
    Note over L: Discrimina pelo campo type:'nfse'
    L->>FX: POST /v2/nfse {inscricao_municipal, codigo_servico, iss...}
    FX->>PF: Transmite NFS-e para webservice municipal
    PF-->>FX: {numero_nfse, codigo_verificacao}
    FX-->>L: {numero, status, link_nfse}
    L->>Q: sendMessage (nfe-results) — resultado NFS-e

    Note over A: nfeResultsWorker (mesmo worker, trata ambos)
    Q-->>A: Mensagem de resultado
    A->>A: UPDATE nfse_invoices SET status='authorized', numero_nfse=...

    Note over L,FX: NFS-e vs NF-e — nunca misturar (regra 24)
    Note over L,FX: Endpoint Focus: /v2/nfse (não /v2/nfe)
    Note over L,FX: Imposto: ISS municipal (não ICMS/IPI/PIS/COFINS)
```

---

### Ciclo de Vida do Pedido de Venda

```mermaid
stateDiagram-v2
    direction LR
    [*] --> draft : POST /v1/orders\ncria pedido com itens

    draft --> confirmed : POST /orders/:id/confirm\nreserva estoque\n(inventory_movements type=reserve)

    confirmed --> delivered : POST /orders/:id/deliver\nbaixa estoque\n(inventory_movements type=out)

    delivered --> invoiced : POST /v1/invoices\nimporta pedido\n→ emite NF-e

    draft --> cancelled : POST /orders/:id/cancel
    confirmed --> cancelled : POST /orders/:id/cancel\nestorna reserva\n(type=unreserve)

    invoiced --> [*]
    cancelled --> [*]

    note right of draft
        order_items NÃO tem tenant_id.
        Filtrar SEMPRE via
        JOIN orders ON orders.tenant_id
    end note

    note right of invoiced
        invoices importa os itens do pedido.
        NCM vem de materials.ncm
        via materials.find(m => m.id === item.material_id)
    end note
```

---

### Centro de Custo — Ledger de Materiais

```mermaid
sequenceDiagram
    actor U as Usuário
    participant F as Frontend
    participant A as api-core
    participant CS as costCenterStock.ts
    participant DB as PostgreSQL

    Note over CS,DB: Entrada manual de material
    U->>F: POST /v1/cost-centers/:id/entries {material_id, quantity, unit_cost}
    F->>A: requisição autenticada (JWT)
    A->>CS: applyEntry({source:'manual_entry', materialId, qty, unitCost, ...})
    CS->>DB: BEGIN TRANSACTION
    CS->>DB: SELECT FOR UPDATE → cost_center_stock row (previne race condition)
    CS->>DB: avg = (old_qty*old_avg + qty*unit_cost) / (old_qty+qty) → toFixed(4)
    CS->>DB: INSERT cost_center_movements (idempotency_key UNIQUE — catch 23505)
    CS->>DB: UPSERT cost_center_stock (quantity+, avg_unit_cost)
    CS->>DB: COMMIT
    A-->>F: 201 {movement, stock}

    Note over CS,DB: Saída automática (NF-e autorizada com cost_center_id)
    A->>A: nfeResultsWorker detecta nfe_status='authorized'
    A->>CS: applyExit per item se invoice.cost_center_id != null
    CS->>DB: SELECT FOR UPDATE + verificar saldo
    CS->>DB: HTTP 422 DomainError se qty < 0 e allow_negative=false
    CS->>DB: INSERT movement + UPDATE stock (quantity-) + COMMIT

    Note over CS,DB: Estorno (cancelamento de NF-e autorizada)
    A->>CS: applyEntry({source:'adjustment', sourceId:'cancel:invoiceId'})
    CS->>DB: Reverte as saídas — chave 'adjustment:cancel:id:materialId' é única

    Note over CS,DB: Ajuste manual
    A->>CS: applyAdjustment({costCenterId, materialId, newQty, ...})
    CS->>DB: BEGIN TRANSACTION + SELECT FOR UPDATE (lê saldo DENTRO da tx)
    CS->>DB: delta>0 → applyEntry, delta<0 → applyExit, delta=0 → {skipped:true}
    CS->>DB: COMMIT
```

---

### Emissão de Boleto / PIX (Itaú API v2)

```mermaid
sequenceDiagram
    actor U as Usuário
    participant F as Frontend (React)
    participant A as api-core (ECS)
    participant Q as SQS billing-requests
    participant L as lambda-billing
    participant I as Itaú API v2
    participant S3
    participant R as SQS billing-results

    U->>F: Clica "Emitir Boleto" no recebível
    F->>A: POST /v1/receivables/:id/emit-boleto
    A->>Q: sendMessage — dados do boleto + tenant itau_client_id/secret
    A-->>F: 200 {status: "pending"}

    Q-->>L: Trigger SQS Event Source Mapping
    L->>I: POST /oauth/token (client_credentials)
    I-->>L: {access_token, expires_in}
    L->>I: POST /boletos {nosso_numero, vencimento, sacado, valor...}
    I-->>L: {nosso_numero, linha_digitavel, codigo_barras, url_pdf}
    L->>S3: PutObject — PDF boleto (lifecycle 7 anos)
    L->>R: sendMessage — resultado com linha_digitavel e url_pdf

    Note over A: boletoResultsWorker (long-poll, in-process ECS)
    R-->>A: Mensagem de resultado
    A->>A: INSERT boletos (nosso_numero, linha_digitavel, url_pdf)
    A->>A: UPDATE receivables SET boleto_id=...
    A->>A: sendNotificationIfEnabled(boleto_registered) → e-mail cliente
```

---

### Proposta Comercial — Ciclo Completo

```mermaid
sequenceDiagram
    actor V as Vendedor (backoffice)
    participant A as api-core
    participant Q as SQS notifications
    participant L as lambda-notifications
    participant S as Amazon SES
    actor C as Cliente Final

    V->>A: POST /v1/proposals {itens, validade, cliente}
    A-->>V: 201 {id, token: "64-hex-chars", status: "draft"}

    V->>A: POST /v1/proposals/:id/send
    A->>Q: sendSystemNotification(proposal_sent, from_name, link /p/:token)
    A-->>V: 200 {status: "sent"}

    Q-->>L: Trigger SQS
    L->>S: SendEmail — template proposta com link portal
    S-->>C: E-mail "Você recebeu uma proposta comercial"

    C->>A: GET /v1/public/proposals/:token (sem JWT)
    A-->>C: {proposta, itens, validade, empresa}
    Note over C: Portal /p/:token — React SPA rota pública

    alt Cliente aceita
        C->>A: POST /v1/public/proposals/:token/accept
        A->>A: UPDATE proposals SET status='accepted'
        A->>Q: sendSystemNotification(proposal_accepted)
        V->>A: POST /v1/proposals/:id/convert
        A->>A: INSERT orders + order_items
        A-->>V: 201 {order_id}
    else Cliente rejeita
        C->>A: POST /v1/public/proposals/:token/reject {motivo?}
        A->>A: UPDATE proposals SET status='rejected'
        A->>Q: sendSystemNotification(proposal_rejected)
    end

    Note over V,C: Status machine: draft → sent → viewed → accepted | rejected | expired | cancelled
```

---

### Fluxo de Notificações por E-mail

```mermaid
flowchart TD
    subgraph Triggers["Gatilhos de Notificação"]
        T1["Evento de negócio\nnfe_authorized · boleto_registered · nfe_rejected"]
        T2["Evento sistêmico\nuser_welcome · password_reset\nproposal_sent · proposal_accepted · proposal_rejected"]
        T3["dueSoonWorker\n(23h interval)\nrecebíveis vencendo em N dias"]
    end

    subgraph API["api-core (ECS)"]
        N1["sendNotificationIfEnabled()\nVerifica notification_configs do tenant\nUsar para eventos de negócio"]
        N2["sendSystemNotification()\nEnvia direto, sem verificar config\nFire-and-forget — não bloqueia API"]
    end

    subgraph Queue["Amazon SQS"]
        Q["notifications queue"]
        DLQ["notifications-dlq\nFalhas após retries"]
    end

    subgraph Lambda["lambda-notifications (ECR)"]
        TMP["Seleciona template HTML por tipo\nRebuild ECR obrigatório\nao adicionar novo tipo"]
    end

    SES["Amazon SES v2"]
    DEST["Destinatário\ne-mail HTML renderizado"]

    T1 --> N1
    T2 --> N2
    T3 --> N1
    N1 -->|"Se tenant tem notify habilitado"| Q
    N2 --> Q
    Q --> TMP
    TMP --> SES
    SES --> DEST
    Q -. "falha após 3 retries" .-> DLQ

    style N1 fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
    style N2 fill:#dcfce7,stroke:#22c55e,color:#14532d
    style DLQ fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    style Q fill:#fef9c3,stroke:#ca8a04,color:#713f12
    style TMP fill:#f3e8ff,stroke:#9333ea,color:#4c1d95
```

---

## Módulos do sistema (Web — backoffice)

| Módulo | Rota frontend | Tabelas principais |
|--------|--------------|-------------------|
| Dashboard | `/dashboard` | receivables, payables, invoices, orders |
| Fluxo de Caixa | `/dashboard` (seção) | receivables, payables (groupBy semana) |
| Clientes | `/clients` | clients, client_contacts |
| Histórico 360° | drawer de cliente | orders, invoices, receivables |
| Materiais | `/materials` | materials, material_images |
| Estoque | `/stock` | inventory, inventory_movements |
| Pedidos | `/orders` | orders, order_items |
| Propostas | `/proposals`, `/p/:token` | proposals, proposal_items |
| Notas Fiscais (NF-e) | `/invoices` | invoices, invoice_items, nfe_events |
| NFS-e | `/nfse` | nfse_invoices, nfse_events |
| Contas a Receber | `/receivables` | receivables, receivable_payments, boletos |
| Centro de Custo | `/cost-centers`, `/cost-centers/:id` | cost_centers, cost_center_stock, cost_center_movements |
| Contas a Pagar | `/payables` | payables, payable_payments |
| Contratos | `/contracts` | service_contracts, contract_billings |
| Fornecedores | `/suppliers` | suppliers |
| Relatórios | `/reports` | receivables (inadimplência), order_items (ranking) |
| Usuários | `/users` | users |
| Minha Empresa | `/company` | tenants, nfe_configs, notification_configs |

---

## 📱 App Mobile — Flutter (Android & iOS)

> **Esta seção é o prompt principal para geração do app mobile.**
> O app consome a **mesma API REST** (`/v1/*`) do backoffice web.
> Toda autenticação usa JWT Bearer. Nenhuma rota nova é criada exclusivamente para o mobile
> sem estar documentada na regra 2 acima.

### Localização no monorepo

```
apps/
  backoffice/          # React SPA (web)
  mobile/              # Flutter app — Android & iOS
    lib/
    android/
    ios/
    pubspec.yaml
```

### Stack do App Mobile

| Camada | Pacote | Versão mínima |
|--------|--------|---------------|
| UI framework | Flutter | 3.x (stable) |
| Linguagem | Dart | 3.x |
| State management | Riverpod | 2.x (`@riverpod` annotations) |
| HTTP client | Dio | 5.x |
| Navegação | GoRouter | 14.x |
| Autenticação segura | flutter_secure_storage | 9.x |
| Formulários | flutter_form_builder | 9.x |
| PDF viewer / DANFE | url_launcher | 6.x (abre link Focus no browser) |
| QR Code / Código de barras | mobile_scanner | 5.x |
| Formatação (datas, moeda) | intl | 0.19.x |
| Push notifications | firebase_messaging | 15.x |
| Deep links | app_links | 6.x |
| Compartilhamento | share_plus | 10.x |

### Funcionalidades do App Mobile

| Funcionalidade | Telas | Ações disponíveis |
|---------------|-------|-------------------|
| Login / Auth | Login, Esqueci a senha | Autenticar, redefinir senha, biometria opcional |
| Dashboard | KPIs resumidos | Totais de a receber, a pagar, faturamento |
| Clientes | Lista, Detalhe, Cadastro | Buscar, criar, editar, histórico 360° |
| Materiais | Lista, Detalhe | Buscar, visualizar, escanear código de barras |
| Pedidos | Lista, Detalhe, Criar | Criar, confirmar, entregar, cancelar |
| Notas Fiscais | Lista, Detalhe | Status, abrir DANFE no browser, copiar chave |
| Contas a Receber | Lista, Detalhe | Registrar pagamento, emitir boleto, visualizar linha digitável |
| Contas a Pagar | Lista, Detalhe | Registrar pagamento, visualizar vencimentos |
| Centro de Custo | Lista, Detalhe | Saldo por material, lançar entrada manual |
| Propostas | Lista, Detalhe, Criar | Criar, enviar por e-mail, converter em pedido |
| Fornecedores | Lista, Detalhe | Buscar, ver contas a pagar vinculadas |
| Estoque | Visão geral, Alertas | Saldo atual, alertas de mínimo |

### Regras para IA — App Mobile

As regras abaixo são obrigatórias ao gerar código Flutter para este projeto:

1. **Nunca criar rotas de API exclusivas para o mobile.** O app consome as mesmas rotas da regra 2 do Protocolo Anti-alucinação. Se uma funcionalidade exige uma rota nova, ela deve ser adicionada ao backend e listada na regra 2.

2. **tenant_id sempre vem do JWT.** O app armazena o token JWT no `flutter_secure_storage` e injeta `Authorization: Bearer <token>` em todas as requisições via interceptor do Dio. Nunca passar `tenant_id` como query param ou body explícito.

3. **Todos os valores monetários em BRL.** Usar `NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$')` do pacote `intl`. Nunca exibir valores sem formatação.

4. **Todas as datas no padrão brasileiro.** Usar `DateFormat('dd/MM/yyyy', 'pt_BR')` do pacote `intl`. Datas com horário: `DateFormat('dd/MM/yyyy HH:mm', 'pt_BR')`.

5. **Paleta de cores idêntica ao web.** `primaryColor = Color(0xFF3B5CE4)`, `accentColor = Color(0xFF00B4D8)`, `backgroundColor = Color(0xFFF9FAFB)`. O app deve ter identidade visual consistente com o backoffice.

6. **Soft-delete: nunca deletar fisicamente.** As mesmas regras da tabela "Soft-delete por módulo" se aplicam — o app chama `PATCH` com `is_active: false` ou os endpoints de soft-delete documentados na regra 2.

7. **Paginação: sempre enviar `page` e `per_page`.** Nunca carregar todos os registros de uma vez. Default: `per_page=20`. Implementar scroll infinito (`ListView.builder` + detector de fim de lista).

8. **Erros da API: sempre exibir feedback visível.** Status 422 (DomainError) exibe a mensagem do campo `error`. Status 401 redireciona para o login e limpa o token. Status 5xx exibe "Erro interno — tente novamente".

9. **Nunca definir Widgets dentro do método `build()`.** No Flutter, nunca fazer `Widget card = Container(...)` dentro de `build()`. Extrair sempre como método privado `Widget _buildCard()` ou como classe separada com `StatelessWidget`.

10. **Estado de loading em toda requisição assíncrona.** Toda tela que faz fetch exibe `CircularProgressIndicator` durante o carregamento e trata os estados `loading`, `data` e `error` separadamente (usar `AsyncValue` do Riverpod).

11. **DANFE e PDF de boleto: abrir no browser externo.** Usar `url_launcher` (`launchUrl`) para abrir URLs do Focus NF-e e URLs de PDF do Itaú. Nunca tentar renderizar PDF inline.

12. **Deep link `/p/:token`: redirecionar para tela de proposta no app.** Configurar `app_links` para capturar `orquestraerp.com.br/p/:token` e navegar via GoRouter para `/proposals/public/:token`.

13. **QR Code / código de barras: usar `mobile_scanner`.** Ao escanear em materiais, chamar `GET /v1/materials?search=<codigo>`. Ao escanear boleto, exibir linha digitável para cópia.

14. **Status machines são as mesmas do web.** Orders: `draft → confirmed → delivered → invoiced`. Proposals: `draft → sent → viewed → accepted | rejected | expired | cancelled`. Invoices: `draft → queued → processing → authorized | rejected | cancelled`. Nunca inventar status novos.

### Estrutura de Pastas do Projeto Flutter

```
apps/mobile/
├── lib/
│   ├── core/
│   │   ├── api/
│   │   │   ├── api_client.dart          # Dio + AuthInterceptor (inject JWT)
│   │   │   ├── api_exception.dart       # DomainError, NetworkError, AuthError
│   │   │   └── endpoints.dart           # Constantes de todas as rotas /v1/*
│   │   ├── auth/
│   │   │   ├── auth_repository.dart     # login, logout, me, forgot-password
│   │   │   ├── auth_provider.dart       # @riverpod AuthState
│   │   │   └── secure_storage.dart      # flutter_secure_storage wrapper
│   │   ├── theme/
│   │   │   ├── app_theme.dart           # ThemeData com paleta Orquestra ERP
│   │   │   └── app_colors.dart          # primaryColor #3B5CE4, accent #00B4D8
│   │   ├── i18n/
│   │   │   └── strings_pt_br.dart       # Strings pt-BR (espelha chaves do web)
│   │   ├── widgets/
│   │   │   ├── app_scaffold.dart        # BottomNavigationBar + AppBar padrão
│   │   │   ├── status_badge.dart        # StatusBadge(status: 'authorized')
│   │   │   ├── currency_text.dart       # Exibe valor em R$
│   │   │   ├── loading_overlay.dart     # Overlay durante fetch
│   │   │   ├── error_card.dart          # Card de erro com ação de retry
│   │   │   └── empty_state.dart         # Tela vazia com ícone + ação
│   │   └── utils/
│   │       ├── date_formatter.dart      # dd/MM/yyyy pt-BR
│   │       └── currency_formatter.dart  # NumberFormat.currency pt-BR
│   ├── features/
│   │   ├── auth/
│   │   │   ├── login_page.dart
│   │   │   └── forgot_password_page.dart
│   │   ├── dashboard/
│   │   │   ├── dashboard_page.dart
│   │   │   ├── dashboard_provider.dart
│   │   │   └── kpi_card.dart
│   │   ├── clients/
│   │   │   ├── clients_list_page.dart
│   │   │   ├── client_detail_page.dart
│   │   │   ├── client_form_page.dart
│   │   │   └── clients_provider.dart
│   │   ├── materials/
│   │   │   ├── materials_list_page.dart
│   │   │   ├── material_detail_page.dart
│   │   │   └── materials_provider.dart
│   │   ├── orders/
│   │   │   ├── orders_list_page.dart
│   │   │   ├── order_detail_page.dart
│   │   │   ├── order_create_page.dart
│   │   │   └── orders_provider.dart
│   │   ├── invoices/
│   │   │   ├── invoices_list_page.dart
│   │   │   ├── invoice_detail_page.dart
│   │   │   └── invoices_provider.dart
│   │   ├── receivables/
│   │   │   ├── receivables_list_page.dart
│   │   │   ├── receivable_detail_page.dart
│   │   │   └── receivables_provider.dart
│   │   ├── payables/
│   │   │   ├── payables_list_page.dart
│   │   │   ├── payable_detail_page.dart
│   │   │   └── payables_provider.dart
│   │   ├── cost_centers/
│   │   │   ├── cost_centers_list_page.dart
│   │   │   ├── cost_center_detail_page.dart
│   │   │   ├── cost_center_stock_tab.dart
│   │   │   ├── cost_center_movements_tab.dart
│   │   │   ├── entry_bottom_sheet.dart
│   │   │   └── cost_centers_provider.dart
│   │   ├── proposals/
│   │   │   ├── proposals_list_page.dart
│   │   │   ├── proposal_detail_page.dart
│   │   │   ├── proposal_create_page.dart
│   │   │   └── proposals_provider.dart
│   │   ├── suppliers/
│   │   │   ├── suppliers_list_page.dart
│   │   │   └── supplier_detail_page.dart
│   │   └── stock/
│   │       ├── stock_page.dart
│   │       └── stock_provider.dart
│   ├── router.dart                      # GoRouter — todas as rotas do app
│   └── main.dart                        # ProviderScope + MaterialApp.router
├── android/
├── ios/
└── pubspec.yaml
```

### Autenticação — Fluxo JWT no App

```dart
// core/api/api_client.dart — interceptor de autenticação
class AuthInterceptor extends Interceptor {
  final SecureStorage _storage;
  AuthInterceptor(this._storage);

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    final token = await _storage.readToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401) {
      await _storage.deleteToken();
      router.go('/login');   // GoRouter global
    }
    handler.next(err);
  }
}
```

### Padrão de Provider (Riverpod)

```dart
// features/clients/clients_provider.dart
@riverpod
class ClientsNotifier extends _$ClientsNotifier {
  @override
  Future<ClientsState> build() async => ClientsState.empty();

  Future<void> load({String search = '', int page = 1}) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      final res = await ref.read(apiClientProvider)
          .get('/v1/clients', queryParameters: {
            'search': search, 'page': page, 'per_page': 20,
          });
      return ClientsState.fromJson(res.data);
    });
  }
}
```

### Navegação — GoRouter

```dart
// router.dart
final router = GoRouter(
  initialLocation: '/login',
  redirect: (context, state) {
    final auth = ProviderScope.containerOf(context).read(authProvider);
    final loggedIn = auth.valueOrNull?.token != null;
    final onLogin = state.matchedLocation == '/login';
    if (!loggedIn && !onLogin) return '/login';
    if (loggedIn && onLogin) return '/dashboard';
    return null;
  },
  routes: [
    GoRoute(path: '/login',      builder: (_, __) => const LoginPage()),
    GoRoute(path: '/dashboard',  builder: (_, __) => const DashboardPage()),
    GoRoute(path: '/clients',    builder: (_, __) => const ClientsListPage()),
    GoRoute(path: '/clients/:id', builder: (_, s) => ClientDetailPage(id: s.pathParameters['id']!)),
    GoRoute(path: '/orders',     builder: (_, __) => const OrdersListPage()),
    GoRoute(path: '/orders/:id', builder: (_, s) => OrderDetailPage(id: s.pathParameters['id']!)),
    GoRoute(path: '/invoices',   builder: (_, __) => const InvoicesListPage()),
    GoRoute(path: '/invoices/:id', builder: (_, s) => InvoiceDetailPage(id: s.pathParameters['id']!)),
    GoRoute(path: '/receivables', builder: (_, __) => const ReceivablesListPage()),
    GoRoute(path: '/payables',   builder: (_, __) => const PayablesListPage()),
    GoRoute(path: '/cost-centers', builder: (_, __) => const CostCentersListPage()),
    GoRoute(path: '/cost-centers/:id', builder: (_, s) => CostCenterDetailPage(id: s.pathParameters['id']!)),
    GoRoute(path: '/proposals',  builder: (_, __) => const ProposalsListPage()),
    GoRoute(path: '/proposals/public/:token', builder: (_, s) => ProposalPublicPage(token: s.pathParameters['token']!)),
    GoRoute(path: '/suppliers',  builder: (_, __) => const SuppliersListPage()),
    GoRoute(path: '/stock',      builder: (_, __) => const StockPage()),
    GoRoute(path: '/materials',  builder: (_, __) => const MaterialsListPage()),
  ],
);
```

### Checklist para nova feature mobile

Ao adicionar uma nova funcionalidade ao app Flutter:

1. Confirmar que a rota de API existe na regra 2 deste README
2. Criar `features/<modulo>/` com pages + provider
3. Adicionar rota em `router.dart`
4. Adicionar entry no `app_scaffold.dart` (BottomNav ou Drawer)
5. Adicionar strings em `strings_pt_br.dart`
6. Tratar todos os estados: loading, error, empty, data (usar `AsyncValue`)
7. Testar em Android (emulador API 34+) e iOS (simulator iOS 17+)
8. Verificar scroll e layout em telas estreitas (320dp) e tablets

---

## Histórico de versões relevantes

### v13.0 — Centro de Custo + Design System UI + NF-e/NFS-e UI Redesign

> **Centro de Custo (migrations 0026 + 0027):**
> Novo módulo de controle de materiais por projeto/departamento.
> `cost_centers`: `id`, `tenant_id`, `code VARCHAR(20) UNIQUE(tenant)`, `name`, `description`, `allow_negative BOOL DEFAULT false`, `is_active BOOL DEFAULT true`.
> `cost_center_stock`: saldo materializado por `(cost_center_id, material_id)` — PK composta. Custo médio ponderado `avg_unit_cost NUMERIC(12,4)`.
> `cost_center_movements`: ledger append-only com UNIQUE `(tenant_id, idempotency_key)`. ENUMs: `cc_movement_direction ('in','out')` e `cc_movement_source ('manual_entry','adjustment','payable','order','invoice')`.
>
> **Gatilhos automáticos:**
> - OUT: `nfeResultsWorker` ao detectar `nfe_status='authorized'` com `invoice.cost_center_id` → `applyExit` por item.
> - Estorno: cancelamento de NF-e autorizada com CC → `applyEntry({source:'adjustment', sourceId:'cancel:invoiceId'})` por item.
>
> **Motor de estoque (`costCenterStock.ts`):** `applyEntry`, `applyExit`, `applyAdjustment`. `SELECT FOR UPDATE` em toda escrita. Idempotência via catch-23505 no UNIQUE de `idempotency_key`. `toFixed(4)` para avg. `applyAdjustment` lê o saldo dentro da própria transação. `delta=0` retorna `{skipped:true}`.
>
> **API:** 10 rotas em `costCenters.ts`. `DomainError` (saldo insuficiente) → HTTP 422.
>
> **FK opcional** em payables, orders, invoices, receivables: `cost_center_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL`.
>
> **Frontend web:** `CostCentersPage.tsx` (CRUD list), `CostCenterDetailPage.tsx` (tabs Estoque + Movimentações), `CostCenterDrawers.tsx` (MaterialSelect fora do corpo do componente — evita remount). Dropdown CC + filtro por CC em 5 páginas (Payables, Orders, Invoices, InvoiceNew, Receivables). InvoiceNewPage: aviso amber inline por item quando quantidade excede saldo do CC — advisory, não bloqueia emissão.
>
> **Design System:** Tokens CSS unificados. **NF-e/NFS-e UI Redesign:** Formulários de emissão com novo layout editorial.

### v12.0 — Fluxo de Caixa + Histórico 360° + Relatórios + Impressão de Proposta

> **`GET /v1/dashboard/cashflow`:** Agrupa vencimentos em 12 semanas. `DashboardPage` exibe gráfico de barras duplas.
> **`GET /v1/clients/:id/history`:** 20 pedidos, 20 notas, 20 recebíveis do cliente.
> **Relatórios:** `ReportsPage.tsx` com abas Inadimplência e Ranking de Produtos. Exportação XLSX.
> **Impressão de Proposta:** `window.print()` no portal público.
> **i18n:** Chaves `cl.history`, `d.cashflow*`, `nav.reports`, `rep.*`.

### v11.0 — Gestão de Propostas Comerciais + OAuth2 Itaú

> **Propostas:** Status machine `draft → sent → viewed → accepted | rejected | expired | cancelled`. Token público 64 hex chars. Portal `/p/:token`. Conversão direta em pedido.
> **OAuth2 Itaú:** `tenants.itau_client_id` + `tenants.itau_client_secret` (migration 0025).

### v10.0 — Reset de Senha + XLSX Export + Dashboard KPIs + Contas Recorrentes + Notificações

> **Reset de senha:** `users.password_reset_token` + `users.password_reset_expires`.
> **XLSX export:** SheetJS client-side em Receivables, Payables, Invoices, Clients.
> **Dashboard KPIs:** 5 queries paralelas. Cards bento grid + mini bar chart.
> **Contas Recorrentes:** `payables.recurrence` (none/weekly/monthly/quarterly/yearly). Worker 23h.
> **Notificações de Vencimento:** `notification_configs.notify_receivable_due_days`. `dueSoonWorker.ts`.

---

## Adicionando um novo módulo

### Backend (obrigatório para todos)

1. **Migration SQL** em `services/api-core/db/migrations/00NN_nome.sql`
2. **Schema Drizzle** em `services/api-core/src/db/schema.ts`
3. **Adicionar migration** ao array em `services/api-core/src/scripts/migrate.ts`
4. **Rota Fastify** em `services/api-core/src/routes/nome.ts`
5. **Registrar rota** em `services/api-core/src/app.ts`
6. **Atualizar regra 1** deste README com novas tabelas/colunas
7. **Atualizar regra 2** deste README com novas rotas

### Frontend Web (backoffice)

8. **Página React** em `apps/backoffice/src/pages/nome/NomePage.tsx`
9. **Rota React Router** em `apps/backoffice/src/App.tsx`
10. **Nav item + ícone SVG** em `apps/backoffice/src/components/Layout.tsx`
11. **Chaves i18n** em `apps/backoffice/src/i18n/pt-BR.ts` E `en.ts`
12. **Atualizar tabela "Módulos do sistema"** neste README

### App Mobile Flutter

13. **Feature directory** em `apps/mobile/lib/features/nome/`
14. **Provider** `nome_provider.dart` com `@riverpod`
15. **Telas** `nome_list_page.dart`, `nome_detail_page.dart`, etc.
16. **Rota** em `apps/mobile/lib/router.dart`
17. **Nav entry** em `apps/mobile/lib/core/widgets/app_scaffold.dart`
18. **Strings** em `apps/mobile/lib/core/i18n/strings_pt_br.dart`
19. **Atualizar tabela "Funcionalidades do App Mobile"** neste README

### Soft-delete por módulo

| Módulo | Coluna | Valor inativo |
|--------|--------|---------------|
| clients | `is_active` | `false` |
| materials | `is_active` | `false` |
| users | `status` | `'disabled'` |
| suppliers | `is_active` | `false` |
| cost_centers | `is_active` | `false` |
| orders | `status` | `'cancelled'` |
| invoices | `status` | `'cancelled'` |
| receivables | `status` | `'cancelled'` |
| payables | `status` | `'cancelled'` |
| service_contracts | `status` | `'cancelled'` |
| proposals | `status` | `'cancelled'` |
| boleto_events, nfe_events, nfse_events, cost_center_movements | — | append-only, nunca deletar |

---

## Desenvolvimento local

### Pré-requisitos

- Node.js ≥ 20
- Docker + Docker Compose
- Flutter SDK 3.x (para o app mobile)
- Dart 3.x

### Iniciando o ambiente web

```bash
# 1. Subir infraestrutura local (PostgreSQL 16 + LocalStack SQS/S3/SES)
docker compose up db localstack -d

# 2. Rodar migrations
npm run migrate

# 3. API (porta 3000)
npm run dev:api

# 4. Backoffice web (porta 5173)
npm run dev:backoffice
```

### Iniciando o app mobile

```bash
cd apps/mobile
flutter pub get
flutter run                    # escolhe emulador/dispositivo interativamente
flutter run -d emulator-5554  # Android específico
flutter run -d iPhone          # iOS específico

# Build para produção
flutter build apk --release          # Android
flutter build ios --release          # iOS
```

### Acessos locais

| Serviço | URL |
|---------|-----|
| Backoffice Web | http://localhost:5173 |
| API Core | http://localhost:3000 |
| PostgreSQL | postgresql://erp_lite:erp_lite@localhost:5432/erp_lite |
| LocalStack (SQS/S3/SES) | http://localhost:4566 |
| App Mobile → API (Android emulador) | http://10.0.2.2:3000 |
| App Mobile → API (iOS simulator) | http://localhost:3000 |

---

## Variáveis de ambiente (api-core — ECS task definition)

```
DATABASE_URL              # postgres://user:pass@host:5432/db
PGSSLMODE                 # require (ECS) | ausente (local Docker)
JWT_SECRET                # segredo JWT (mínimo 32 chars em produção)
FOCUS_NFE_TOKEN           # fallback se tenant não tiver token próprio
NOTIFICATIONS_QUEUE_URL   # SQS queue para e-mails
NFE_QUEUE_URL             # SQS nfe-requests
NFE_RESULTS_QUEUE_URL     # SQS nfe-results
BILLING_QUEUE_URL         # SQS billing-requests
BILLING_RESULTS_QUEUE_URL # SQS billing-results
NFE_BUCKET                # S3 para XMLs NF-e
APP_URL                   # https://www.orquestraerp.com.br (padrão)
NODE_ENV                  # prod (ECS) | development (local)
```

## Variáveis de ambiente (app mobile Flutter)

```dart
// apps/mobile/lib/core/api/endpoints.dart
// Configurar via --dart-define na build ou via .env (flutter_dotenv)
const String kApiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000',  // Android emulador aponta para localhost
  // iOS simulator: usar http://localhost:3000
  // Produção: https://orquestraerp.com.br
);
```
