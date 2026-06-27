# Orquestra ERP — SaaS Multi-tenant ERP on AWS

> **Este README é o prompt principal para geração de código por IA.**
> Antes de implementar qualquer funcionalidade, leia este arquivo na íntegra.
> Ele define a fonte da verdade sobre schema, rotas, componentes e convenções.

---

## Protocolo Anti-alucinação (leia primeiro)

Regras que toda IA assistindo este projeto DEVE seguir antes de gerar código:

1. **Nunca inventar tabelas ou colunas.** O schema de banco de dados está documentado neste README e nos arquivos `services/api-core/db/migrations/000N_*.sql`. Tabelas existentes: `tenants`, `users`, `materials`, `material_images`, `inventory`, `inventory_movements`, `clients`, `client_contacts`, `orders`, `order_items`, `invoices`, `invoice_items`, `nfe_configs`, `nfe_events`, `notification_configs`, `receivables`, `receivable_payments`, `payables`, `payable_payments`, `boletos`, `boleto_events`, `service_contracts`, `contract_billings`, `nfse_invoices`, `nfse_events`, `suppliers`, `proposals`, `proposal_items`. Colunas adicionadas em v10.0: `users.password_reset_token`, `users.password_reset_expires`; `receivables.due_notification_sent`; `payables.recurrence`, `payables.recurrence_day`, `payables.recurrence_end_date`, `payables.recurrence_last_generated`, `payables.parent_payable_id`; `notification_configs.notify_receivable_due_days`. Colunas adicionadas em v11.0: `tenants.itau_client_id`, `tenants.itau_client_secret`. Antes de usar qualquer tabela/coluna, confirme que ela existe.

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

13. **Importação em lote: parsear no frontend, enviar JSON.** O padrão do projeto é usar SheetJS (`xlsx`) no browser para converter `.xlsx` em array JSON e enviar para `POST /v1/clients/import` ou `POST /v1/materials/import`. Nunca fazer upload de arquivo binário para o servidor — isso evita adicionar dependência de parser Excel no backend Fastify. O endpoint de importação usa `ON CONFLICT DO NOTHING RETURNING id` para detectar duplicatas sem lançar exceção.

14. **Cálculo de impostos: sempre usar taxEngine.ts (stateless).** O módulo `services/api-core/src/lib/taxEngine.ts` é a fonte da verdade para ICMS, PIS, COFINS de São Paulo. Ele é puro (sem I/O). O endpoint `POST /v1/tax/calculate` delega para ele. O frontend chama esse endpoint e armazena os valores calculados nos campos `icms_*`, `pis_*`, `cofins_*` dos itens antes de salvar a NF-e. ICMS/PIS/COFINS são impostos "por dentro" (embutidos no preço — não aumentam o total). IPI é "por fora" (adicionado ao total). O total da NF-e = subtotal + ipi_total.

15. **Lambda container images: sempre usar `platforms: linux/amd64` + `provenance: false`** nos steps `docker/build-push-action` do CI/CD. Sem isso, Docker Buildx gera um OCI manifest index (manifest list) que o AWS Lambda rejeita com `InvalidParameterValueException: image manifest ... not supported`. Lambda exige Docker Image Manifest V2 Schema 2 single-platform. A api-core (ECS) não precisa dessas flags — apenas as Lambdas.

16. **Nunca definir variáveis reservadas do Lambda runtime em `environment.variables` do Terraform.** O runtime do Lambda injeta automaticamente: `AWS_REGION`, `AWS_DEFAULT_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_LAMBDA_FUNCTION_NAME`, `AWS_LAMBDA_FUNCTION_VERSION`, `AWS_LAMBDA_FUNCTION_MEMORY_SIZE`, `LAMBDA_TASK_ROOT`, `LAMBDA_RUNTIME_DIR`. Tentar definir qualquer uma delas resulta em `InvalidParameterValueException: environment variables contains reserved keys`. O código acessa `process.env.AWS_REGION` normalmente — o valor já está disponível em runtime sem configuração manual.

