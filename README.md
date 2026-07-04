# Orquestra ERP — SaaS Multi-tenant ERP on AWS

> **Este README é o prompt principal para geração de código por IA.**
> Antes de implementar qualquer funcionalidade, leia este arquivo na íntegra.
> Ele define a fonte da verdade sobre schema, rotas, componentes e convenções
> — tanto para o backoffice **web** quanto para o **app mobile Flutter**.

---

## Protocolo Anti-alucinação (leia primeiro)

Regras que toda IA assistindo este projeto DEVE seguir antes de gerar código:

1. **Nunca inventar tabelas ou colunas.** O schema de banco de dados está documentado neste README e nos arquivos `services/api-core/db/migrations/000N_*.sql`. Tabelas existentes: `tenants`, `users`, `materials`, `material_images`, `inventory`, `inventory_movements`, `clients`, `client_contacts`, `orders`, `order_items`, `invoices`, `invoice_items`, `nfe_configs`, `nfe_events`, `notification_configs`, `receivables`, `receivable_payments`, `payables`, `payable_payments`, `boletos`, `boleto_events`, `service_contracts`, `contract_billings`, `nfse_invoices`, `nfse_events`, `suppliers`, `proposals`, `proposal_items`, `cost_centers`, `cost_center_stock`, `cost_center_movements`, `sellers`, `commission_entries`, `tax_icms_interstate_rates`, `tax_icms_internal_rates`, `tax_fcp_rates`, `tax_st_rules`, `tax_simples_nacional_brackets`, `purchase_orders`, `purchase_order_items`, `supplier_invoices`, `supplier_invoice_items`, `dre_categories`, `tenant_modules`, `technicians`, `service_orders`, `service_order_items`, `service_visits`, `service_visit_photos`, `supplier_contacts`, `bank_accounts`, `marketplace_connections`, `material_marketplace_links`, `marketplace_webhook_events`, `plans`, `billing_events` (assinatura Stripe — regra 43). Colunas adicionadas em v10.0: `users.password_reset_token`, `users.password_reset_expires`; `receivables.due_notification_sent`; `payables.recurrence`, `payables.recurrence_day`, `payables.recurrence_end_date`, `payables.recurrence_last_generated`, `payables.parent_payable_id`; `notification_configs.notify_receivable_due_days`. Colunas adicionadas em v11.0: `tenants.itau_client_id`, `tenants.itau_client_secret`. Colunas adicionadas em v13.0: `payables.cost_center_id`, `orders.cost_center_id`, `invoices.cost_center_id`, `receivables.cost_center_id`. Colunas adicionadas em v14.0: `orders.seller_id`, `invoices.seller_id`. Colunas adicionadas em v15.0: `tenants.simples_rbt12`; `invoices.fcp_total`, `invoices.icms_difal_total`; `invoice_items.fcp_rate`, `invoice_items.fcp_value`, `invoice_items.icms_difal_value`. Colunas adicionadas em v16.0: `payables.dre_category_id`. Colunas adicionadas em v17.0: `users.role` passa a aceitar `'technician'` (CHECK constraint atualizado). Colunas adicionadas em v19.0 (migration 0046): `nfe_configs.id` (nova PRIMARY KEY — `tenant_id` deixa de ser PK, vira FK comum), `nfe_configs.is_default`, `nfe_configs.is_active`; `invoices.company_id`, `nfse_invoices.company_id`, `service_contracts.company_id` (FK opcional para `nfe_configs.id` — regra 40). Colunas adicionadas em v20.0 (migration 0047): `boletos.bank_account_id` (FK opcional para `bank_accounts.id` — regra 41); `tenants.bank_code/agency/account/account_digit/billing_provider/billing_days_to_expire/itau_client_id/itau_client_secret` ficam deprecated-mas-presentes (não mais lidos/escritos diretamente — ver regra 41). Colunas adicionadas em v21.0 (migration 0048): `orders.marketplace_order_id`, `orders.origin` (`'erp'`|`'mercadolivre'` — regra 42). Colunas adicionadas em `tenants` pela migration 0026 (assinatura Stripe — regra 43): `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `subscription_period_end`, `cancel_at_period_end`. Reaproveita `tenants.status`/`tenants.trial_ends_at`, já existentes desde a migration 0001. Antes de usar qualquer tabela/coluna, confirme que ela existe.

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
   - `POST /v1/tax/calculate` — aceita `company_id` opcional (regra 40)
   - `GET|PUT /v1/nfe-config` — sempre opera sobre a empresa PADRÃO do tenant (retrocompatível, regra 40)
   - `GET|POST|PATCH|DELETE /v1/companies(/:id)?` · `PATCH /v1/companies/:id/set-default` — empresas/CNPJs do tenant (regra 40); `POST` (criar 2ª+ empresa) gated por `requireModule('multi_empresa')`, demais endpoints sempre disponíveis
   - `GET|POST|PATCH|DELETE /v1/bank-accounts(/:id)?` · `PATCH /v1/bank-accounts/:id/set-default` — contas bancárias por empresa (regra 41), sem gate de módulo; `GET` aceita `?company_id=` opcional
   - `GET|POST|PATCH /v1/nfse(/:id)?` · `POST /v1/nfse/:id/emit`
   - `GET|POST|PATCH|DELETE /v1/receivables(/:id)?` · `POST /v1/receivables/:id/payments` · `DELETE /v1/receivables/:id/payments/:pid`
   - `POST /v1/receivables/:id/emit-boleto` — aceita `bank_account_id` opcional (regra 41), default a conta padrão do tenant · `POST /v1/receivables/:id/expire-boleto`
   - `GET|POST|PATCH|DELETE /v1/payables(/:id)?` · `POST /v1/payables/:id/payments` · `DELETE /v1/payables/:id/payments/:pid`
   - `GET|POST|PATCH|DELETE /v1/suppliers(/:id)?` · `GET /v1/suppliers/:id/payables`
   - `GET /v1/suppliers/:id/contacts` · `POST /v1/suppliers/:id/contacts` · `PATCH|DELETE /v1/suppliers/:id/contacts/:cid` — autenticado por JWT (regra 39), diferente de `client_contacts`
   - `GET|POST|PATCH /v1/service-contracts(/:id)?` · `POST /v1/service-contracts/:id/billings`
   - `GET|POST|PATCH|DELETE /v1/users(/:id)?`
   - `GET|PATCH /v1/tenant` — campos bancários no request/response mantidos por retrocompatibilidade, mas lidos/escritos via `bankAccountService` (regra 41), não mais colunas de `tenants` · `PUT|DELETE /v1/tenant/logo`
   - `GET|POST|PATCH /v1/notification-config`
   - `GET|POST|PATCH|DELETE /v1/proposals(/:id)?`
   - `POST /v1/proposals/:id/send` · `POST /v1/proposals/:id/convert` · `POST /v1/proposals/:id/duplicate` · `POST /v1/proposals/:id/cancel`
   - `GET /v1/proposals/:id/print` — mesmos dados do portal público (`/v1/public/proposals/:token`), porém autenticado por tenantId; funciona para qualquer status (inclusive `draft`) e nunca altera status/`public_viewed_at`
   - `GET /v1/public/proposals/:token` · `POST /v1/public/proposals/:token/accept` · `POST /v1/public/proposals/:token/reject`
   - `GET /v1/dashboard` · `GET /v1/dashboard/cashflow` — KPIs + fluxo de caixa projetado (próximas 12 semanas)
   - `GET /v1/reports/overdue` — contas a receber vencidas com nome do cliente
   - `GET /v1/reports/top-products?days=30` — ranking de produtos por faturamento
   - `GET /v1/cost-centers` · `POST /v1/cost-centers` · `GET /v1/cost-centers/active`
   - `GET /v1/cost-centers/:id` · `PATCH /v1/cost-centers/:id` · `DELETE /v1/cost-centers/:id`
   - `GET /v1/cost-centers/:id/stock` · `GET /v1/cost-centers/:id/movements`
   - `POST /v1/cost-centers/:id/entries` · `POST /v1/cost-centers/:id/adjustments`
   - `GET|POST|PATCH|DELETE /v1/sellers(/:id)?` · `GET /v1/sellers/active`
   - `GET /v1/sellers/:id/commissions` — extrato de comissões do vendedor (histórico por venda)
   - `GET /v1/reports/commissions?from=&to=` — ranking de comissão por vendedor
   - `GET /v1/tax/simples-effective-rate` — alíquota efetiva estimada do Simples Nacional (Anexo I) pelo RBT12 do tenant (informativo)
   - `GET|POST|PATCH /v1/purchase-orders(/:id)?` · `POST /v1/purchase-orders/:id/approve` · `POST /v1/purchase-orders/:id/cancel`
   - `GET|POST /v1/supplier-invoices(/:id)?` · `POST /v1/supplier-invoices/:id/confirm` · `POST /v1/supplier-invoices/:id/cancel`
   - `GET /v1/reports/dre?from=YYYY-MM-DD&to=YYYY-MM-DD` — DRE Gerencial (Caminho A — sem dupla entrada contábil)
   - `GET /v1/dre/categories` — categorias DRE disponíveis para o tenant (globais + personalizadas)
   - `GET /v1/tenant/modules` · `PATCH /v1/tenant/modules/:key` — módulos opcionais habilitados por tenant (regra 38; `MODULE_KEYS` atuais: `service_orders`, `multi_empresa`, `pos`, `mercadolivre`)
   - `GET|POST /v1/technicians(/:id)?` · `PATCH /v1/technicians/:id/active` — gated por `requireModule('service_orders')`
   - `GET|POST /v1/service-orders(/:id)?` · `POST /v1/service-orders/:id/visits` · `GET /v1/service-orders/:id/visits/:visitId` · `POST /v1/service-orders/:id/cancel` — gated por `requireModule('service_orders')`. `GET /v1/service-orders/:id` retorna `visit_link` (URL pronta, montada por `buildVisitLink()` em `serviceVisitService.ts`) e `link_valid` (via `isRoutingTokenValid()`) por visita — nunca o `routing_token` bruto — para reenvio manual do link ao técnico (ex.: WhatsApp) pelo backoffice.
   - `GET /v1/technician/visits(/:id)?` · `POST /v1/technician/visits/:id/check-in` · `POST /v1/technician/visits/:id/complete` — autenticado, role=`technician`, escopado ao próprio técnico
   - `POST /v1/technician/visits/:id/photos/presign` · `POST /v1/technician/visits/:id/photos/confirm` · `POST /v1/technician/visits/:id/signature/presign` · `POST /v1/technician/visits/:id/signature/confirm` — upload direto ao S3 (presigned POST), nunca pela API
   - `GET /v1/integrations/mercadolivre/connections` — lista todas as conexões do tenant (qualquer empresa), sem gate de módulo (leitura inofensiva) · `GET /v1/integrations/mercadolivre/connect` · `GET /v1/integrations/mercadolivre/status` · `DELETE /v1/integrations/mercadolivre` — todas com `?company_id=` obrigatório, gated por `requireModule('mercadolivre')` (regra 42)
   - `GET /v1/public/integrations/mercadolivre/callback` — público, o Mercado Livre redireciona o navegador do usuário para cá; sempre termina em redirect de volta ao app (`?ml_status=connected|error`), nunca em JSON
   - `GET|POST|PATCH|DELETE /v1/materials/:id/marketplace-links(/:linkId)?` · `POST /v1/materials/:id/marketplace-links/:linkId/sync` — gated por `requireModule('mercadolivre')`
   - `POST /v1/public/marketplace/mercadolivre/webhook` — público, sempre responde 200 rápido; payload nunca é fonte de verdade, só um gatilho (regra 42)
   - `GET /v1/subscription` — estado da assinatura + planos disponíveis, inclui `stripe_enabled` (regra 43) · `POST /v1/subscription/checkout-session` · `POST /v1/subscription/portal-session` — ambas `503`/erro se `STRIPE_SECRET_KEY` não configurada
   - `POST /v1/subscription/webhook` — público, body raw (verificação de assinatura HMAC via `STRIPE_WEBHOOK_SECRET`); idempotente por `billing_events.stripe_event_id`, sempre responde 200
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

14. **Cálculo de impostos: usar a pilha fiscal multi-estado (v15.0).** Três camadas separadas, **nunca misturar responsabilidades**:
    - `taxRulesResolver.ts` — lookup das tabelas centrais de alíquotas (ICMS interno/interestadual, FCP, ST, Simples). Cache em memória de 5 min. Nunca chamar diretamente de rotas — usar via `taxCalculationService.ts`.
    - `taxEngine.ts` — aritmética pura/stateless: recebe alíquotas JÁ resolvidas, nunca faz I/O. Importar `calculateTaxes()` apenas a partir de `taxCalculationService.ts` ou testes unitários.
    - `taxCalculationService.ts` — orquestração: resolve alíquotas, determina DIFAL (EC 87/2015) quando `icms_taxpayer='9'` + `consumer_type='1'` + interestadual, e FCP da UF destino.
    - `POST /v1/tax/calculate` (autenticado via JWT) usa `nfe_configs.uf` como `origin_state` por padrão — nunca mais hardcode `'SP'`. O frontend envia `icms_taxpayer` e `consumer_type` do cliente para DIFAL correto. ICMS/PIS/COFINS/FCP são "por dentro". IPI é "por fora". Total NF-e = subtotal + ipi_total.

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

33. **Motor fiscal multi-estado: tabelas centrais NUNCA editáveis por tenant.** As tabelas `tax_icms_interstate_rates`, `tax_icms_internal_rates`, `tax_fcp_rates`, `tax_st_rules` e `tax_simples_nacional_brackets` (migration 0037) são mantidas pela Orquestra (legislação tributária é igual para todos os tenants no mesmo estado). O que É configurável por tenant: `nfe_configs.uf` (UF de origem, obrigatório configurar antes de emitir), `nfe_configs.regime_tributario` (CRT 1/2/3), `tenants.simples_rbt12` (faturamento acumulado 12 meses para cálculo de alíquota efetiva do Simples). **Limitações documentadas desta versão (v15.0):** (a) ICMS-ST: tabela `tax_st_rules` criada, mas sem dados — recomendado integrar provedor de dados fiscais (IOB/TaxWeaver) para populá-la; (b) FCP: tabela criada sem dados — popular por demanda por UF; (c) DIFAL: cálculo simplificado por diferença direta (não usa gross-up do Anexo VI do Convênio 236/2021); (d) Versionamento temporal de alíquotas: não implementado (alíquota corrente no momento da consulta é sempre aplicada — sem lookups por data); (e) Conteúdo de importação (alíquota de 4% — Resolução Senado 13/2012): não implementado. Nunca afirmar que estas limitações não existem; documentar no código e nos changelogs.

34. **Pedido de Compra e NF-e de Entrada: Clean Architecture com 3 camadas.** Domínio puro em `src/domain/purchaseOrder/purchaseOrderDomain.ts` (state machine, validação, cálculo) e `src/domain/supplierInvoice/supplierInvoiceDomain.ts` (state machine, 3-way matching). Serviços de aplicação em `src/services/purchaseOrderService.ts` e `src/services/supplierInvoiceService.ts` (orquestração, I/O). Nunca chamar lógica de domínio diretamente de rotas; nunca chamar I/O de banco dentro do domínio puro. `confirmSupplierInvoice()` cria o `payable` automaticamente E registra movimentação de entrada no inventário (`inventory_movements type='in'`) — nunca duplicar esse efeito. O 3-way matching (`matchAgainstPO`) retorna `'divergence'` quando quantidade ou preço do item difere do PO — o status da NF-e fica `'divergence'` em vez de `'confirmed'` mas o payable ainda é criado e o PO **não** avança para `'received'` nesse caso.

35. **DRE Gerencial: Caminho A (sem dupla entrada contábil).** `src/domain/dre/dreDomain.ts` contém a fórmula pura do DRE (SOLID: puro, testável, sem I/O). `src/services/dreService.ts` lê invoices (receita) e payables (despesas por `dre_category_id`) e chama `buildDRE()`. `dre_categories` tem categorias globais (tenant_id NULL — mantidas pela Orquestra) e pode ter categorias customizadas por tenant. `payables.dre_category_id` é nullable — payables sem categoria aparecem em "Outras Despesas" na DRE. NUNCA afirmar que este DRE é um DRE contábil formal: ele é gerencial e não substitui SPED Contábil/ECD. A fórmula respeita: Receita Líquida = Receita Bruta − Deduções; Lucro Bruto = Rec. Líquida + CMV; EBITDA = Lucro Bruto + Despesas Opex; EBT = EBITDA + Result. Financeiro; Resultado Líquido = EBT + Impostos sobre Resultado. Despesas têm `sign = -1` (montante negativo) e receitas têm `sign = +1` — nunca inverter esse sinal.

36. **CNPJ Alfanumérico (IN RFB nº 2.229/2024): nunca usar `digits()` ou `replace(/\D/g,'')` em campos CNPJ.** A partir de julho/2026 a Receita Federal emitirá CNPJs com letras A-Z nos 12 primeiros caracteres. O sistema foi preparado com a função `normalizeCNPJ()` que remove SOMENTE pontuação (`. - / espaços`) mas PRESERVA letras. CNPJs sempre gravados em maiúsculas. Algoritmo correto: Módulo 11, pesos `[5,4,3,2,9,8,7,6,5,4,3,2]` e `[6,5,4,3,2,9,8,7,6,5,4,3,2]` com conversão base-36 (`A=10…Z=35`, `0-9=0-9`) — mesmo algoritmo do CNPJ tradicional, retrocompatível com todos os CNPJs numéricos existentes. O domínio está em `services/api-core/src/domain/cnpj/cnpjDomain.ts` (backend puro, testável) e as funções `normalizeCNPJ()`, `maskCNPJ()`, `isValidCNPJ()` foram atualizadas em `apps/backoffice/src/lib/brazil.ts` (frontend). Pontos de escrita no banco SEMPRE chamam `normalizeCNPJ()` — nunca `digits()`. **O CNPJ "UKPVME1E8HI996" citado na documentação do CNPJ.ws é um CNPJ estrutural de demonstração (formato válido, dígitos verificadores errados) — não valida e não deve ser usado em testes automatizados.** CNPJs válidos computados para testes: `AAAAAA00000171`, `B2C3D4E5F6G185`, `ORQUESTRA01269`, `ZZTESTE0000198`.

37. **Impressão de Proposta: reaproveitar `ProposalDocument.tsx`, nunca duplicar o layout.** O componente visual do documento (header com logo/banner, bloco "Para/Válida até", tabela de itens, totais, observações/termos e rodapé com dados do emissor) vive em `apps/backoffice/src/pages/proposals/ProposalDocument.tsx` — usado tanto pelo portal público (`ProposalPublicPage.tsx`, rota `/p/:token`, sem auth) quanto pela impressão interna (`ProposalPrintPage.tsx`, rota `/proposals/:id/print`, autenticada, botão "Imprimir" na lista `/proposals`). A impressão interna usa `GET /v1/proposals/:id/print` (autenticado por tenantId, qualquer status) — nunca abrir `/p/:token` para uso interno: essa rota exige `public_token` (só existe após `POST /proposals/:id/send`, ou seja, propostas em rascunho não têm token) e o próprio `GET /v1/public/proposals/:token` muda `status` para `'viewed'` e grava `public_viewed_at`, poluindo a métrica de "cliente visualizou a proposta". Formatação de CNPJ/CPF no documento sempre usa `fmtDoc()` de `ProposalDocument.tsx`, que delega para `maskCNPJ()`/`maskCPF()`/`normalizeCNPJ()` de `apps/backoffice/src/lib/brazil.ts` (regra 36) — nunca reimplementar a máscara localmente. Impressão usa `window.print()` nativo do navegador (CSS `@media print` + classe `print-hide`) — o projeto não tem `jsPDF`/`puppeteer`/`@react-pdf` instalado; não adicionar essas libs sem necessidade real.

38. **Ordens de Serviço / Visita Técnica: módulo opcional, Clean Architecture, técnico é usuário autenticado.** Domínio puro em `src/domain/serviceOrder/serviceOrderDomain.ts` e `src/domain/serviceVisit/serviceVisitDomain.ts` (state machines, `isValidCPF`). Serviços em `src/services/serviceOrderService.ts`, `src/services/serviceVisitService.ts`, `src/services/technicianService.ts`, `src/services/servicePhotoStorageService.ts`, `src/services/tenantModuleService.ts`.
    - **Módulo desligado por padrão.** `tenant_modules (tenant_id, module_key, enabled)` é uma flag genérica reaproveitável por qualquer módulo opcional futuro — não é específica de OS. Toda rota gated usa o `preHandler` `requireModule('service_orders')` (`src/lib/requireModule.ts`). Frontend consulta `GET /v1/tenant/modules` só para exibir/esconder o item de menu — nunca é o controle de acesso de verdade, isso é sempre backend.
    - **Técnico é `users.role = 'technician'`, login obrigatório — nunca um link público anônimo.** `technicians.user_id` é `NOT NULL UNIQUE` (diferente de `sellers.user_id`, que é opcional). O e-mail de agendamento (`service_visit_assigned`) carrega um link de **roteamento** (`/tecnico/entrar?redirect=/tecnico/visitas/:id`) — o link em si nunca concede acesso; toda ação exige JWT autenticado + `technician_id` da visita batendo com o técnico logado (`assertTechnicianOwnsVisit` em `serviceVisitService.ts`). CPF é capturado uma única vez no cadastro do técnico (nunca redigitado por visita) e é "congelado" (snapshot) em `service_visits.technician_name`/`technician_cpf` no check-in — mesmo raciocínio de `order_items`/`invoice_items` congelarem nome/preço.
    - **`technicianRoleGuard` (hook global em `app.ts`) restringe `role='technician'` ao prefixo `/v1/technician/*`.** Sem esse hook, um JWT de técnico teria acesso a qualquer rota existente (`authenticate` só confere `tenantId`, nunca `role`). Nunca remover esse guard nem adicionar rotas fora do prefixo `/v1/technician/*` que aceitem esse papel.
    - **Onboarding do técnico reaproveita o fluxo de reset de senha que já existe** (`users.password_reset_token`/`password_reset_expires`, `POST /v1/auth/reset-password`) — nunca envia senha em texto puro por e-mail.
    - **Fotos e assinatura: upload direto do navegador para o S3 via presigned POST** (`@aws-sdk/s3-presigned-post`), nunca proxiado pela API (custo de Fargate + mantém CPF/assinatura fora de log de aplicação). Bucket `service_visit_photos` é privado (Block Public Access, SSE-KMS, CORS restrito a `var.app_public_origins`) — leitura só via presigned GET de curta duração, gerada sob demanda (`getPresignedReadUrl`), nunca um link fixo. Chave do objeto é `{tenant_id}/{service_visit_id}/{uuid}.jpg` — isolamento por tenant E por visita.
    - **Assinatura do cliente é artefato 1:1 com a visita** (`service_visits.signature_s3_key`/`signed_by_name`/`signed_at`), não uma linha em `service_visit_photos` (que é a galeria de N fotos por visita) — nunca confundir os dois. É assinatura eletrônica simples (Lei 14.063/2020), não ICP-Brasil — nunca afirmar equivalência com assinatura digital certificada.
    - **Idempotência de foto:** `idempotency_key` gerado no navegador (UUID) antes do upload, `UNIQUE(tenant_id, idempotency_key)` em `service_visit_photos` — retry de rede não duplica a linha (mesmo padrão de `cost_center_movements`/`commission_entries`).
    - **Compressão client-side obrigatória antes do upload** (`apps/backoffice/src/lib/visitUpload.ts`, Canvas API, ~1600px maior lado, JPEG 80%) — controle de custo de storage, não um Lambda de processamento de imagem.

39. **Contatos de fornecedor (`supplier_contacts`) espelham `client_contacts` na estrutura, mas NÃO no padrão de autenticação.** `client_contacts.ts` recebe `tenant_id` do body/query da requisição — exceção legada documentada na regra 4, que antecede o auth Lambda estar totalmente integrado. `supplier_contacts.ts` (rotas em `src/routes/supplierContacts.ts`) foi implementado do zero já com o padrão correto: `onRequest: [(fastify as any).authenticate]` + `tenantId` extraído do JWT, mesmo padrão que `suppliers.ts` já usa. **Nunca copiar o padrão de `client_contacts.ts` para um módulo novo** — ele existe por motivo histórico, não é o padrão de referência. Tipos de contato são diferentes entre os dois: `client_contacts` usa `comercial|juridico|compras|manutencao|comprador|outro` (papéis de quem COMPRA de nós); `supplier_contacts` usa `comercial|financeiro|suporte|logistica|outro` (papéis do lado de quem VENDE para nós) — nunca reaproveitar "comprador"/"compras" para fornecedor, não faz sentido semântico. Frontend: aba "Contatos" em `SuppliersPage.tsx` (terceira aba do drawer, ao lado de `general`/`banking`, só aparece em modo edição) — diferente de `ClientsPage.tsx`, que não usa abas e mostra contatos inline na rolagem única do formulário; a escolha de UI segue o padrão que a própria página hospedeira já usa, não o de `ClientsPage.tsx`.

40. **Multi-Empresa (multi-CNPJ): `nfe_configs` é a entidade "Empresa", promovida de singleton (1 por tenant) para N por tenant.** Antes da migration 0046, `nfe_configs.tenant_id` era a PRIMARY KEY (1 CNPJ por tenant, sem exceção). Agora `nfe_configs.id` é a PK e `tenant_id` é uma FK comum — cada linha é uma empresa/CNPJ que o tenant opera, com `is_default` marcando qual delas é usada quando nenhuma empresa é escolhida explicitamente, e `is_active` para soft-delete (regra 8). **Criar uma 2ª+ empresa exige o módulo opcional `multi_empresa` habilitado** (`POST /v1/companies` é gated por `requireModule('multi_empresa')` — mesmo mecanismo genérico de `tenant_modules` da regra 38); listar/editar a empresa que já existe (`GET`/`PATCH /v1/companies(/:id)?`) nunca é gated, pois não é a capacidade nova. Backend é sempre a autoridade — o frontend só usa o módulo habilitado para decidir se mostra o botão "+ Nova Empresa".
    - **Escopo desta versão (v19.0): só o que afeta emissão fiscal.** `company_id` (nullable, FK para `nfe_configs.id`, mesmo padrão aditivo de `seller_id`/`cost_center_id`) existe em `invoices`, `nfse_invoices` e `service_contracts` — os três pontos onde "qual CNPJ emite" importa de verdade. **Fora do escopo, documentado como limitação conhecida (mesmo espírito da regra 33):** `payables`, `purchase_orders`, `supplier_invoices`, `receivables`, `proposals` e `orders` continuam sem `company_id` — pedido é intenção comercial, a decisão de empresa emissora só é obrigatória no fato gerador fiscal (`POST /v1/invoices`, criação de `service_contracts`). POS/NFC-e (`services/fiscal/focusNfe.ts`) também continua usando sempre a empresa padrão do tenant — terminal físico já corresponde, na prática, a um único CNPJ/local. **Atualização (v20.0):** boleto/PIX (Itaú) deixou de ser 1:1 por tenant — ver regra 41 (`bank_accounts`, N contas por empresa).
    - **`companyService.ts` (`src/services/companyService.ts`) é o único ponto de leitura/escrita de empresa — nenhuma rota consulta `nfeConfigs` diretamente para resolver "qual empresa emite".** `resolveCompanyId(tenantId, companyId?, db)` é a peça central: sem `companyId` explícito devolve a empresa padrão (`getDefaultCompany`); com `companyId`, valida posse do tenant + `is_active` antes de devolver (senão `CompanyDomainError('company_not_found')`) — mesmo idioma de guard de `assertTechnicianOwnsVisit` (regra 38). Usado nos 4 pontos de emissão: `routes/nfe.ts` (`POST /invoices/:id/emit`), `routes/nfse.ts` (`POST /nfse/:id/emit`), `routes/serviceContracts.ts` (`POST /:id/billings`) e `routes/tax.ts` (`POST /tax/calculate`, default de `origin_state`). Domínio puro em `src/domain/company/companyDomain.ts`: `canDeactivate()` (bloqueia desativar a empresa padrão ou a última ativa) e `validateNewCompanyCnpj()` (reaproveita `isValidCNPJ`/`normalizeCNPJ` da regra 36, rejeita CNPJ duplicado dentro do tenant).
    - **Retrocompatibilidade é o requisito central, não um detalhe.** `GET|PUT /v1/nfe-config` (rota legada, ainda usada por qualquer cliente que não saiba de multi-empresa) continua com o mesmo contrato de sempre — por trás dos panos, sempre lê/edita a empresa `is_default=true` via `companyService.getDefaultCompany`/`upsertDefaultCompany`. Para um tenant que nunca habilitou `multi_empresa`, o comportamento é byte-idêntico ao de antes da migration 0046: sempre existe exatamente 1 `nfe_configs` por tenant, então qualquer resolução por "empresa padrão" sempre bate na mesma linha de sempre. `company_id` é opcional em toda escrita nova (`POST /v1/invoices`, criação de `service_contracts`) — quando omitido, fica `null` e a emissão resolve para a padrão no momento de emitir, nunca bloqueia a criação de rascunho por falta de configuração fiscal (mesmo comportamento de antes).
    - **Frontend: seletor de empresa com "progressive disclosure" — só aparece com mais de 1 CNPJ cadastrado.** `CompanyPage.tsx` (aba Fiscal) ganha uma faixa de seleção de empresa (renderizada apenas se `companies.length > 1 || multiEmpresaEnabled`) que reaproveita o MESMO formulário/handlers já existentes (`nfeForm`, `handleNfeSave`) — a única mudança é para onde o save é roteado: empresa padrão selecionada → `PUT /v1/nfe-config` (legado, inalterado); empresa não-padrão → `PATCH /v1/companies/:id`; `selectedCompanyId === 'new'` → `POST /v1/companies`. Zero duplicação de JSX. `InvoiceNewPage.tsx` e `ContractsPage.tsx` (este último só quando `nfse_enabled`) ganham um `<select>` de "Empresa emissora", também só renderizado com `companies.length > 1`.

41. **Múltiplas Contas Bancárias por Empresa: `bank_accounts` é N por `nfe_configs` (empresa), não por tenant.** Antes da migration 0047, um tenant tinha exatamente uma conta bancária/Itaú — colunas soltas em `tenants` (`bank_code`, `agency`, `account`, `account_digit`, `billing_provider`, `billing_days_to_expire`, `itau_client_id`, `itau_client_secret`). Essas colunas continuam em `tenants` (deprecated-mas-presentes, sem DROP destrutivo), mas não são mais lidas nem escritas diretamente por nenhuma rota. **Sem gate de módulo aqui** — diferente de `multi_empresa` (regra 40), qualquer tenant pode cadastrar mais de uma conta para o mesmo CNPJ, mesmo sem o módulo `multi_empresa` habilitado.
    - **`bankAccountService.ts` (`src/services/bankAccountService.ts`) é o único ponto de leitura/escrita de conta bancária.** `resolveBankAccount(tenantId, bankAccountId?, db)` é a peça central, mesmo idioma de `companyService.resolveCompanyId`: sem id explícito, resolve a conta padrão (`is_default=true`) da empresa padrão do tenant; com id, valida posse do tenant + `is_active`. `getDefaultBankAccount(tenantId, companyId?, db)` encadeia dois defaults (empresa padrão → conta padrão dela) quando `companyId` é omitido. Domínio puro em `src/domain/bankAccount/bankAccountDomain.ts`: `canDeactivate()` bloqueia desativar a conta padrão de uma empresa ou a última conta ativa **daquela empresa** (o invariante é por empresa, não por tenant — cada CNPJ precisa de pelo menos uma conta ativa própria). Validação de formato dos dados bancários (`bank_code`/`agency`/`account`/`account_digit`/`billing_provider`) reaproveita `validateBankingData()`/`isValidBillingProvider()` de `lib/banking.ts`, já existente e testado — nunca duplicada.
    - **Onde a conta bancária é resolvida de verdade:** `POST /v1/receivables/:id/emit-boleto` aceita `bank_account_id` opcional no body; resolve via `resolveBankAccount()` antes de montar o snapshot em `boletos` (`banco_code`/`agencia`/`conta`/`digito`, inalterado) e a mensagem SQS para o `lambda-billing` (mesmo formato de `BillingEmitMessage.banking` — nenhuma mudança no lambda). `boletos.bank_account_id` grava rastreabilidade extra (nullable) sem substituir o snapshot.
    - **Retrocompatibilidade: `GET|PATCH /v1/tenant` continua com o mesmo contrato de request/response para os campos bancários**, mas por trás delega para `bankAccountService.getDefaultBankAccount`/`upsertDefaultBankAccount` (conta padrão da empresa padrão). `upsertDefaultBankAccount` faz merge com os dados já gravados em atualização parcial (ex.: só trocar `itau_client_secret` sem reenviar agência/conta) — mesmo comportamento que o `PATCH /v1/tenant` sempre teve. **Correção de uma inconsistência:** `GET /v1/tenant` retornava `itau_client_secret` em texto puro (diferente de `nfe_configs`, que já mascarava tokens Focus) — agora mascarado (`****xxxx`), só no novo caminho; o padrão antigo não foi retroativamente alterado em nenhum outro lugar.
    - **Frontend: mesmo padrão de progressive disclosure de duas camadas** — seletor de empresa (reaproveita `companies` já carregado pela regra 40) aparece só com >1 empresa; dentro da empresa selecionada, seletor de conta aparece só com >1 conta cadastrada para ela. Tenant com 1 empresa e 1 conta não vê nenhuma mudança de UI, continua no `PATCH /v1/tenant` legado. `ReceivablesPage.tsx` ganha um `<select>` de conta bancária na emissão de boleto, só renderizado com mais de 1 conta ativa no tenant.

42. **Integração Mercado Livre: uma conexão OAuth é por EMPRESA (`nfe_configs`), não por tenant.** Uma conta do Mercado Livre é vinculada a um CNPJ específico — um tenant com 2 empresas (regra 40) pode ter 2 lojas ML separadas. `marketplace_connections.company_id` é `NOT NULL` e único por `(company_id, provider)`. **Esta foi uma implementação em duas fases — ambas concluídas:**
    - **Fase 1 (api-core apenas):** migration `0048_mercadolivre.sql`, domínio (`src/domain/marketplace/marketplaceDomain.ts`), serviços (`marketplaceConnectionService.ts`, `materialMarketplaceLinkService.ts`, `marketplaceWebhookService.ts`), rotas, worker in-process (`marketplaceSyncResultsWorker.ts`) e frontend (`CompanyPage.tsx` aba Integrações, `MaterialsPage.tsx` seção Mercado Livre). Tudo 100% testável sem AWS real.
    - **Fase 2 (Lambda + Terraform + sync real):** `services/lambda-marketplace` (mesmo molde de `lambda-billing`: handler SQS + adapter OAuth2) + infraestrutura Terraform (`terraform/marketplace.tf`, filas `marketplace-sync-requests`/`marketplace-sync-results`/`marketplace-sync-dlq` em `sqs.tf`, ECR em `ecr.tf`) + CI/CD (`deploy.yml`). **Lambdas neste projeto nunca acessam o Postgres diretamente** (mesmo padrão de `BillingEmitMessage.banking`) — por isso `requestSync()` e `ingestWebhook()` embutem um snapshot dos tokens da conexão (`access_token`/`refresh_token`/`token_expires_at`) e, no caso do sync, do preço/estoque atuais do material, na própria mensagem SQS (`MarketplaceSyncRequestMessage` em `lib/marketplace-types.ts`).
    - **Sync só manual nesta fase (decisão deliberada):** o botão "Sincronizar" já existente (`POST /v1/materials/:id/marketplace-links/:linkId/sync`) funciona de ponta a ponta; sync automático ao alterar preço/estoque no ERP fica para uma versão futura, para validar o fluxo básico com a conta real antes de automatizar.
    - **Refresh do token OAuth: o `refresh_token` do Mercado Livre é de uso único** — a API invalida o anterior ao emitir um novo. `MercadoLivreAdapter.ensureFreshToken()` (`lambda-marketplace/src/adapters/mercadolivre.ts`) renova quando faltam menos de 5 min para expirar, e **sempre** devolve o par renovado no campo opcional `refreshed_tokens` da mensagem de resultado — nunca só em memória. `marketplaceSyncResultsWorker.ts` persiste esse campo em `marketplace_connections` independente do tipo da mensagem (`sync_material` ou `order_import`); ignorar esse campo derrubaria a conexão na próxima chamada (refresh_token já consumido).
    - **`syncMaterial` limitação de v1 documentada:** quando `ml_variation_id` está presente no vínculo, o `PUT /items/:id` ainda mira o item base — variações ficam para uma iteração futura, não travam o sync manual.
    - **`fetchResource` só processa tópicos de pedido** (`topic` iniciando com `orders`, ex.: `orders_v2`) — outros tópicos de webhook (perguntas, itens) são reconhecidos e ignorados em silêncio nesta fase (sem erro, sem mensagem de resultado).
    - **Tokens (`access_token`/`refresh_token`) continuam em texto puro** — mesma limitação documentada de `itau_client_secret`/`focus_token_producao`: nenhum segredo deste projeto usa KMS hoje. Criar KMS só para o Mercado Livre seria inconsistente com o resto da base; migrar todos os segredos para KMS, se necessário, é um projeto à parte. Nunca afirmar que os tokens estão criptografados em repouso.
    - **`signState`/`verifyState` (`marketplaceDomain.ts`) protegem o callback OAuth contra CSRF sem tabela nova** — o `state` da URL de autorização carrega o próprio `company_id` assinado com HMAC-SHA256 + timestamp (expira em 10 min), revalidado no callback antes de confiar nele. O callback é público (`GET /v1/public/integrations/mercadolivre/callback` — o Mercado Livre redireciona o navegador do usuário, não há JWT nesse ponto) e **sempre termina em redirect de volta ao app**, nunca em JSON.
    - **Webhook nunca é fonte de verdade, só um gatilho** (mesmo raciocínio de segurança da regra 38 sobre o link de roteamento do técnico): `POST /v1/public/marketplace/mercadolivre/webhook` valida só a forma do payload (topic/resource/user_id), grava em `marketplace_webhook_events` (idempotência via `UNIQUE(idempotency_key)` = `provider:topic:resource` — reenvio do mesmo evento não duplica a linha) e **sempre responde 200 rápido**, mesmo em erro interno — nunca deixar o Mercado Livre nos marcar como endpoint instável.
    - **Módulo opcional `mercadolivre`, desligado por padrão** (mesmo mecanismo genérico de `tenant_modules` da regra 38) — gated via `requireModule('mercadolivre')` em `routes/marketplaceIntegration.ts` e `routes/materialMarketplaceLinks.ts`. `GET /v1/integrations/mercadolivre/connections` (lista) nunca é gated — é leitura inofensiva usada por outras telas.
    - **`mapMlOrderToErpOrder()` (domínio puro) nunca cria `order_item` órfão** — se um item vendido no ML não tem `material_marketplace_links` correspondente, lança erro explícito em vez de silenciosamente ignorar. Pedido importado entra direto em `orders.status='confirmed'` (pula `draft` — a venda no ML já está paga/comprometida), com `origin='mercadolivre'` e `marketplace_order_id` preenchidos.
    - **Decisão de v1 documentada, não escondida:** pedidos importados do Mercado Livre são atribuídos a um cliente genérico único por tenant (`clients.full_name = 'Cliente Mercado Livre'`, criado sob demanda) — não criamos um cadastro de cliente por comprador anônimo do marketplace. Revisitar apenas se houver necessidade real de CRM por comprador.

43. **Assinatura SaaS via Stripe: opt-in por `STRIPE_SECRET_KEY` — sem a env var, o módulo inteiro é um no-op.** `stripeClient.ts` (`isStripeEnabled()` = `Boolean(process.env.STRIPE_SECRET_KEY)`) e `middleware/subscriptionGuard.ts` (preHandler global — retorna cedo se `!isStripeEnabled()`) são a única fonte de verdade. **Isto já foi uma armadilha real: a env var nunca foi adicionada ao Terraform/ECS depois que a feature foi implementada, deixando o billing "pronto mas nunca ligado" em produção** — corrigido adicionando `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (variáveis `stripe_secret_key`/`stripe_webhook_secret`, sensitive) ao `environment` do ECS em `terraform/ecs.tf` e aos `TF_VAR_*` do `deploy.yml`. **Checklist para nunca repetir esse erro:** toda vez que uma env var nova for lida via `process.env.X` num serviço/adapter, ela só existe de verdade em produção se estiver (a) declarada como `variable` em `terraform/variables.tf`, (b) presente no bloco `environment` do recurso certo (ECS para api-core, `environment.variables` do Lambda para lambdas), e (c) passada como `TF_VAR_x` a partir de um GitHub Secret no `deploy.yml` — faltar qualquer um dos três é o mesmo bug do Stripe.
    - **Tenants existentes nunca são afetados ao ligar o Stripe:** `subscriptionGuard` libera incondicionalmente quando `status='trial'` e `trial_ends_at IS NULL` (todo tenant criado antes desta feature) — o bloqueio (HTTP 402) só se aplica a tenants **novos**, que ganham `trial_ends_at` de 14 dias no registro (`auth.ts`, criação do Stripe customer é fire-and-forget, nunca bloqueia o cadastro).
    - **`plans.stripe_price_id` precisa apontar para Prices reais do Stripe no MESMO modo (test/live) da `STRIPE_SECRET_KEY` configurada** — test e live são ambientes completamente separados no Stripe; um Price criado em test não existe para uma chave `sk_live_...`. Migration `0026_stripe_billing.sql` cria os planos com `'price_placeholder'`; `0029_stripe_price_ids.sql` já substitui pelos Price IDs reais — `POST /v1/subscription/checkout-session` bloqueia explicitamente (`400`) se o preço ainda for `price_placeholder*`.
    - **Webhook (`POST /v1/subscription/webhook`) sem `STRIPE_WEBHOOK_SECRET` pula a verificação de assinatura HMAC** (loga aviso, mas aceita o evento) — nunca operar assim em produção; configurar o endpoint no Stripe Dashboard apontando para `https://orquestraerp.com.br/v1/subscription/webhook` e copiar o `whsec_...` para a env var. Idempotência via `billing_events.stripe_event_id UNIQUE` — reenvio do mesmo evento pelo Stripe não duplica processamento.
    - **Tabelas:** `plans` (catálogo de planos, `stripe_price_id`, seed de 3 linhas: Starter/Profissional/Enterprise) e `billing_events` (append-only, auditoria de todo evento Stripe processado). Colunas em `tenants`: `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `subscription_period_end`, `cancel_at_period_end`, `status`, `trial_ends_at`.

32. **Comissão de vendedor: sempre lançada na autorização da NF-e, nunca antes.** `sellers` é uma entidade desacoplada de `users` (login via `user_id` é opcional — representante externo não precisa de acesso ao sistema). `orders.seller_id` e `invoices.seller_id` são nullable — não preencher não quebra nenhum fluxo existente. O serviço `services/api-core/src/services/commissionService.ts` é a única fonte de verdade: `accrueCommission()` é chamado pelo `nfeResultsWorker.ts` no mesmo bloco que já faz a baixa de estoque do centro de custo, somente quando `invoices.nfe_status` vira `'authorized'` e a nota tem `seller_id`. A base de cálculo (`subtotal` ou `total` da NF-e) é definida por `sellers.commission_base`. `cancelCommission()` é chamado por `POST /v1/invoices/:id/cancel` quando a nota cancelada estava autorizada — nunca deleta o registro, apenas marca `commission_entries.status = 'cancelled'` (regra 8). Idempotência via UNIQUE `(tenant_id, idempotency_key)` com `idempotency_key = 'invoice:${invoiceId}'` — uma NF-e gera no máximo uma comissão. Nunca chamar `accrueCommission`/`cancelCommission` diretamente nas rotas fora desses dois pontos de gatilho.

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
│  ├─ dueSoonWorker        (23h interval → SQS notifications)     │
│  └─ marketplaceSyncResultsWorker (SQS long-poll → UPDATE        │
│      marketplace_connections/material_marketplace_links,        │
│      INSERT orders — regra 42)                                  │
│                                                                 │
│  → RDS PostgreSQL 16 (SSL PGSSLMODE=require)                   │
│  → SQS: nfe-requests, billing-requests, notifications,          │
│         marketplace-sync-requests/results                       │
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

┌───────────────────────────────┐
│  Lambda: lambda-marketplace   │
│  (ECR container)              │
│  SQS trigger (sync-requests)  │
│  → Mercado Livre API OAuth2   │
│  → Sync preço/estoque (PUT)   │
│  → Import de pedido (GET)     │
│  → SQS marketplace-sync-results│
└───────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  App Mobile Flutter  (apps/mobile)                              │
│  Android & iOS — mesma API REST /v1/* — JWT Bearer              │
└─────────────────────────────────────────────────────────────────┘

Infraestrutura (Terraform):
  Route 53 → ACM us-east-1 → CloudFront → NLB → ECS
  ECR: api-core, lambda-fiscal, lambda-billing, lambda-notifications, lambda-marketplace
  SQS: nfe-requests/results, billing-requests/results, notifications, notifications-dlq,
       marketplace-sync-requests/results, marketplace-sync-dlq
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
| Marketplace | Mercado Livre API OAuth2 `authorization_code` → sync preço/estoque + import de pedido (`lambda-marketplace`) |
| Assinatura SaaS | Stripe Checkout + Billing Portal + webhook (regra 43) — opt-in via `STRIPE_SECRET_KEY` |

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
    System_Ext(ml, "Mercado Livre API", "Marketplace — OAuth2 por empresa/CNPJ. Conexão, webhook, sync de preço/estoque e importação de pedido")

    Rel(user, erp, "Opera via browser ou app mobile", "HTTPS")
    Rel(client, erp, "Acessa portal /p/:token", "HTTPS (sem autenticação)")
    Rel(erp, focus, "Emite NF-e e NFS-e", "REST HTTPS")
    Rel(focus, sefaz, "Transmite e autoriza notas", "SOAP/REST HTTPS")
    Rel(erp, itau, "Emite boleto e PIX", "REST HTTPS OAuth2 client_credentials")
    Rel(erp, ses, "Envia e-mails transacionais", "AWS SDK SQS → Lambda → SES")
    Rel(erp, fcm, "Envia push notifications", "Firebase Admin SDK")
    Rel(erp, client, "Notifica por e-mail", "SES")
    Rel(user, viacep, "Consulta CEP (browser direto)", "REST HTTPS")
    Rel(erp, ml, "Conecta via OAuth2, sincroniza preço/estoque e importa pedidos", "REST HTTPS (regra 42)")
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
        Container(api, "api-core", "Node 22 · Fastify · Drizzle ORM · ECS Fargate Spot", "API REST multi-tenant. Workers in-process: nfeResults, boletoResults, recurringPayables, dueSoon, marketplaceSyncResults")
        ContainerDb(db, "RDS PostgreSQL 16", "PostgreSQL · SSL obrigatório", "Todos os dados isolados por tenant_id. Migrations em db/migrations/")
        ContainerDb(sqs, "SQS Queues", "Amazon SQS", "nfe-requests · nfe-results · billing-requests · billing-results · notifications · notifications-dlq · marketplace-sync-requests/results")
        ContainerDb(s3data, "S3 Data Buckets", "Amazon S3", "nfe-xml (lifecycle 5 anos) · billing-pdf (lifecycle 7 anos)")
        Container(lfiscal, "lambda-fiscal", "Node 22 · ECR Container", "Emite NF-e e NFS-e via Focus. Discrimina por {type:'nfse'}. Salva XML no S3")
        Container(lbilling, "lambda-billing", "Node 22 · ECR Container", "Emite boleto/PIX via Itaú OAuth2. Salva PDF no S3")
        Container(lnotif, "lambda-notifications", "Node 22 · ECR Container", "Renderiza templates HTML e envia via SES v2. Rebuild obrigatório ao adicionar tipo")
        Container(lmarket, "lambda-marketplace", "Node 22 · ECR Container", "OAuth2 refresh, sync de preço/estoque (PUT /items) e import de pedido (GET /orders) via API do Mercado Livre")
    }

    System_Ext(focus, "Focus NF-e API", "Gateway fiscal")
    System_Ext(itau, "Itaú API v2", "Boleto + PIX")
    System_Ext(ses, "Amazon SES v2", "Relay de e-mail")
    System_Ext(fcm, "Firebase Cloud Messaging", "Push notifications")
    System_Ext(ml, "Mercado Livre API", "OAuth2 + sync + pedidos")

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
    Rel(sqs, lmarket, "Trigger marketplace-sync-requests", "SQS Event Source Mapping")
    Rel(lfiscal, focus, "POST /v2/nfe ou /v2/nfse", "REST HTTPS")
    Rel(lfiscal, s3data, "Salva XML", "AWS SDK PutObject")
    Rel(lbilling, itau, "OAuth2 token + POST /boletos", "REST HTTPS")
    Rel(lbilling, s3data, "Salva PDF", "AWS SDK PutObject")
    Rel(lnotif, ses, "SendEmail com template HTML", "AWS SDK v3")
    Rel(lmarket, ml, "OAuth2 refresh + PUT/GET items/orders", "REST HTTPS")
    Rel(api, ml, "OAuth2 connect/callback + recebe webhook", "REST HTTPS")
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

    U->>F: Clica "Emitir Boleto" no recebível (opcional: escolhe bank_account_id)
    F->>A: POST /v1/receivables/:id/emit-boleto
    A->>A: bankAccountService.resolveBankAccount() — bank_account_id explícito<br/>ou a conta padrão da empresa padrão do tenant (regra 41)
    A->>Q: sendMessage — dados do boleto + itau_client_id/secret da conta resolvida
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
| Propostas | `/proposals`, `/proposals/:id/print`, `/p/:token` | proposals, proposal_items |
| Notas Fiscais (NF-e) | `/invoices` | invoices, invoice_items, nfe_events |
| NFS-e | `/nfse` | nfse_invoices, nfse_events |
| Contas a Receber | `/receivables` | receivables, receivable_payments, boletos |
| Centro de Custo | `/cost-centers`, `/cost-centers/:id` | cost_centers, cost_center_stock, cost_center_movements |
| Vendedores / Comissões | `/sellers`, `/sellers/:id` | sellers, commission_entries |
| Pedidos de Compra | `/purchase-orders` | purchase_orders, purchase_order_items |
| NF-e de Entrada | `/supplier-invoices` | supplier_invoices, supplier_invoice_items |
| DRE Gerencial | `/dre` | dre_categories + leitura de invoices/payables |
| Contas a Pagar | `/payables` | payables, payable_payments |
| Contratos | `/contracts` | service_contracts, contract_billings |
| Fornecedores | `/suppliers` | suppliers, supplier_contacts |
| Relatórios | `/reports` | receivables (inadimplência), order_items (ranking) |
| Usuários | `/users` | users |
| Minha Empresa | `/company` | tenants, nfe_configs, notification_configs, bank_accounts |
| Empresas / Multi-CNPJ *(opcional, ver `tenant_modules`)* | `/company` (aba Fiscal) | nfe_configs (N por tenant) |
| Ordens de Serviço *(opcional, ver `tenant_modules`)* | `/service-orders` | service_orders, service_order_items, service_visits |
| Técnicos *(opcional)* | `/technicians` | technicians, users |
| Portal do Técnico *(opcional, autenticado)* | `/tecnico/entrar`, `/tecnico/visitas`, `/tecnico/visitas/:id` | service_visits, service_visit_photos |
| Integração Mercado Livre *(opcional, ver `tenant_modules`)* | `/company` (aba Integrações), aba "Mercado Livre" em `/materials` | marketplace_connections, material_marketplace_links, marketplace_webhook_events |

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

### v23.0 — Correção: variáveis de ambiente de produção não conectadas (Stripe + Mercado Livre)

> **Achado ao investigar por que `stripe_enabled: false` aparecia em produção** (`GET /v1/subscription`): a assinatura Stripe (feature implementada em sessão anterior, commit `3f1a505`) nunca teve `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` conectadas ao Terraform/ECS — o módulo estava pronto no código, mas inerte em produção desde sempre (regra 43).
>
> **Mesma auditoria revelou 2 gaps equivalentes na integração Mercado Livre (v21.0/v22.0):** `MARKETPLACE_SYNC_REQUESTS_QUEUE_URL`/`MARKETPLACE_SYNC_RESULTS_QUEUE_URL` (necessárias para o `api-core` publicar/consumir as filas do Lambda) e `MERCADOLIVRE_CLIENT_ID`/`MERCADOLIVRE_CLIENT_SECRET` (necessárias para o fluxo OAuth de `marketplaceConnectionService.ts`) nunca tinham sido adicionadas ao `environment` do ECS em `terraform/ecs.tf` — só ao Lambda. Corrigido nesta versão, junto com o Stripe.
>
> **Correção:** `terraform/variables.tf` ganha `stripe_secret_key`/`stripe_webhook_secret` (sensitive); `terraform/ecs.tf` ganha as 6 variáveis faltantes no `environment` do container `api-core`; `deploy.yml` ganha `TF_VAR_stripe_secret_key`/`TF_VAR_stripe_webhook_secret`. **Ação necessária do usuário:** cadastrar `TF_VAR_STRIPE_SECRET_KEY` e `TF_VAR_STRIPE_WEBHOOK_SECRET` nos GitHub Secrets do repositório com os valores reais do Stripe (modo live) antes do próximo deploy — sem isso, o `terraform apply` usa os defaults vazios (`""`) e o Stripe continua desabilitado.
>
> **Nenhum tenant existente é afetado ao ligar o Stripe** — `subscriptionGuard` (regra 43) libera incondicionalmente qualquer tenant com `trial_ends_at IS NULL` (todos os cadastrados antes desta feature existir).

### v22.0 — Integração Mercado Livre (Fase 2 — Lambda + Terraform + sync real)

> **Conclui a Fase 2 anunciada na v21.0** — usuário obteve cadastro de desenvolvedor no Mercado Livre. Entrega: novo serviço `services/lambda-marketplace` (mesmo molde de `lambda-billing`), infraestrutura Terraform (`terraform/marketplace.tf`, filas em `sqs.tf`, ECR em `ecr.tf`, variáveis `mercado_livre_client_id`/`mercado_livre_client_secret`) e CI/CD (`deploy.yml`).
>
> **Lambdas nunca acessam o Postgres diretamente** (mesmo padrão de `BillingEmitMessage.banking`) — `materialMarketplaceLinkService.requestSync()` e `marketplaceWebhookService.ingestWebhook()` (ambos da v21.0) passaram a embutir um snapshot dos tokens da conexão e do preço/estoque do material na mensagem SQS (`MarketplaceSyncRequestMessage` em `lib/marketplace-types.ts`, duplicado em `lambda-marketplace/lib/types.ts` — mesma convenção de tipos duplicados por workspace já usada por `lambda-billing`).
>
> **Refresh de token OAuth — o `refresh_token` do Mercado Livre é de uso único.** `MercadoLivreAdapter.ensureFreshToken()` renova quando faltam menos de 5 min de validade e devolve sempre o novo par via `refreshed_tokens` na mensagem de resultado; `marketplaceSyncResultsWorker.ts` persiste esse campo em `marketplace_connections` (independente do tipo da mensagem) — sem isso, a próxima chamada usaria um refresh_token já invalidado pela própria API do ML.
>
> **Decisões confirmadas com o usuário (ambas recomendadas):** tokens continuam em texto puro (consistente com `itau_client_secret`/`focus_token_producao` — nenhum segredo do projeto usa KMS hoje); sync só manual nesta fase (o endpoint `POST /v1/materials/:id/marketplace-links/:linkId/sync` já existente passa a funcionar de ponta a ponta — sync automático ao alterar preço/estoque fica para depois).
>
> **Escopo do MVP:** `fetchResource` só processa tópicos de pedido (`orders_v2`); outros tópicos de webhook são ignorados em silêncio. `syncMaterial` atualiza preço/estoque via `PUT /items/:id` — quando o vínculo tem `ml_variation_id`, o PUT ainda mira o item base (variações ficam para uma iteração futura).
>
> **Testes:** 17 testes novos — 5 em `materialMarketplaceLinks.test.ts`/`marketplaceWebhook.test.ts`/`marketplaceSyncResultsWorker.test.ts` (api-core, cobrindo o novo shape de mensagem e a persistência de `refreshed_tokens`) + 12 em `lambda-marketplace` (`mercadolivre.test.ts`, `marketplaceSyncService.test.ts` — token refresh, sync de preço/estoque, mapeamento de pedido, propagação de erro para retry do SQS).
>
> **Sem `terraform apply` nesta sessão** — arquivos `.tf` validados localmente (`terraform validate`/`fmt`), aplicação real acontece pelo pipeline `deploy.yml` já existente quando mergeado, ou manualmente quando as credenciais do app do Mercado Livre estiverem configuradas nos GitHub Secrets (`TF_VAR_MERCADO_LIVRE_CLIENT_ID`/`_SECRET`).

### v21.0 — Integração Mercado Livre (Fase 1 — api-core)

> **Migration 0048.** Novas tabelas `marketplace_connections` (conexão OAuth por EMPRESA — `nfe_configs`, não por tenant), `material_marketplace_links` (vínculo material↔anúncio, N por conexão) e `marketplace_webhook_events` (append-only, idempotente por `topic+resource`). `orders` ganha `marketplace_order_id` e `origin` (`'erp'`|`'mercadolivre'`), nullable/aditivo.
>
> **Implementação em duas fases, deliberada:** esta versão entrega só o módulo **api-core** — migration, domínio, serviços, rotas, worker in-process e testes unitários, 100% verificável sem AWS real. O Lambda `lambda-marketplace`, a infraestrutura Terraform (SQS, ECR, IAM) e o CI/CD ficam para a Fase 2, quando houver credenciais reais do Mercado Livre para validar o fluxo OAuth de ponta a ponta. Até lá, tudo que dependeria da fila SQS é um no-op deliberado (mesmo padrão de graceful-degradation já usado em toda emissão fiscal/boleto quando a fila não está configurada) — conectar/desconectar conta e vincular material a anúncio funcionam hoje, de ponta a ponta. **Atualização: a Fase 2 foi concluída na v22.0.**
>
> **OAuth2 sem tabela de state:** `signState`/`verifyState` (`marketplaceDomain.ts`) assinam o `company_id` com HMAC-SHA256 + timestamp (expira em 10 min) — o parâmetro `state` da URL de autorização carrega a própria empresa, revalidado no callback antes de confiar nele. O callback (`GET /v1/public/integrations/mercadolivre/callback`) é público — o Mercado Livre redireciona o navegador do usuário, sem JWT — e sempre termina em redirect de volta ao app.
>
> **Segredos em texto puro nesta fase** — mesma limitação já documentada para `itau_client_secret`/`focus_token_producao`/`bank_accounts.itau_client_secret` (nenhum segredo deste projeto usa KMS hoje). Envelope encryption via KMS fica para a Fase 2.
>
> **Webhook nunca é fonte de verdade, só um gatilho:** valida forma, grava para auditoria/idempotência, sempre responde 200 rápido mesmo em erro interno.
>
> **Arquitetura:** domínio puro em `src/domain/marketplace/marketplaceDomain.ts`, serviços em `src/services/marketplaceConnectionService.ts`, `materialMarketplaceLinkService.ts`, `marketplaceWebhookService.ts`, worker em `src/workers/marketplaceSyncResultsWorker.ts`, rotas em `routes/marketplaceIntegration.ts`, `routes/materialMarketplaceLinks.ts`, `routes/marketplaceWebhook.ts`. Ver regra 42 para o detalhamento completo.
>
> **Frontend:** `CompanyPage.tsx` ganha aba "Integrações" (conectar/desconectar por empresa). `MaterialsPage.tsx` ganha seção "Mercado Livre" no drawer de edição (vincular/desvincular anúncio, sincronizar), visível só com o módulo habilitado e ao menos uma conta conectada.
>
> **Testes:** 39 testes novos — `marketplaceDomain.test.ts` (10, puro), `marketplaceIntegration.test.ts` (9, rotas — inclui prova de state adulterado rejeitado), `materialMarketplaceLinks.test.ts` (7), `marketplaceWebhook.test.ts` (4, idempotência), `marketplaceSyncResultsWorker.test.ts` (1). Suíte completa: 381/387 passando (6 falhas remanescentes são pré-existentes em `billing.test.ts`, não relacionadas).
>
> **Soft-delete:** `material_marketplace_links.status = 'closed'` (não usa `is_active`, reaproveita a coluna de status do ciclo de vida do anúncio).

### v20.0 — Múltiplas Contas Bancárias por Empresa

> **Migration 0047.** Nova tabela `bank_accounts` — N contas bancárias por empresa (`nfe_configs`, não por tenant). Antes, um tenant tinha exatamente uma conta (colunas soltas em `tenants`: `bank_code`, `agency`, `account`, `account_digit`, `billing_provider`, `billing_days_to_expire`, `itau_client_id`, `itau_client_secret`) — essas colunas ficam deprecated-mas-presentes, sem DROP destrutivo. Backfill automático: todo tenant que já tinha dados bancários preenchidos ganhou 1 `bank_account` vinculada à sua empresa padrão, marcada `is_default=true` — nenhum tenant existente ficou sem conta.
>
> **Sem gate de módulo:** diferente de `multi_empresa` (regra 40), qualquer tenant pode ter mais de uma conta bancária para o mesmo CNPJ, mesmo sem o módulo multi-empresa habilitado — faz sentido mesmo para quem só tem 1 CNPJ.
>
> **Onde a conta é resolvida de verdade:** `POST /v1/receivables/:id/emit-boleto` aceita `bank_account_id` opcional e resolve via `bankAccountService.resolveBankAccount()` — não mais assume uma única config bancária por tenant. O snapshot em `boletos` (`banco_code`/`agencia`/`conta`/`digito`) e a mensagem SQS para o `lambda-billing` continuam no mesmo formato, agora alimentados pela conta resolvida. `boletos.bank_account_id` (nullable) grava qual conta foi a origem.
>
> **Retrocompatibilidade:** `GET|PATCH /v1/tenant` mantém o mesmo contrato de sempre para os campos bancários, delegando por trás para a conta padrão da empresa padrão do tenant — comportamento byte-idêntico ao anterior para quem nunca cadastrou uma 2ª conta. Correção incluída: `GET /v1/tenant` passou a mascarar `itau_client_secret` (`****xxxx`), corrigindo uma inconsistência com o padrão já usado em `nfe_configs`/Focus tokens.
>
> **Arquitetura:** domínio puro em `src/domain/bankAccount/bankAccountDomain.ts` (`canDeactivate` — invariante por empresa, não por tenant), serviço em `src/services/bankAccountService.ts` (reaproveita `validateBankingData()`/`isValidBillingProvider()` de `lib/banking.ts`, já existentes), rotas em `src/routes/bankAccounts.ts`. Ver regra 41 para o detalhamento completo.
>
> **Frontend:** `CompanyPage.tsx` (aba Bancário) ganha seletor de empresa + conta em duas camadas de progressive disclosure, reaproveitando o formulário existente. `ReceivablesPage.tsx` ganha seletor opcional de conta bancária na emissão de boleto.
>
> **Testes:** 22 testes novos — `bankAccountDomain.test.ts` (6, puro), `bankAccounts.test.ts` (9, rotas), `billingBankAccount.test.ts` (3, regressão + fix na emissão de boleto), `tenantBankAccount.test.ts` (4, retrocompatibilidade de `/v1/tenant`).
>
> **Soft-delete:** `bank_accounts.is_active = false` — bloqueado pelo domínio (`canDeactivate`) se a conta for a padrão ou a última ativa da sua empresa.

### v19.0 — Multi-Empresa (Multi-CNPJ) na Emissão Fiscal

> **Migration 0046.** `nfe_configs` promovido de singleton por tenant (`tenant_id` era PRIMARY KEY) para N por tenant — cada linha é uma empresa/CNPJ. Nova PK `id`, mais `is_default` (qual empresa é usada quando nenhuma é escolhida) e `is_active` (soft-delete). `company_id` (nullable, FK para `nfe_configs.id`) adicionado a `invoices`, `nfse_invoices` e `service_contracts` — os três pontos onde a identidade fiscal emissora importa de verdade. Toda linha existente de `nfe_configs` virou automaticamente a empresa padrão do seu tenant; todo `invoice`/`nfse_invoice`/`service_contract` histórico foi backfillado com o `company_id` da empresa padrão — nenhuma linha fica órfã.
>
> **Segurança do módulo: criar uma 2ª+ empresa exige `multi_empresa` habilitado.** Mesmo mecanismo genérico de `tenant_modules` já usado por `service_orders` (regra 38) — `POST /v1/companies` é gated por `requireModule('multi_empresa')`; listar/editar a empresa que já existe nunca é gated (não é a capacidade nova). Enquanto o módulo está desligado (padrão), o sistema se comporta byte-a-byte como antes da migration: 1 empresa por tenant, resolvida sempre pela mesma linha.
>
> **Onde "qual CNPJ emite" passou a ser resolvido de verdade — não só cosmético:** `POST /v1/invoices/:id/emit`, `POST /v1/nfse/:id/emit`, `POST /v1/service-contracts/:id/billings` e `POST /v1/tax/calculate` agora resolvem a empresa via `companyService.resolveCompanyId()` em vez de assumir uma única config fiscal por tenant. Prova de regressão + prova do fix em `nfeEmit.test.ts`: tenant sem multi-empresa emite exatamente como antes; invoice com `company_id` de uma empresa não-padrão emite com o CNPJ/razão social/token daquela empresa.
>
> **Escopo deliberadamente restrito a emissão fiscal nesta versão — documentado como limitação conhecida (regra 40), não esquecimento:** `payables`, `purchase_orders`, `supplier_invoices`, `receivables`, `proposals`, `orders` e POS/NFC-e continuam sem `company_id` — ficam para uma fase futura. **Atualização (v20.0):** boleto/Itaú deixou de ser 1:1 por tenant — ver regra 41 (`bank_accounts`).
>
> **Arquitetura:** domínio puro em `src/domain/company/companyDomain.ts` (`canDeactivate`, `validateNewCompanyCnpj` — reaproveita `cnpjDomain.ts` da regra 36), serviço único de resolução em `src/services/companyService.ts`, rotas em `src/routes/companies.ts`. `GET|PUT /v1/nfe-config` (legado) continua funcionando sem nenhuma mudança de contrato — por trás, opera sobre a empresa padrão via `companyService`.
>
> **Frontend:** `CompanyPage.tsx` (aba Fiscal) ganha seletor de empresa com progressive disclosure (só aparece com >1 CNPJ), reaproveitando o mesmo formulário existente — sem duplicação de JSX. `InvoiceNewPage.tsx` e `ContractsPage.tsx` ganham seletor opcional de "Empresa emissora", mesma regra de visibilidade. Aba **Módulos** ganha o card `multi_empresa` (mecanismo genérico já existente, só uma entrada de label nova).
>
> **Testes:** 27 testes novos — `companyDomain.test.ts` (10, puro), `companies.test.ts` (10, rotas — inclui a prova explícita do gate 403/módulo desligado), `nfeEmit.test.ts` (4, regressão + fix no ponto de emissão), mais casos de multi-empresa adicionados a `tax.test.ts`, `nfse.test.ts`, `invoicesCompany.test.ts` e `serviceContractsCompany.test.ts`.
>
> **Soft-delete:** `nfe_configs.is_active = false` — bloqueado pelo domínio (`canDeactivate`) se a empresa for a padrão ou a última ativa do tenant.

### v18.0 — Contatos de Fornecedor

> **Migration 0045.** `supplier_contacts` — mesma ideia de `client_contacts` (lista de contatos por tipo, com nome/e-mail/telefone/observações), aplicada ao cadastro de fornecedores.
>
> **Correção de padrão, não cópia cega:** `client_contacts.ts` ainda usa o padrão legado de `tenant_id` vindo do body/query (regra 4 — exceção temporária). O novo `supplierContacts.ts` foi implementado já com o padrão correto (`tenantId` do JWT via `authenticate`), mesmo padrão que `suppliers.ts` já usa — ver regra 39 para o raciocínio completo.
>
> **Tipos de contato adaptados ao papel do fornecedor:** `comercial | financeiro | suporte | logistica | outro` — não reaproveita os tipos de `client_contacts` (`comprador`/`compras` descrevem quem compra de nós, não fazem sentido do lado do fornecedor).
>
> **Frontend:** terceira aba "Contatos" em `SuppliersPage.tsx` (ao lado de Dados Gerais/Dados Bancários), visível apenas em modo edição — segue o padrão de abas que a própria página já usa, não o layout de rolagem única de `ClientsPage.tsx`.
>
> **Testes:** `supplierContacts.test.ts` — 10 testes cobrindo autenticação, isolamento por tenant, validação de `contact_type` e soft-delete.
>
> **Soft-delete:** `supplier_contacts.is_active = false` (nunca deletado fisicamente) — mesmo padrão de `client_contacts`, agora também documentado na tabela de soft-delete (lacuna pré-existente corrigida nesta versão).

### v17.0 — Ordens de Serviço / Visita Técnica (módulo opcional por tenant)

> **Migration 0044.** Primeiro módulo verticalizado do produto — não compete com ERPs de SMB genéricos, abre um segmento (equipamentos, climatização, elétrica, manutenção industrial) onde nenhum concorrente direto de SMB tem um módulo de OS decente.
>
> **Habilitação sob demanda:** `tenant_modules (tenant_id, module_key, enabled)` — flag genérica, desligada por padrão, reaproveitável por módulos opcionais futuros. Toggle em Minha Empresa → Módulos (`GET|PATCH /v1/tenant/modules`). Toda rota do módulo é gated por `requireModule('service_orders')` — backend é sempre a autoridade, nunca o frontend.
>
> **Técnico é usuário autenticado, não link público anônimo:** `users.role = 'technician'` (CHECK constraint ampliado) + `technicians` (1:1 obrigatório com `users`, CPF capturado uma vez no cadastro). O e-mail de agendamento (`service_visit_assigned`) carrega um link de *roteamento*, não de autorização — toda ação exige JWT + `technician_id` da visita batendo com o técnico logado. `technicianRoleGuard` (hook global) restringe esse papel ao prefixo `/v1/technician/*`, fechando o que seria uma lacuna de acesso a todo o resto da API.
>
> **Fotos e assinatura do cliente:** upload direto do navegador para o S3 via presigned POST (nunca proxiado pela API), bucket privado com SSE-KMS + Block Public Access + CORS restrito. Assinatura é artefato 1:1 com a visita (`service_visits.signature_s3_key`), fotos são galeria N:1 (`service_visit_photos`, idempotente, append-only). Compressão client-side (Canvas, ~1600px/JPEG80) antes do upload — controle de custo sem Lambda de processamento de imagem.
>
> **Arquitetura:** Clean Architecture — `src/domain/serviceOrder/`, `src/domain/serviceVisit/` (puro, testado — 35 testes novos), `src/services/serviceOrderService.ts`, `serviceVisitService.ts`, `technicianService.ts`, `servicePhotoStorageService.ts`, `tenantModuleService.ts`, `src/routes/serviceOrders.ts`, `technicians.ts`, `technicianPortal.ts`, `tenantModules.ts`.
>
> **Frontend:** `ServiceOrdersPage.tsx`, `TechniciansPage.tsx` (backoffice, dentro do grupo de nav "Campo" — só aparece se o módulo estiver habilitado) e um portal do técnico separado (`TechnicianLoginPage.tsx`, `TechnicianVisitsPage.tsx`, `TechnicianVisitDetailPage.tsx`, `TechnicianLayout.tsx`) fora do `<Layout>` administrativo — captura de foto com compressão e assinatura em `<canvas>` via `lib/visitUpload.ts`.
>
> **Soft-delete:** `service_orders.status = 'cancelled'` · `service_visits.status = 'cancelled'` · `technicians.is_active = false` (também desabilita o login). `service_visit_photos` é append-only.

### v16.0 — P1 NF-e de Entrada + P2 Pedido de Compra + P3 DRE Gerencial

> **Arquitetura:** Clean Architecture com DDD em 3 camadas para cada módulo:
> - Domínio puro (`src/domain/*/`) — state machine, validação, fórmulas. Zero I/O, 100% testável.
> - Serviços de aplicação (`src/services/`) — orquestração de I/O + domínio. Injeção de db para testabilidade.
> - Rotas HTTP (`src/routes/`) — adapter Fastify, extrai tenantId do JWT (regra 4), delega a serviços.
>
> **P2 — Pedido de Compra (migrations 0040):**
> `purchase_orders` + `purchase_order_items`. State machine: `draft → approved → received | cancelled`. Aprovação marca `approved_by`/`approved_at`. Recebimento é acionado automaticamente pela confirmação da NF-e de entrada vinculada. `purchaseOrderDomain.ts` valida transições e calcula totais (com desconto/frete). `purchaseOrderService.ts` orquestra criação e transições.
>
> **P1 — NF-e de Entrada (migration 0041):**
> `supplier_invoices` + `supplier_invoice_items`. State machine: `draft → confirmed | divergence | cancelled`. Confirmação (`confirmSupplierInvoice`): (1) cria `payable` automaticamente, (2) registra `inventory_movements type='in'` por item com `material_id`, (3) executa 3-way matching contra PO vinculado via `matchAgainstPO()` — status fica `divergence` se quantidade/preço diferirem. `purchase_order_id` é FK opcional para 3-way match. NF-e de entrada tem foco em dados manuais (número, chave, data, itens) por enquanto — integração com Focus manifesto do destinatário reservada para v1 do módulo de compliance fiscal.
>
> **P3 — DRE Gerencial (migration 0042):**
> `dre_categories` (14 categorias globais pré-seedadas seguindo padrão CFC) + `payables.dre_category_id` (FK opcional). DRE Gerencial (Caminho A — sem dupla entrada): receita = NF-e autorizadas no período; despesas = payables por `dre_category_id`. Fórmula em `dreDomain.buildDRE()` — puro, testável. `dreService.computeDRE()` faz as queries e chama o domínio. Totalizadores: Receita Líquida, Lucro Bruto + Margem, EBITDA + Margem, EBT, Resultado Líquido + Margem. **Não substitui SPED Contábil/ECD.** Ver regra 35.
>
> **Frontend:** `PurchaseOrdersPage.tsx`, `SupplierInvoicesPage.tsx`, `DREPage.tsx` (cards de KPI + tabela contábil com totalizadores intermediários + disclaimer gerencial). Nav em grupos Inventário (compras) e Financeiro (DRE).
>
> **Testes:** 38 testes unitários novos — `purchaseOrderDomain.test.ts` (16), `supplierInvoiceDomain.test.ts` (16), `dreDomain.test.ts` (6).
>
> **Soft-delete:** `purchase_orders.status = 'cancelled'` · `supplier_invoices.status = 'cancelled'`.

### v15.0 — Motor Fiscal Multi-estado (ICMS/FCP/DIFAL/Simples Nacional)

> **Migration 0037_tax_rules.sql:**
> Cinco tabelas fiscais centrais mantidas pela Orquestra (não editáveis por tenant).
> `tax_icms_interstate_rates`: 702 registros gerados via regra legal da Resolução do Senado 22/89 (Sul/Sudeste-sem-ES → demais = 7%; outros pares = 12%).
> `tax_icms_internal_rates`: alíquota "modal" de referência por UF — **revisar com contabilidade antes de produção** (coluna `notes` documenta isso explicitamente).
> `tax_fcp_rates` e `tax_st_rules`: estrutura criada sem dados — popular por demanda (FCP) e via provedor de dados fiscais (ICMS-ST, ver regra 33).
> `tax_simples_nacional_brackets`: Anexo I (Comércio), 6 faixas da LC 123/2006 pós-reforma 2018.
> Colunas novas: `tenants.simples_rbt12`; `invoices.fcp_total`/`icms_difal_total`; `invoice_items.fcp_rate`/`fcp_value`/`icms_difal_value`.
>
> **Arquitetura do motor (3 camadas):**
> `taxRulesResolver.ts` (lookup de alíquotas, cache 5 min) → `taxCalculationService.ts` (orquestração: DIFAL/FCP) → `taxEngine.ts` (aritmética pura/stateless).
> `POST /v1/tax/calculate` agora é autenticado (regra 4) e usa `nfe_configs.uf` como origem por padrão — nunca mais hardcode `'SP'`.
>
> **DIFAL (EC 87/2015):** lançado automaticamente quando venda é interestadual + `client.icms_taxpayer='9'` + `client.consumer_type='1'`. Fórmula simplificada (sem gross-up do Anexo VI). Ver regra 33 para limitações documentadas.
>
> **Simples Nacional:** `taxRulesResolver.getSimplesEffectiveRate()` usa fórmula oficial LC 123 e o `tenants.simples_rbt12` configurado em Empresa → Fiscal. Para NF-e: ICMS/PIS/COFINS continuam zerados (correto — impostos no DAS); alíquota efetiva é informativa via `GET /v1/tax/simples-effective-rate`.
>
> **Correções incluídas:** `focusNfe.ts` (NFC-e/PDV) parou de mandar `icms_aliquota: 0` fixo — agora resolve via `taxRulesResolver.getIcmsRate(cfg.uf, cfg.uf, db)` (intra-estado, com fallback 0 nunca bloqueante).
>
> **Frontend:** `InvoiceNewPage` usa `nfe_configs.uf` como origem real, auto-preenche UF destino pelo estado do cliente, passa `icms_taxpayer`/`consumer_type` para DIFAL correto, e exibe linhas de FCP e DIFAL no Step 5 quando > 0. `CompanyPage → Fiscal`: novo campo RBT12 (Simples Nacional), condicional ao regime CRT=1.
>
> **Testes:** 49 novos testes unitários (`taxRulesResolver`, `taxEngine`, `taxCalculationService`, `tax` route).

### v14.0 — Cadastro de Vendedores + Motor de Comissionamento

> **Vendedores (migration 0036):**
> Novo módulo `sellers`, desacoplado de `users` — login via `user_id` é opcional (representante externo não precisa de acesso ao sistema).
> `sellers`: `id`, `tenant_id`, `user_id` (nullable), `name`, `email`, `phone`, `document`, `default_commission_pct NUMERIC(5,2)`, `commission_base VARCHAR(20)` (`'subtotal'` ou `'total'` — padrão `'subtotal'`, pós-desconto e pré-imposto), `is_active BOOL DEFAULT true`.
>
> **Atribuição de venda:** `orders.seller_id` e `invoices.seller_id` — nullable, `ON DELETE SET NULL`, mesmo padrão de fan-out de `cost_center_id` (v13.0). Não preencher não quebra nenhum pedido/nota existente. `POST /v1/invoices` herda `seller_id` do pedido de origem (`order_id`) quando não informado explicitamente.
>
> **Gatilho de comissão — sempre na autorização da NF-e:**
> - Lançamento: `nfeResultsWorker.ts` chama `accrueCommission()` no mesmo bloco que já faz a baixa de estoque do centro de custo, quando `invoices.nfe_status` vira `'authorized'` e a nota tem `seller_id`.
> - Cancelamento: `POST /v1/invoices/:id/cancel` chama `cancelCommission()` quando a nota cancelada estava autorizada — nunca deleta o registro, apenas marca `status = 'cancelled'` (regra 8).
>
> **Motor (`commissionService.ts`):** `accrueCommission`, `cancelCommission`. Idempotência via UNIQUE `(tenant_id, idempotency_key)` com chave `invoice:${invoiceId}` — uma NF-e gera no máximo uma comissão. `commission_amount = round2(base_amount * rate / 100)`.
>
> **`commission_entries`** (ledger, nunca deletado): `id`, `tenant_id`, `seller_id`, `invoice_id`, `order_id`, `base_amount`, `rate`, `commission_amount`, `status` (`'accrued'` | `'cancelled'`), `idempotency_key`, `cancelled_at`.
>
> **API:** 7 rotas em `sellers.ts` (CRUD + soft-delete + `/active` + `/:id/commissions` extrato) e `GET /v1/reports/commissions` (ranking gerencial por vendedor).
>
> **Frontend web:** `SellersPage.tsx` (CRUD list), `SellerDetailPage.tsx` (extrato de comissões com cards de resumo — total a receber / total cancelado). Dropdown de vendedor (opcional) em `OrdersPage.tsx` e `InvoiceNewPage.tsx`.

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
| client_contacts | `is_active` | `false` |
| materials | `is_active` | `false` |
| users | `status` | `'disabled'` |
| suppliers | `is_active` | `false` |
| supplier_contacts | `is_active` | `false` |
| nfe_configs (empresas) | `is_active` | `false` (bloqueado se for a padrão ou a última ativa — `companyDomain.canDeactivate`) |
| bank_accounts | `is_active` | `false` (bloqueado se for a padrão da empresa ou a última ativa daquela empresa — `bankAccountDomain.canDeactivate`) |
| material_marketplace_links | `status` | `'closed'` (não usa `is_active` — reaproveita a mesma coluna de status do ciclo de vida do anúncio) |
| cost_centers | `is_active` | `false` |
| sellers | `is_active` | `false` |
| orders | `status` | `'cancelled'` |
| invoices | `status` | `'cancelled'` |
| receivables | `status` | `'cancelled'` |
| payables | `status` | `'cancelled'` |
| service_contracts | `status` | `'cancelled'` |
| proposals | `status` | `'cancelled'` |
| purchase_orders | `status` | `'cancelled'` |
| supplier_invoices | `status` | `'cancelled'` |
| technicians | `is_active` | `false` (também desabilita `users.status='disabled'` do login vinculado) |
| service_orders | `status` | `'cancelled'` |
| service_visits | `status` | `'cancelled'` |
| boleto_events, nfe_events, nfse_events, cost_center_movements, service_visit_photos | — | append-only, nunca deletar |

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
