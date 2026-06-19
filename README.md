# GAX ERP — SaaS Multi-tenant ERP on AWS

> **Este README é o prompt principal para geração de código por IA.**
> Antes de implementar qualquer funcionalidade, leia este arquivo na íntegra.
> Ele define a fonte da verdade sobre schema, rotas, componentes e convenções.

---

## Protocolo Anti-alucinação (leia primeiro)

Regras que toda IA assistindo este projeto DEVE seguir antes de gerar código:

1. **Nunca inventar tabelas ou colunas.** O schema de banco de dados está documentado neste README e nos arquivos `services/api-core/db/migrations/000N_*.sql`. Tabelas existentes: `tenants`, `users`, `materials`, `inventory`, `inventory_movements`, `clients`, `orders`, `order_items`, `invoices`, `invoice_items`, `nfe_configs`, `nfe_events`. Antes de usar qualquer tabela/coluna, confirme que ela existe.

2. **Nunca inventar rotas de API.** Todas as rotas existentes estão listadas na seção "API Reference". Se uma rota não está aqui, ela não existe.

3. **Nunca inventar componentes, hooks ou classes CSS.** Os componentes React existentes estão em `apps/backoffice/src/components/` e `apps/backoffice/src/pages/`. As classes CSS existem em `apps/backoffice/src/index.css` — leia o arquivo antes de usar qualquer classe.

4. **Nunca usar `tenant_id` do body da requisição em código de produção.** O `tenant_id` vem sempre do JWT (`request.user.tenantId`). A exceção atual (tenant_id no body) é temporária enquanto o auth Lambda não está integrado.

5. **Nunca assumir que uma biblioteca está instalada** sem verificar `package.json`. O projeto usa exatamente o que está declarado em `services/api-core/package.json` e `apps/backoffice/package.json`.

6. **Sempre ler o arquivo antes de editá-lo.** Usar o conteúdo real como base — não o que você imagina que está lá.

7. **Sempre adicionar chaves de i18n nos dois arquivos:** `apps/backoffice/src/i18n/pt-BR.ts` (source of truth para `TKey`) e `apps/backoffice/src/i18n/en.ts` (deve ter todas as mesmas chaves, ou o TypeScript dará erro de compilação).

8. **Nunca deletar fisicamente registros.** Todos os soft-deletes estão documentados por módulo abaixo.

9. **Nunca concatenar strings em SQL.** Usar sempre `$1, $2, ...` parametrizado.

10. **Ao adicionar um novo módulo**, seguir o checklist completo da seção "Adicionando um novo módulo".

11. **Nunca carregar dropdowns do drawer em event handlers.** O padrão correto é `useEffect([drawerOpen, tenantId])` com flag de cancelamento. Chamar `loadDropdowns()` de `openCreate()` cria stale-closure que não retenta quando `tenantId` resolve depois. Usar `noValidate` no `<form>` e `role="alert"` no div de erro.

12. **Nunca usar `per_page` acima de 100.** A API impõe `Math.min(per_page, 100)` em todas as rotas de listagem. Valores maiores são silenciosamente truncados para 100.

13. **Importação em lote: parsear no frontend, enviar JSON.** O padrão do projeto é usar SheetJS (`xlsx`) no browser para converter `.xlsx` em array JSON e enviar para `POST /v1/clients/import` ou `POST /v1/materials/import`. Nunca fazer upload de arquivo binário para o servidor — isso evita adicionar dependência de parser Excel no backend Fastify. O endpoint de importação usa `ON CONFLICT DO NOTHING RETURNING id` para detectar duplicatas sem lançar exceção.

14. **Cálculo de impostos: sempre usar taxEngine.ts (stateless).** O módulo `services/api-core/src/lib/taxEngine.ts` é a fonte da verdade para ICMS, PIS, COFINS de São Paulo. Ele é puro (sem I/O). O endpoint `POST /v1/tax/calculate` delega para ele. O frontend chama esse endpoint e armazena os valores calculados nos campos `icms_*`, `pis_*`, `cofins_*` dos itens antes de salvar a NF-e. ICMS/PIS/COFINS são impostos "por dentro" (embutidos no preço — não aumentam o total). IPI é "por fora" (adicionado ao total). O total da NF-e = subtotal + ipi_total.

---

## Histórico de Prompts

### v0.1 — Kickoff
> Novo projeto ERP SaaS, multitenant, AWS. Monorepo Fastify + Node + React.
> Lambda para serviços pontuais. Cadastro de clientes com campos: Empresa, CNPJ,
> Endereço, Telefone, Contatos (compras/manutenção/fiscal) com tel e email.
> Campos em inglês para venda global. Banco PostgreSQL.

### v0.2 — Materiais + Docker + AWS
> Adicionar cadastro de materiais para venda de produtos e serviços com estoque.
> Iniciar abordagem para rodar localmente no Docker e estrutura para rodar na AWS
> com menor custo possível. Atualizar README como prompt para IA.

### v0.3 — Backoffice + Auth
> Adicionar tela de login e cadastro básico para rodar localmente. Auth integrada
> no api-core (login/register com bcrypt + JWT). React SPA em apps/backoffice
> com React Router, contexto de auth e páginas: Login, Register, Dashboard, Materials.

### v0.4 — Identidade visual GAX + Módulo Clientes (PJ/PF)
> Empresa se chama GAX. Criar logo moderno para a tela de login. Implementar
> migrations básico para rodar localmente. No cadastro de clientes prever que
> uma empresa pode emitir NF-e para CNPJ e CPF — adicionar campos necessários.

### v0.5 — Globalização pt-BR + CNPJ fix + CI/CD + Users CRUD
> Globalizar todas as labels para português-BR com toggle EN. Corrigir validação
> de CNPJ (peso inicial era n-7, correto é n-8). GitHub Actions CI/CD pipeline.
> CRUD de usuários por tenant com roles. Fix: login case-insensitive + seed script.

### v0.6 — Pedidos de Venda + Notas Fiscais
> Telas de gestão de pedidos (Pedidos de Venda com baixa automática de estoque,
> status: draft→confirmed→invoiced→delivered|cancelled) e Notas Fiscais
> (draft→issued|cancelled, geração sequencial de número por série, vínculo com pedido).
> README reescrito como prompt anti-alucinação com protocolo de uso para IA.

### v0.7 — Deploy AWS end-to-end + Mixed Content fix + i18n completo
> Pipeline CI/CD totalmente funcional na AWS: GitHub Actions → ECR → Terraform →
> ECS Fargate + RDS PostgreSQL 16 + CloudFront/S3. Correções aplicadas durante
> o processo: descrições de security group em ASCII, migrations pós-apply, OAC
> S3 com BucketOwnerEnforced + depends_on, senha RDS auto-gerada via
> `random_password` (charset URL-safe + `urlencode()`), SSL obrigatório no
> PostgreSQL 16, script de migrations compilado (sem ts-node em prod). Fix
> principal: Mixed Content eliminado roteando `/v1/*` pelo CloudFront (HTTPS
> viewer → HTTP ALB interno), unificando o domínio público em HTTPS. Tela de
> cadastro de empresa traduzida para pt-BR via namespace `r.*`.

### v0.9 — Cost optimisation: NLB + Fargate Spot
> Duas mudanças de infra Terraform sem impacto em código de aplicação.
> **NLB substitui ALB**: mesmo custo base ($0.008/hora) mas capacidade-unit 8×
> mais barata (NLCU vs LCU). Para MVP de baixo tráfego, o ALB cobrava LCUs extras
> por avaliação de regras L7; o NLB TCP puro elimina esse overhead.
> **Fargate Spot substitui Fargate regular**: `launch_type = "FARGATE"` substituído
> por `capacity_provider_strategy` com FARGATE_SPOT (peso 4) e FARGATE como fallback
> automático (peso 1). Spot tem ~70% de desconto; ECS faz o failover transparente
> se a capacidade Spot for interrompida.
> CloudWatch log retention reduzido de 30 → 14 dias em prod (sem impacto operacional).
> NLB SG: regra HTTPS 443 removida (CloudFront já termina HTTPS — NLB só precisa de 80).
> Economia estimada: **$9–14/mês** (~$38 → ~$24–29).
> **Nota:** `terraform apply` destrói o ALB e recria como NLB — ~2 min de downtime
> esperado durante o apply. Aceitável para MVP.