17. **O arquivo `GaxLogo.tsx` é o logo Orquestra ERP.** O arquivo mantém o nome antigo para não quebrar imports. O componente renderiza a identidade visual Orquestra ERP: arco 270° com gradiente `#3B5CE4→#00B4D8`, nó central, dois braços com pontos, wordmark "Orquestra" + subtítulo "ERP". **Não recriar nem renomear o arquivo.** Tamanhos: `sm=28`, `md=36`, `lg=48`, `xl=64`, `xxl=88` (px de altura). Na LoginPage: hero usa `size="xxl"`, formulário usa `size="xl"`.

18. **Domínio público: `orquestraerp.com.br`.** Route 53 hosted zone provisionada (`terraform/dns.tf`). Aliases CloudFront e certificado ACM (us-east-1) ativados. A URL pública de produção é `https://orquestraerp.com.br`. Nunca usar o domínio `*.cloudfront.net` como URL pública para o usuário final.

19. **Variáveis CSS foram atualizadas para o tema Orquestra ERP.** Paleta atual em `apps/backoffice/src/index.css`: `--primary: #3B5CE4` (azul Orquestra), `--primary-h: #2945C8`, `--accent: #00B4D8` (ciano). Nunca usar cores da identidade anterior (ex: `--primary: #2563eb`). Todas as classes CSS existentes continuam válidas — apenas os valores das variáveis mudaram.

20. **PostgreSQL `ALTER TABLE` multi-coluna: nunca usar parênteses.** A sintaxe `ADD COLUMN (col1 type, col2 type)` é MySQL — o PostgreSQL a rejeita com `syntax error at "("` (código `42601`). A forma correta é uma cláusula `ADD COLUMN` por coluna separada por vírgula, sem parênteses englobante:
    ```sql
    -- ✅ PostgreSQL correto
    ALTER TABLE minha_tabela
      ADD COLUMN coluna1 VARCHAR(10),
      ADD COLUMN coluna2 TEXT,
      ADD COLUMN coluna3 INT NOT NULL DEFAULT 0;
    ```

21. **SSL do Pool pg: nunca usar `ssl: false` quando PGSSLMODE=require está no ambiente.** O `pg` v8 trata `ssl: false` explícito como override absoluto — ignora `PGSSLMODE`. O ECS define `NODE_ENV=prod` (não `"production"`), então qualquer check `=== 'production'` falha silenciosamente. A forma correta é derivar o ssl da variável `PGSSLMODE` diretamente:
    ```typescript
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
    ```

22. **Formulários aninhados (`<form>` dentro de `<form>`) são inválidos em HTML.** O browser descarta a tag `<form>` interna — seus campos viram filhos do form externo e o submit button aciona o handler errado. Sempre usar `<div>` para o container interno e `type="button" onClick={handler}` no botão de submit interno.

23. **Notificações de sistema vs. notificações de tenant.** Existem dois helpers em `services/api-core/src/lib/notificationsClient.ts`:
    - `sendNotificationIfEnabled(payload)` — verifica `notification_configs` do tenant. Usar para eventos de negócio (NF-e, pedido, boleto).
    - `sendSystemNotification(payload)` — envia direto para a fila SQS sem verificar config. Usar para e-mails sistêmicos (boas-vindas, reset de senha, propostas). Tipos disponíveis: `user_welcome`, `password_reset`, `receivable_due_soon`, `proposal_sent`, `proposal_accepted`, `proposal_rejected`. O envio é fire-and-forget; nunca deve bloquear a resposta da API. Quando `NOTIFICATIONS_QUEUE_URL` não está definida, loga `console.warn` e retorna sem enviar. Sempre passar `from_name` explicitamente para e-mails de proposta.

24. **NFS-e vs NF-e: nunca misturar os dois tipos.** NFS-e usa o endpoint Focus `/v2/nfse`, imposto ISS municipal, e requer `inscricao_municipal` + `codigo_servico` (LC 116). NF-e usa `/v2/nfe`, ICMS federal/estadual, e requer NCM/CFOP. Ambos compartilham a mesma fila SQS `nfe-requests` e a mesma Lambda `lambda-fiscal`, discriminados por `type: 'nfse'` na mensagem. Nunca enviar campos de NF-e em uma emissão de NFS-e nem vice-versa.