### v1.3 — Lambda fiscal NF-e + Focus NF-e async emission
> Novo microserviço `services/lambda-fiscal/` (Node 20, ECR container) responsável por
> emitir NF-e via Focus NF-e REST API de forma assíncrona, com observabilidade via
> X-Ray + CloudWatch e resiliência via SQS DLQ + retry.
>
> **Padrão "full payload no SQS":** `api-core` serializa todos os dados da NF-e
> (`NfeEmitMessage`) na mensagem SQS. O Lambda nunca acessa o RDS — elimina a necessidade
> de NAT Gateway (~$32/mês economizados). Lambda sem VPC → internet pública → Focus NF-e.
>
> **Fluxo:** `POST /v1/invoices/:id/emit` (api-core, 202) →
> SQS `nfe-requests` → Lambda fiscal → Focus NF-e → SEFAZ →
> S3 (XML assinado, lifecycle 5 anos SEFAZ) → SQS `nfe-results` →
> Worker ECS long-poll (15s) → UPDATE invoices + INSERT nfe_events → GET status em tempo real.
>
> **Terraform:** `sqs.tf` (3 filas + DLQ alarm), `s3-nfe.tf` (bucket + lifecycle S3 IA →
> GLACIER_DEEP_ARCHIVE 5 anos), `lambda.tf` (função + event source mapping + CW alarm),
> `ecr.tf` (repo lambda-fiscal), `ecs.tf` + `variables.tf` (novos env vars + focus_nfe_token).
>
> **CI/CD:** step paralelo de build/push `lambda-fiscal` no deploy.yml. Novo GitHub Secret
> `TF_VAR_FOCUS_NFE_TOKEN` necessário (token da conta Focus NF-e — https://focusnfe.com.br).
>
> **Novo banco:** tabela `nfe_configs` (dados do emitente por tenant), colunas NF-e em
> `invoices` (nfe_status, nfe_chave, nfe_protocol, nfe_auth_date, nfe_xml_s3_key, nfe_danfe_url),
> tabela `nfe_events` (audit trail: emissões, cancelamentos, correções).
>
> **Status flow:** `null` → `pending` (emit clicked) → `processing` (Lambda consumiu)
> → `authorized` (SEFAZ aprovou, gera número sequencial NF-e) | `rejected` (SEFAZ rejeitou).

### v1.2 — Cost optimisation: Remove Multi-AZ + RDS auto-stop scheduler (dev)
> Duas mudanças Terraform sem impacto em código de aplicação. Economia total: ~**$19/mês**.
>
> **Remove Multi-AZ (P1):** `multi_az` migrado de `var.environment == "prod"` para a
> nova variável `var.rds_multi_az` (default `false`). Multi-AZ duplica o custo do RDS
> sem benefício real para um MVP — o RPO/RTO do backup diário (7 dias de retenção) é
> suficiente neste estágio. Economia: ~**$11/mês** em prod. Para reativar Multi-AZ quando
> o SLA exigir < 1 min de RTO: `terraform apply -var="rds_multi_az=true"`.
>
> **Scheduler auto-stop dev (P2):** novo arquivo `terraform/scheduler.tf` cria dois
> EventBridge Schedules (non-prod only): para RDS às 20h Brasília (stop) e às 08h Brasília
> (start), segunda a sexta. Reduz horas ativas de 720 → 260 h/mês (~64% menos). Economia:
> ~**$8/mês** no ambiente dev. Fim de semana: DB permanece parado (< limite de 7 dias da AWS
> para stop manual). Para acesso fora do horário:
> `aws rds start-db-instance --db-instance-identifier erp-lite-postgres-dev`
>
> **P3 (Reserved Instances):** ação manual no Console AWS Billing → Reservations.
> Compromisso de 1 ano em `db.t3.micro` = 35–40% de desconto adicional (~$4/mês).
>
> **P4 (Aurora Serverless v2) e P5 (Lambda):** analisados e descartados para este MVP.
> Aurora Serverless v2 com min_capacity=0 é mais caro que RDS t3.micro single-AZ quando
> o sistema fica ativo > 6h/dia. Lambda requer NAT Gateway para DB privado (cancela
> economia) ou tornar o RDS público (risco de segurança). Nenhum dos dois vale para o
> perfil de uso atual.

### v1.1 — Importação de materiais + Motor de cálculo de impostos SP (Avalara-pattern)
> **Importação de materiais:** mesmo padrão da importação de clientes. `POST /v1/materials/import`
> aceita array JSON de até 500 linhas; SKU duplicado → ignorado com `ON CONFLICT DO NOTHING`.
> MaterialsPage recebe botão "↑ Importar" e modal 4-fases igual ao de clientes.
> Modelo de planilha com 12 colunas gerado pelo frontend via SheetJS.
>
> **Motor de impostos SP:** módulo puro `services/api-core/src/lib/taxEngine.ts` com
> `calculateTaxes(TaxTransaction): TaxResult`. Rates: ICMS interno SP 12%; interstate
> SP→SE/Sul/CO 12%, SP→N/NE/ES 7%. PIS/COFINS: Lucro Presumido 0.65%/3.00%, Lucro Real
> 1.65%/7.60%, Simples/MEI 0% (DAS). CST: `00`/`40` (LP/LR), CSOSN `102`/`400` (Simples).
> `POST /v1/tax/calculate` expõe o engine via REST.
> Migration `0008_invoice_taxes.sql`: adiciona `tax_regime`, `origin_state`, `icms_total`,
> `pis_total`, `cofins_total` em `invoices`; adiciona colunas `icms_*`, `pis_*`, `cofins_*`,
> `ipi_*` em `invoice_items` (armazenamento para NF-e).
> InvoicesPage: seletor de regime tributário + UF destino + botão "Calcular Impostos" +
> painel de breakdown fiscal (ICMS/PIS/COFINS embutidos com CST e alíquota).
> Regras 13 e 14 atualizadas no Protocolo Anti-alucinação.

### v1.0 — Importação de clientes via planilha Excel
> Funcionalidade de importação em lote no módulo de Clientes.
> Estratégia: parsing do `.xlsx` no browser via SheetJS (`xlsx` 0.18.x) — sem upload de
> arquivo no servidor. O frontend converte as linhas em JSON e envia para o novo endpoint
> `POST /v1/clients/import` (máx 500 linhas). O backend processa linha a linha, com
> `ON CONFLICT DO NOTHING` para ignorar duplicados (CNPJ/CPF já cadastrados) sem
> interromper o restante. Retorna `{ imported, skipped, errors: [{ row, message }] }`.
> Frontend: botão "↑ Importar" no page-header da ClientsPage. Modal centralizado com
> 4 fases: `idle` (layout das colunas + download do modelo) → `preview` (tabela com
> N linhas encontradas) → `importing` (spinner) → `done` (resultado por linha).
> Modelo de planilha com 23 colunas gerado pelo próprio frontend via SheetJS.
> Regra 13 adicionada ao Protocolo Anti-alucinação.

### v0.8 — Fix dropdowns OrdersPage + InvoicesPage + testes unitários
> Causa raiz dos dropdowns vazios em ambas as telas: `loadDropdowns()` era chamado
> de event handlers com guarda `ddLoading` que impedia retentativas quando `tenantId`
> resolvia depois da abertura do drawer. Fix: substituído por `useEffect([drawerOpen,
> tenantId])` com flag de cancelamento e erros surfaced em `formError` (nenhum `catch`
> silencioso). `per_page` corrigido para 100 (limite da API). `noValidate` adicionado
> ao `<form>` para que a validação JS rode em vez da validação nativa do browser.
> InvoicesPage adicional: o filtro `status=confirmed` no dropdown de pedidos impedia
> vincular pedidos em rascunho; substituído por todos os pedidos não-cancelados/entregues.
> `handleOrderChange` agora limpa cliente e itens ao desselecionar um pedido.
> Infra de testes: Vitest + React Testing Library + 23 testes unitários para OrdersPage
> cobrindo lista, drawer/formulário, gerenciamento de itens e submissão (sucesso + erro).

---

## Visão Geral

**GAX Enterprise** é um ERP SaaS multi-tenant construído em Node.js/Fastify,
com frontend React (identidade visual GAX), banco PostgreSQL, deployado na AWS
com custo mínimo.

**Modelo multi-tenant:** shared database, shared schema — todas as tabelas ERP
carregam `tenant_id`. O `tenant_id` é sempre extraído do JWT (nunca do body da
requisição), garantindo isolamento por camada de aplicação.

---

## Diagramas de Arquitetura

### Contexto (C4 Nível 1)

```mermaid
flowchart LR
    saas_admin(["SaaS Admin\n(Operações internas)"])
    tenant_user(["Usuário do Tenant\n(Funcionário da empresa)"])

    subgraph erp["GAX ERP  ·  SaaS Multi-tenant"]
        direction TB
        backoffice["Backoffice\nReact SPA  :5173"]
        api_core["API Core\nFastify / ECS  :3000"]
        fiscal_lambda["Lambda  fiscal (NF-e)"]
        notif_lambda["Lambda  notifications"]
        db[("PostgreSQL\nRDS")]
        sqs[["SQS"]]
    end

    sefaz(["SEFAZ\nNF-e"])
    meta(["Meta\nWhatsApp"])
    ses(["AWS SES\nEmail"])

    saas_admin -- gerencia tenants --> backoffice
    tenant_user -- usa o ERP --> backoffice
    backoffice -- REST API --> api_core
    api_core -- queries --> db
    api_core -- enfileira eventos --> sqs
    sqs --> fiscal_lambda
    sqs --> notif_lambda
    fiscal_lambda -- XML/SOAP --> sefaz
    notif_lambda --> meta
    notif_lambda --> ses
```

### Infraestrutura AWS

```mermaid
flowchart TD
    internet(("Internet"))
    internet -->|HTTPS| cf["CloudFront\n/v1/* → NLB  /  /* → S3"]
    cf -->|HTTP /v1/*| alb["Network Load Balancer\n(TCP 80 — Layer 4)"]

    subgraph vpc["VPC  10.0.0.0/16"]
        direction TB
        subgraph pub["Subnets Públicas  ·  AZ-a / AZ-b"]
            ecs["ECS Fargate Spot\napi-core\n256 vCPU · 512 MB\nassign_public_ip = true"]
        end
        subgraph priv["Subnets Privadas  ·  AZ-a / AZ-b"]
            rds[("RDS PostgreSQL 16\ndev: db.t3.micro\nprod: db.t3.small")]
        end
    end

    subgraph async["Async — sem VPC (internet nativa)"]
        direction LR
        sqs_req["SQS nfe-requests\nVT=300s · DLQ após 3×"]
        lambda["Lambda fiscal-nfe\nNode 20 · 512MB · 270s\nconcurrency=5 · X-Ray"]
        sqs_res["SQS nfe-results\nlong-poll 15s"]
    end

    ecr["ECR\napi-core + lambda-fiscal"]
    s3_nfe["S3 nfe-xmls\nLifecycle 5 anos\n(obrigação SEFAZ)"]
    s3_ui["S3 backoffice\n+ CloudFront"]
    cw["CloudWatch\nLogs + Alarms"]
    focus["Focus NF-e\n(REST API)"]
    sefaz(["SEFAZ"])
    eb["EventBridge\nScheduler\n(RDS stop/start dev)"]

    alb --> ecs
    ecs --> rds
    ecs -->|SendMessage| sqs_req
    ecs -->|long-poll ReceiveMessage| sqs_res
    sqs_req -->|trigger batch=1| lambda
    lambda -->|HTTPS| focus
    focus <-->|XML/SOAP| sefaz
    lambda -->|PutObject| s3_nfe
    lambda -->|SendMessage| sqs_res
    ecr -.->|image pull| ecs
    ecr -.->|image pull| lambda
    ecs -.->|logs| cw
    lambda -.->|traces+logs| cw
    eb -.->|stop 20h / start 8h| rds
```

> **Sem NAT Gateway:** ECS tasks ficam em subnet pública com `assign_public_ip = true`.
> Lambda fiscal opera fora da VPC — acessa internet (Focus NF-e), S3 e SQS nativamente.
> Economia: ~$30/mês vs abordagem com NAT Gateway.
> **Fargate Spot:** ECS service usa `capacity_provider_strategy` com FARGATE_SPOT (peso 4)
> e FARGATE como fallback automático (peso 1). Spot tem ~70% de desconto.
> **NLB:** substitui o ALB para cortar custo de LCU. Camada 4 (TCP) — sem features L7.
> **Single-AZ RDS:** `rds_multi_az = false` por padrão. Economia: ~$11/mês.
> **Scheduler dev:** EventBridge para parar o RDS às 20h e iniciar às 8h (seg–sex, Brasília).
> Dev RDS fica ativo ~260 h/mês em vez de 720 h. Economia: ~$8/mês no ambiente dev.
> **Lambda concurrency=5:** previne sobrecarga do Focus NF-e / SEFAZ em bursts.
> **DLQ alarm:** qualquer mensagem na nfe-dlq (3 falhas) dispara alarme CloudWatch.

### Sequência — Emissão NF-e Async

```mermaid
sequenceDiagram
    actor User as Usuário
    participant FE as Backoffice (React)
    participant API as api-core (ECS Fastify)
    participant DB as PostgreSQL (RDS)
    participant SQS_REQ as SQS nfe-requests
    participant Lambda as lambda-fiscal (Fastify DI)
    participant Focus as Focus NF-e (REST)
    participant SEFAZ as SEFAZ
    participant S3 as S3 nfe-xmls
    participant SQS_RES as SQS nfe-results

    User->>FE: Clica "Emitir NF-e"
    FE->>API: POST /v1/invoices/:id/emit

    API->>DB: SELECT invoice + items + client + nfe_config
    API->>DB: UPDATE nfe_status = 'pending'
    API->>SQS_REQ: SendMessage (NfeEmitMessage — payload completo)
    API->>DB: UPDATE nfe_status = 'processing'
    API-->>FE: 202 Accepted { nfe_status: 'processing' }

    Note over Lambda: Cold start: buildApp() → plugins → app.ready()
    SQS_REQ-->>Lambda: trigger (batch_size=1)
    Lambda->>Focus: POST /v2/nfe?ref={invoice_id}
    Focus->>SEFAZ: XML v4.0 + A1 cert (Focus gerencia)
    SEFAZ-->>Focus: autorizado | denegado

    alt autorizado
        Focus-->>Lambda: { status: 'autorizado', chave_nfe, numero_protocolo }
        Lambda->>Focus: GET /v2/nfe/{ref}/xml
        Focus-->>Lambda: XML assinado pela SEFAZ
        Lambda->>S3: PutObject (tenant_id/ano/invoice_id.xml, SSE-AES256)
        Lambda->>SQS_RES: SendMessage { nfe_status: 'authorized', nfe_chave, xml_s3_key }
    else rejeitado / erro
        Focus-->>Lambda: { status: 'rejeitado', erros: [...] }
        Lambda->>SQS_RES: SendMessage { nfe_status: 'rejected', nfe_reject_reason }
    end

    Note over API: Worker long-poll (WaitTimeSeconds=15)
    SQS_RES-->>API: ReceiveMessage (nfeResultsWorker.ts)

    alt authorized
        API->>DB: UPDATE invoices SET status='issued', nfe_status='authorized',<br/>number=MAX+1, nfe_chave, nfe_protocol, nfe_auth_date, nfe_xml_s3_key
        API->>DB: INSERT nfe_events (event_type='emission', payload)
    else rejected
        API->>DB: UPDATE invoices SET nfe_status='rejected', nfe_reject_reason
        API->>DB: INSERT nfe_events (event_type='emission', payload)
    end

    FE->>API: GET /v1/invoices/:id/nfe (polling)
    API-->>FE: { nfe_status, nfe_chave, nfe_danfe_url, ... }
```

---

## Stack Tecnológica

| Camada | Tecnologia | Versão | Justificativa |
|--------|-----------|--------|---------------|
| API HTTP | Node.js + Fastify + TypeScript | 20 / 4.x / 5.x | Alto throughput, schemas JSON nativos, plugin system |
| Lambda | Fastify como DI + pino + TypeScript | 4.x / 5.x | Mesmo modelo de plugins do api-core, sem HTTP listen |
| Banco | PostgreSQL | 16 (RDS) | ACID, UUID nativo, triggers |
| Frontend | React + Vite + TypeScript | 18 / 5.x / 5.x | SPA com proxy de API |
| Auth | bcryptjs (salt 12) + @fastify/jwt (HS256 24h) | — | Stateless |
| NF-e | Focus NF-e REST API | v2 | XML 4.0 + cert A1 + SEFAZ gerenciados pelo provider |
| i18n | Context API customizado | — | pt-BR padrão, EN toggle |
| Infra | Terraform + ECS Fargate | ≥ 1.5 | IaC reproduzível |
| CI/CD | GitHub Actions | — | Build ECR (api-core + lambda-fiscal) → Terraform → Migrate |

---

## Princípios de Arquitetura

### Abordagem: DDD tático + Clean Architecture (adaptada para monolito modular)

Este projeto segue os princípios de **Domain-Driven Design (DDD)** tático e
**Clean Architecture** adaptados para a escala de um MVP. A estratégia é um
monolito modular (não distribuído) com fronteiras de domínio bem definidas.
À medida que a carga escala, cada módulo pode ser extraído para um serviço
independente sem reescrever a lógica de negócios.

#### Camadas (de dentro para fora)

```
Domain          ← Entidades, Value Objects, regras de negócio puras (sem I/O)
  │
Application     ← Casos de uso, orquestração, chamadas de porta (sem frameworks)
  │
Infrastructure  ← Implementações: Postgres (pg), SQS, S3, Focus NF-e, Fastify
  │
Interface       ← Rotas HTTP Fastify, Workers SQS, Lambda handlers
```

**No código atual, o mapeamento é:**

| Camada | Localização |
|--------|-------------|
| **Domain** | `src/lib/taxEngine.ts` (cálculo de impostos — puro, sem I/O). Value Objects: campos `cnpj`, `cpf`, `nfe_chave` como VARCHAR com invariantes verificadas em SQL (CHECK). |
| **Application** | Lógica de orquestração dentro das rotas Fastify (ex: `nfe.ts` — validação de pré-condições, sequência emit → mark pending → SQS → mark processing) e `nfeResultsWorker.ts` (poll → process → update). |
| **Infrastructure** | `src/db/pool.ts` (pg.Pool), `src/lib/sqsClient.ts` (SQSClient singleton), `services/lambda-fiscal/src/focusNfe.ts` (adaptador Focus NF-e REST). |
| **Interface** | `src/routes/*.ts` (Fastify plugins), `src/workers/*.ts` (SQS long-poll), `services/lambda-fiscal/src/handler.ts` (Lambda handler). |

#### Padrões aplicados

**Fastify Plugin Architecture (api-core):** cada módulo de domínio (`clients`, `orders`, `invoices`, `nfe`) é um `FastifyPluginAsync` independente, registrado com prefixo em `app.ts`. Isso garante encapsulamento e permite testar cada plugin isoladamente.

**Fastify como DI Container (lambda-fiscal):** a Lambda não usa HTTP, então não chama `app.listen()`. O Fastify é usado como container de injeção de dependências e logger (pino JSON estruturado, compatível com CloudWatch Logs Insights). Padrão de inicialização: `app.register()` sem await (todos os plugins enfileirados), seguido de um único `await app.ready()` que inicializa a cadeia na ordem correta via `fp() + dependencies[]`. O handler mantém o app como **singleton** entre warm invocations: `buildApp()` roda apenas no cold start; invocações subsequentes reusam `app.config`, `app.sqs`, `app.s3` e o cache `Map<1|2, FocusNfeClient>` sem re-inicializar. Resultado: mesmo modelo de plugins/decorators do `api-core`, zero boilerplate duplicado, cold start mínimo.

**Soft Delete:** nenhuma entidade de negócio é deletada fisicamente. O estado é alterado (`is_active=false`, `status='cancelled'`) — preserva auditoria e permite restauração.

**Snapshots em itens de pedido/NF-e:** `order_items` e `invoice_items` armazenam snapshots de nome, preço e SKU no momento da transação. Isso garante que alterações futuras no cadastro de materiais não corrompam registros históricos.

**Imutabilidade de movimentos:** `inventory_movements` e `nfe_events` são append-only. Nunca atualizados — apenas inseridos.

**Full payload no SQS (anti-chatty pattern):** `api-core` serializa o payload completo da NF-e na mensagem SQS. O Lambda fiscal nunca precisa consultar o RDS — elimina dependência de VPC e NAT Gateway.

**Idempotência na emissão:** a rota `POST /emit` usa uma guarda de estado (`nfe_status` NOT IN `pending`, `processing`) antes de enfileirar. Se o SQS falhar após o UPDATE, o status é revertido. O worker só processa mensagens onde `nfe_status='processing'`.

**Boundary de domínio via módulos npm:** cada serviço (`api-core`, `lambda-fiscal`) é um workspace npm independente com seu próprio `package.json`. Eles não compartilham código em runtime — apenas tipos se necessário.

#### Convenções Fastify (não inventar outros padrões)

```typescript
// ✅ Correto — Plugin Fastify com prefixo
export const minhaRotas: FastifyPluginAsync = async (fastify) => {
  fastify.get('/rota', { schema: { ... } }, async (req, reply) => { ... });
};
// Registro em app.ts:
await app.register(minhaRotas, { prefix: '/v1' });

// ✅ Autenticação — tenant_id SEMPRE do JWT
const tenantId = request.user.tenantId; // nunca do body

// ✅ Transações para operações compostas
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // múltiplas queries...
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}

// ✅ Erros — lançar com fastify.httpErrors (via @fastify/sensible)
throw fastify.httpErrors.notFound('Invoice not found');
throw fastify.httpErrors.badRequest('Invoice already processing');
```

#### Convenções de domínio

- **Tenant isolation:** `tenant_id` em toda tabela ERP. Query sempre inclui `AND tenant_id = $N`.
- **UUID PKs:** gerados pelo PostgreSQL com `gen_random_uuid()`. Nunca pelo cliente.
- **Datas:** sempre `TIMESTAMPTZ` no banco. Datas de negócio (ex: issue_date) como `DATE`.
- **Dinheiro:** `DECIMAL(15,2)` — nunca `FLOAT`. Impostos calculados em JS e armazenados para NF-e.
- **Estado de máquina:** status de entidades seguem máquinas de estado explícitas documentadas neste README. O backend valida transições — o frontend nunca altera status diretamente.
- **Worker lifecycle:** workers SQS (ECS) usam flag `running` para graceful shutdown via `onClose` hook do Fastify.

---

## Estrutura do Projeto (fonte da verdade)

```
erp-lite/
├── docker-compose.yml              ← ambiente local completo
├── package.json                    ← monorepo npm workspaces
│
├── services/api-core/              ← ECS Fargate — API Fastify
│   ├── Dockerfile                  ← multi-stage: development | builder | production
│   ├── package.json                ← deps: fastify, @fastify/jwt, @fastify/sensible,
│   │                                        @fastify/cors, bcryptjs, pg
│   ├── src/
│   │   ├── index.ts                ← entry point (porta 3000)
│   │   ├── app.ts                  ← Fastify factory + registro de rotas
│   │   ├── config.ts               ← variáveis de ambiente
│   │   ├── db/pool.ts              ← pg.Pool singleton
│   │   ├── lib/
│   │   │   ├── taxEngine.ts        ← motor de cálculo de impostos SP (puro, sem I/O)
│   │   │   └── sqsClient.ts        ← SQSClient singleton (lazy init)
│   │   ├── routes/
│   │   │   ├── auth.ts             ← POST /v1/auth/login|register, GET /v1/auth/me
│   │   │   ├── customers.ts        ← CRUD /v1/customers (tenants SaaS)
│   │   │   ├── materials.ts        ← CRUD /v1/materials + import + /v1/stock/*
│   │   │   ├── clients.ts          ← CRUD /v1/clients (PJ/PF — NF-e ready) + import
│   │   │   ├── users.ts            ← CRUD /v1/users (por tenant)
│   │   │   ├── orders.ts           ← CRUD /v1/orders + confirm/deliver/cancel
│   │   │   ├── invoices.ts         ← CRUD /v1/invoices + issue/cancel (c/ tax values)
│   │   │   ├── tax.ts              ← POST /v1/tax/calculate
│   │   │   └── nfe.ts              ← NF-e config + emit + status (Focus NF-e / SEFAZ)
│   │   ├── workers/
│   │   │   └── nfeResultsWorker.ts ← SQS long-poll: consome nfe-results → UPDATE invoices
│   │   └── scripts/
│   │       ├── migrate.ts          ← runner de migrations SQL (executa em ordem)
│   │       └── seed.ts             ← cria usuário admin para dev local
│   └── db/migrations/
│       ├── 0001_tenants.sql
│       ├── 0002_users.sql
│       ├── 0003_materials.sql
│       ├── 0004_inventory.sql
│       ├── 0005_clients.sql
│       ├── 0006_orders.sql         ← orders + order_items
│       ├── 0007_invoices.sql       ← invoices + invoice_items
│       ├── 0008_invoice_taxes.sql  ← colunas de impostos em invoices + invoice_items
│       └── 0009_nfe.sql            ← nfe_configs + colunas NF-e em invoices + nfe_events
│
├── services/lambda-fiscal/         ← Lambda — emissão async NF-e via Focus NF-e
│   ├── Dockerfile                  ← multi-stage Node 20 (public.ecr.aws/lambda/nodejs:20)
│   ├── package.json                ← deps: fastify, fastify-plugin, @aws-sdk/*, axios
│   ├── tsconfig.json
│   └── src/
│       ├── app.ts                  ← Fastify factory (sem listen) — container de DI
│       ├── handler.ts              ← SQSHandler: singleton app, loop com batchItemFailures
│       ├── plugins/
│       │   ├── config.ts           ← app.config (env vars validados via app.decorate)
│       │   ├── aws.ts              ← app.sqs + app.s3 (SQSClient / S3Client decorators)
│       │   └── focusNfe.ts         ← app.getFocusClient(ambiente) — cache por ambiente
│       ├── services/
│       │   └── nfeService.ts       ← processRecord: camada de aplicação (usa app.*)
│       └── lib/
│           ├── focusNfe.ts         ← FocusNfeClient class + buildFocusPayload (puro, sem I/O)
│           └── types.ts            ← NfeEmitMessage, NfeItem, NfePagamento, NfeResultMessage
│
├── apps/backoffice/                ← React + Vite SPA
│   ├── vite.config.ts              ← proxy /v1/* e /health → api-core:3000
│   ├── src/
│   │   ├── main.tsx                ← bootstrap React
│   │   ├── App.tsx                 ← BrowserRouter + rotas guardadas
│   │   ├── index.css               ← design system completo (classes abaixo)
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx     ← login/register/logout + estado global
│   │   ├── components/
│   │   │   ├── Layout.tsx          ← sidebar com navegação
│   │   │   └── GaxLogo.tsx         ← logo GAX
│   │   ├── i18n/
│   │   │   ├── index.tsx           ← I18nProvider + useI18n() hook
│   │   │   ├── pt-BR.ts            ← SOURCE OF TRUTH para TKey (tipo derivado aqui)
│   │   │   └── en.ts               ← Record<TKey, string> — deve ter TODOS os keys
│   │   ├── lib/
│   │   │   ├── api.ts              ← fetch wrapper (ApiError com status HTTP)
│   │   │   └── brazil.ts           ← maskCNPJ, isValidCNPJ, digits (CPF/CNPJ)
│   │   └── pages/
│   │       ├── LoginPage.tsx
│   │       ├── RegisterPage.tsx
│   │       ├── DashboardPage.tsx
│   │       ├── clients/ClientsPage.tsx
│   │       ├── materials/MaterialsPage.tsx
│   │       ├── users/UsersPage.tsx
│   │       ├── orders/OrdersPage.tsx
│   │       └── invoices/InvoicesPage.tsx
│
└── terraform/
    ├── variables.tf  main.tf  security.tf  rds.tf  ecs.tf  ecr.tf  static.tf  outputs.tf
    ├── secrets.tf    ← random_password para RDS (charset URL-safe, armazenado no estado S3)
    ├── scheduler.tf  ← EventBridge Schedules (RDS stop 20h / start 8h, non-prod)
    ├── sqs.tf        ← 3 filas NF-e (nfe-dlq, nfe-requests, nfe-results) + alarm DLQ
    ├── s3-nfe.tf     ← bucket XMLs NF-e + lifecycle S3 IA → GLACIER_DEEP_ARCHIVE (5 anos)
    └── lambda.tf     ← Lambda fiscal-nfe + event source mapping SQS + alarm de erros
```

---

## Schema do Banco de Dados (fonte da verdade)

### Convenções
- UUID PKs com `gen_random_uuid()`
- `created_at / updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` em todas as tabelas
- `updated_at` atualizado via trigger `update_updated_at()` definido em `0001_tenants.sql`
- `tenant_id UUID NOT NULL REFERENCES tenants(id)` em toda tabela ERP
- Soft-delete: `is_active = false` (materials, clients) ou `status = 'disabled'` (users) ou `status = 'cancelled'` (orders, invoices)
- Nunca deletar fisicamente registros ERP

### `tenants`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| company_name | VARCHAR(255) NOT NULL | Razão social |
| trade_name | VARCHAR(255) | Nome fantasia |
| tax_id | VARCHAR(50) NOT NULL | CNPJ / EIN / VAT |
| tax_id_type | VARCHAR(10) NOT NULL | `CNPJ`\|`EIN`\|`VAT`\|`OTHER` |
| street..country | VARCHAR | Endereço completo |
| purchasing/maintenance/fiscal _contact_* | VARCHAR | 3 contatos × nome/tel/email |
| status | VARCHAR(20) | `trial`\|`active`\|`suspended`\|`cancelled` |
| plan | VARCHAR(30) | `starter`\|`professional`\|`enterprise` |
| trial_ends_at | TIMESTAMPTZ | |
| **UNIQUE** | (tax_id, tax_id_type) | |

### `users`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| tenant_id | UUID FK → tenants | |
| email | VARCHAR(255) | Único por tenant. Armazenado em lowercase |
| name | VARCHAR(255) NOT NULL | |
| password_hash | TEXT NOT NULL | bcrypt salt=12 |
| role | VARCHAR(20) | `owner`\|`admin`\|`manager`\|`user` |
| status | VARCHAR(20) | `active`\|`disabled` |
| **UNIQUE** | (tenant_id, email) | |

### `materials`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| tenant_id | UUID FK | |
| sku | VARCHAR(100) NOT NULL | **UNIQUE** (tenant_id, sku) |
| name | VARCHAR(255) NOT NULL | |
| description | TEXT | |
| type | VARCHAR(20) | `product`\|`service`\|`raw_material`\|`asset` |
| category / brand / unit | VARCHAR | unit padrão `UN` |
| sale_price / cost_price | DECIMAL(15,2) | |
| ncm_code | VARCHAR(10) | NCM brasileiro |
| tax_group | VARCHAR(50) | Uso futuro (módulo fiscal) |
| weight_kg | DECIMAL(10,3) | |
| is_active | BOOLEAN DEFAULT true | Soft-delete |
| tracks_inventory | BOOLEAN DEFAULT true | false para serviços |

### `inventory`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| tenant_id | UUID FK | |
| material_id | UUID FK → materials | **UNIQUE** (tenant_id, material_id) |
| quantity | DECIMAL(15,3) DEFAULT 0 | Estoque atual |
| min_qty / max_qty | DECIMAL(15,3) | Alertas e reposição |

### `inventory_movements` (imutável — nunca deletar)
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| tenant_id | UUID FK | |
| material_id | UUID FK → materials | |
| movement_type | VARCHAR(20) | `in`\|`out`\|`adjustment`\|`return`\|`transfer` |
| quantity | DECIMAL(15,3) | Delta (positivo) |
| quantity_before / quantity_after | DECIMAL(15,3) | Snapshot |
| reason | TEXT | Texto livre |
| reference_id | UUID | ID do pedido, NF etc. |
| reference_type | VARCHAR(50) | `order`\|`invoice`\|`adjustment` |
| created_by | UUID FK → users | |
| created_at | TIMESTAMPTZ | |

### `clients`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| tenant_id | UUID FK | |
| person_type | VARCHAR(2) | `PJ`\|`PF` |
| **PJ** | company_name NOT NULL, trade_name, cnpj (14 dígitos), state_reg, municipal_reg, suframa | |
| **PF** | full_name NOT NULL, cpf (11 dígitos), birth_date, rg, rg_issuer | |
| email / phone / mobile | VARCHAR | |
| zip_code..country | VARCHAR | Endereço |
| icms_taxpayer | CHAR(1) | `1`=Contribuinte `2`=Isento `9`=Não Contribuinte |
| consumer_type | CHAR(1) | `0`=B2B `1`=B2C (PF sempre `1`) |
| is_active | BOOLEAN | Soft-delete |
| **UNIQUE** | (tenant_id, cnpj), (tenant_id, cpf) | |

### `orders` *(migration: 0006_orders.sql)*
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| tenant_id | UUID FK → tenants | |
| client_id | UUID FK → clients | |
| number | VARCHAR(20) NOT NULL | Sequencial por tenant, formato `00001` |
| status | VARCHAR(20) | `draft`→`confirmed`→`invoiced`→`delivered`\|`cancelled` |
| notes | TEXT | |
| subtotal | DECIMAL(15,2) | Soma dos itens |
| discount | DECIMAL(15,2) DEFAULT 0 | |
| shipping | DECIMAL(15,2) DEFAULT 0 | |
| total | DECIMAL(15,2) | subtotal − discount + shipping |
| created_by | UUID FK → users ON DELETE SET NULL | |
| **UNIQUE** | (tenant_id, number) | |

**Fluxo de status:**
- `draft` → `confirmed`: baixa automática de estoque via `inventory_movements` (type=`out`, reference_type=`order`)
- `confirmed`/`invoiced` → `delivered`: apenas atualiza status
- `confirmed`/`invoiced` → `cancelled`: restaura estoque via `inventory_movements` (type=`return`)
- `draft` → `cancelled`: sem alteração de estoque

### `order_items` *(migration: 0006_orders.sql)*
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| order_id | UUID FK → orders ON DELETE CASCADE | |
| material_id | UUID FK → materials ON DELETE RESTRICT | Nullable (item livre) |
| name | VARCHAR(255) NOT NULL | **Snapshot** do nome no momento do pedido |
| sku / unit | VARCHAR | Snapshots |
| quantity | DECIMAL(15,3) CHECK > 0 | |
| unit_price | DECIMAL(15,2) CHECK >= 0 | **Snapshot** do preço no momento |
| total | DECIMAL(15,2) | quantity × unit_price |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | Usado para ordenação dos itens |

### `invoices` *(migrations: 0007_invoices.sql + 0008_invoice_taxes.sql)*
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| tenant_id | UUID FK → tenants | |
| order_id | UUID FK → orders ON DELETE SET NULL | Nullable |
| client_id | UUID FK → clients | |
| number | VARCHAR(20) DEFAULT '' | Atribuído ao emitir (sequencial por tenant+serie) |
| serie | VARCHAR(10) DEFAULT '1' | Série da NF-e |
| status | VARCHAR(20) | `draft`→`issued`\|`cancelled` |
| issue_date | DATE | Atribuído ao emitir (CURRENT_DATE) |
| subtotal | DECIMAL(15,2) | Soma dos itens (impostos embutidos — PIS/COFINS/ICMS "por dentro") |
| tax_total | DECIMAL(15,2) DEFAULT 0 | ICMS + PIS + COFINS (informacional; já embutidos no subtotal) |
| total | DECIMAL(15,2) | subtotal + IPI (IPI é "por fora"); = subtotal se IPI = 0 |
| notes | TEXT | |
| xml_url / pdf_url | TEXT | URLs futuras (integração SEFAZ) |
| tax_regime | VARCHAR(30) DEFAULT 'lucro_presumido' | `lucro_presumido`\|`lucro_real`\|`simples_nacional`\|`mei` |
| origin_state | CHAR(2) DEFAULT 'SP' | UF do emitente |
| icms_total / pis_total / cofins_total | DECIMAL(15,2) DEFAULT 0 | Breakdown por imposto |

**Fluxo de status:**
- `draft` → `issued`: gera número sequencial (MAX(number) + 1 por tenant+serie, filtrado em `status='issued'`), seta `issue_date = CURRENT_DATE`, marca pedido vinculado como `invoiced`
- `issued` → `cancelled`: reverte pedido para `confirmed` se não houver outra NF-e `issued` vinculada

### `invoice_items` *(migrations: 0007_invoices.sql + 0008_invoice_taxes.sql)*
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| invoice_id | UUID FK → invoices ON DELETE CASCADE | |
| material_id | UUID FK → materials | Nullable |
| name | VARCHAR(255) NOT NULL | Snapshot |
| ncm_code | VARCHAR(20) | Código NCM |
| cfop | VARCHAR(10) | Código CFOP |
| quantity | DECIMAL(15,3) CHECK > 0 | |
| unit_price | DECIMAL(15,2) CHECK >= 0 | |
| total | DECIMAL(15,2) | quantity × unit_price |
| icms_cst | VARCHAR(3) | CST `00`/`40` ou CSOSN `102`/`400` (Simples) |
| icms_base / icms_rate / icms_value | DECIMAL | Base, alíquota %, valor ICMS |
| pis_cst | VARCHAR(2) | CST `01` (tributada) ou `07` (Simples/MEI) |
| pis_base / pis_rate / pis_value | DECIMAL | |
| cofins_cst | VARCHAR(2) | CST `01` ou `70` (Simples/MEI) |
| cofins_base / cofins_rate / cofins_value | DECIMAL | |
| ipi_rate / ipi_value | DECIMAL | IPI "por fora" (adicionado ao total da NF-e) |

### `nfe_configs` *(migration: 0009_nfe.sql)*
Dados do emitente por tenant — necessários para compor a NF-e. Um registro por tenant.
| Campo | Tipo | Notas |
|-------|------|-------|
| tenant_id | UUID PK FK → tenants ON DELETE CASCADE | |
| cnpj | VARCHAR(14) NOT NULL | 14 dígitos, sem máscara |
| razao_social | VARCHAR(255) NOT NULL | |
| regime_tributario | SMALLINT | `1`=Simples `2`=Lucro Presumido `3`=Lucro Real |
| logradouro | VARCHAR(255) | |
| numero | VARCHAR(20) | |
| complemento | VARCHAR(100) | |
| bairro | VARCHAR(100) | |
| municipio | VARCHAR(100) DEFAULT 'SAO PAULO' | |
| uf | CHAR(2) DEFAULT 'SP' | |
| cep | VARCHAR(8) | 8 dígitos sem hífen |
| telefone | VARCHAR(20) | |
| email | VARCHAR(255) | |
| cfop_padrao | VARCHAR(10) DEFAULT '5102' | CFOP intraestadual (mesmo UF) |
| cfop_interestadual | VARCHAR(10) DEFAULT '6102' | CFOP interestadual (outro UF) |
| natureza_operacao | VARCHAR(60) DEFAULT 'Venda de mercadoria' | |
| focus_ambiente | SMALLINT DEFAULT 2 | `1`=Produção `2`=Homologação |

### `invoices` — colunas adicionadas pela migration 0009_nfe.sql
| Campo | Tipo | Notas |
|-------|------|-------|
| nfe_status | VARCHAR(30) | `null`\|`pending`\|`processing`\|`authorized`\|`rejected`\|`cancellation_pending`\|`cancelled_sefaz` |
| nfe_chave | CHAR(44) | Chave de acesso SEFAZ (44 dígitos) |
| nfe_protocol | VARCHAR(20) | Número do protocolo SEFAZ |
| nfe_auth_date | TIMESTAMPTZ | Data/hora de autorização SEFAZ |
| nfe_reject_reason | TEXT | Motivo de rejeição (quando rejected) |
| nfe_attempts | SMALLINT DEFAULT 0 | Contador de tentativas (para observabilidade) |
| nfe_xml_s3_key | TEXT | Chave S3 do XML assinado (para download) |
| nfe_danfe_url | TEXT | URL DANFE gerada pela Focus NF-e |

### `nfe_events` *(migration: 0009_nfe.sql)*
Audit trail imutável de todas as operações NF-e. Nunca deletar.
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| invoice_id | UUID FK → invoices | |
| tenant_id | UUID FK → tenants | |
| event_type | VARCHAR(30) | `emission`, `cancellation`, `correction_letter` |
| status_code | VARCHAR(10) | Código de status SEFAZ |
| protocol | VARCHAR(20) | Número do protocolo |
| payload | JSONB | Resposta completa da SEFAZ / Focus NF-e |
| created_at | TIMESTAMPTZ | |

---

## API Reference (fonte da verdade)

Base URL local: `http://localhost:3001`
Base URL prod:  `https://<CF_DOMAIN>` (ver `terraform output api_url` — CloudFront roteia `/v1/*` para o ALB)

> Todas as rotas retornam JSON. Erros seguem o formato Fastify Sensible:
> `{ statusCode, error, message }`.

### Auth
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/v1/auth/register` | Criar tenant + usuário owner (retorna JWT) |
| POST | `/v1/auth/login` | Login — email normalizado para lowercase+trim |
| GET  | `/v1/auth/me` | Usuário autenticado (requer Bearer) |

### Clients (PJ/PF)
| Método | Rota | Descrição |
|--------|------|-----------|
| POST   | `/v1/clients` | Criar PJ ou PF |
| GET    | `/v1/clients?tenant_id=&person_type=&search=&page=&per_page=` | Listar |
| GET    | `/v1/clients/:id` | Buscar |
| PATCH  | `/v1/clients/:id` | Atualizar |
| DELETE | `/v1/clients/:id` | Soft delete (is_active=false) |
| POST   | `/v1/clients/import` | Importação em lote via planilha (máx 500 linhas) |

**Body de importação:**
```json
{
  "tenant_id": "uuid",
  "clients": [
    {
      "person_type": "PJ",
      "company_name": "ACME Ltda",
      "cnpj": "11444777000161",
      "email": "contato@acme.com.br",
      "city": "São Paulo",
      "state": "SP"
    }
  ]
}
```
**Response:** `{ "imported": N, "skipped": N, "errors": [{ "row": 2, "message": "..." }] }`
- Duplicados (CNPJ/CPF já cadastrado no tenant) são ignorados automaticamente — não falham a importação.
- Erros de validação retornam por linha, sem interromper as demais.
- O frontend parseia o `.xlsx` no browser (SheetJS) e envia JSON — sem upload de arquivo no servidor.

### Materials + Stock
| Método | Rota | Descrição |
|--------|------|-----------|
| POST   | `/v1/materials` | Criar (cria `inventory` se tracks_inventory=true) |
| GET    | `/v1/materials?tenant_id=&type=&search=&page=&per_page=` | Listar |
| GET    | `/v1/materials/:id` | Buscar |
| PATCH  | `/v1/materials/:id` | Atualizar |
| DELETE | `/v1/materials/:id` | Soft delete (is_active=false) |
| POST   | `/v1/materials/import` | Importação em lote via planilha (máx 500 linhas) |
| GET    | `/v1/materials/:id/stock` | Estoque atual |
| POST   | `/v1/materials/:id/stock/movements` | Registrar movimento |
| GET    | `/v1/materials/:id/stock/movements` | Histórico |
| GET    | `/v1/stock/alerts?tenant_id=` | Materiais abaixo do mínimo |

**Body de importação de materiais:**
```json
{
  "tenant_id": "uuid",
  "materials": [
    { "sku": "PROD-001", "nome": "Parafuso M6", "tipo": "product",
      "unidade": "UN", "preco_venda": 29.90, "preco_custo": 15.00,
      "ncm": "7318.15.00", "controla_estoque": "SIM" }
  ]
}
```
**Response:** `{ "imported": N, "skipped": N, "errors": [{ "row": 2, "message": "..." }] }`
- SKU duplicado por tenant → ignorado. Cria linha `inventory` se `controla_estoque=SIM`.

### Users
| Método | Rota | Descrição |
|--------|------|-----------|
| GET    | `/v1/users?tenant_id=&search=&page=&per_page=` | Listar |
| POST   | `/v1/users` | Criar usuário |
| PATCH  | `/v1/users/:id` | Atualizar (name, role, status, password) |
| DELETE | `/v1/users/:id` | Soft delete (status='disabled') |

### Orders (Pedidos de Venda)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET    | `/v1/orders?tenant_id=&status=&search=&page=&per_page=` | Listar |
| POST   | `/v1/orders` | Criar pedido em rascunho com itens |
| GET    | `/v1/orders/:id` | Pedido + itens + dados do cliente |
| PATCH  | `/v1/orders/:id` | Editar (apenas status=draft) |
| POST   | `/v1/orders/:id/confirm` | Confirmar → baixa estoque |
| POST   | `/v1/orders/:id/deliver` | Marcar como entregue |
| POST   | `/v1/orders/:id/cancel` | Cancelar → restaura estoque se confirmado |

**Body de criação/edição:**
```json
{
  "tenant_id": "uuid",
  "client_id": "uuid",
  "notes": "string|null",
  "discount": 0,
  "shipping": 0,
  "items": [
    { "material_id": "uuid|null", "name": "string", "sku": "string|null",
      "unit": "UN", "quantity": 1, "unit_price": 99.90, "notes": "string|null" }
  ]
}
```

### Invoices (Notas Fiscais)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET    | `/v1/invoices?tenant_id=&status=&search=&page=&per_page=` | Listar |
| POST   | `/v1/invoices` | Criar NF-e (rascunho) |
| GET    | `/v1/invoices/:id` | NF-e + itens + pedido vinculado |
| POST   | `/v1/invoices/:id/issue` | Emitir → gera número sequencial + data |
| POST   | `/v1/invoices/:id/cancel` | Cancelar |

**Body de criação:**
```json
{
  "tenant_id": "uuid",
  "client_id": "uuid",
  "order_id": "uuid|null",
  "serie": "1",
  "notes": "string|null",
  "tax_regime": "lucro_presumido",
  "origin_state": "SP",
  "items": [
    { "material_id": "uuid|null", "name": "string",
      "ncm_code": "0000.00.00", "cfop": "5102",
      "quantity": 1, "unit_price": 99.90,
      "icms_cst": "00", "icms_base": 99.90, "icms_rate": 12, "icms_value": 11.99,
      "pis_cst": "01",  "pis_base":  99.90, "pis_rate":  0.65, "pis_value": 0.65,
      "cofins_cst": "01", "cofins_base": 99.90, "cofins_rate": 3.00, "cofins_value": 3.00,
      "ipi_rate": 0, "ipi_value": 0 }
  ]
}
```
- Campos de impostos são opcionais (default 0). O frontend deve calcular via `POST /v1/tax/calculate` antes de salvar.

### Tax (Cálculo de Impostos — São Paulo)
| Método | Rota | Descrição |
|--------|------|-----------|
| POST   | `/v1/tax/calculate` | Calcular ICMS/PIS/COFINS/IPI para SP (stateless) |

**Body:**
```json
{
  "origin_state": "SP",
  "destination_state": "SP",
  "tax_regime": "lucro_presumido",
  "lines": [
    { "ncm_code": "7318.15.00", "quantity": 10, "unit_price": 29.90, "ipi_rate": 0 }
  ]
}
```
**Response:**
```json
{
  "lines": [{
    "subtotal": 299.00,
    "icms_cst": "00", "icms_base": 299.00, "icms_rate": 12, "icms_value": 35.88,
    "pis_cst": "01",  "pis_base": 299.00,  "pis_rate": 0.65, "pis_value": 1.94,
    "cofins_cst": "01", "cofins_base": 299.00, "cofins_rate": 3.00, "cofins_value": 8.97,
    "ipi_base": 299.00, "ipi_rate": 0, "ipi_value": 0,
    "embedded_tax_total": 46.79, "line_total": 299.00
  }],
  "totals": { "subtotal": 299.00, "icms_total": 35.88, "pis_total": 1.94,
               "cofins_total": 8.97, "ipi_total": 0, "embedded_tax_total": 46.79, "grand_total": 299.00 },
  "applied_rates": { "icms": 12, "pis": 0.65, "cofins": 3.00 },
  "tax_regime": "lucro_presumido", "origin_state": "SP", "destination_state": "SP"
}
```
- ICMS/PIS/COFINS são "por dentro" — `grand_total = subtotal + ipi_total`
- ICMS SP→SP ou SP→MG/RJ/PR/SC/RS/GO/MS/MT/DF: 12%. SP→N/NE/ES: 7%
- Simples Nacional / MEI: ICMS 0% (CSOSN `102`/`400`), PIS/COFINS 0% (CST `07`/`70`)

### NF-e — Configuração e Emissão SEFAZ
| Método | Rota | Descrição |
|--------|------|-----------|
| GET  | `/v1/nfe-config` | Configuração fiscal do tenant (emitente, CFOP, Focus ambiente) |
| PUT  | `/v1/nfe-config` | Criar/atualizar configuração (upsert — CNPJ, endereço, regime, focus_ambiente) |
| POST | `/v1/invoices/:id/emit` | Enfileirar emissão NF-e (202 Accepted — async via SQS → Lambda) |
| GET  | `/v1/invoices/:id/nfe` | Status NF-e em tempo real (nfe_status, nfe_chave, nfe_danfe_url) |
| GET  | `/v1/invoices/:id/nfe-events` | Audit trail de operações NF-e (emissões, cancelamentos) |

**Pré-requisitos para emissão:**
- `nfe_configs` deve existir para o tenant (PUT /v1/nfe-config primeiro)
- Invoice deve estar no status `draft`
- Todos os itens devem ter `ncm_code` preenchido
- `nfe_status` deve ser `null` (sem tentativa em andamento)

**Body de PUT /v1/nfe-config:**
```json
{
  "cnpj": "11444777000161",
  "razao_social": "ACME Ltda",
  "regime_tributario": 1,
  "logradouro": "Rua das Acácias", "numero": "100", "bairro": "Centro",
  "municipio": "SAO PAULO", "uf": "SP", "cep": "01310100",
  "telefone": "11999990000", "email": "fiscal@acme.com.br",
  "cfop_padrao": "5102", "cfop_interestadual": "6102",
  "natureza_operacao": "Venda de mercadoria",
  "focus_ambiente": 2
}
```

**Response de GET /v1/invoices/:id/nfe:**
```json
{
  "nfe_status": "authorized",
  "nfe_chave": "35240611444777000161550010000000011000000011",
  "nfe_protocol": "135240000000001",
  "nfe_auth_date": "2026-06-19T14:30:00.000Z",
  "nfe_xml_s3_key": "tenant-uuid/2026/06/invoice-uuid.xml",
  "nfe_danfe_url": "https://focusnfe.com.br/danfe/...",
  "nfe_reject_reason": null,
  "nfe_attempts": 1
}
```

**Status flow:**
`null` → `pending` (emit disparado) → `processing` (Lambda consumiu) →
`authorized` (SEFAZ aprovou, número NF-e gerado sequencialmente) | `rejected` (SEFAZ rejeitou)

### Customers (Tenants SaaS)
| Método | Rota | Descrição |
|--------|------|-----------|
| POST   | `/v1/customers` | Criar |
| GET    | `/v1/customers?status=&search=` | Listar |
| GET    | `/v1/customers/:id` | Buscar |
| PATCH  | `/v1/customers/:id` | Atualizar |
| DELETE | `/v1/customers/:id` | Cancelar |

### Sistema
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Health check (ECS) |

---

## Frontend — Classes CSS disponíveis

> **NUNCA inventar classes CSS.** Todas as abaixo existem em `apps/backoffice/src/index.css`.

### Layout
`.app-shell` `.sidebar` `.sidebar-logo` `.sidebar-nav` `.sidebar-footer` `.main-area` `.page-content`

### Estrutura de página
`.page-header` — flex row com title + button
`.stats-grid` `.stat-card` `.stat-label` `.stat-value`

### Cards e tabelas
`.card` — container branco com sombra e border-radius
`table > thead > tr > th` / `tbody > tr > td` — estilos automáticos dentro de `.card`

### Botões
`.btn` `.btn-primary` `.btn-secondary` `.btn-danger` `.btn-sm`

### Badges
`.badge` + modificador:
`.badge-product` `.badge-service` `.badge-raw_material` `.badge-asset`
`.badge-active` `.badge-inactive`

### Formulários
`.field` `.field-row` — layout vertical / horizontal
`.pwd-wrap` `.pwd-toggle` — input de senha com toggle

### Drawer (painel lateral)
`.overlay` `.drawer` `.drawer-header` `.drawer-body` `.drawer-footer`

### Feedback
`.alert` `.alert-error` `.alert-success`
`.spinner` `.empty-state`

### Utilitários
`.flex-gap` `.mt-16` `.text-right` `.text-muted`

### Variáveis CSS (usar em `style={{}}`)
`var(--primary)` `var(--danger)` `var(--border)` `var(--surface)` `var(--muted)`

---

## Frontend — Padrão de página (não inventar outro)

Todo CRUD segue exatamente este padrão (veja `MaterialsPage.tsx` como referência):

```tsx
// 1. Imports
import { useEffect, useState, FormEvent } from 'react';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';

// 2. Interfaces locais para os tipos
// 3. Estado: lista, paginação, drawer, form, saving, formError
// 4. load() via useEffect (deps: tenantId, page, search)
// 5. Dropdown data: useEffect([drawerOpen, tenantId]) — NUNCA chamar de event handler
//    Sempre usar flag `cancelled` de cancelamento e surfacing de erros:
//    useEffect(() => {
//      if (!drawerOpen || !tenantId) return;
//      let cancelled = false;
//      Promise.all([api.get(...), ...])
//        .then(([...]) => { if (cancelled) return; setXxx(...); })
//        .catch((err) => { if (cancelled) return; setFormError(...); });
//      return () => { cancelled = true; };
//    }, [drawerOpen, tenantId]);
// 6. Drawer open/close helpers (sem void loadDropdowns() — isso é anti-padrão aqui)
// 7. handleSave(e: FormEvent) com api.post/patch — NUNCA usar catch silencioso
// 8. JSX: page-header | search input | card > table | drawer overlay
//    <form onSubmit={handleSave} noValidate ...> — noValidate SEMPRE para que o JS valide
//    {formError && <div role="alert" className="alert alert-error">{formError}</div>}
```

**Paginação padrão:** `page`, `per_page` (default 20). Retorno: `{ data, total, page, per_page }`.

**useI18n:** importar `{ useI18n }` de `'../../i18n'` e `type { TKey }` de `'../../i18n/pt-BR'` quando precisar de chaves dinâmicas.

---

## i18n — Como adicionar traduções

1. Adicionar chave em `apps/backoffice/src/i18n/pt-BR.ts` (isso atualiza `TKey` automaticamente)
2. Adicionar **a mesma chave** em `apps/backoffice/src/i18n/en.ts` (`Record<TKey, string>` — TypeScript dará erro de compilação se faltar)
3. Usar no componente: `const { t } = useI18n(); t('minha.chave')`

**Namespaces de chaves existentes:**
- `nav.*` — navegação
- `c.*` — comuns (save, cancel, edit, loading…)
- `d.*` — dashboard
- `r.*` — register (cadastro de empresa)
- `l.*` — login
- `m.*` — materials
- `cl.*` — clients
- `u.*` — users
- `o.*` — orders (pedidos)
- `inv.*` — invoices (notas fiscais)

---

## Desenvolvimento Local

### Pré-requisitos
| Ferramenta | Versão mínima |
|------------|--------------|
| Docker Desktop | qualquer recente |
| Node.js | 20+ |
| npm | 10+ |

### Subir tudo com Docker (recomendado)

```bash
npm install                   # dependências do monorepo
docker compose up             # PostgreSQL + API Core + Backoffice (hot-reload)
docker compose run --rm migrate  # cria tabelas (rodar na primeira vez e após novas migrations)
```

| Serviço | URL |
|---------|-----|
| Backoffice | http://localhost:5173 |
| API Core   | http://localhost:3001 |
| PostgreSQL  | localhost:5432 |

> O Vite faz proxy de `/v1/*` e `/health` para api-core em `:3000` — sem CORS.

### Primeiro acesso — criar conta

```bash
# Opção 1: seed com credenciais padrão
docker compose exec api-core npm run seed
# → usuário: admin@erp.local / senha: Admin@2024

# Opção 2: seed com suas credenciais
docker compose exec api-core env \
  SEED_EMAIL=voce@empresa.com \
  SEED_PASSWORD=SuaSenha123 \
  npm run seed

# Opção 3: registrar via UI
# Acesse http://localhost:5173 → clique "Criar sua empresa →"
```

### Comandos úteis

```bash
# Health check
curl http://localhost:3000/health

# Registrar empresa
curl -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"company_name":"Acme Ltda","tax_id":"11444777000161","email":"admin@acme.com","password":"Senha@2024"}'

# Login
curl -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@acme.com","password":"Senha@2024"}'

# Criar pedido
curl -X POST http://localhost:3000/v1/orders \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"<TID>","client_id":"<CID>","items":[{"name":"Produto X","quantity":2,"unit_price":99.90}]}'

# Confirmar pedido (baixa estoque)
curl -X POST http://localhost:3000/v1/orders/<ID>/confirm

# Criar NF-e a partir de pedido
curl -X POST http://localhost:3000/v1/invoices \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"<TID>","client_id":"<CID>","order_id":"<OID>","serie":"1","items":[...]}'

# Emitir NF-e (gera número)
curl -X POST http://localhost:3000/v1/invoices/<ID>/issue
```

### Variáveis de ambiente (api-core)

| Variável | Padrão dev | Descrição |
|----------|-----------|-----------|
| `DATABASE_URL` | `postgres://erp_lite:erp_lite@db:5432/erp_lite` | Connection string |
| `JWT_SECRET` | `local-dev-secret` | Segredo JWT |
| `PORT` | `3000` | Porta HTTP |
| `NODE_ENV` | `development` | |
| `AWS_REGION` | `us-east-1` | Região AWS (SQS/S3) |
| `NFE_REQUESTS_QUEUE_URL` | *(vazio — desativa emissão)* | URL da fila SQS nfe-requests |
| `NFE_RESULTS_QUEUE_URL` | *(vazio — desativa worker)* | URL da fila SQS nfe-results |
| `NFE_BUCKET` | *(vazio)* | Nome do bucket S3 para XMLs NF-e |
| `SEED_EMAIL` | `admin@erp.local` | Para `npm run seed` |
| `SEED_PASSWORD` | `Admin@2024` | Para `npm run seed` |

### Variáveis de ambiente (lambda-fiscal)

| Variável | Descrição |
|----------|-----------|
| `FOCUS_NFE_TOKEN` | Token de API da Focus NF-e (obrigatório) |
| `NFE_RESULTS_QUEUE_URL` | URL da fila SQS nfe-results (obrigatório) |
| `NFE_BUCKET` | Nome do bucket S3 para XMLs (obrigatório) |
| `AWS_REGION` | Injetado automaticamente pela AWS Lambda |

---

## Padrões de Código

### Adicionando um novo módulo ERP

1. **Migration** em `services/api-core/db/migrations/000N_nome.sql`
   - Incluir `tenant_id UUID NOT NULL REFERENCES tenants(id)`
   - Incluir trigger `update_updated_at()`
   - Índice `(tenant_id, ...)` para toda query frequente
   - Adicionar ao array em `scripts/migrate.ts`

2. **Rota** em `services/api-core/src/routes/nome.ts`
   - Paginação padrão: `page`, `per_page=20`, `max 100`
   - Soft delete (nunca DELETE físico)
   - Transações (`pool.connect()` + BEGIN/COMMIT/ROLLBACK) para operações compostas
   - JSON Schema em todas as rotas que aceitam body

3. **Registrar** em `services/api-core/src/app.ts`:
   ```typescript
   await app.register(novoModuloRoutes, { prefix: '/v1' });
   ```

4. **Página frontend** em `apps/backoffice/src/pages/modulo/ModuloPage.tsx`
   - Seguir o padrão de `MaterialsPage.tsx` (lista + drawer)
   - Usar apenas classes CSS existentes documentadas acima

5. **Rota no App.tsx**:
   ```tsx
   import { ModuloPage } from './pages/modulo/ModuloPage';
   // dentro de <GuardedRoutes>:
   <Route path="/modulo" element={<ModuloPage />} />
   ```

6. **Nav em Layout.tsx**:
   ```typescript
   { to: '/modulo', label: t('nav.modulo'), icon: '🔲' }
   ```

7. **i18n**: adicionar `nav.modulo` e todos os keys `mod.*` nos dois arquivos

8. **README**: atualizar schema, rotas e roadmap

### Regras de segurança

- `tenant_id` nunca vem do body — sempre do JWT (`request.user.tenantId`)
  > Exceção temporária: enquanto JWT auth Lambda não está integrado
- Senhas: bcrypt com salt rounds = 12 (`bcryptjs`)
- Secrets: AWS Parameter Store — nunca em env vars ECS em texto claro
- Queries: sempre `$1, $2, ...` — nunca concatenação SQL
- Email: sempre armazenar em lowercase (`email.toLowerCase().trim()`)

---

## Deploy AWS

**O deploy é 100% automatizado via GitHub Actions** (`push` na branch `main`).
O pipeline executa em ordem: build Docker → push ECR → `terraform apply` →
migrations via ECS run-task → build Vite → sync S3 → invalidação CloudFront.

Secrets necessários no repositório GitHub:

| Secret | Descrição |
|--------|-----------|
| `AWS_ACCESS_KEY_ID` | IAM key com permissões ECS/ECR/RDS/S3/CF/Terraform/Lambda/SQS |
| `AWS_SECRET_ACCESS_KEY` | IAM secret |
| `TF_VAR_JWT_SECRET` | Segredo para assinar JWTs |
| `TF_VAR_FOCUS_NFE_TOKEN` | Token de API da Focus NF-e (https://focusnfe.com.br → Configurações → API) |

> A senha do RDS é gerada automaticamente pelo Terraform (`random_password`) e
> armazenada criptografada no estado S3 — **não precisa de secret no GitHub**.
> Para recuperar: `terraform output -raw db_password` (após o primeiro deploy).

> **Focus NF-e:** criar conta em https://focusnfe.com.br (uma conta por plataforma SaaS,
> não por tenant). Cada tenant faz upload do certificado A1 (.pfx) diretamente no portal
> Focus NF-e — o certificado **não transita pelo nosso backend**. O campo `focus_ambiente`
> em `nfe_configs` controla se a emissão vai para homologação (2) ou produção (1).

```bash
# Inspecionar outputs após deploy
cd terraform
terraform output api_url       # CloudFront HTTPS (domínio público unificado)
terraform output cloudfront_domain
terraform output -raw db_password  # senha gerada pelo Terraform (sensitive)
```

### Variáveis de custo (terraform/variables.tf)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `db_instance_class` | `db.t3.micro` | Classe RDS — usar `db.t3.small` em prod com alta carga |
| `rds_multi_az` | `false` | Multi-AZ standby (dobra custo) — ativar apenas quando SLA exige RTO < 1 min |
| `api_desired_count` | `1` | Tasks ECS — usar `2` em prod para zero-downtime deploys |
| `api_cpu` | `256` | vCPU Fargate (unidades) |
| `api_memory` | `512` | RAM Fargate (MB) |

**Estimativa mensal prod:** ~**$19** (RDS single-AZ $12 + ECS Spot $3 + NLB $6 + Lambda $0.50 + SQS $0.50 + S3 $1 + CW $2 − free tier)
**Estimativa mensal dev:** ~**$8** (RDS c/ scheduler $4 + ECS Spot $3 + restante $1)
> Lambda e SQS têm free tier generoso (1M invocações/mês) — custo efetivo ~$0 no MVP.
> Antes da v1.2: ~$27/mês (Multi-AZ RDS em prod + RDS rodando 24/7 em dev).
> Antes da v0.9: ~$38 (ECS regular Fargate $9 + ALB $16 + restante $13).

> **RDS PostgreSQL 16:** `rds.force_ssl=1` ativado por padrão. O `DATABASE_URL` usa
> `ssl: { rejectUnauthorized: false }` para aceitar o certificado auto-assinado da AWS
> em conexões intra-VPC. Isso é seguro — o tráfego fica dentro da VPC.

> **Mixed Content:** o backoffice (HTTPS via CloudFront) não pode chamar o NLB via HTTP.
> A solução é ter o CloudFront como único endpoint público: `/v1/*` é roteado para o NLB
> via HTTP internamente (viewer → CF é HTTPS; CF → NLB é HTTP dentro da AWS).
> `VITE_API_URL` aponta para o domínio CloudFront — nunca para o NLB diretamente.

---

## Roadmap

| Status | Módulo | Descrição |
|--------|--------|-----------|
| ✅ | **Tenants** | Cadastro multi-tenant + planos |
| ✅ | **Auth** | Login/register bcrypt+JWT, email case-insensitive |
| ✅ | **Materials** | Produtos/serviços + controle de estoque |
| ✅ | **Clients** | PJ/PF com CNPJ/CPF, endereço, campos NF-e |
| ✅ | **Users** | CRUD de usuários por tenant com roles |
| ✅ | **Docker** | Ambiente local hot-reload + seed script |
| ✅ | **Terraform** | AWS ECS + RDS + ECR + ALB + CloudFront/S3 |
| ✅ | **CI/CD** | GitHub Actions build + ECR push + ECS deploy |
| ✅ | **i18n** | pt-BR (padrão) + EN com toggle |
| ✅ | **Orders** | Pedidos de venda + baixa automática de estoque |
| ✅ | **Invoices** | Notas Fiscais com número sequencial por série |
| ✅ | **SEFAZ/NF-e async** | Lambda fiscal + Focus NF-e + SQS + S3 (XMLs 5 anos) |
| 🔜 | **NF-e cancellation** | Cancelamento SEFAZ (POST /invoices/:id/nfe/cancel) |
| 🔜 | **NF-e correction** | Carta de correção eletrônica (CC-e) |
| 🔜 | **Purchasing** | Pedidos de compra com entrada de estoque |
| 🔜 | **Reports** | Relatórios async via Lambda + S3 |
| 🔜 | **Notifications** | Email/WhatsApp via Lambda + SQS |
| 🔜 | **RBAC** | Controle de acesso granular por role |