25. **CEP automático via ViaCEP — nunca criar endpoint backend para isso.** A função `fetchAddressByCEP(cep)` já existe em `apps/backoffice/src/lib/brazil.ts`. Ela chama `https://viacep.com.br/ws/{cep}/json/` diretamente do browser. Nunca criar uma rota `/v1/cep/:cep` no backend.

26. **Workers ECS in-process — nunca criar nova infra AWS para workers.** Workers de polling/agendamento rodam dentro do próprio container `api-core` no ECS, inicializados no hook `onReady` do Fastify. Padrão: `let running = false; while(running) { /* lógica */ await sleep(intervalMs); }`. Nunca criar nova Lambda, Fargate Task, EventBridge Rule, ou Step Function para lógica que pode rodar em-processo no ECS.

27. **Modal de feedback: nunca usar `modal.error()` para exibir sucesso.** O `ModalContext` tem três métodos: `confirm()` (pergunta), `error(err)` (erros com ícone vermelho), e `success(message, title?)` (confirmação com ícone verde). Usar sempre o método semanticamente correto.

28. **lambda-notifications: sempre reimplantar ao adicionar tipos de notificação.** O código do `lambda-notifications` é um container ECR implantado como AWS Lambda. Ao adicionar um novo tipo de notificação, o repositório de container ECR precisa ser reconstruído e o Lambda atualizado com a nova imagem. Sem isso, a mensagem SQS falha e vai ao DLQ.

29. **Focus NF-e: `caminho_danfe` retorna path relativo, não URL absoluta.** A função `toAbsoluteUrl` em `services/lambda-fiscal/src/services/nfeService.ts` e `toDanfeAbsoluteUrl` em `InvoicesPage.tsx` convertem o path relativo para URL absoluta usando `https://api.focusnfe.com.br` (prod) ou `https://homologacao.focusnfe.com.br` (homolog). Nunca exibir ou salvar o path relativo sem conversão.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│  Usuário final (browser)                                        │
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
│                       │  │                        │  │                          │
│  SQS trigger          │  │ SQS trigger            │  │ SQS trigger              │
│  → Focus NF-e API     │  │ → Itaú API v2 OAuth2   │  │ → SESv2 (e-mail HTML)   │
│  → SEFAZ              │  │ → Boleto + PIX          │  │ Templates: welcome,      │
│  → S3 (XML)           │  │ → S3 (PDF boleto)       │  │ reset, nfe, boleto,      │
│  → SQS nfe-results    │  │ → SQS billing-results   │  │ proposta, vencimento     │
└───────────────────────┘  └────────────────────────┘  └──────────────────────────┘

Infraestrutura (Terraform):
  Route 53 (dns.tf) → ACM us-east-1 → CloudFront → NLB → ECS
  ECR: api-core, lambda-fiscal, lambda-billing, lambda-notifications
  SQS: nfe-requests/results, billing-requests/results, notifications, notifications-dlq
  S3: static (SPA), nfe-xml (lifecycle 5 anos), billing-pdf (lifecycle 7 anos)
  RDS: PostgreSQL 16, db.t3.micro, single-AZ, backup 7 dias
  Scheduler (EventBridge): RDS auto-stop 20h→08h seg-sex (dev only)
```

### Stack tecnológico

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18, TypeScript, React Router, SheetJS (XLSX), Vite |
| Backend API | Node 22, Fastify, Drizzle ORM, `@fastify/jwt`, `@fastify/sensible` |
| Banco de dados | PostgreSQL 16 (RDS), Drizzle schema em `src/db/schema.ts` |
| Lambdas | Node 22, Fastify DI, AWS SDK v3, ECR container images |
| Infra | Terraform, GitHub Actions CI/CD, ECS Fargate Spot |
| Fiscal | Focus NF-e API (`api.focusnfe.com.br` / `homologacao.focusnfe.com.br`) |
| E-mail | Amazon SES v2, SQS → lambda-notifications |
| Cobrança | Itaú API v2 OAuth2 `client_credentials` → boleto + PIX |

---

## Diagramas de Fluxo de Negócio

### Contexto de Integração entre Microserviços

```
                              ┌──────────────────────────────────────────────────┐
                              │              USUÁRIO FINAL (browser)              │
                              └────────────────────┬─────────────────────────────┘
                                                   │ HTTPS
                              ┌────────────────────▼─────────────────────────────┐
                              │             CloudFront + S3 (SPA)                 │
                              │   /     → React app (apps/backoffice)             │
                              │   /p/*  → Portal público propostas (sem auth)     │
                              │   /v1/* → NLB → ECS api-core                      │
                              └────────────────────┬─────────────────────────────┘
                                                   │
                    ┌──────────────────────────────▼──────────────────────────────┐
                    │                  ECS api-core (Fastify)                      │
                    │                                                               │
                    │  Publica em SQS:          Consome de SQS (long-poll):        │
                    │  ├─ nfe-requests  ─────▶  ├─ nfe-results (nfeResultsWorker) │
                    │  ├─ billing-requests ──▶  ├─ billing-results (boletoWorker) │
                    │  └─ notifications  ─────▶  └─ (fire-and-forget)             │
                    │                                                               │
                    │  Workers in-process (interval):                               │
                    │  ├─ recurringPayablesWorker (23h)                            │
                    │  └─ dueSoonWorker (23h) → publica em SQS notifications       │
                    │                                                               │
                    │  ─────────────────────────────────────────────────────────── │
                    │  RDS PostgreSQL 16   │   S3 (leitura de logo/assets)         │
                    └──────┬──────────────┴──────────────────────────────────────┘
                           │ SQS triggers (independentes)
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
  ┌────────────────┐ ┌──────────────┐ ┌────────────────────┐
  │ lambda-fiscal  │ │lambda-billing│ │lambda-notifications│
  │                │ │              │ │                    │
  │ Focus NF-e API │ │ Itaú OAuth2  │ │ Amazon SES v2      │
  │ → SEFAZ        │ │ → Boleto PDF │ │ → E-mail HTML      │
  │ → S3 XML       │ │ → S3 PDF     │ │                    │
  │ → SQS results  │ │ → SQS results│ │                    │
  └────────────────┘ └──────────────┘ └────────────────────┘
```

---

### Fluxo de Emissão de NF-e (Nota Fiscal Eletrônica de Produto)

```
  Frontend          api-core            SQS               lambda-fiscal       Focus/SEFAZ
     │                  │                 │                     │                  │
     │ ①POST /invoices  │                 │                     │                  │
     │─────────────────▶│                 │                     │                  │
     │  (cria rascunho) │                 │                     │                  │
     │◀─────────────────│                 │                     │                  │
     │                  │                 │                     │                  │
     │ ②POST /emit      │                 │                     │                  │
     │─────────────────▶│                 │                     │                  │
     │                  │ sendMessage     │                     │                  │
     │                  │────────────────▶│ nfe-requests        │                  │
     │  {status:queued} │                 │                     │                  │
     │◀─────────────────│                 │─── trigger ────────▶│                  │
     │                  │                 │                     │ POST /v2/nfe     │
     │                  │                 │                     │─────────────────▶│
     │                  │                 │                     │                  │→ SEFAZ
     │                  │                 │                     │ {chave, protocolo}│
     │                  │                 │                     │◀─────────────────│
     │                  │                 │                     │ PUT XML → S3     │
     │                  │ nfe-results     │                     │                  │
     │                  │◀────────────────────────────────────── │                  │
     │                  │ UPDATE invoices │                     │                  │
     │                  │ status=authorized                     │                  │
     │                  │ sendNotification(nfe_authorized)      │                  │
     │                  │                 │                     │                  │
     │ ③GET /nfe-status │                 │                     │                  │
     │─────────────────▶│                 │                     │                  │
     │ {status,chave,   │                 │                     │                  │
     │  url_danfe}      │                 │                     │                  │
     │◀─────────────────│                 │                     │                  │

  Status machine: draft ──▶ queued ──▶ processing ──▶ authorized
                                                  └──▶ rejected
                                                  └──▶ error

  Notas:
  · url_danfe = caminho_danfe (path relativo Focus) convertido para URL absoluta
    em lambda-fiscal antes de salvar no DB. Ver regra 29.
  · Em caso de rejected: lambda-fiscal grava motivo em nfe_events (append-only).
  · Cancelamento: POST /v1/invoices/:id/cancel → Focus POST /v2/nfe/:ref/cancela
```

---

### Fluxo de Emissão de NFS-e (Nota Fiscal de Serviços Eletrônica)

```
  Frontend          api-core            SQS               lambda-fiscal       Focus/Prefeitura
     │                  │                 │                     │                   │
     │ ①POST /nfse      │                 │                     │                   │
     │─────────────────▶│                 │                     │                   │
     │  (cria rascunho) │                 │                     │                   │
     │◀─────────────────│                 │                     │                   │
     │                  │                 │                     │                   │
     │ ②POST /emit      │                 │                     │                   │
     │─────────────────▶│                 │                     │                   │
     │                  │ sendMessage     │                     │                   │
     │                  │ {type:'nfse'}  ▶│ nfe-requests        │                   │
     │  {status:queued} │                 │─── trigger ────────▶│                   │
     │◀─────────────────│                 │                     │ POST /v2/nfse     │
     │                  │                 │                     │──────────────────▶│
     │                  │                 │                     │                   │→ Prefeitura
     │                  │                 │                     │ {numero, codigo}  │
     │                  │                 │                     │◀──────────────────│
     │                  │ nfe-results     │                     │                   │
     │                  │◀────────────────────────────────────── │                   │
     │                  │ UPDATE nfse_invoices status=authorized │                   │

  Diferenças NFS-e vs NF-e (regra 24):
  · Endpoint Focus: /v2/nfse (não /v2/nfe)
  · Imposto: ISS municipal (não ICMS/IPI/PIS/COFINS)
  · Campos obrigatórios: inscricao_municipal + codigo_servico (LC 116)
  · Discriminado na mensagem SQS por: { type: 'nfse' }
  · Tabelas: nfse_invoices, nfse_events (separadas de invoices/nfe_events)
```

---

### Fluxo de Pedido de Venda

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                     CICLO DE VIDA DO PEDIDO                              │
  │                                                                           │
  │  ┌────────┐    ┌───────────┐    ┌───────────┐    ┌───────────────────┐   │
  │  │ draft  │───▶│ confirmed │───▶│ delivered │    │ invoiced (NF-e)   │   │
  │  └────────┘    └─────┬─────┘    └─────┬─────┘    └───────────────────┘   │
  │       │              │                 │                   ▲              │
  │       │              ▼                 └───────────────────┘              │
  │       │        ┌──────────┐           (pós-entrega: converte para        │
  │       └───────▶│cancelled │            invoice e emite NF-e)             │
  │                └──────────┘                                               │
  └──────────────────────────────────────────────────────────────────────────┘

  Endpoints por transição:
  · draft     → POST /v1/orders            (cria com itens)
  · confirmed → POST /v1/orders/:id/confirm
  · delivered → POST /v1/orders/:id/deliver
  · invoiced  → POST /v1/invoices (importando pedido) → POST /v1/invoices/:id/emit
  · cancelled → POST /v1/orders/:id/cancel

  Impacto no estoque:
  · confirm: reserva estoque (inventory_movements type='reserve')
  · deliver: baixa estoque  (inventory_movements type='out')
  · cancel:  estorna reserva (inventory_movements type='unreserve')

  Campos de order_items:
  · order_items NÃO tem tenant_id — filtrar SEMPRE via JOIN com orders.tenant_id
```

---

### Fluxo de Emissão de Boleto / PIX

```
  Frontend          api-core            SQS               lambda-billing      Itaú API v2
     │                  │                 │                     │                  │
     │ POST /emit-boleto│                 │                     │                  │
     │─────────────────▶│                 │                     │                  │
     │                  │ sendMessage     │                     │                  │
     │                  │────────────────▶│ billing-requests    │                  │
     │  {status:pending}│                 │─── trigger ────────▶│                  │
     │◀─────────────────│                 │                     │ OAuth2 token     │
     │                  │                 │                     │─────────────────▶│
     │                  │                 │                     │ POST /boletos    │
     │                  │                 │                     │─────────────────▶│
     │                  │                 │                     │ {nosso_numero,   │
     │                  │                 │                     │  linha_digitavel, │
     │                  │                 │                     │  url_pdf}        │
     │                  │                 │                     │◀─────────────────│
     │                  │                 │                     │ PUT PDF → S3     │
     │                  │ billing-results │                     │                  │
     │                  │◀────────────────────────────────────── │                  │
     │                  │ INSERT boleto  │                     │                  │
     │                  │ UPDATE receivable.boleto_id          │                  │
     │                  │                 │                     │                  │
     │ GET /receivables  │                 │                     │                  │
     │─────────────────▶│                 │                     │                  │
     │ {boleto_url,     │                 │                     │                  │
     │  linha_digitavel}│                 │                     │                  │
     │◀─────────────────│                 │                     │                  │

  Cancelamento: POST /v1/receivables/:id/expire-boleto → lambda-billing → Itaú baixa boleto
  Autenticação Itaú: OAuth2 client_credentials com tenants.itau_client_id/secret (migration 0025)
```

---

### Fluxo de Proposta Comercial

```
  Vendedor (backoffice)                   api-core              Cliente (portal público)
          │                                   │                          │
          │ POST /v1/proposals                │                          │
          │ (status: draft)                   │                          │
          │──────────────────────────────────▶│                          │
          │                                   │                          │
          │ POST /v1/proposals/:id/send       │                          │
          │──────────────────────────────────▶│                          │
          │                                   │ sendSystemNotification   │
          │                                   │ (proposal_sent)          │
          │                                   │──── SQS notifications ──▶│ e-mail c/ link
          │  {status: sent}                   │                          │
          │◀──────────────────────────────────│                          │
          │                                   │                          │
          │                                   │ GET /v1/public/proposals/:token
          │                                   │◀─────────────────────────│
          │                                   │  {proposta, itens, ...}  │
          │                                   │─────────────────────────▶│ portal /p/:token
          │                                   │                          │
          │                                   │ POST /token/accept       │ (cliente aceita)
          │                                   │◀─────────────────────────│
          │                                   │ status = accepted        │
          │                                   │ sendSystemNotification(proposal_accepted)
          │◀──────────────────── e-mail ──────│                          │
          │                                   │                          │
          │ POST /v1/proposals/:id/convert    │                          │
          │──────────────────────────────────▶│                          │
          │ (gera pedido de venda)            │ INSERT orders + items    │
          │◀──────────────────────────────────│                          │

  Status machine:
  draft ──▶ sent ──▶ viewed ──▶ accepted ──▶ (convert para order)
                           └──▶ rejected
                           └──▶ expired (duração configurável)
                           └──▶ cancelled

  Impressão: GET /p/:token (portal público) tem botão "Imprimir/Salvar PDF"
             que chama window.print(). CSS @media print oculta .print-hide.
```

---

### Fluxo de Notificações por E-mail

```
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                      DOIS TIPOS DE NOTIFICAÇÃO                                │
  ├────────────────────────────────┬─────────────────────────────────────────────┤
  │  sendNotificationIfEnabled()   │  sendSystemNotification()                    │
  │  (eventos de negócio)          │  (e-mails sistêmicos)                         │
  │                                │                                               │
  │  Verifica notification_configs │  Envia direto — sem verificar config          │
  │  do tenant antes de enviar     │                                               │
  │                                │  Tipos:                                       │
  │  Tipos:                        │  · user_welcome   (novo usuário)              │
  │  · nfe_authorized              │  · password_reset (reset de senha)            │
  │  · nfe_rejected                │  · proposal_sent  (proposta enviada)          │
  │  · boleto_registered           │  · proposal_accepted                          │
  │  · receivable_due_soon *       │  · proposal_rejected                          │
  │                                │                                               │
  │  * via dueSoonWorker (23h)     │                                               │
  └────────────────────────────────┴─────────────────────────────────────────────┘

  Caminho técnico (ambos os tipos):

  api-core                    SQS                    lambda-notifications      SES v2
     │                          │                            │                    │
     │ sendMessage(payload)     │                            │                    │
     │─────────────────────────▶│ notifications              │                    │
     │  (fire-and-forget)       │─── trigger ───────────────▶│                    │
     │                          │                            │ renderiza HTML     │
     │                          │                            │ template           │
     │                          │                            │ SendEmail ─────────▶
     │                          │                            │                    │→ destinatário
     │                          │                            │                    │

  Regras operacionais:
  · Se NOTIFICATIONS_QUEUE_URL não definida: console.warn + retorna (não lança erro)
  · Envio é fire-and-forget: nunca bloqueia a resposta HTTP da api-core
  · Ao adicionar novo tipo: rebuild obrigatório do container lambda-notifications (regra 28)
  · Falhas de envio vão para SQS DLQ (notifications-dlq) — nunca perdem a mensagem
```

---

## Módulos do sistema

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
| Contas a Pagar | `/payables` | payables, payable_payments |
| Contratos | `/contracts` | service_contracts, contract_billings |
| Fornecedores | `/suppliers` | suppliers |
| Relatórios | `/reports` | receivables (inadimplência), order_items (ranking) |
| Usuários | `/users` | users |
| Minha Empresa | `/company` | tenants, nfe_configs, notification_configs |

---

## Histórico de versões relevantes

### v12.0 — Fluxo de Caixa + Histórico 360° + Relatórios + Impressão de Proposta

> **Fluxo de Caixa Projetado (`GET /v1/dashboard/cashflow`):**
> Novo endpoint agrupa vencimentos de receivables e payables em semanas (próximas 12).
> Retorna `{ weeks: [{ week_start, inflow, outflow, net }], summary }`.
> `DashboardPage` exibe gráfico de barras duplas (verde=a receber, vermelho=a pagar) e
> totais de entrada/saída/saldo projetado.
>
> **Histórico 360° do Cliente (`GET /v1/clients/:id/history`):**
> Novo endpoint retorna os 20 pedidos mais recentes, 20 notas fiscais e 20 contas a receber
> do cliente. `ClientsPage` exibe nova seção "Histórico" no drawer de edição (somente edit mode),
> abaixo da seção de contatos. Carregado via `useEffect([drawerOpen, editing?.id])`.
>
> **Relatórios (`GET /v1/reports/overdue` + `GET /v1/reports/top-products`):**
> Novo arquivo `services/api-core/src/routes/reports.ts` registrado em `app.ts`.
> Nova página `apps/backoffice/src/pages/reports/ReportsPage.tsx` com duas abas:
> - **Inadimplência**: receivables vencidas (status pending/partial, due_date < today)
>   com nome do cliente via LEFT JOIN, dias em atraso, exportação XLSX.
> - **Ranking de Produtos**: top 20 produtos por faturamento com filtro de período (7/30/90/180/365 dias),
>   via `order_items` JOIN `orders` (filtra tenant por orders.tenant_id), exportação XLSX.
> Rota `/reports` adicionada ao `App.tsx`. Nav item + ícone adicionados ao `Layout.tsx`.
>
> **Impressão de Proposta (`window.print()`):**
> Botão "Imprimir / Salvar PDF" adicionado ao `ProposalPublicPage.tsx` (estados `view`,
> `already_accepted`, `already_rejected`). CSS `@media print` adicionado ao `index.css`:
> `.print-hide { display: none }` para ocultar botões e rodapé na impressão.
>
> **i18n:** Chaves `cl.history`, `cl.historyEmpty`, `d.cashflow*`, `nav.reports`, `rep.*`
> adicionadas em `pt-BR.ts` e `en.ts`.
>
> **Protocolo anti-alucinação:** Regra 2 atualizada com novos endpoints; regra 3 atualizada
> com nota sobre padrão de abas com inline styles; regra 29 adicionada (Focus NF-e URL).

### v11.0 — Gestão de Propostas Comerciais + OAuth2 Itaú + Correções

> **Módulo de Propostas Comerciais:** CRUD completo com status machine
> `draft → sent → viewed → accepted | rejected | expired | cancelled`.
> Token público de 64 hex chars para acesso sem login pelo cliente.
> Conversão direta em pedido de venda. Portal público em `/p/:token`.
>
> **OAuth2 Itaú:** `tenants.itau_client_id` + `tenants.itau_client_secret` (migration 0025).
> Campos exibidos na aba Dados Bancários da CompanyPage quando `billing_provider === 'itau'`.
>
> **Correções v11:**
> - `ClientsPage`: interface `Client` não incluía campos de endereço — corrigido.
> - `ProposalsPage`: `modal.error()` era chamado com mensagem de sucesso — corrigido com `modal.success()`.
> - `proposals.ts (send)`: `trade_name` pode ser NULL → usar `COALESCE(trade_name, company_name)`.
> - `notificationsClient`: `NOTIFICATIONS_QUEUE_URL` ausente agora loga `console.warn` em vez de silenciar.
> - `InvoicesPage`: NCM não era populado ao importar pedido — corrigido com `materials.find(...)`.
> - `lambda-fiscal`: `caminho_danfe` convertido para URL absoluta antes de salvar no DB.

### v10.0 — Reset de Senha + XLSX Export + Dashboard KPIs + Contas Recorrentes + Notificações

> **Reset de senha:** `POST /v1/auth/forgot-password` + `POST /v1/auth/reset-password`.
> Migrations: `users.password_reset_token`, `users.password_reset_expires`.
>
> **XLSX export:** Botão "Exportar" client-side (SheetJS) em Receivables, Payables, Invoices, Clients.
>
> **Dashboard KPIs:** `GET /v1/dashboard` com 5 queries paralelas. Cards bento grid + mini bar chart.
>
> **Contas Recorrentes:** `payables.recurrence` (none/weekly/monthly/quarterly/yearly).
> Worker `recurringPayablesWorker.ts` in-process no ECS, intervalo 23h.
>
> **Notificações de Vencimento:** `notification_configs.notify_receivable_due_days`.
> Worker `dueSoonWorker.ts` in-process, envia `receivable_due_soon` via SQS.

---

## Adicionando um novo módulo

Checklist obrigatório ao criar um novo módulo:

1. **Migration SQL** em `services/api-core/db/migrations/00NN_nome.sql`
2. **Schema Drizzle** em `services/api-core/src/db/schema.ts` + export em `src/db/index.ts`
3. **Adicionar migration** ao array em `services/api-core/src/scripts/migrate.ts`
4. **Rota Fastify** em `services/api-core/src/routes/nome.ts`
5. **Registrar rota** em `services/api-core/src/app.ts`
6. **Página React** em `apps/backoffice/src/pages/nome/NomePage.tsx`
7. **Rota React Router** em `apps/backoffice/src/App.tsx`
8. **Nav item + ícone** em `apps/backoffice/src/components/Layout.tsx`
9. **Chaves i18n** em `apps/backoffice/src/i18n/pt-BR.ts` E `en.ts`
10. **Atualizar rule 1** deste README com novas tabelas/colunas
11. **Atualizar rule 2** deste README com novas rotas

### Soft-delete por módulo

| Módulo | Coluna | Valor inativo |
|--------|--------|---------------|
| clients | `is_active` | `false` |
| materials | `is_active` | `false` |
| users | `status` | `'disabled'` |
| suppliers | `is_active` | `false` |
| orders | `status` | `'cancelled'` |
| invoices | `status` | `'cancelled'` |
| receivables | `status` | `'cancelled'` |
| payables | `status` | `'cancelled'` |
| service_contracts | `status` | `'cancelled'` |
| proposals | `status` | `'cancelled'` |
| boleto_events, nfe_events, nfse_events | — | append-only, nunca deletar |

---

## Variáveis de ambiente (ECS task definition)

```
DATABASE_URL          # postgres://user:pass@host:5432/db
PGSSLMODE             # require (ECS) | ausente (local Docker)
JWT_SECRET            # segredo JWT
FOCUS_NFE_TOKEN       # fallback se tenant não tiver token próprio
NOTIFICATIONS_QUEUE_URL  # SQS queue para e-mails
NFE_QUEUE_URL         # SQS nfe-requests
NFE_RESULTS_QUEUE_URL # SQS nfe-results
BILLING_QUEUE_URL     # SQS billing-requests
BILLING_RESULTS_QUEUE_URL # SQS billing-results
NFE_BUCKET            # S3 para XMLs NF-e
APP_URL               # https://www.orquestraerp.com.br (padrão)
NODE_ENV              # prod (ECS) | development (local)
```
