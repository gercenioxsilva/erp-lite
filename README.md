# Orquestra ERP — SaaS Multi-tenant ERP on AWS

> **Este README é o prompt principal para geração de código por IA.**
> Antes de implementar qualquer funcionalidade, leia este arquivo na íntegra.
> Ele define a fonte da verdade sobre arquitetura, convenções e regras de negócio do backoffice **web** (`apps/backoffice`) e da API (`services/api-core` + `services/lambda-*`).
> **Não existe app mobile neste repositório** — só `apps/backoffice`. Se alguma referência a Flutter/mobile aparecer em código antigo ou comentário, é resíduo a ignorar, nunca fonte de verdade.

---

## Protocolo Anti-alucinação (leia primeiro)

Regras que toda IA assistindo este projeto DEVE seguir antes de gerar código. Fatos que mudam com frequência (schema exato, lista de rotas) **apontam para o código-fonte em vez de serem copiados aqui** — copiar gera drift (este README já teve isso corrigido uma vez; não repetir).

1. **Nunca inventar tabelas ou colunas.** Fonte de verdade: `services/api-core/src/db/schema.ts` (definição Drizzle) + `services/api-core/db/migrations/00NN_*.sql` (histórico cumulativo, nunca destrutivo). Antes de usar qualquer tabela/coluna, `grep` o nome em `schema.ts` — nunca assumir que existe pela lembrança de uma feature. Tabelas existentes (nomes, para varredura rápida — schema completo de cada uma está em `schema.ts`): `tenants`, `users`, `materials`, `material_images`, `material_price_history`, `inventory`, `inventory_movements`, `clients`, `client_contacts`, `orders`, `order_items`, `invoices`, `invoice_items`, `nfe_configs`, `nfe_events`, `notification_configs`, `receivables`, `receivable_payments`, `payables`, `payable_payments`, `boletos`, `boleto_events`, `service_contracts`, `contract_billings`, `nfse_invoices`, `nfse_events`, `suppliers`, `supplier_contacts`, `proposals`, `proposal_items`, `cost_centers`, `cost_center_stock`, `cost_center_movements`, `sellers`, `commission_entries`, `tax_icms_interstate_rates`, `tax_icms_internal_rates`, `tax_fcp_rates`, `tax_st_rules`, `tax_simples_nacional_brackets`, `tax_ibs_cbs_rates`, `purchase_orders`, `purchase_order_items`, `supplier_invoices`, `supplier_invoice_items`, `dre_categories`, `tenant_modules`, `technicians`, `service_orders`, `service_order_items`, `service_visits`, `service_visit_photos`, `bank_accounts`, `marketplace_connections`, `material_marketplace_links`, `marketplace_webhook_events`, `plans`, `billing_events`, `simples_remessas`, `simples_remessa_items`, `simples_remessa_events`, `sales_pipeline_stages`, `sales_opportunities`, `sales_opportunity_activities`, `access_profiles`, `access_profile_permissions`, `access_profile_events`, `employees`, `payroll_runs`, `payroll_entries`, `payroll_tax_brackets`, `pos_terminals`, `pos_sessions`, `pos_cash_movements`, `pos_sales`, `pos_sale_items`, `pos_sale_payments`, `scheduling_settings`, `scheduling_professionals`, `scheduling_areas`, `scheduling_professional_areas`, `scheduling_availability_rules`, `scheduling_availability_exceptions`, `scheduling_package_templates`, `scheduling_client_packages`, `scheduling_sessions`, `scheduling_calendar_connections`, `scheduling_package_movements`, `whatsapp_accounts`, `whatsapp_message_templates`, `whatsapp_automations`, `whatsapp_messages`, `whatsapp_message_events`, `whatsapp_webhook_events`, `projects`, `project_professionals`, `contract_field_definitions`, `contract_field_values`, `api_keys`, `api_key_usage`, `payment_plans`, `payment_plan_installments`, `service_visit_field_definitions`, `service_visit_field_values`.

2. **Nunca inventar rotas de API.** Fonte de verdade: `grep -n "fastify\.\(get\|post\|patch\|delete\)(" services/api-core/src/routes/*.ts` — se uma rota não aparece nesse grep, ela não existe, crie antes de usar. Toda rota autenticada usa `onRequest: [(fastify as any).authenticate]` e extrai `tenantId` de `request.user.tenantId` (nunca do body/query, exceto a exceção legada documentada na regra 4). Domínios cobertos hoje (um arquivo de rota por domínio em `routes/`, nome do arquivo = nome do domínio): auth (login/registro/verificação de e-mail/reset de senha), clients (+ contacts + import + history 360°), materials (+ images + import + price-history + marketplace-links), stock, orders, invoices (+ emit/cancel/nfe-status/events), nfse, simples-remessas, tax (calculate + simples-effective-rate), nfe-config, companies (multi-empresa), bank-accounts, receivables (+ payments + emit-boleto), payables (+ payments), suppliers (+ contacts + payables), service-contracts (+ billings), users, access-profiles (RBAC), employees + payroll (RH), tenant (+ logo + modules), notification-config, proposals (+ send/convert/duplicate/cancel/print + portal público `/public/proposals/:token`), dashboard (+ cashflow), reports (overdue/top-products/commissions/dre), cost-centers (+ active/stock/movements/entries/adjustments), sellers (+ active/commissions), purchase-orders (+ approve/cancel), supplier-invoices (+ confirm/cancel/lookup-by-key/document), technicians (+ resend-invite), service-orders (+ visits/billing/print/cancel), technician (portal do técnico, `/v1/technician/*`, role-gated), integrations/mercadolivre (+ callback público + webhook público), subscription (Stripe, + webhook público), sales-pipeline (stages + opportunities + activities), pos (terminais/sessões/vendas), scheduling (+ scheduling-portal + scheduling-sessions + calendar-integration), whatsapp (account + templates + automations + messages + webhook público `/public/whatsapp/webhook`), projects (+ professionals + orders + service-orders + start/complete/cancel), engine (API do Motor Fiscal por chave `X-API-Key`, `/v1/engine/*`, sem JWT) + engine-keys (autoatendimento de chave, JWT), lead-capture (`POST /v1/public/leads` por chave `X-API-Key`, sem JWT) + lead-capture-keys (autoatendimento de chave, JWT), payment-plans (CRUD do catálogo de planos de pagamento + `/active`, regra 75).

3. **Nunca inventar componentes, hooks ou classes CSS.** Componentes React em `apps/backoffice/src/components/` e `apps/backoffice/src/pages/`. Classes CSS em `apps/backoffice/src/index.css` — ler antes de usar. Padrão de abas usa **inline styles**, não classes CSS (ver `CompanyPage.tsx`).

4. **Nunca usar `tenant_id` do body da requisição em código novo.** Vem sempre do JWT (`request.user.tenantId`). Exceção legada isolada: `client_contacts.ts` (histórica, documentada na regra 39 — nunca copiar esse padrão para código novo).

5. **Nunca assumir que uma biblioteca está instalada** sem checar `package.json` (`services/api-core/package.json`, `apps/backoffice/package.json`).

6. **Sempre ler o arquivo antes de editá-lo.** Usar o conteúdo real, nunca o que foi lembrado de sessões passadas.

7. **Sempre adicionar chaves de i18n nos dois arquivos**: `apps/backoffice/src/i18n/pt-BR.ts` (source of truth de `TKey`) e `en.ts` (mesmas chaves, senão o TypeScript não compila).

8. **Nunca deletar fisicamente registros.** Ver tabela de soft-delete por módulo na seção "Adicionando um novo módulo".

9. **Nunca concatenar strings em SQL.** Rotas usam Drizzle ORM (`db.select/insert/update/transaction`); SQL bruto usa `sql\`... ${valor} ...\`` (parametrização automática).

10. **Ao adicionar um novo módulo**, seguir o checklist da seção "Adicionando um novo módulo".

11. **Nunca carregar dropdowns do drawer em event handlers.** Padrão: `useEffect([drawerOpen, tenantId])` com flag de cancelamento (chamar de `openCreate()` cria stale-closure). `<form>` usa `noValidate`; erro usa `role="alert"`.

12. **Nunca usar `per_page` acima de 100.** A API impõe `Math.min(per_page, 100)` em toda rota de listagem — valores maiores são truncados silenciosamente.

13. **Importação em lote: parsear no frontend (SheetJS/`xlsx`), enviar JSON.** Nunca fazer upload de arquivo binário para o servidor.

14. **Cálculo de impostos: 3 camadas separadas, nunca misturar responsabilidades.** `taxRulesResolver.ts` (lookup de alíquotas — ICMS interno/interestadual, FCP, ST, Simples, IBS/CBS — cache 5 min, nunca chamado direto de rotas) → `taxEngine.ts` (aritmética pura/stateless, alíquotas já resolvidas, nunca faz I/O) → `taxCalculationService.ts` (orquestra: resolve alíquotas, determina DIFAL quando `icms_taxpayer='9'`+`consumer_type='1'`+interestadual, FCP/IBS/CBS da UF destino). `POST /v1/tax/calculate` usa `nfe_configs.uf` como origem (nunca hardcode `'SP'`). ICMS/PIS/COFINS/FCP são "por dentro"; IPI é "por fora"; IBS/CBS são calculados mas nunca somados ao total (regra 44).

15. **Lambda container images: sempre `platforms: linux/amd64` + `provenance: false`** nos steps `docker/build-push-action` do CI/CD — sem isso o Buildx gera manifest list que o Lambda rejeita.

16. **Nunca definir variáveis reservadas do Lambda runtime** (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, demais `AWS_LAMBDA_*`) em `environment.variables` do Terraform — o runtime já injeta, redefinir causa `InvalidParameterValueException`.

17. **`GaxLogo.tsx` é o logo Orquestra ERP — não recriar nem renomear.** Arco 270° gradiente `#3B5CE4→#00B4D8`, wordmark "Orquestra" + "ERP". Tamanhos: `sm=28`, `md=36`, `lg=48`, `xl=64`, `xxl=88` (px).

18. **Domínio público: `orquestraerp.com.br`.** Nunca usar `*.cloudfront.net` como URL pública pro usuário final.

19. **Paleta atual em `apps/backoffice/src/index.css`**: `--primary: #3B5CE4`, `--primary-h: #2945C8`, `--accent: #00B4D8`. Nunca usar cores da identidade anterior.

20. **PostgreSQL `ALTER TABLE` multi-coluna: nunca usar parênteses** (`ADD COLUMN (col1, col2)` é sintaxe MySQL). Uma cláusula `ADD COLUMN` por coluna, separadas por vírgula.

21. **SSL do Pool pg**: `ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false` — nunca `ssl: false` fixo com `PGSSLMODE=require` no ambiente.

22. **Formulários aninhados (`<form>` dentro de `<form>`) são inválidos em HTML.** Usar `<div>` + `type="button" onClick={handler}` para submit interno.

23. **Notificações: `sendNotificationIfEnabled(payload)` (verifica `notification_configs` do tenant, eventos de negócio) vs. `sendSystemNotification(payload)` (envia direto, e-mails sistêmicos).** Fire-and-forget, nunca bloqueia a resposta da API.

24. **NFS-e vs NF-e: nunca misturar.** NFS-e usa `/v2/nfse` (ISS, exige `inscricao_municipal`+`codigo_servico`); NF-e usa `/v2/nfe` (ICMS, exige NCM/CFOP). Mesma fila SQS e mesma Lambda, discriminados por `type`.

25. **CEP via ViaCEP direto do browser — nunca criar endpoint backend.** `fetchAddressByCEP(cep)` em `apps/backoffice/src/lib/brazil.ts` chama `viacep.com.br` direto.

26. **Workers rodam in-process dentro do container `api-core` (ECS), hook `onReady` do Fastify — nunca criar infra AWS nova para worker.**

27. **`ModalContext` tem `confirm()`, `error(err)`, `success(message, title?)` — nunca usar `error()` para sucesso.**

28. **`lambda-notifications` é ECR container — sempre reimplantar ao adicionar tipo de notificação**, senão a mensagem SQS vai ao DLQ.

29. **Focus NF-e `caminho_danfe` é path relativo, não URL absoluta.** Usar `toDanfeAbsoluteUrl` (`InvoicesPage.tsx`) para converter.

30. **Centro de Custo: `costCenterStock.ts` é a única fonte de verdade de saldo de materiais.** Toda escrita usa `SELECT FOR UPDATE` dentro de `db.transaction()`. Idempotência via `${source}:${sourceId}:${materialId}` UNIQUE por `(tenant_id, idempotency_key)`. Custo médio ponderado usa `toFixed(4)`. Saldo negativo bloqueado por padrão (422), override via `allow_negative=true`. Gatilho de saída: `nfe_status='authorized'` no `nfeResultsWorker`; estorno: cancelamento de NF-e autorizada. Nunca chamar `applyEntry`/`applyExit`/`applyAdjustment` fora do serviço.

32. **Comissão de vendedor: sempre lançada na autorização da NF-e, nunca antes.** `sellers` é entidade desacoplada de `users` (`user_id` opcional). `commissionService.ts` é a única fonte de verdade: `accrueCommission()` roda no `nfeResultsWorker.ts` quando `nfe_status` vira `'authorized'` e a nota tem `seller_id` — base de cálculo definida por `sellers.commission_base`. `cancelCommission()` roda em `POST /invoices/:id/cancel`, nunca deleta, marca `commission_entries.status='cancelled'`. Idempotente via UNIQUE `(tenant_id, idempotency_key='invoice:${invoiceId}')`. O mesmo bloco de autorização também cria a conta a receber (regra 60).

33. **Motor fiscal multi-estado: tabelas centrais nunca editáveis por tenant.** `tax_icms_interstate_rates`, `tax_icms_internal_rates`, `tax_fcp_rates`, `tax_st_rules`, `tax_simples_nacional_brackets` são mantidas pela Orquestra. Configurável por tenant: `nfe_configs.uf`, `nfe_configs.regime_tributario`, `tenants.simples_rbt12`. **Limitações conhecidas, documentar sempre, nunca afirmar que não existem**: ICMS-ST sem dados populados; FCP sem dados populados; DIFAL usa diferença direta (não o gross-up do Convênio 236/2021); sem versionamento temporal de alíquota (sempre a corrente); sem conteúdo de importação (Resolução Senado 13/2012).

34. **Pedido de Compra / NF-e de Entrada: Clean Architecture 3 camadas.** Domínio puro em `domain/purchaseOrder/` e `domain/supplierInvoice/` (state machine, 3-way matching); serviços em `services/purchaseOrderService.ts`/`supplierInvoiceService.ts` (orquestração/I-O); nunca chamar domínio de rota nem I-O de dentro do domínio. `confirmSupplierInvoice()` cria `payable` + movimenta estoque de entrada — nunca duplicar. 3-way matching (`matchAgainstPO`) devolve `'divergence'` quando qtd/preço diverge do PO — payable é criado mesmo assim, PO não avança pra `'received'`.

35. **DRE Gerencial é Caminho A (sem dupla entrada contábil) — nunca afirmar equivalência com SPED Contábil/ECD.** `domain/dre/dreDomain.ts` (fórmula pura) + `services/dreService.ts` (lê invoices/payables/nfse_invoices autorizada). `dre_categories` globais (`tenant_id NULL`) + customizadas por tenant; `payables.dre_category_id` nullable cai em "Outras Despesas". Despesas `sign=-1`, receitas `sign=+1` — nunca inverter.

36. **CNPJ Alfanumérico (IN RFB 2.229/2024): nunca usar `digits()`/`replace(/\D/g,'')` em campo CNPJ.** A partir de jul/2026 CNPJs trazem letras A-Z nos 12 primeiros caracteres. `normalizeCNPJ()` remove só pontuação, preserva letras, grava maiúsculo. Domínio: `services/api-core/src/domain/cnpj/cnpjDomain.ts` (backend) + `apps/backoffice/src/lib/brazil.ts` (frontend) — sempre chamar `normalizeCNPJ()` nos pontos de escrita, nunca `digits()`. CNPJs válidos pra teste: `AAAAAA00000171`, `B2C3D4E5F6G185`, `ORQUESTRA01269`, `ZZTESTE0000198` (o CNPJ de exemplo da documentação do CNPJ.ws, `UKPVME1E8HI996`, tem dígito verificador inválido — não usar em testes).

37. **Impressão de Proposta: reaproveitar `ProposalDocument.tsx`, nunca duplicar layout.** Usado tanto pelo portal público (`ProposalPublicPage.tsx`) quanto pela impressão interna (`ProposalPrintPage.tsx`, via `GET /v1/proposals/:id/print`, autenticado, qualquer status). Nunca abrir `/p/:token` para uso interno — muda `status` pra `'viewed'`. Formatação de CNPJ/CPF sempre via `fmtDoc()`. Impressão usa `window.print()` nativo — sem `jsPDF`/`puppeteer`/`@react-pdf`.

38. **Ordens de Serviço / Visita Técnica: módulo opcional (`requireModule('service_orders')`), Clean Architecture.** Domínio em `domain/serviceOrder/`, `domain/serviceVisit/`; serviços em `services/serviceOrderService.ts`, `serviceVisitService.ts`, `technicianService.ts`, `servicePhotoStorageService.ts`. Técnico é `users.role='technician'` com login obrigatório — nunca link público anônimo; `technicianRoleGuard` restringe esse papel ao prefixo `/v1/technician/*`. CPF/nome são "congelados" (snapshot) em `service_visits` no check-in. Fotos/assinatura sobem direto do browser pro S3 via presigned POST (`service_visit_photos`, bucket privado, SSE-KMS); leitura só via presigned GET de curta duração. Assinatura é eletrônica simples (Lei 14.063/2020) — nunca afirmar equivalência com ICP-Brasil.

39. **`supplier_contacts` espelha `client_contacts` na estrutura, mas usa o padrão de auth correto (JWT), não o legado do body.** `client_contacts.ts` é a exceção histórica da regra 4 — nunca copiar esse padrão pra módulo novo; `supplier_contacts.ts` é a referência correta. Tipos de contato diferem: `client_contacts` usa papéis de quem compra de nós; `supplier_contacts` usa papéis do lado de quem vende pra nós — nunca reaproveitar um vocabulário no outro.

40. **Multi-Empresa: `nfe_configs` é a entidade "Empresa" (N por tenant, `id` é PK, `tenant_id` é FK comum).** `is_default` marca a usada por padrão; `is_active` é soft-delete. Criar 2ª+ empresa exige `requireModule('multi_empresa')`; listar/editar a existente nunca é gated. `company_id` (nullable, FK `nfe_configs.id`) existe em `invoices`, `nfse_invoices`, `service_contracts` — só onde "qual CNPJ emite" importa de fato. Fora de escopo (limitação conhecida): `payables`, `purchase_orders`, `supplier_invoices`, `receivables`, `proposals`, `orders`, POS/NFC-e continuam sem `company_id`. `companyService.ts::resolveCompanyId(tenantId, companyId?, db, docType?)` é o único ponto de resolução — `docType` (`'nfe'|'nfse'`) valida capacidade de emissão (regra 53). `GET|PUT /v1/nfe-config` (legado) sempre opera sobre a empresa padrão, retrocompatível byte-a-byte.

41. **Múltiplas Contas Bancárias: `bank_accounts` é N por empresa (`nfe_configs`), não por tenant, sem gate de módulo.** Colunas bancárias antigas em `tenants` ficam deprecated-mas-presentes (nunca lidas/escritas diretamente). `bankAccountService.ts::resolveBankAccount(tenantId, bankAccountId?, db)` é o único ponto de resolução — sem id, resolve a conta padrão da empresa padrão. `canDeactivate()` bloqueia desativar a última conta ativa de uma empresa. Credenciais de qualquer provedor (Itaú incluso, retroativamente) vivem em `bank_accounts.credentials` (jsonb genérico, regra 59).

42. **Integração Mercado Livre: conexão OAuth é por EMPRESA (`nfe_configs`), não por tenant.** `marketplace_connections.company_id` NOT NULL, único por `(company_id, provider)`. Fase 1 (api-core: domínio, serviços, rotas, worker in-process) + Fase 2 (`services/lambda-marketplace`, Terraform, sync real) ambas concluídas. Lambdas nunca acessam Postgres direto — tokens/preço/estoque viajam via snapshot na própria mensagem SQS. `refresh_token` é uso único — `ensureFreshToken()` sempre devolve o par renovado em `refreshed_tokens`, e o worker de resultado sempre persiste esse campo, senão a conexão quebra na próxima chamada. Sync é só manual nesta fase (sem automação ao alterar preço/estoque no ERP). `signState`/`verifyState` protegem o callback OAuth contra CSRF via HMAC no próprio `state`, sem tabela nova. Webhook nunca é fonte de verdade, só gatilho — sempre responde 200 rápido. Módulo opcional `mercadolivre` (`requireModule`). Tokens em texto puro (mesma limitação de outros segredos do projeto — nenhum usa KMS hoje).

43. **Assinatura SaaS via Stripe: opt-in por `STRIPE_SECRET_KEY` — sem a env var, o módulo inteiro é no-op.** `stripeClient.ts::isStripeEnabled()` + `middleware/subscriptionGuard.ts` são a única fonte de verdade. **Checklist obrigatório pra qualquer env var nova lida via `process.env.X`**: (a) declarada em `terraform/variables.tf`, (b) presente no `environment` do recurso certo (ECS pra api-core, Lambda `environment.variables` pros lambdas), (c) passada via `TF_VAR_x` a partir de GitHub Secret no `deploy.yml` — faltar qualquer um quebra em produção silenciosamente. Tenants existentes nunca são afetados ao ligar o Stripe (`subscriptionGuard` libera incondicionalmente quando `status='trial'` e `trial_ends_at IS NULL`). `plans.stripe_price_id` precisa apontar pro MESMO modo (test/live) da secret key configurada. Webhook idempotente via `billing_events.stripe_event_id UNIQUE`; sem `STRIPE_WEBHOOK_SECRET`, pula verificação HMAC — nunca operar assim em produção.

44. **Reforma Tributária — campos IBS/CBS na NF-e/NFC-e (LC 214/2025), só modelo 55/65, NFS-e fica de fora (gap conhecido).** IBS/CBS em 2026 são só informativos — **nunca somados ao total cobrado do cliente** (`totals.ibs_total`/`totals.cbs_total` separados, nunca em `grand_total`). Alíquotas de teste fixas 2026: CBS 0,9% + IBS 0,1% (`getIbsCbsRates(uf, db)`, cache 5 min, fallback nunca bloqueia). `materials.class_trib` é override manual (nunca inferido de NCM/CFOP), default `'000001'`. IBS/CBS não são zerados para Simples Nacional/MEI (diferente de ICMS/FCP/DIFAL/PIS/COFINS). **`cbs_valor`/`ibs_uf_valor` sempre recalculados dentro de `buildItem()` (lambda-fiscal) a partir de `base × alíquota` — nunca confiar num valor já persistido em `invoice_items`**, pois o frontend não envia esses campos na criação da nota (ficam `0` no banco); recalcular no último ponto antes do Focus é a única fonte de verdade da aritmética que vai pra SEFAZ.

45. **Importação de materiais: SKU duplicado pode atualizar preço (opt-in via `update_existing`), toda mudança de preço gera histórico.** `dry_run` classifica sem escrever (mesmo shape de resposta que a escrita real). `update_existing` só atualiza `sale_price`/`cost_price` — nunca nome/categoria/NCM/marca, mesmo que a planilha traga. `material_price_history` é append-only (nunca UPDATE/DELETE), gravado na MESMA transação do update em `materials`, alimentado tanto pela importação (`source:'bulk_import'`) quanto por `PATCH /v1/materials/:id` (`source:'manual_edit'`). `cost_center_stock.avg_unit_cost` é snapshot próprio — mudar preço em massa não corrompe custo médio já lançado. `POST /v1/clients/import` continua skip-only em CNPJ/CPF duplicado (gap conhecido, mesmo padrão de solução se necessário no futuro).

46. **NF-e de Entrada: autofill pela chave de acesso via Focus NF-e/MDe.** `POST /v1/supplier-invoices/lookup-by-key` funciona porque, numa nota de entrada, o tenant é o destinatário (distribuição SEFAZ NFeDistribuicaoDFe). Depende do produto "Manifestação do Destinatário" ativo na conta Focus — sem isso, 404 tratado como resultado válido (`found:false`), nunca erro; formulário sempre preenchível manualmente. Rota é só leitura — nunca cria fornecedor nem grava a nota automaticamente. Limite de 20 consultas/hora por CNPJ (regra SEFAZ) — nunca usar em polling/lote.

47. **NF-e de Entrada: parcelamento automático mensal, estoque alimentado uma única vez por nota.** `installments > 1` gera N `payables` com vencimento mensal, resto de centavos na última parcela; `installment_group_id` não é FK, só correlaciona. Estoque só é alimentado uma vez mesmo se `confirmSupplierInvoice()` rodar duas vezes (transição `divergence → confirmed` só troca status, nunca refaz payable/estoque). Item vinculado a material via `ProductPicker` alimenta estoque de verdade; item sem `material_id` (avulso, ex. frete) não alimenta.

48. **Faturamento de Ordem de Serviço: gatilho sempre manual, nunca automático.** `POST /v1/service-orders/:id/billing` exige `status='completed'`; idempotência real é o UNIQUE parcial em `receivables.service_order_id` (no máximo um receivable por OS). NFS-e é opt-in por faturamento (checkbox `emit_nfse` no body), não uma preferência persistida — falha ao enfileirar nunca desfaz o receivable já criado. Cobrança (boleto+Pix) reaproveita 100% o fluxo já existente de `POST /v1/receivables/:id/emit-boleto`. DRE Gerencial soma NFS-e autorizada (`nfse_status='authorized'`) na receita bruta junto com `invoices`.

49. **NF-e de Entrada: editável em `draft` (via `PATCH`, delete+reinsert de itens), somente leitura em qualquer outro status — nunca editar nota já confirmada.** PDF/XML de nota de terceiro (`GET /:id/document?format=pdf|xml`) vai em base64 (nunca link direto ao Focus, por causa do Basic Auth) — indisponibilidade é resultado esperado (`found:false`), sempre 200.

50. **Assinatura Stripe: status desconhecido nunca vira `'trial'` silenciosamente.** `mapStripeStatus()` cobre todos os status reais do Stripe (`incomplete`/`paused`→`'past_due'`, `incomplete_expired`→`'canceled'`); qualquer status inesperado cai em `'past_due'` com log de aviso, nunca em `'trial'`. `subscriptionGuard` só reconhece `trial`/`active`/`past_due`/`canceled` — gap conhecido se o Stripe introduzir um 5º status.

51. **NF-e de Simples Remessa: entidade própria (`simples_remessas`), nunca um flag em `invoices` — operação não onerosa não gera receivable nem comissão.** Reaproveita a mesma fila/Lambda de NF-e comum, discriminada por `type:'remessa'`. CFOP e situação tributária são função do `motivo` (conserto/demonstração/comodato/industrialização/amostra grátis/devolução), nunca inferidos de NCM/CFOP — defaults precisam de validação contábil antes do primeiro uso real. **IBS/CBS: a alíquota enviada à SEFAZ nunca pode ser zero, mesmo em operação não onerosa** — a não incidência se expressa zerando a BASE de cálculo (`ibs_cbs_base_calculo:0`), nunca a alíquota (`resolveTaxSituation()` não resolve alíquota, é I/O; `getIbsCbsRates()` busca a real pela UF de destino). Estoque baixa na autorização e devolve no retorno, idempotente via `stock_applied_at`. Retorno é a mesma entidade com `parent_remessa_id` apontando pra original.

52. **Pedido de Compra: editável em `draft` (itens inclusos), somente leitura depois — mesmo padrão de NF-e de Entrada (regra 49).** **Nunca montar SQL de update concatenando string** (`sql.raw()` com interpolação direta já foi uma vulnerabilidade real de SQL injection aqui) — sempre usar Drizzle parametrizado (`update().set().where()`).

53. **Cada empresa (`nfe_configs`) declara se emite NF-e (`emite_nfe`), NFS-e (`emite_nfse`), ou ambos — dois booleans independentes, default `true`/`true`.** `resolveCompanyId(tenantId, companyId, db, docType?)`: `docType` omitido é retrocompatível (resolução sem relação com tipo fiscal); informado, resolve pela empresa certa ou devolve erro explícito (`company_missing_capability`, `no_company_for_doc_type`, `company_selection_required`) — nunca escolhe arbitrariamente por trás do usuário. 5 pontos de emissão informam `docType`: `routes/nfe.ts`, `routes/nfse.ts`, `routes/serviceContracts.ts`, `serviceOrderBillingService.ts`, `simplesRemessaService.ts`.

54. **Técnico é editável (nome/e-mail/telefone/CPF/especialidade), senha nunca é definida por edição — só reenvio de convite via o mesmo mecanismo de `password_reset_token`.** `materials.notes` é observação interna, distinta de `description` (buscável/usada em propostas). `GET /v1/service-orders/:id/print` ("espelho do técnico") devolve exatamente o que o técnico vê no portal — deliberadamente sem itens, pois o portal também não mostra itens.

55. **Funil de Vendas (CRM): módulo opcional (`requireModule('sales_pipeline')`), Kanban nativo sem dependência nova.** `status` (`open|won|lost`) é eixo separado de `stage_id` (etapa configurável pelo tenant, seed em `DEFAULT_STAGES`). Não confundir com `ProposalsFunnelPage.tsx` (relatório estático de conversão, sem código em comum). `convert-to-proposal` reaproveita 100% o schema/fluxo de Propostas já existente.

56. **RBAC: `users.role` reduzido a 2 papéis de sistema (`owner`, `technician`); o resto vira Perfil de Acesso configurável pelo tenant.** `access_profiles`/`access_profile_permissions` (grant = presença da linha, `resource`+`action` em `'view'|'manage'`) via `requireRole('owner')`/`requirePermission()`. `users.access_profile_id` é FK nullable — `NULL` pra `owner`/`technician`, que nunca usam perfil. **Achado de segurança corrigido nesta mesma migration**: `users.ts` lia `tenant_id` de query/body em vez do JWT, e faltavam checagens de posse em `PATCH`/`DELETE` — corrigido pra sempre usar `request.user.tenantId`.

57. **RH Simplificado: cadastro de funcionários + folha calculada, módulo opcional (`requireModule('hr')`) — ferramenta de cálculo/organização interna, nunca um sistema de folha certificado (nada envia ao eSocial).** `payroll_runs` fecha com `POST /payroll/:id/close` (irreversível, gera 1 `payable` por funcionário). `payroll_tax_brackets` é **global, sem `tenant_id`** — INSS/IRRF são faixas federais; faixa de IRRF acima de R$5.000 é aproximação não-oficial, documentar sempre.

58. **Ativação de Conta por E-mail: todo tenant novo nasce bloqueado até o owner confirmar o e-mail.** `tenants.activated_at` (nullable, `NULL` bloqueia) — backfillado com `created_at` pra tenant pré-existente, nunca afeta quem já usava o sistema. `users.email_verification_token/expires/verified_at` são colunas DEDICADAS, nunca reaproveitam `password_reset_token`.

59. **Boleto C6 Bank: 2º provedor de cobrança, credenciais genéricas por provedor (`bank_accounts.credentials`, jsonb) em vez de colunas nomeadas por banco.** C6 exige, além de `client_id`/`client_secret`, certificado com chave privada (mTLS via `https.Agent` nativo do Node, sem dependência nova). Diferente do Itaú (app compartilhado da plataforma), credenciais C6 são genuinamente por tenant — lidas fresh a cada mensagem SQS, nunca cacheadas.

60. **NF-e de venda autorizada pelo SEFAZ sempre gera conta a receber — a nota É o fato gerador.** `createReceivableFromInvoice()` (`services/receivableService.ts`) é o único ponto de criação, chamado por `nfeResultsWorker.ts::processResult()` na autorização real. Idempotente via UNIQUE parcial `receivables.invoice_id` — reprocessamento de SQS (at-least-once) nunca duplica.

61. **NCM/CFOP são travados 100% no cadastro do produto (`materials.ncm_code`/`materials.cfop`) — nunca digitados na tela de nota fiscal.** Produto sem código cadastrado: aviso + link pro cadastro (`/materials?edit=<id>`), nunca digitação manual como fallback. Item de NF-e sem produto vinculado não é aceito (sem produto não há de onde travar o fiscal). Vendedor e centro de custo herdam do pedido de origem em `POST /invoices` quando não informados explicitamente. `POST /invoices/:id/issue` (caminho legado que nunca falava com o SEFAZ) foi removido — único caminho de emissão é `POST /invoices/:id/emit`, via o painel de NF-e.

62. **`GET /v1/orders/:id` faz `LEFT JOIN materials` e devolve `ncm_code`/`cfop` prontos em cada item — o pedido é a fonte autoritativa, nunca recasar `material_id` contra uma lista de materiais buscada à parte no frontend** (frágil: paginação tem teto, lista é buscada uma vez só no mount).

63. **Todo endpoint de listagem devolve `{ data: [...] }` — nunca um array "nu".** Contrato único da API (`GET /cost-centers/active` já teve esse bug: array nu quebrava silenciosamente o dropdown em 4 telas que já esperavam `.data`).

64. **PDV / NFC-e: módulo opcional (`requireModule('pos')`).** Terminal físico (`pos_terminals`) sempre usa a empresa padrão do tenant (regra 40) — não tem seletor de empresa, terminal já corresponde a um CNPJ/local. Sessão de caixa (`pos_sessions`) controla abertura/fechamento com movimentações (`pos_cash_movements`: suprimento/sangria/abertura/fechamento). Venda (`pos_sales`/`pos_sale_items`/`pos_sale_payments`) aceita pagamento misto (dinheiro/débito/crédito/Pix/voucher/crédito-loja). Rotas em `routes/pos.ts`, frontend em `pages/pos/`.

65. **Agendamento (Scheduling): módulo opcional (`requireModule('scheduling')`).** Profissionais (`scheduling_professionals`) com áreas de atuação (`scheduling_areas`, vínculo N:N via `scheduling_professional_areas`), grade semanal de disponibilidade + exceções (`scheduling_availability_rules`/`scheduling_availability_exceptions`), sessões agendadas (`scheduling_sessions`), pacotes de cliente com movimentação de saldo (`scheduling_client_packages`/`scheduling_package_movements`) e sync opcional com Google Calendar (`scheduling_calendar_connections`, `routes/calendarIntegration.ts`). Rotas em `routes/scheduling*.ts`, frontend em `pages/scheduling/`.

66. **WhatsApp — Cobranças e Notificações: módulo opcional pago (`requireModule('whatsapp')`), MVP de mensagens transacionais por template, nunca caixa de entrada/chatbot.** 5 eventos fixos disparam mensagem — `invoice_due_soon`/`invoice_overdue` (N dias antes/depois do vencimento, `whatsappBillingWorker.ts`, mesmo molde de `dueSoonWorker.ts`), `payment_confirmed` (`POST /receivables/:id/payments`, na quitação total), `fiscal_document_authorized` (`nfeResultsWorker.ts`, autorização SEFAZ), `proposal_sent` (`POST /proposals/:id/send`). Conteúdo dos 5 templates é fixo pelo sistema — nunca editável pelo tenant (evita reprovação/uso indevido); `provider_template_id` (Content SID do Twilio) é por tenant, registrado depois de aprovado (passo operacional, fora do escopo de código).
    - **Credenciais 100% por tenant (`whatsapp_accounts.credentials` jsonb) — nunca um app Twilio compartilhado da plataforma**, mesmo padrão do C6 Bank (regra 59). Isso elimina o próprio risco que a regra 43 documenta (segredo de plataforma esquecido no Terraform) — não existe segredo de plataforma pra esquecer, só duas URLs de fila (não segredo) no ambiente do ECS/Lambda.
    - **Nova Lambda dedicada (`services/lambda-whatsapp`), mesmo padrão arquitetural de boleto/fiscal/marketplace**: rota enfileira em `WHATSAPP_REQUESTS_QUEUE_URL` → Lambda chama a API do Twilio (Content API, variáveis numeradas `{{1}}`, `{{2}}`... — `whatsappMessageService.ts` monta a ordem a partir de `WHATSAPP_TEMPLATES[key].variables`, nunca por nome) → resultado volta por `WHATSAPP_RESULTS_QUEUE_URL` → `whatsappResultsWorker.ts` (in-process) atualiza `whatsapp_messages`. Status de entrega/leitura chegam depois, só por webhook (`POST /v1/public/whatsapp/webhook`), nunca pela fila de resultado.
    - **Webhook do Twilio não carrega tenant nenhum — resolvido pelo próprio número WhatsApp** (`From` no status callback, `To` na mensagem recebida) contra `whatsapp_accounts.whatsapp_number`, ANTES de validar a assinatura (o auth_token pra validar é por tenant). Assinatura verificada manualmente (`verifyTwilioSignature`, HMAC-SHA1 + `timingSafeEqual`, sem SDK `twilio` — regra 5) contra uma URL sempre montada a partir de `APP_URL`, nunca de `request.protocol/hostname` (proxy/CloudFront podem divergir do que o Twilio assinou). Idempotência via `whatsapp_webhook_events` (mesmo padrão de `marketplace_webhook_events`) — sempre responde 200 rápido, mesmo em erro/assinatura inválida.
    - **Idempotência de disparo automático via a própria `whatsapp_messages`, nenhuma coluna nova em `receivables`/`invoices`/`proposals`**: antes de enviar, `whatsappAutomationService.ts` confere se já existe mensagem daquele `template_key` pra aquele documento de origem — reaproveita a tabela de auditoria como ledger, mesmo espírito de `accrueCommission()` usar `idempotency_key`.
    - **Consentimento LGPD é campo direto em `clients`** (`whatsapp_opt_in`/`whatsapp_opt_in_at`/`whatsapp_opt_out_at`, migration 0067) — relação 1:1, mesmo raciocínio de `tenants.activated_at` não precisar de tabela própria. Resposta exata "SAIR" (case-insensitive, `isOptOutReply()`) no webhook revoga o opt-in automaticamente. MVP manda mensagem só pro telefone principal do cliente (`mobile` com fallback `phone`), nunca por `client_contacts` — limitação documentada.
    - **Billing do módulo em si fica fora do escopo desta fase, deliberadamente** — módulo é ativado pelo mesmo mecanismo genérico de `tenant_modules` que os módulos gratuitos já usam (`PATCH /v1/tenant/modules/:key`); cobrança comercial acontece fora do sistema até validar com os primeiros tenants. Franquia/excedente por mensagem, Embedded Signup/Coexistence e caixa de entrada/chatbot ficam para uma fase futura, documentados como fora de escopo, não esquecimento (mesmo espírito da regra 33/40).

67. **Cadastro com login obrigatório (ex.: Técnicos) nunca deve travar num dead-end de "e-mail já cadastrado" — sempre oferecer vincular o usuário existente.** `technicians.user_id` é `NOT NULL` (diferente de `sellers`/`employees`/`scheduling_professionals`, onde é opcional), então `createTechnician()` sempre tentava `INSERT` num `users` novo e colidia com `UNIQUE(tenant_id, email)` sem nenhuma ação de recuperação na tela. `findLinkableUser()` (`technicianService.ts`) checa proativamente se o e-mail já pertence a um usuário do tenant; se sim e for elegível (nunca o `owner`, nunca alguém já vinculado a outro técnico), `createTechnician({ linkExistingUserId })` vincula o usuário existente em vez de criar um novo — `UPDATE users SET role='technician', access_profile_id=NULL` (técnico nunca usa perfil RBAC) + `INSERT technicians` apontando pro `user_id` já existente. Vincular é uma mudança de acesso drástica (`technicianRoleGuard.ts` restringe `role='technician'` a um allowlist mínimo de rotas, perdendo qualquer acesso anterior) — o frontend sempre confirma explicitamente antes (`GET /v1/technicians/check-email`), nunca vincula silenciosamente. Mesmo padrão a replicar se `sellers`/`employees`/`scheduling_professionals` ganharem uma UI de "vincular usuário existente" no futuro.

68. **Projetos: módulo opcional (`requireModule('projects')`), Clean Architecture 3 camadas (`domain/project/projectDomain.ts` + `services/projectService.ts` + `routes/projects.ts`), mesmo molde de Ordem de Serviço.** Estado `draft → in_progress → completed | cancelled` (`draft → cancelled` também); editável (nome/valor/datas/cliente/centro de custo) só em `draft` — depois disso só profissionais, vínculos e transição de status mudam. `project_professionals` aloca técnico OU vendedor (nunca ambos, `CHECK` garante) com `commission_pct` **só informativo** — aparece no relatório de acompanhamento do projeto, nunca é lançado em `commission_entries` (a comissão real continua exclusiva de `accrueCommission()`/regra 32, e técnico não ganhou conceito de comissão real nenhum). Pedidos de venda e ordens de serviço se vinculam ao projeto por coluna direta `project_id` (nullable) em `orders`/`service_orders` — não tabela de junção, mesmo padrão de `cost_center_id` nessas tabelas — através de rotas próprias do projeto (`POST|DELETE /v1/projects/:id/orders` e `/service-orders`), nunca via `PATCH /orders/:id` (que só edita pedido em `draft`). `GET /v1/projects/:id` já devolve o relatório de acompanhamento embutido (sem endpoint `/report` separado, mesmo padrão de `GET /service-orders/:id` dobrar billing/nfse): "consumido" soma `orders.total` + `service_orders.total` vinculados; "faturado" soma **duas origens distintas** — `invoices.total` via `invoices.order_id` para pedidos, `receivables.amount` via `receivables.service_order_id` para OS (OS nunca fatura via `invoices`, regra 47/48) — nunca confundir as duas.

69. **Exclusão em massa de produtos (Minha Empresa → Zona de Risco) É um `DELETE` físico de verdade — reset de emergência pra importação de planilha errada.** Revisão de uma regra anterior (que descrevia a versão soft-delete, `UPDATE ... SET is_active=false`): a pedido de negócio, `POST /v1/materials/bulk-delete-unused` (`requirePermission('materials:delete')`) agora roda `DELETE FROM materials WHERE tenant_id=$1 AND NOT EXISTS (...)` de verdade, sem filtro de `is_active` (um produto já desativado numa tentativa anterior também precisa sumir). Diferente do `DELETE /v1/materials/:id` de um único produto (que continua soft-delete, `is_active=false`, regra 8 — nunca mudou), este é físico e **irreversível**.
    - **Elegibilidade — o `NOT EXISTS` não olha só `inventory_movements` (critério de negócio "nunca teve entrada/saída"), olha TODA tabela com FK pra `materials` que seja `SET NULL` ou sem `ON DELETE` (NO ACTION ⇒ bloqueia)**: `order_items`, `invoice_items`, `simples_remessa_items`, `service_contracts`, `proposal_items`, `purchase_order_items`, `supplier_invoice_items`, `service_order_items` (todas `SET NULL` — apagar sem checar corromperia o documento histórico órfão de produto), `pos_sale_items`, `cost_center_stock`, `cost_center_movements`, `material_components.component_id` (essas 4 são `NO ACTION`/`RESTRICT` — apagar sem checar faria o `DELETE` inteiro falhar em transação única, derrubando também os produtos que seriam elegíveis). Um produto citado em QUALQUER um desses nunca é elegível, mesmo sem `inventory_movements`.
    - **Tabelas com `ON DELETE CASCADE` não entram no filtro** (`material_images`, `inventory`, `material_price_history`, `material_marketplace_links`, `material_components.kit_id` — os componentes do PRÓPRIO kit) — o Postgres já limpa elas sozinho quando a linha de `materials` sai; é isso que cobre o "todas demais relacionadas" pedido, sem precisar de DELETE manual tabela por tabela.
    - Devolve `{ deleted: N }` (campo renomeado — antes `{ deactivated: N }`). Frontend (`CompanyPage.tsx`) reescreveu a confirmação e a descrição pra deixar explícito que a ação é permanente, não mais "reative manualmente" — mesmo botão/permissão de sempre (`materials:delete`), comportamento novo.

70. **Integração fiscal automatizada (Minha Empresa → Fiscal): registro da empresa no emissor fiscal é ASSÍNCRONO, upload de certificado digital e teste de conexão são SÍNCRONOS — e o nome do provedor (Focus) nunca é exposto ao tenant.** Reaproveita 100% o pipeline assíncrono já existente de NF-e/NFS-e/Simples Remessa (mesmas filas `nfe_requests`/`nfe_results`, mesma Lambda `fiscal_nfe`), discriminado por um 4º valor de `type`: `'company_registration'`. Nenhuma mudança de infraestrutura (Terraform) foi necessária pra fila/Lambda/IAM — só um novo par de tipos de mensagem (`CompanyRegistrationEmitMessage`/`CompanyRegistrationResultMessage`, `services/lambda-fiscal/src/lib/types.ts`) e um novo branch de discriminação em `handler.ts` (Lambda) e `nfeResultsWorker.ts` (api-core).
    - **Token mestre vs. token por empresa — dois papéis nunca confundidos.** `FOCUS_NFE_TOKEN` (`app.config.focusToken` na Lambda, `process.env.FOCUS_NFE_TOKEN` na api-core — precisou ser adicionado ao `environment` do `aws_ecs_task_definition.api_core` em `terraform/ecs.tf`, só existia na Lambda até aqui) é o token da CONTA da plataforma, usado exclusivamente para gerir o cadastro de empresas (`POST/PUT/GET /v2/empresas`). Os tokens `focus_token_producao`/`focus_token_homologacao` de cada `nfe_configs` (devolvidos pelo registro e persistidos pelo worker) continuam sendo os únicos usados pra EMITIR documentos (NF-e/NFS-e/Remessa) — nunca o token mestre.
    - **Registro assíncrono** (`registerCompanyFiscalIntegration`, `services/api-core/src/services/fiscalIntegrationService.ts`): mesma dança pending→enqueue→processing com rollback em falha de `emitSimplesRemessa` (regra 51). `POST /v1/companies/:id/fiscal-integration/register` devolve 202; o resultado (tokens + `fiscal_integration_ref`, ou erro) chega pelo worker e grava direto em `nfe_configs` com guarda de idempotência `WHERE fiscal_registration_status='processing'` (mesmo padrão de `processRemessaResult`).
    - **Upload de certificado e teste de conexão são SÍNCRONOS, em processo, na api-core** (`services/fiscal/fiscalIntegrationClient.ts`, `PUT`/`GET /v2/empresas/{ref}` via `fetch()`+Basic Auth, mesmo padrão de `services/fiscal/focusNfe.ts`) — nunca passam pela fila. Certificado nunca é persistido em banco (nem o arquivo, nem a senha); só os metadados que o emissor devolve (`certificado_cnpj`/`certificado_valido_de`/`certificado_valido_ate`) ficam em `nfe_configs`. Upload exige a empresa já registrada (`fiscal_integration_ref` presente) — o registro em si nunca inclui o certificado.
    - **`nfe_configs` ganha as colunas de estado** (migration 0071): `fiscal_integration_ref` (id da empresa no emissor), `fiscal_registration_status` (`pending`/`processing`/`registered`/`error`, NULL = nunca solicitado), `fiscal_registration_attempts`, `fiscal_registration_error`, `certificado_cnpj`/`certificado_valido_de`/`certificado_valido_ate`, e `inscricao_estadual` (lacuna corrigida — só existia em `tenants.state_reg`, singleton incompatível com multi-empresa da regra 40). Nova tabela append-only `fiscal_integration_events` (mesmo molde de `nfse_events`/`simples_remessa_events`, sem `protocol` — não se aplica aqui) audita registro/upload/teste.
    - **Nunca expor "Focus" pro tenant** — toda string de UI/i18n (`comp.fiscalIntegration.*`, `pt-BR.ts`/`en.ts`) fala em "integração de emissão de notas fiscais", nunca no nome do provedor; o mesmo valeu pra `comp.nfse.hint`, que já vazava "via Focus" antes desta regra e foi corrigido. Nome do provedor continua livre em código/nomes de arquivo/comentário interno (`lib/focusNfe.ts`, `lib/focusEmpresa.ts`, env var `FOCUS_NFE_TOKEN`) — isso nunca chega ao tenant.
    - **Status exibido na tela é sempre derivado, nunca inferido pela UI**: `deriveFiscalIntegrationStatus()` (`domain/fiscalIntegration/fiscalIntegrationDomain.ts`, puro) calcula `not_registered`/`pending`/`registered_no_certificate`/`active`/`certificate_expiring_soon` (≤30 dias)/`certificate_expired`/`error` a partir do estado bruto — `CompanyPage.tsx` (aba Fiscal) só renderiza o resultado, e faz polling de 3s enquanto `pending`/`processing` (mesmo padrão de `NfsePage.tsx`).

71. **Contratos de Serviço: módulo opcional (`requireModule('service_contracts')`), mesmo padrão de `tenant_modules` do Mercado Livre/PDV/etc — mas já existia em produção, então o backfill (migration 0072) habilita automaticamente todo tenant que já tinha ≥1 contrato, nunca trava quem já usava.** Todas as 9 rotas de `routes/serviceContracts.ts` e `routes/contractFields.ts` ganharam o gate; tenant novo (zero contratos) começa OFF, como qualquer módulo, e liga pela mesma tela `Empresa → Módulos` (`MODULE_LABELS` em `CompanyPage.tsx` é 100% data-driven a partir de `GET /v1/tenant/modules` — nenhum código novo de UI precisou ser escrito pro toggle em si).
    - **Campos personalizados de contrato — schema por tenant, aplicado a todo contrato, EAV clássico com validação por tipo.** `contract_field_definitions` (chave/label/tipo/obrigatório/ordem, `field_key` derivado do label na criação via `slugifyFieldKey()` e imutável depois — renomear o label nunca corrompe valores já salvos) + `contract_field_values` (sempre `TEXT`, nunca colunas tipadas por campo — tipagem e formatação de exibição são responsabilidade de `contractFieldDomain.ts`, nunca do banco). 5 tipos suportados: `text`/`decimal`/`integer`/`date`/`boolean` — **o tipo nunca é editável depois de criado** (`updateFieldDefinition()` não aceita `field_type` no input), só label/obrigatoriedade/ordem; remover um campo é sempre soft-delete (`is_active=false`, regra 8) — contratos que já têm valor preenchido mantêm o histórico, o campo só some do formulário de novos/edição.
    - **Camadas**: `domain/contractField/contractFieldDomain.ts` (puro — `validateFieldValue()`/`formatFieldValueForDisplay()`, nunca I/O) → `services/contractFieldService.ts` (CRUD de definições + `setFieldValuesForContract()`/`getFieldValuesForContract()`) → `routes/contractFields.ts` (CRUD de definições) + `routes/serviceContracts.ts` (valores plugados em `POST`/`PATCH`/`GET /:id`, campo `custom_fields` no body/resposta).
    - **Impressão e e-mail do contrato são novos, e-mail é sempre auto-contido — contratos não têm portal público como proposta (`/p/:token`).** `GET /v1/service-contracts/:id/print` (`ContractPrintPage.tsx`, aba autenticada `window.print()`, mesmo padrão de `ContractBillingReceiptPrintPage.tsx`) devolve emissor sempre de `tenants` (regra 37) + `custom_fields` já formatados (`formatFieldValueForDisplay`, nunca formatação duplicada no frontend). `POST /v1/service-contracts/:id/send` (fire-and-forget via `sendSystemNotification`, tipo novo `contract_sent`) renderiza o resumo do contrato **dentro do próprio corpo do e-mail** — nunca um link, já que não existe página pública de contrato; campos personalizados chegam pré-formatados em HTML/texto puro no payload da fila (`custom_fields_html`/`custom_fields_text`), a Lambda de notificações nunca acessa banco.

72. **Captação de Leads via API pública (landing pages): módulo opcional (`requireModule('lead_capture')`), reaproveita 100% a infraestrutura de API key do Fiscal Engine (migration 0080) em vez de um sistema de auth novo.** `api_keys` ganha um discriminador `key_type` (`'secret'`|`'publishable'`, migration 0084) — chave `ek_live_...` continua server-side-only e multi-escopo (Engine), chave nova `pk_live_...` é "publishable" no sentido Stripe: segura pra embutir em JS client-side de landing page, escopo único e fixo (`leads:create`), rate limit bem mais baixo por padrão (10/min vs 60/min do Engine) e `allowed_origins` (jsonb) opcional — checado contra `Origin`/`Referer` como **defesa em profundidade, nunca a fronteira de segurança real** (esses headers são forjáveis fora de um navegador de verdade; a fronteira real é o par escopo+rate limit). `generateApiKey()`/`requireApiKey()`/`createKey()`/`listKeys()`/`revokeKey()` (`lib/apiKeyAuth.ts` + `services/engineKeyService.ts`) foram generalizados com parâmetros opcionais **sempre anexados depois de `db`** (nunca antes — quebra silenciosamente chamador posicional já existente) para servir os dois recursos (Engine e Lead Capture) com o mesmo código, cada um com sua própria tela de autoatendimento (`EngineKeysCard.tsx`/`LeadCaptureKeysCard.tsx`) e filtro de escopo (`scopeFilter`) pra nunca misturar as duas listas de chave na UI.
    - **O lead vira uma linha em `clients`, nunca uma tabela `leads` separada — é literalmente "meu cadastro de clientes" alimentado por outra origem.** `clients.origin` (varchar, default `'erp'`, migration 0084 — mesmo precedente de `orders.origin`) marca `'landing_page'` nos registros vindos da API pública; filtro por origem na tela Clientes (`GET /v1/clients?origin=...`) e badge "Landing page" na listagem, sem UI nova pra gerenciar leads separadamente. Dedup é decidido em `findOrCreateLeadClient()` (`services/leadCaptureService.ts`): casa por CNPJ normalizado se informado, senão por e-mail (lowercase) se nenhum dos dois lados tem documento; quando casa, faz **merge que só preenche campo vazio, nunca sobrescreve dado já editado pelo tenant** (mesma filosofia "nunca dead-end, sempre vincular" da regra 67); sem CNPJ nem e-mail (só telefone), sempre cria — não existe chave de dedup confiável nesse caso. **Decisão deliberada**: nenhum índice `UNIQUE` novo no banco pra isso — a tabela já tem dados reais em produção com formato desconhecido, e `CREATE UNIQUE INDEX` falha com uma mensagem (`is duplicated`) que o error-skip de `migrate.ts` não reconhece (só casa a substring `duplicate key`), então um conflito real travaria o deploy inteiro; dedup fica 100% na camada de aplicação.
    - **`POST /v1/public/leads` é síncrono (nunca SQS/Lambda) — é um INSERT/UPDATE de uma tabela só, sem dependência externa lenta**, diferente do padrão assíncrono reservado pra chamadas SEFAZ/Focus/banco/WhatsApp. `tenant_id` nunca vem do body (regra 4) — vem exclusivamente da chave (`request.apiKey.tenantId`, resolvida dentro de `requireApiKey`); um `tenant_id` no payload é silenciosamente ignorado. Contrato de resposta `{success:true,data}`/`{success:false,error}` (convenção de `routes/engine.ts`, distinta do JSON "nu" das rotas internas por JWT) — `201` quando cria, `200` quando mescla com cliente existente. Nenhuma infraestrutura nova (sem WAF/API Gateway/rate limit distribuído) — aceita o mesmo risco/custo operacional já em produção pro Engine; CORS já era `{origin:true}` (permissivo) antes desta feature, sem mudança.

73. **Documentação de API pública para integradores: spec OpenAPI hand-maintained em `docs/openapi/public-api.yaml`, publicado como página estática (Redoc) em `/api-docs.html` — reaproveita o mesmo bucket S3 + distribuição CloudFront do backoffice, nenhum recurso AWS novo.** Cobre as duas famílias de endpoint autenticadas por `X-API-Key` (Captação de Leads + Motor Fiscal), nunca as rotas internas por JWT. Gerado via `@redocly/cli` (`npm run docs:api:build`, script na raiz) num único HTML autocontido (JS inlinado, sem dependência de CDN em runtime); `npm run docs:api:preview` dá live-reload local pra quem edita o spec. **O spec não é gerado a partir do código** — as rotas (`routes/leadCapture.ts`/`routes/engine.ts`) validam o body manualmente, sem `schema` do Fastify, então não há geração automática viável sem refatorar as rotas; **toda mudança de contrato num desses dois arquivos precisa atualizar o spec na mesma PR**, sob risco de a doc divergir do comportamento real (mesmo princípio anti-drift do resto deste README). CI (`.github/workflows/ci.yml`, job `api-docs`) roda `docs:api:lint`+`docs:api:build` em todo push/PR — pega spec quebrado antes do merge, mas não publica nada; só o deploy real (`deploy.yml`, branch `main`) builda e sincroniza pro S3, na mesma invalidação `/*` que já existe pro backoffice.
    - **Jornada do tenant, do zero até a primeira chamada autenticada** (não existe link dentro do produto apontando pra doc hoje — o caminho é este):
      1. Módulo relevante ativo no tenant — `lead_capture` ou `engine` (Minha Empresa → Módulos, se opcional no plano contratado).
      2. Backoffice → **Minha Empresa → Integrações** → card "Captação de Leads" (`LeadCaptureKeysCard.tsx`) ou "Engine API" (`EngineKeysCard.tsx`), visível só a quem tem `lead_capture:manage`/`engine:manage` (admin-only por padrão em cada matriz de RBAC).
      3. **+ Nova chave** → nome da chave (rate limit e domínios permitidos são opcionais na Captação de Leads) → o backend devolve o segredo: `pk_live_...` pra Captação de Leads (escopo `leads:create`) ou `ek_live_...` pro Engine/Motor Fiscal (escopo `engine`).
      4. **O segredo aparece uma única vez na tela** — só hash + prefixo ficam persistidos; se perder, a única saída é revogar e gerar outra chave, não existe "mostrar de novo".
      5. Documentação interativa em `https://<domínio do backoffice>/api-docs.html` — mesma origem do CloudFront, **página pública, sem login** (só a chamada à API exige `X-API-Key`; visualizar a doc não exige nada).
      6. Chamada real: header `X-API-Key: pk_live_...` ou `ek_live_...` em `POST /v1/public/leads` ou `POST /v1/engine/simples/...` — nunca `Authorization: Bearer`, exclusivo das rotas internas por JWT.

74. **Regime tributário do cliente é travado no cadastro (`clients.tax_regime`, migration 0085) — nunca mais perguntado na tela de emissão de NF-e, mesma receita da regra 61 (NCM/CFOP travado no cadastro do produto).** Antes, `InvoiceNewPage.tsx` (Step 4) deixava o tenant escolher manualmente num `<select>` a cada nota (default hardcoded `lucro_presumido`, com uma tentativa de herdar de `nfe_configs.regime_tributario` — configuração fiscal do **tenant**, não do cliente/destinatário). Agora `formTaxRegime` é só leitura, sincronizado a partir do cliente selecionado (tanto via `<select id="inv-client">` quanto via `handleOrderChange`, quando a nota nasce de um pedido); cliente sem o campo preenchido mostra aviso + link `/clients?edit=<id>` (nunca um select como fallback — mesmo princípio de nunca deixar o mesmo erro entrar por dois caminhos diferentes). `ClientsPage.tsx` ganhou o deep-link `?edit=<id>` nesta entrega (antes só `MaterialsPage.tsx` tinha, regra 61) — é o que faz o link "Cadastrar" abrir o cliente certo já em modo edição. Coluna nullable, sem default e sem backfill — não dá pra inferir o regime tributário de um cliente já cadastrado a partir de nenhum outro campo (diferente de `icms_taxpayer`, que é sobre contribuinte de ICMS, não regime societário); a nota continua podendo ser salva sem o regime calculado (como já era antes — `handleCalculateTaxes` agora só recusa com um aviso amigável em vez de estourar 400 no `POST /v1/tax/calculate`, que exige o campo).

75. **Plano de Pagamento (migration 0086): catálogo por tenant ("À Vista", "3x sem juros", "30/60/90 dias corridos"), escolhido no pedido de venda, herdado pela nota fiscal — os N recebíveis parcelados nascem na AUTORIZAÇÃO da NF-e, nunca na confirmação do pedido.** Decisão deliberada de arquitetura: reaproveita o único ponto de criação de recebível que já existia (`createReceivableFromInvoice`, idempotente via UNIQUE parcial em `receivables.invoice_id`, regra 60) em vez de criar um novo gatilho em `POST /orders/:id/confirm` — pedido e recebível continuam desacoplados como sempre foram neste sistema; só quando a NF-e é autorizada é que o dinheiro devido nasce de verdade.
    - **Modelo de dados**: `payment_plans` (nome/descrição/`is_default`, catálogo por tenant, sem seed automático antes desta feature em nenhum outro catálogo — é a primeira exceção, ver seed abaixo) + `payment_plan_installments` (número da parcela, `days_offset` em **dias corridos** — não mês calendário, diferente do parcelamento mensal automático de NF-e de Entrada, regra 47 — e `percentage`, validado somando 100% com tolerância de arredondamento). `orders.payment_plan_id`/`invoices.payment_plan_id` são colunas irmãs (nullable, `ON DELETE SET NULL`) — a nota herda a escolha do pedido no frontend (mesmo padrão não-mágico de `seller_id`/`cost_center_id`, sem FK cascade automática), mas `invoices.payment_plan_id` é a fonte de verdade lida em `routes/nfe.ts`/`nfeResultsWorker.ts`, nunca `orders.payment_plan_id` diretamente.
    - **Achado crítico que mudou uma constraint existente**: `receivables` tinha `UNIQUE(invoice_id) WHERE invoice_id IS NOT NULL` — "1 recebível por nota, sempre" (migration 0065). Virou `UNIQUE(invoice_id, installment_number)`, com `installment_number` **NOT NULL default 1** (nunca `NULL` de propósito — um `UNIQUE` com `NULL` não bloqueia duplicata no Postgres, cada `NULL` conta como distinto, o que quebraria a idempotência do caso sem plano). O caso de hoje sem plano vira só `(invoice_id, 1)` — mesma garantia de sempre, só generalizada; `createReceivableFromInvoice()` **não muda de assinatura nem comportamento**, uma função nova (`createReceivablesFromInvoiceWithPlan`, `receivableService.ts`) cobre o caso com plano (Open/Closed — extensão aditiva, zero risco pro caminho existente).
    - **Domínio puro** (`domain/paymentPlan/paymentPlanDomain.ts`): `generateInstallmentSchedule(totalAmount, baseDate, installments)` divide o total por percentual (resto de centavos sempre na última parcela, mesmo espírito de `splitInstallmentAmounts` da regra 47, generalizado pra percentual+dias-corridos) e `addDaysToDateStr()` (dias corridos — nunca reutiliza `addMonthsToDateStr`, que é mês calendário e serviria mal pro "30/60/90 dias corridos" pedido).
    - **Duplicatas na NF-e**: quando a nota tem plano, `routes/nfe.ts` monta `message.duplicatas` (grupo `cobr`/`dup` do XML — número, vencimento, valor de cada parcela, pro quadro FATURA/DUPLICATAS sair no DANFE) e `lambda-fiscal` (`types.ts`/`focusNfe.ts`) inclui a chave só quando presente — nota sem plano não muda 1 byte do payload de sempre. ⚠️ Nomes de campo do Focus NF-e (`duplicatas`/`numero`/`data_vencimento`/`valor`) ainda não foram confirmados contra uma emissão real em homologação — validar antes de usar em produção.
    - **Seed do plano padrão** — única exceção no sistema a "catálogo por tenant nunca tem seed automático" (regra confirmada em `cost_centers`/`access_profiles`): toda migration cria "À Vista" pra tenant já existente (backfill, mesmo padrão da regra 71) e `routes/auth.ts` cria o mesmo seed na própria transação de registro — nunca existe tenant sem ao menos 1 plano configurado.
    - **Sem gate de módulo** (`requireModule`) — catálogo core como `cost_centers`, não add-on pago. Permissões `payment_plans:view/create/edit/delete`, mesmo padrão `recurso:ação` de sempre.

76. **Proposta em rascunho pode ser convertida em pedido diretamente pelo tenant (`POST /proposals/:id/convert` aceita `draft`, além de `accepted`/`sent`/`viewed`) — o aceite do cliente via portal público não é o único caminho.** Em alguns casos o "aceite" é uma decisão do próprio tenant (ex.: acordo verbal, sem o cliente nunca ter aberto o link do portal) — como uma proposta em `draft` nunca passou pelo aceite real (o portal só aceita `sent`/`viewed`), converter a partir do rascunho registra esse aceite internamente antes de criar o pedido: `status → 'accepted'`, `accepted_at = NOW()`, `accepted_by_name`/`accepted_by_email` preenchidos com o usuário autenticado (via `SELECT name, email FROM users`) em vez do nome/e-mail que o cliente digitaria no portal (`routes/public.ts`, `/accept`) — mesmo rastro de auditoria, fonte diferente. Esse bloco só roda quando `status === 'draft'`; conversão a partir de `accepted`/`sent`/`viewed` continua **byte a byte igual** ao que já existia (nunca toca `accepted_by_*`). Frontend: `ProposalsPage.tsx` ganhou o botão "Converter em Pedido" também na linha de propostas em rascunho (reaproveita o mesmo `convertToOrder()`/`modal.confirm()` já usado pelas outras linhas), com uma mensagem de confirmação própria avisando que a conversão pula o aceite do cliente. Não existe uma rota `/proposals/:id` de detalhe dedicada neste app — como em toda outra tela, a "tela de detalhe" é a linha da listagem + o drawer que abre ao clicar nela (`openEdit`), então o botão fica na mesma barra de ações das outras linhas, nunca num lugar novo. **Bug lateral corrigido no mesmo handler**: `userId` lia `request.user.id` (chave que não existe no JWT — o payload assinado em `auth.ts` é sempre `{tenantId, userId, role}`), então `orders.created_by` de todo pedido convertido de proposta sempre gravava `NULL`; corrigido pra `request.user.userId`.

77. **Observação digitada na tela de emissão de nota de venda (`invoices.notes`) agora sai de fato na NF-e — antes só ficava gravada no banco.** Bug real: `POST /invoices` sempre persistiu `notes` corretamente, mas `routes/nfe.ts` (`POST /invoices/:id/emit`) nunca lia esse campo ao montar a mensagem SQS pro `lambda-fiscal` — a observação nunca chegava no XML/DANFE, mesmo preenchida. Corrigido mapeando `invoice.notes` (já disponível via `SELECT i.*`, regra 1) pro novo campo `informacoes_adicionais_contribuinte` em `NfeEmitMessage` (`lambda-fiscal/src/lib/types.ts`) e no payload do Focus (`buildFocusPayload()`, `lambda-fiscal/src/lib/focusNfe.ts`) — presente só quando a nota tem observação (nota sem observação não muda 1 byte do payload de sempre, mesmo padrão aditivo de `duplicatas`, regra 75). ⚠️ Nome de campo (`informacoes_adicionais_contribuinte`) segue a documentação pública do Focus NF-e v2 pelo conhecimento geral — sem nenhum precedente neste código (NFC-e/NFS-e também nunca mandaram observação nenhuma pro Focus) pra confirmar; validar no primeiro teste real em homologação, mesma ressalva já feita pro campo `duplicatas`.

78. **Agenda do Técnico (migration 0087): calendário estilo Google Agenda das visitas técnicas, `/service-orders/agenda` — visão por técnico (semana/dia) ou todos os técnicos lado a lado (dia).** `service_visits`/`technicians` (regra 38) e `scheduling_sessions`/`scheduling_professionals` (regra 65) continuam **domínios de negócio separados de propósito** — checklist/foto/assinatura de campo vs. sessão com pacote de cliente são conceitos diferentes que só coincidem em "alguém tem um horário reservado"; nunca fundidos. Só a camada visual é compartilhada (ver componente abaixo).
    - **`duration_minutes`** (smallint, `NOT NULL DEFAULT 60`, aditiva) — `service_visits` só guardava um instante (`scheduled_at`); sem duração não dá pra desenhar um bloco de calendário nem checar conflito de horário. Default preserva 100% do comportamento de quem cria visita sem informar duração.
    - **Conflito de horário do técnico, antes inexistente** — `scheduleVisit()` (`serviceVisitService.ts`) agora replica parte do desenho de `createSession()` (Agendamento, regra 65): `pg_advisory_xact_lock` com chave `service_visit:<technicianId>` dentro da transação (seed de hash 43, diferente do 42 do Agendamento, só pra nunca colidir no mesmo espaço de chaves), leitura dos bloqueadores (visitas `scheduled`/`in_progress` do técnico) e checagem atômica (`domain/serviceVisit/serviceVisitDomain.ts::findVisitConflict`) antes do insert. **Deliberadamente SEM `EXCLUDE USING gist` físico como backstop** (diferente de `scheduling_sessions_no_overlap`, migration 0063): lá o constraint era seguro porque `scheduling_sessions` nasceu na mesma migration que o criou (zero linha pré-existente possível); `service_visits` já existe desde a migration 0044 com dado real possível em produção — `ADD CONSTRAINT ... EXCLUDE` validaria retroativamente TODO o histórico e falharia o deploy se qualquer par antigo já se sobrepusesse sob a duração default de 60min (conceito que não existia antes desta feature). Risco que este projeto nunca aceita numa migration (nunca destrutiva, nunca arriscando falhar contra dado real). `scheduleVisit()` é o único ponto de escrita de agendamento de `service_visits` — o advisory lock sozinho é suficiente pra correção aqui.
    - **Leitura da agenda**: `GET /v1/service-orders/visits?from=&to=&technician_id=` (rota estática em `routes/serviceOrders.ts` — nunca colide com `GET /service-orders/:id`, find-my-way sempre prioriza rota estática) devolve `{data:[...]}` (regra 63) com `ends_at` já calculado. Segue a convenção já estabelecida neste módulo (diferente do Agendamento): consulta de leitura fica direto na rota, não numa função de serviço — mesmo padrão de `GET /service-orders`/`GET /service-orders/:id`.
    - **Componente compartilhado**: o motor de posicionamento de `CalendarWeekGrid.tsx` (Agendamento) foi extraído para `ds/components/TimeGrid.tsx` — genérico em "colunas × horas" (sem saber o que é sessão ou visita), com número de colunas dinâmico (antes fixo em 7 via CSS). `CalendarWeekGrid` virou um adapter fino sobre `TimeGrid` com props/comportamento idênticos de antes (Agendamento não muda 1 linha de comportamento); `ServiceOrdersAgendaPage.tsx` é o segundo adapter, com colunas = dias (visão por técnico) OU colunas = técnicos (visão "todos, um dia"). ⚠️ `service_visits.status` usa `'cancelled'` (2 L); `CalendarSession.status` do Agendamento usa `'canceled'` (1 L) — nomes de status nunca são intercambiáveis entre os dois adapters.
    - **Sem gate de módulo novo** — vive dentro do módulo já existente `service_orders`; permissões reaproveitadas (`service_orders:view` pra ver, `service_orders:assign` pra criar visita), nenhuma chave nova no catálogo RBAC.
    - **Reagendar e cancelar** (`PATCH /v1/service-orders/:id/visits/:visitId` e `POST /v1/service-orders/:id/visits/:visitId/cancel`, mesma permissão `service_orders:assign`) — `rescheduleVisit()`/`cancelVisit()` (`serviceVisitService.ts`) só existem no lado backoffice; nunca reaproveitam `assertTechnicianOwnsVisit()` (isso é só pro portal do técnico). `rescheduleVisit()` replica a MESMA checagem atômica de conflito de `scheduleVisit()` (advisory lock + `findVisitConflict`), com uma diferença: exclui a PRÓPRIA visita da lista de bloqueadores antes de checar (senão ela sempre "conflitaria consigo mesma"). Só elegível em `status='scheduled'` (`canRescheduleVisit`) — depois do check-in mudar data/hora não faz sentido, a visita já está acontecendo. `cancelVisit()` é elegível em `scheduled`/`in_progress` (`canCancelVisit`, mesma tabela `VALID_TRANSITIONS` da regra 38) e **nunca mexe no status da Ordem de Serviço** — uma OS pode ter outras visitas ainda ativas, mesma filosofia de `scheduleVisit()` só tocar a OS na transição `draft→scheduled`, nunca sincronizar o status inteiro. Frontend: os dois botões vivem no mesmo drawer de detalhe da `ServiceOrdersAgendaPage.tsx` — "Reagendar" abre uma sub-view com data/hora/duração dentro do próprio drawer (sem drawer novo), "Cancelar visita" usa o mesmo `modal.confirm({danger:true})` já padrão do projeto pra ações irreversíveis.

79. **Campos Personalizados de Visita Técnica (migration 0088): mesmo EAV de contrato (regra 71), aplicado a `service_visits` — mas quem PREENCHE o valor é o técnico, no portal dele, no momento da visita, nunca o backoffice no cadastro.** Schema (`service_visit_field_definitions`/`service_visit_field_values`, tenant, tipos `text`/`decimal`/`integer`/`date`/`boolean`, `field_key` imutável) idêntico ao de contrato; a diferença toda é ONDE o valor nasce e QUEM configura o schema.
    - **Domínio extraído para `domain/customFields/customFieldDomain.ts`** — `slugifyFieldKey()`/`validateFieldValue()`/`formatFieldValueForDisplay()`/`FIELD_TYPES` nunca souberam o que é "contrato" (só operam em `field_type`/`label`/`value`), então em vez de duplicar ~90 linhas pra visita, `domain/contractField/contractFieldDomain.ts` virou um **shim** que reexporta daqui — `ContractFieldDomainError` é literalmente `CustomFieldDomainError` sob outro nome de export (`export { CustomFieldDomainError as ContractFieldDomainError }`), então `instanceof` nas rotas/testes de contrato continua funcionando sem tocar em nada. `serviceVisitFieldService.ts`/`routes/serviceVisitFields.ts` importam direto do módulo compartilhado — zero duplicação de validação por tipo entre os dois recursos.
    - **Admin-only de verdade, não por convenção**: diferente de contrato (campos geridos por `contracts:edit`, qualquer perfil com essa permissão configura o schema), aqui existe um recurso RBAC **dedicado** — `service_visit_fields:view`/`service_visit_fields:manage` — que NUNCA entra nas listas explícitas de `MANAGER`/`USER`/`TECHNICIAN`/`PROFESSIONAL`/`CLIENT` em `roleMatrix.ts`. Só `OWNER` (`ALL_PERMISSION_KEYS`) e `ADMIN` (`ALL_PERMISSION_KEYS` menos `billing:manage`) ganham a permissão automaticamente — exatamente "owner + administradores do tenant", nunca quem só despacha visita (`service_orders:assign`) ou o próprio técnico (`portal:access`). Frontend: a aba "Campos da Visita Técnica" em Minha Empresa nem aparece na lista de tabs pra quem não tem `service_visit_fields:view` (`CompanyPage.tsx`) — reforço de UX em cima do reforço real, que é sempre o backend.
    - **Onde o valor nasce**: `TechnicianVisitDetailPage.tsx` (portal do técnico) renderiza o formulário dinâmico dentro do bloco `in_progress` (mesma janela de fotos/assinatura/relatório) — respostas só são enviadas junto de `POST /v1/technician/visits/:id/complete` (`custom_fields`, mesmo padrão de `report_notes`, nunca salvo incrementalmente). `completeVisit()` (`serviceVisitService.ts`) valida/persiste os campos ANTES de mudar o status pra `completed` — um campo obrigatório sem resposta lança `field_value_required` e a visita nunca fica "meio completa" (o técnico também vê essa checagem client-side antes do POST, mas o backend é sempre a autoridade).
    - **Onde o valor aparece pro operador do tenant**: `GET /v1/service-orders/:id` (drawer da OS, `ServiceOrdersPage.tsx`), `GET /v1/service-orders/:id/visits/:visitId` (mesmo endpoint, reaproveitado sob demanda pelo drawer de detalhe da Agenda do Técnico, regra 78, já que a listagem leve `GET /v1/service-orders/visits` não carrega campo nenhum de propósito) e `GET /v1/service-orders/:id/print` ("espelho do técnico", regra 38) — este último já formatado (`formatted_value`), mesmo padrão de impressão/e-mail de contrato.

---

## Arquitetura & Padrões de Código

### Stack tecnológico

| Camada | Tecnologia |
|--------|-----------|
| Frontend Web | React 18, TypeScript, React Router v6, SheetJS (XLSX), Vite |
| Backend API | Node 22, Fastify, Drizzle ORM, `@fastify/jwt`, `@fastify/sensible` |
| Banco de dados | PostgreSQL 16 (RDS), schema Drizzle em `services/api-core/src/db/schema.ts` |
| Lambdas | Node 22, AWS SDK v3, ECR container images |
| Infra | Terraform, GitHub Actions CI/CD, ECS Fargate Spot |
| Fiscal | Focus NF-e API (`api.focusnfe.com.br` / `homologacao.focusnfe.com.br`) |
| E-mail | Amazon SES v2, via SQS → `lambda-notifications` |
| Cobrança | Itaú API v2 OAuth2 `client_credentials` (app compartilhado da plataforma) · C6 Bank OAuth2 `client_credentials` + mTLS (credenciais por tenant, regra 59) — ambos via `lambda-billing`, boleto + Pix |
| Marketplace | Mercado Livre API OAuth2 `authorization_code` — sync preço/estoque + import de pedido (`lambda-marketplace`) |
| Assinatura SaaS | Stripe Checkout + Billing Portal + webhook (regra 43) — opt-in via `STRIPE_SECRET_KEY` |
| WhatsApp | Twilio WhatsApp Business Platform (Content API) — credenciais 100% por tenant, sem secret de plataforma (`lambda-whatsapp`), módulo opcional cobrado à parte (regra 66) |

### Camadas (DDD simplificado)

Todo módulo com regra de negócio não trivial segue 3 camadas, sempre nessa direção de dependência (nunca invertida):

- **Domínio** (`src/domain/<modulo>/<modulo>Domain.ts`) — funções puras: state machines, validação, cálculo. **Nunca faz I/O** (sem `db`, sem `fetch`). Testável sem mock de banco. Exemplos: `purchaseOrderDomain.ts`, `dreDomain.ts`, `cnpjDomain.ts`, `simplesRemessaDomain.ts`.
- **Serviço** (`src/services/<modulo>Service.ts`) — orquestração e I/O: chama o domínio, lê/escreve no banco (`db.transaction`), publica em fila. Nunca é chamado direto por outro serviço sem necessidade — rotas chamam serviços, serviços chamam domínio.
- **Rota** (`src/routes/<modulo>.ts`) — só HTTP: parse do body/params, chama o serviço, formata a resposta. Nunca contém regra de negócio nem chama o domínio diretamente.

Nunca pular camada (rota chamando domínio direto, ou lógica de negócio dentro da rota) — isso já foi identificado como dívida técnica revertida em módulos como Pedido de Compra/NF-e de Entrada (regra 34) e DRE (regra 35).

### Convenções de teste (Vitest)

- Mock de `db` sempre via `vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn(), transaction: vi.fn() }))` + `vi.mock('../db', ...)`.
- Quando mais de uma query roda na mesma rota (comum com `db.execute` de SQL bruto), **discriminar por conteúdo da query** (regex no texto/`queryChunks`), nunca por ordem de chamada — `app.ts` dispara workers em background durante `buildApp()` que também chamam `db.execute`/`db.select` fora de ordem.
- `db.transaction` mockado precisa diferenciar `insert(tabelaA)` de `insert(tabelaB)` quando o teste inspeciona valores inseridos (comparar a referência da tabela, não a ordem das chamadas).
- Testes de rota usam `app.inject()` (Fastify) com `Authorization: Bearer ${app.jwt.sign({tenantId, userId, role})}`.
- Testes de componente React usam Testing Library + `vi.mock` das dependências (`api`, `useAuth`, `useI18n`, `useModal`) — ver `OrdersPage.test.tsx` como referência de padrão completo (mocks hoisted, fixtures, helpers de setup).

### Migrations

Numeradas e cumulativas em `services/api-core/db/migrations/00NN_nome.sql`, **nunca destrutivas** (sem `DROP COLUMN` em coluna que já teve dado real — preferir deprecated-mas-presente, ver regra 41). Toda migration nova precisa ser adicionada ao array em `services/api-core/src/scripts/migrate.ts`, senão nunca roda.

### Multi-tenant e i18n

Isolamento por `tenant_id` sempre do JWT (regra 4). Toda chave de i18n nova entra nos dois arquivos, `pt-BR.ts` e `en.ts` (regra 7).

---

## Diagramas

> Todos em **Mermaid**, renderizados automaticamente pelo GitHub.

### C4 Nível 1 — Contexto do Sistema

```mermaid
C4Context
    title C4 Nível 1 — Contexto do Orquestra ERP

    Person(user, "Usuário ERP", "Gestor, vendedor, financeiro ou técnico de campo — acessa via browser")
    Person_Ext(client, "Cliente Final", "Recebe proposta comercial por e-mail e acessa o portal público")
    Person_Ext(integrator, "Sistema Integrador / Parceiro", "Landing page ou sistema externo do tenant — consome a API pública via X-API-Key (regra 73)")

    System(erp, "Orquestra ERP", "SaaS multi-tenant: pedidos, NF-e, NFS-e, Simples Remessa, PDV, agendamento, financeiro, propostas, CRM, RH, centros de custo, relatórios")

    System_Ext(focus, "Focus NF-e API", "Gateway fiscal que abstrai SEFAZ (NF-e) e prefeituras (NFS-e)")
    System_Ext(sefaz, "SEFAZ / Prefeitura", "Autoridade fiscal federal/estadual/municipal")
    System_Ext(itau, "Itaú API v2", "Boleto bancário registrado e Pix via OAuth2 — app compartilhado da plataforma")
    System_Ext(c6, "C6 Bank API", "Boleto bancário via OAuth2 + mTLS — credenciais por tenant")
    System_Ext(ses, "Amazon SES v2", "Relay de e-mail transacional")
    System_Ext(viacep, "ViaCEP", "Consulta de endereço por CEP — chamado direto do browser, sem backend")
    System_Ext(ml, "Mercado Livre API", "Marketplace — OAuth2 por empresa/CNPJ: conexão, webhook, sync de preço/estoque, importação de pedido")
    System_Ext(stripe, "Stripe", "Checkout + Billing Portal + webhook — assinatura SaaS, opt-in")
    System_Ext(gcal, "Google Calendar API", "Sync opcional de agenda — módulo de Agendamento")
    System_Ext(twilio, "Twilio WhatsApp API", "BSP — envio de template e recebimento de status/reply via webhook — credenciais por tenant, módulo opcional")

    Rel(user, erp, "Opera via browser", "HTTPS")
    Rel(client, erp, "Acessa portal /p/:token", "HTTPS (sem autenticação)")
    Rel(erp, focus, "Emite NF-e, NFS-e e Simples Remessa", "REST HTTPS")
    Rel(focus, sefaz, "Transmite e autoriza notas", "SOAP/REST HTTPS")
    Rel(erp, itau, "Emite boleto e Pix", "REST HTTPS OAuth2 client_credentials")
    Rel(erp, c6, "Emite boleto", "REST HTTPS OAuth2 client_credentials + mTLS")
    Rel(erp, ses, "Envia e-mails transacionais", "AWS SDK SQS → Lambda → SES")
    Rel(erp, client, "Notifica por e-mail", "SES")
    Rel(user, viacep, "Consulta CEP (browser direto)", "REST HTTPS")
    Rel(erp, ml, "Conecta via OAuth2, sincroniza preço/estoque e importa pedidos", "REST HTTPS")
    Rel(erp, stripe, "Checkout, portal de billing e webhook de assinatura", "REST HTTPS")
    Rel(erp, gcal, "Sincroniza sessões agendadas", "REST HTTPS OAuth2")
    Rel(erp, twilio, "Envia mensagem de template (cobrança, pagamento, NF-e, orçamento)", "REST HTTPS")
    Rel(twilio, erp, "Status callback (sent/delivered/read/failed) e reply (opt-out SAIR)", "Webhook POST")
    Rel(erp, client, "Notifica por WhatsApp (opt-in LGPD)", "Twilio")
    Rel(integrator, erp, "Lê a documentação pública (/api-docs.html) e chama a API (captação de leads, Motor Fiscal)", "REST HTTPS · X-API-Key")
```

---

### C4 Nível 2 — Containers

```mermaid
C4Container
    title C4 Nível 2 — Containers do Orquestra ERP

    Person(user, "Usuário ERP", "Opera o backoffice")
    Person_Ext(client, "Cliente Final", "Acessa portal de propostas")
    Person_Ext(integrator, "Sistema Integrador / Parceiro", "Consome a API pública via X-API-Key (regra 73)")

    Container_Boundary(aws, "AWS Cloud") {
        Container(cdn, "CloudFront + S3 Static", "AWS CDN / S3", "Entrega a SPA, assets e a documentação pública da API (/api-docs.html, Redoc estático). Roteia /v1/* para NLB. Certificado ACM us-east-1")
        Container(spa, "React SPA", "React 18 · TypeScript · Vite", "Backoffice completo + portal público /p/:token")
        Container(api, "api-core", "Node 22 · Fastify · Drizzle ORM · ECS Fargate Spot", "API REST multi-tenant. Workers in-process: nfeResults, boletoResults, contractBilling, recurringPayables, dueSoon, marketplaceSyncResults")
        ContainerDb(db, "RDS PostgreSQL 16", "PostgreSQL · SSL obrigatório", "Todos os dados isolados por tenant_id. Migrations em db/migrations/")
        ContainerDb(sqs, "SQS Queues", "Amazon SQS", "nfe-requests/results · billing-requests/results · notifications(-dlq) · marketplace-sync-requests/results(-dlq)")
        ContainerDb(s3data, "S3 Data Buckets", "Amazon S3", "nfe-xml (lifecycle 5 anos) · billing-pdf (lifecycle 7 anos) · service-visit-photos (privado, SSE-KMS)")
        Container(lfiscal, "lambda-fiscal", "Node 22 · ECR Container", "Emite NF-e, NFS-e e Simples Remessa via Focus. Discrimina por type. Salva XML no S3")
        Container(lbilling, "lambda-billing", "Node 22 · ECR Container", "Emite boleto/Pix via Itaú ou C6 Bank (adapter por bank_accounts.billing_provider). Salva PDF no S3")
        Container(lnotif, "lambda-notifications", "Node 22 · ECR Container", "Renderiza templates HTML e envia via SES v2. Rebuild obrigatório ao adicionar tipo")
        Container(lmarket, "lambda-marketplace", "Node 22 · ECR Container", "OAuth2 refresh, sync de preço/estoque e import de pedido via API do Mercado Livre")
        Container(lwa, "lambda-whatsapp", "Node 22 · ECR Container", "Envia template via Twilio (adapter por whatsapp_accounts.provider). Sem secret de plataforma — credenciais 100% por tenant")
    }

    System_Ext(focus, "Focus NF-e API", "Gateway fiscal")
    System_Ext(itau, "Itaú API v2", "Boleto + Pix")
    System_Ext(c6, "C6 Bank API", "Boleto")
    System_Ext(ses, "Amazon SES v2", "Relay de e-mail")
    System_Ext(ml, "Mercado Livre API", "OAuth2 + sync + pedidos")
    System_Ext(stripe, "Stripe", "Assinatura SaaS")
    System_Ext(twilio, "Twilio WhatsApp API", "Envio de template + webhook de status/reply")

    Rel(user, cdn, "Acessa via browser", "HTTPS")
    Rel(client, cdn, "Acessa /p/:token", "HTTPS")
    Rel(integrator, cdn, "Lê /api-docs.html (sem autenticação)", "HTTPS")
    Rel(integrator, api, "Chama /v1/public/leads e /v1/engine/*", "REST HTTPS · X-API-Key")
    Rel(cdn, spa, "Serve SPA", "S3 origin")
    Rel(cdn, api, "Proxia /v1/*", "HTTPS → NLB → ECS")
    Rel(spa, api, "Chama API autenticada", "REST HTTPS · JWT Bearer")
    Rel(api, db, "Lê e escreve dados", "Drizzle ORM · SSL TCP 5432")
    Rel(api, sqs, "Publica + consome mensagens", "AWS SDK v3")
    Rel(api, stripe, "Checkout/portal/webhook", "REST HTTPS, in-process")
    Rel(sqs, lfiscal, "Trigger nfe-requests", "SQS Event Source Mapping")
    Rel(sqs, lbilling, "Trigger billing-requests", "SQS Event Source Mapping")
    Rel(sqs, lnotif, "Trigger notifications", "SQS Event Source Mapping")
    Rel(sqs, lmarket, "Trigger marketplace-sync-requests", "SQS Event Source Mapping")
    Rel(sqs, lwa, "Trigger whatsapp-requests", "SQS Event Source Mapping")
    Rel(lfiscal, focus, "POST /v2/nfe ou /v2/nfse", "REST HTTPS")
    Rel(lfiscal, s3data, "Salva XML", "AWS SDK PutObject")
    Rel(lbilling, itau, "OAuth2 token + POST /boletos", "REST HTTPS")
    Rel(lbilling, c6, "OAuth2 token + mTLS + POST /boletos", "REST HTTPS")
    Rel(lbilling, s3data, "Salva PDF", "AWS SDK PutObject")
    Rel(lnotif, ses, "SendEmail com template HTML", "AWS SDK v3")
    Rel(lmarket, ml, "OAuth2 refresh + PUT/GET items/orders", "REST HTTPS")
    Rel(api, ml, "OAuth2 connect/callback + recebe webhook", "REST HTTPS")
    Rel(lwa, twilio, "POST /Messages.json (Content API, credenciais do tenant)", "REST HTTPS Basic Auth")
    Rel(api, twilio, "Recebe webhook de status/reply (assinatura validada por tenant)", "REST HTTPS")
```

---

### C4 Nível 3 — Componentes: Pipeline de Emissão Fiscal

```mermaid
C4Component
    title C4 Nível 3 — Componentes: Emissão de NF-e/NFS-e/Simples Remessa

    Container_Boundary(api, "api-core") {
        Component(route, "routes/nfe.ts · nfse.ts · simplesRemessas.ts", "Fastify route", "Recebe POST /:id/emit, valida status draft")
        Component(resolveco, "companyService.resolveCompanyId()", "Service", "Resolve qual empresa emite, valida capacidade (emite_nfe/emite_nfse, regra 53)")
        Component(worker, "nfeResultsWorker.ts", "SQS long-poll worker, in-process", "Consome nfe-results, atualiza status, dispara baixa de estoque (regra 30), comissão (regra 32) e receivable (regra 60)")
    }

    Container_Boundary(lambda, "lambda-fiscal") {
        Component(handler, "handler.ts", "SQS trigger", "Discrimina por type: nfe | nfse | remessa")
        Component(payload, "buildFocusPayload() / buildItem()", "Domain builder", "Monta payload Focus, recalcula IBS/CBS sempre (regra 44)")
        Component(client, "FocusNfeClient", "HTTP client", "POST /v2/nfe ou /v2/nfse")
    }

    ContainerDb(sqsreq, "SQS nfe-requests", "Amazon SQS")
    ContainerDb(sqsres, "SQS nfe-results", "Amazon SQS")
    ContainerDb(s3, "S3 nfe-xml", "Amazon S3")
    System_Ext(focus, "Focus NF-e API")

    Rel(route, resolveco, "Valida empresa antes de enfileirar")
    Rel(route, sqsreq, "sendMessage")
    Rel(sqsreq, handler, "Trigger")
    Rel(handler, payload, "Monta payload por tipo")
    Rel(payload, client, "Payload pronto")
    Rel(client, focus, "POST", "REST HTTPS")
    Rel(handler, s3, "Salva XML")
    Rel(handler, sqsres, "sendMessage — resultado")
    Rel(sqsres, worker, "Trigger")
```

### C4 Nível 3 — Componentes: Motor de Cálculo de Impostos

```mermaid
C4Component
    title C4 Nível 3 — Componentes: Motor Fiscal (regra 14)

    Container_Boundary(api, "api-core") {
        Component(route, "routes/tax.ts", "Fastify route", "POST /tax/calculate — usa nfe_configs.uf como origem")
        Component(svc, "taxCalculationService.ts", "Orquestração", "Resolve DIFAL, FCP, IBS/CBS por UF destino")
        Component(resolver, "taxRulesResolver.ts", "Lookup + cache 5min", "Único ponto de leitura das tabelas tax_*")
        Component(engine, "taxEngine.ts", "Função pura, stateless", "Aritmética — nunca faz I/O")
    }

    ContainerDb(taxtables, "tax_icms_*, tax_fcp_rates,\ntax_st_rules, tax_simples_nacional_brackets,\ntax_ibs_cbs_rates", "PostgreSQL", "Tabelas centrais — nunca editáveis por tenant (regra 33)")

    Rel(route, svc, "Chama com itens + UF origem/destino")
    Rel(svc, resolver, "Busca alíquotas resolvidas")
    Rel(resolver, taxtables, "SELECT com cache")
    Rel(svc, engine, "Passa alíquotas já resolvidas")
    Rel(engine, svc, "Devolve valores calculados")
```

---

### Diagrama de Caso de Uso

```mermaid
flowchart LR
    subgraph Atores
        OW["Owner / Financeiro"]
        VD["Vendedor"]
        TC["Técnico de Campo"]
        CL["Cliente Final"]
        INT["Sistema Integrador\n(landing page / parceiro)"]
    end

    subgraph Externos["Sistemas Externos"]
        SF["SEFAZ / Focus"]
        BK["Itaú / C6 Bank"]
        ML["Mercado Livre"]
        ST["Stripe"]
        TW["Twilio WhatsApp"]
    end

    OW --> UC1["Emitir NF-e / NFS-e / Simples Remessa"]
    OW --> UC2["Gerenciar Contas a Pagar/Receber"]
    OW --> UC3["Configurar Empresa, Perfis de Acesso, Módulos"]
    OW --> UC4["Fechar Folha de Pagamento"]
    OW --> UC5["Consultar DRE Gerencial"]
    OW --> UC6["Gerenciar Centro de Custo"]
    OW --> UC19["Configurar Automações de WhatsApp (opcional)"]
    OW --> UC21["Agendar, Reagendar ou Cancelar Visita Técnica"]
    OW --> UC22["Configurar Campos Personalizados da Visita (schema por tenant)"]
    OW --> UC24["Gerar Chave de API (Leads ou Motor Fiscal)"]

    VD --> UC7["Criar Pedido de Venda"]
    VD --> UC8["Enviar Proposta Comercial"]
    VD --> UC9["Gerenciar Funil de Vendas (CRM)"]
    VD --> UC10["Consultar Comissões"]

    TC --> UC11["Fazer Check-in/Check-out de Visita"]
    TC --> UC12["Registrar Fotos e Assinatura do Cliente"]
    TC --> UC23["Preencher Campos Personalizados no Encerramento da Visita"]

    CL --> UC13["Visualizar e Aceitar/Rejeitar Proposta"]

    INT --> UC25["Capturar Lead via API Pública"]
    INT --> UC26["Consultar Motor Fiscal (Simples Nacional) via API"]

    UC1 --> SF
    UC1 --> UC14["Gerar Conta a Receber (automático na autorização)"]
    UC2 --> UC15["Emitir Boleto/Pix"]
    UC15 --> BK
    UC9 --> UC8
    UC8 -->|aceita| UC16["Converter Proposta em Pedido"]
    UC16 --> UC7
    UC7 --> UC1
    UC3 --> UC17["Conectar Loja Mercado Livre"]
    UC17 --> ML
    UC3 --> UC18["Ativar Assinatura SaaS"]
    UC18 --> ST
    UC19 --> UC20["Notificar Cliente via WhatsApp\n(cobrança, pagamento, NF-e, orçamento)"]
    UC14 --> UC20
    UC15 --> UC20
    UC1 --> UC20
    UC8 --> UC20
    UC20 --> TW
    UC22 --> UC23
    UC21 --> UC11
    UC24 --> UC25
    UC24 --> UC26
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

    U->>F: Preenche dados da NF-e (itens, NCM, CFOP travados do cadastro — regra 61)
    F->>A: POST /v1/invoices
    A-->>F: 201 {id, status: "draft"}

    U->>F: Clica "Emitir NF-e" (painel de NF-e)
    F->>A: POST /v1/invoices/:id/emit
    A->>A: resolveCompanyId(tenant, company_id, docType='nfe') — só empresa com emite_nfe=true (regra 53)
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
    A->>A: Se invoice.cost_center_id → applyExit por item (OUT de estoque, regra 30)
    A->>A: Se invoice.seller_id → accrueCommission (regra 32)
    A->>A: createReceivableFromInvoice() — idempotente (regra 60)
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
    A->>A: resolveCompanyId(tenant, company_id, docType='nfse') — só empresa com emite_nfse=true (regra 53)
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

### NF-e de Simples Remessa (conserto, demonstração, comodato, industrialização, amostra grátis, devolução)

```mermaid
sequenceDiagram
    actor U as Usuário
    participant F as Frontend (React)
    participant A as api-core (ECS)
    participant Q as SQS nfe-requests
    participant L as lambda-fiscal
    participant FX as Focus NF-e API
    participant SF as SEFAZ

    U->>F: Escolhe motivo (conserto/demonstração/comodato/...) + cliente + itens
    F->>A: POST /v1/simples-remessas
    Note over A: domain.resolveRemessaOperation(motivo, sameState)<br/>→ CFOP de ida + natureza_operação
    A-->>F: 201 {id, status: "draft", cfop}

    U->>F: Clica "Emitir"
    F->>A: POST /v1/simples-remessas/:id/emit
    A->>A: resolveCompanyId(tenant, company_id, docType='nfe') — mesma capacidade de venda (regra 53)
    Note over A: domain.resolveTaxSituation(regime) → CST/CSOSN "não tributada"<br/>getIbsCbsRates(uf) → alíquota REAL (nunca zero, regra 51)<br/>base de cálculo = 0 (não a alíquota) — operação não onerosa
    A->>Q: sendMessage {type:"remessa", remessa_id, itens...}
    A-->>F: 202 {status: "processing"}

    Q-->>L: Trigger SQS Event Source Mapping
    Note over L: Discrimina pelo campo type:'remessa'<br/>Reaproveita buildFocusPayload() e FocusNfeClient tal como estão
    L->>FX: POST /v2/nfe {natureza_operacao, cfop 5.9xx/6.9xx, itens...}
    FX->>SF: Transmite XML assinado digitalmente
    SF-->>FX: Protocolo de autorização + chave 44 dígitos
    FX-->>L: {status, chave_nfe, caminho_danfe}
    L->>Q: sendMessage (nfe-results) {type:"remessa", remessa_id, ...}

    Note over A: nfeResultsWorker.processRemessaResult() (mesmo worker, trata os 3 tipos)
    Q-->>A: Mensagem de resultado
    A->>A: UPDATE simples_remessas SET status='authorized', nfe_chave=...
    A->>A: applyRemessaStockMovement('out') — baixa estoque (idempotente via stock_applied_at)
    Note over A: Nunca gera receivable nem comissão — não é venda

    opt Motivo admite retorno (conserto/demonstração/comodato/industrialização)
        U->>F: Clica "Registrar Retorno" (remessa autorizada)
        F->>A: POST /v1/simples-remessas/:id/retorno
        Note over A: Nova simples_remessas com parent_remessa_id = original<br/>CFOP de retorno (domain.resolveRetornoOperation)
        A-->>F: 201 {id, status: "draft"} — usuário revisa e emite como qualquer remessa
        Note over A: Na autorização do retorno: applyRemessaStockMovement('in') — devolve estoque
    end
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
        GET /v1/orders/:id faz LEFT JOIN
        materials — ncm_code/cfop já vêm
        prontos no item (regra 62)
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

### Emissão de Boleto Bancário (Itaú ou C6 Bank)

```mermaid
sequenceDiagram
    actor U as Usuário
    participant F as Frontend (React)
    participant A as api-core (ECS)
    participant Q as SQS billing-requests
    participant L as lambda-billing
    participant P as Itaú ou C6 Bank
    participant S3
    participant R as SQS billing-results

    U->>F: Clica "Emitir Boleto" no recebível (opcional: escolhe bank_account_id)
    F->>A: POST /v1/receivables/:id/emit-boleto
    A->>A: bankAccountService.resolveBankAccount() — bank_account_id explícito<br/>ou a conta padrão da empresa padrão do tenant (regra 41)
    A->>Q: sendMessage — dados do boleto + credentials da conta resolvida (regra 59)
    A-->>F: 200 {status: "pending"}

    Q-->>L: Trigger SQS Event Source Mapping
    Note over L: Adapter por bank_accounts.billing_provider ('itau' | 'c6')
    L->>P: OAuth2 client_credentials (C6 também usa mTLS)
    P-->>L: {access_token, expires_in}
    L->>P: POST /boletos {nosso_numero, vencimento, sacado, valor...}
    P-->>L: {nosso_numero, linha_digitavel, codigo_barras, url_pdf}
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

### Funil de Vendas (CRM) — Lead → Oportunidade → Proposta → Pedido

```mermaid
sequenceDiagram
    actor V as Vendedor (backoffice)
    participant A as api-core
    participant K as Kanban (SalesPipelinePage)

    V->>A: POST /v1/sales-pipeline/opportunities {title, stage_id, contact}
    A-->>V: 201 {id, status: "open"}
    Note over K: Card aparece na coluna da etapa inicial (ex.: "Novo Lead")

    V->>K: Arrasta card para outra coluna
    K->>A: POST /v1/sales-pipeline/opportunities/:id/move {stage_id}
    A->>A: UPDATE stage_id + INSERT activity (type: "stage_change", automático)
    A-->>K: 200 {id, stage_id}

    V->>A: POST /v1/sales-pipeline/opportunities/:id/activities {type: "call", description}
    A->>A: INSERT sales_opportunity_activities (manual — note|call|meeting)
    A-->>V: 201

    alt Oportunidade avança e vira negócio
        V->>A: POST /v1/sales-pipeline/opportunities/:id/convert-to-proposal
        A->>A: INSERT proposals (status: "draft") + 1 item-placeholder
        A->>A: UPDATE sales_opportunities SET proposal_id + INSERT activity (proposal_linked)
        A-->>V: 201 {proposal: {id, token}}
        Note over V: Segue o ciclo de Proposta já existente (draft → sent → accepted → convert → Pedido)
        V->>A: POST /v1/sales-pipeline/opportunities/:id/won
        A->>A: UPDATE status='won', won_at=now() + INSERT activity (won)
    else Oportunidade não avança
        V->>K: Arrasta card para coluna "Perdido"
        K->>A: POST /v1/sales-pipeline/opportunities/:id/lost {reason?}
        A->>A: assertCanMarkLost(status) — bloqueia se já fechada (won|lost)
        A->>A: UPDATE status='lost', lost_at=now(), lost_reason + INSERT activity (lost)
        A-->>K: 200
    end

    Note over V,K: status (open|won|lost) é eixo separado de stage_id (etapa configurável) — Ganho/Perdido são colunas fixas no Kanban, não linhas de sales_pipeline_stages
```

---

### Sync de Preço/Estoque e Importação de Pedido — Mercado Livre

```mermaid
sequenceDiagram
    actor U as Usuário
    participant F as Frontend (React)
    participant A as api-core (ECS)
    participant Q as SQS marketplace-sync-requests
    participant L as lambda-marketplace
    participant ML as Mercado Livre API
    participant R as SQS marketplace-sync-results

    U->>F: Clica "Sincronizar" no vínculo produto↔anúncio
    F->>A: POST /v1/materials/:id/marketplace-links/:linkId/sync
    A->>Q: sendMessage {type:"sync_material", access_token, refresh_token, preço, estoque}
    A-->>F: 200 {status: "queued"}

    Q-->>L: Trigger SQS Event Source Mapping
    L->>L: ensureFreshToken() — renova se faltam <5min pra expirar (refresh_token de uso único)
    L->>ML: PUT /items/:id {price, available_quantity}
    ML-->>L: {status}
    L->>R: sendMessage — resultado + refreshed_tokens (sempre, se houve renovação)

    Note over A: marketplaceSyncResultsWorker (long-poll, in-process ECS)
    R-->>A: Mensagem de resultado
    A->>A: UPDATE material_marketplace_links SET status=...
    A->>A: Se refreshed_tokens presente → UPDATE marketplace_connections (nunca ignorar)

    Note over A,ML: Webhook (POST /v1/public/marketplace/mercadolivre/webhook)<br/>nunca é fonte de verdade, só gatilho — sempre responde 200 rápido<br/>Só processa tópicos orders_v2 — demais tópicos são ignorados em silêncio
    ML--)A: Webhook de pedido novo
    A->>A: INSERT marketplace_webhook_events (idempotente por UNIQUE idempotency_key)
    A->>Q: sendMessage {type:"order_import", resource}
    Q-->>L: Trigger
    L->>ML: GET /orders/:id
    ML-->>L: {itens, comprador, valor}
    L->>R: sendMessage — resultado
    R-->>A: mapMlOrderToErpOrder() → INSERT orders (status='confirmed', origin='mercadolivre')
```

---

### WhatsApp — Envio de Template e Webhook de Status (Twilio)

```mermaid
sequenceDiagram
    actor SYS as Evento de negócio<br/>(pagamento, NF-e, proposta, dueSoon/overdue)
    participant AS as whatsappAutomationService.ts
    participant MS as whatsappMessageService.ts
    participant A as api-core (ECS)
    participant Q as SQS whatsapp-requests
    participant L as lambda-whatsapp
    participant TW as Twilio WhatsApp API
    participant R as SQS whatsapp-results
    actor C as Cliente Final

    SYS->>AS: notifyPaymentConfirmed() / notifyInvoiceDueSoon() / ...
    AS->>AS: alreadyDispatched()? — checa whatsapp_messages por (tenant, template_key, ref_id)
    AS->>MS: sendTemplateMessage() se automação habilitada e ainda não enviado
    MS->>MS: assertCanSend() — conta conectada, template aprovado,<br/>automação habilitada, cliente com opt-in, telefone válido (toE164BR)
    MS->>MS: monta variables[] na ORDEM canônica do template (Content API usa {{1}},{{2}}... — não nomeado)
    MS->>A: INSERT whatsapp_messages (status='queued')
    MS->>Q: sendMessage — credentials do tenant embutidas no payload
    A-->>SYS: fire-and-forget (nunca bloqueia a rota de origem)

    Q-->>L: Trigger SQS Event Source Mapping
    L->>L: TwilioAdapter — Basic Auth com account_sid/auth_token do payload (nunca lido de env var)
    L->>TW: POST /Messages.json {From, To, ContentSid, ContentVariables:{"1":...,"2":...}}
    TW-->>L: {sid, status}
    L->>R: sendMessage — resultado (sid ou erro)

    Note over A: whatsappResultsWorker (long-poll SQS, in-process ECS)
    R-->>A: Mensagem de resultado
    A->>A: UPDATE whatsapp_messages SET status='sent'|'failed', provider_message_id=...
    A->>A: INSERT whatsapp_message_events (append-only)

    TW--)A: Webhook POST /v1/public/whatsapp/webhook (status callback)
    Note over A: resolveWebhookAccount() por número (From) ANTES de validar assinatura —<br/>credenciais são por tenant, não dá pra validar sem saber de quem é
    A->>A: verifyTwilioSignature() com o auth_token DAQUELE tenant (HMAC-SHA1 manual, sem SDK)
    A->>A: INSERT whatsapp_webhook_events (idempotência por MessageSid+status, UNIQUE)
    A->>A: UPDATE whatsapp_messages SET status='delivered'|'read'|'failed', delivered_at/read_at=...
    A-->>TW: 200 sempre (mesmo em erro/duplicado — nunca faz Twilio reter)

    C--)TW: Responde "SAIR"
    TW--)A: Webhook POST (mensagem recebida, To = número do tenant)
    A->>A: isOptOutReply() → UPDATE clients SET whatsapp_opt_in=false, whatsapp_opt_out_at=now()
    Note over A,C: Daí em diante assertCanSend() bloqueia qualquer novo envio a esse cliente (client_not_opted_in)
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

### Integração Fiscal Automatizada (registro assíncrono + certificado/teste síncronos)

```mermaid
sequenceDiagram
    actor U as Usuário
    participant F as Frontend (React — Minha Empresa → Fiscal)
    participant A as api-core (ECS)
    participant Q as SQS nfe-requests
    participant L as lambda-fiscal
    participant FX as Emissor Fiscal (Focus NF-e API — nunca exposto ao tenant)

    Note over U,F: UI nunca menciona o nome do provedor — só "integração de emissão de notas fiscais"

    U->>F: Clica "Registrar empresa"
    F->>A: POST /v1/companies/:id/fiscal-integration/register
    A->>A: assertCanRegister() — bloqueia se já pending/processing
    A->>A: UPDATE nfe_configs SET fiscal_registration_status='pending'
    A->>Q: sendMessage {type:"company_registration", empresa:{...}} — token mestre, nunca token por empresa
    A->>A: UPDATE nfe_configs SET fiscal_registration_status='processing'
    A-->>F: 202 {status: "processing"}
    F->>F: Poll GET /v1/companies a cada 3s enquanto pending/processing

    Q-->>L: Trigger SQS Event Source Mapping
    Note over L: Discrimina pelo campo type:'company_registration'
    L->>FX: POST /v2/empresas {cnpj, razão social, endereço, regime...} — sempre token mestre (FOCUS_NFE_TOKEN)
    FX-->>L: {id, token_producao, token_homologacao} ou {erros}
    L->>Q: sendMessage (nfe-results) — resultado do registro

    Q-->>A: Mensagem de resultado (nfeResultsWorker)
    A->>A: UPDATE nfe_configs SET fiscal_registration_status='registered', fiscal_integration_ref=..., focus_token_producao=..., focus_token_homologacao=... WHERE status='processing' (idempotência)
    A->>A: INSERT fiscal_integration_events (event_type='registration')

    Note over U,FX: Certificado digital e teste de conexão — SÍNCRONOS, nunca passam pela fila
    U->>F: Envia certificado (.pfx/.p12) + senha
    F->>A: POST /v1/companies/:id/fiscal-integration/certificate
    A->>A: assertCanUploadCertificate() — exige fiscal_integration_ref já presente
    A->>FX: PUT /v2/empresas/{ref} {arquivo_certificado_base64, senha_certificado}
    FX-->>A: {certificado_valido_de, certificado_valido_ate} ou {erros}
    A->>A: UPDATE nfe_configs SET certificado_valido_ate=... (nunca persiste o arquivo/senha)
    A-->>F: 200 {status: "active"}

    U->>F: Clica "Testar conexão"
    F->>A: POST /v1/companies/:id/fiscal-integration/test
    A->>FX: GET /v2/empresas/{ref}
    FX-->>A: 200 ou 404
    A-->>F: {ok: true|false}

    Note over A,Q: Mesmas filas/Lambda de NF-e/NFS-e/Remessa — só um 4º valor de type, sem mudança de infraestrutura
```

---

### Contratos — Campos Personalizados (schema por tenant, aplicado ao documento)

```mermaid
sequenceDiagram
    actor U as Usuário
    participant F as Frontend (React — Contratos)
    participant A as api-core (ECS)
    participant Q as SQS notifications
    participant L as lambda-notifications
    participant C as Cliente (e-mail)

    Note over U,F: Configuração do schema — uma vez por tenant

    U->>F: "Campos Personalizados" → Novo campo (label, tipo, obrigatório)
    F->>A: POST /v1/contract-fields
    A->>A: slugifyFieldKey(label) — chave derivada, imutável depois
    A-->>F: 201 {id, field_key, label, field_type}

    Note over U,F: Preenchimento — a cada contrato criado/editado

    U->>F: Preenche o contrato + valores dos campos personalizados
    F->>A: POST/PATCH /v1/service-contracts (custom_fields: [{field_definition_id, value}])
    A->>A: validateFieldValue(field_type, value) por campo — nunca confia no tipo declarado pelo cliente HTTP
    A-->>F: 200/201 {..., custom_fields: [...]}

    Note over U,F: Impressão e envio — sempre formatados a partir do mesmo dado bruto

    U->>F: Clica "Imprimir Contrato"
    F->>A: GET /v1/service-contracts/:id/print
    A-->>F: {contract, client, issuer (de tenants, regra 37), custom_fields: [{label, formatted_value}]}
    F->>F: window.print() — mesma aba autenticada, sem lib de PDF

    U->>F: Clica "Enviar por E-mail"
    F->>A: POST /v1/service-contracts/:id/send
    A->>A: formatFieldValueForDisplay() por campo → custom_fields_html/custom_fields_text
    A->>Q: sendSystemNotification({type:"contract_sent", data:{...custom_fields_html}})
    Q-->>L: Trigger SQS Event Source Mapping
    L->>L: getTemplate('contract_sent', data) — resumo do contrato no próprio corpo, nunca um link (sem portal público de contrato, diferente de proposta)
    L->>C: E-mail (SES)
```

---

### Ordens de Serviço — Agenda do Técnico (agendar, reagendar, cancelar) e Campos Personalizados de Visita

```mermaid
sequenceDiagram
    actor O as Owner/Admin/Manager (backoffice)
    participant F as Frontend (React — Agenda dos Técnicos)
    participant A as api-core (ECS)
    participant DB as PostgreSQL
    actor T as Técnico de Campo
    participant TF as Portal do Técnico (React)

    Note over O,F: Configuração do schema — uma vez por tenant, owner-only (service_visit_fields:manage)

    O->>F: "Campos Personalizados de Visita" → Novo campo (label, tipo, obrigatório)
    F->>A: POST /v1/service-visit-fields
    A-->>F: 201 {id, field_key, label, field_type}

    Note over O,F: Agendar — Ordens de Serviço → Agenda

    O->>F: Escolhe técnico + data/hora na Agenda
    F->>A: POST /v1/service-orders/:id/visits {technician_id, scheduled_at, duration_minutes}
    A->>DB: pg_advisory_xact_lock(tenant, technician) + findConflict() contra visitas ativas do técnico
    alt sem conflito
        A->>DB: INSERT service_visits (status='scheduled')
        A-->>F: 201 {id, scheduled_at}
    else conflito de horário
        A-->>F: 422 visit_conflict {conflicting: {visit_id, scheduled_at}}
    end

    Note over O,F: Reagendar — mesmo card na Agenda, novo horário

    O->>F: Arrasta/edita o card → novo scheduled_at
    F->>A: PATCH /v1/service-orders/:id/visits/:visitId {scheduled_at}
    A->>DB: mesmo lock + findConflict() — exclui a própria visita da checagem de blockers
    A->>DB: UPDATE service_visits SET scheduled_at=...
    A-->>F: 200 {id, scheduled_at}

    Note over O,F: Cancelar — bloqueado se a visita já está num estado terminal

    O->>F: Clica "Cancelar" no card
    F->>A: POST /v1/service-orders/:id/visits/:visitId/cancel
    alt status permite cancelamento (scheduled | in_progress)
        A->>DB: UPDATE service_visits SET status='cancelled'
        A-->>F: 200 {ok: true, status: "cancelled"}
    else visita já completed/cancelled
        A-->>F: 422 visit_cannot_cancel {status}
    end

    Note over T,TF: Preenchimento em campo — no encerramento da visita, não na configuração

    T->>TF: Abre a visita agendada (link/PIN, sem senha de backoffice)
    T->>TF: Check-in → executa o serviço → preenche os campos personalizados (ex.: "Tem internet no local?")
    TF->>A: POST /v1/technician/visits/:id/complete {report_notes, custom_fields: [{field_definition_id, value}]}
    A->>A: validateFieldValue() por campo — obrigatório sem resposta bloqueia a conclusão (nunca "meio completa")
    A->>DB: INSERT service_visit_field_values + UPDATE service_visits SET status='completed'
    A-->>TF: 200 {ok: true, status: "completed"}

    Note over O,F: Consulta pelo operador — respostas coletadas em campo, disponíveis onde a visita aparece

    O->>F: Abre a visita concluída
    F->>A: GET /v1/service-orders/:id/visits/:visitId
    A-->>F: {visit, custom_fields: [{label, field_type, value}]}

    O->>F: Imprime o formulário técnico da Ordem de Serviço
    F->>A: GET /v1/service-orders/:id/print
    A-->>F: {..., visits: [{..., custom_fields: [{label, field_type, formatted_value}]}]}
```

---

### Captação de Leads via API Pública (Landing Pages)

```mermaid
sequenceDiagram
    actor O as Owner/Admin (tenant)
    participant F as Frontend (React — Empresa → Integrações)
    participant A as api-core (ECS)
    actor V as Visitante (landing page)
    participant LP as Landing Page (JS client-side)
    participant DB as Postgres (clients)

    Note over O,A: Autoatendimento — gerar a chave publishable, uma vez

    O->>F: "Captação de Leads" → + Nova chave (nome, domínios opcionais)
    F->>A: POST /v1/lead-capture-keys (JWT, lead_capture:manage)
    A->>A: requireModule('lead_capture') + requirePermission('lead_capture:manage')
    A->>A: createKey(..., {scopes:['leads:create'], keyType:'publishable', rateLimitPerMin:10})
    A-->>F: 201 {secret: "pk_live_...", key_prefix, rate_limit_per_min}
    F->>O: Mostra o segredo UMA vez — só hash+prefixo ficam salvos

    Note over V,DB: Envio do lead — sem sessão, sem cookie, direto do navegador do visitante

    V->>LP: Preenche o formulário (nome, e-mail/telefone, mensagem)
    LP->>A: POST /v1/public/leads (X-API-Key: pk_live_..., Origin: landing page)
    A->>A: requireApiKey('leads:create', 'lead_capture') — hash bate? status active? escopo contém 'leads:create'?
    A->>A: isModuleEnabled(tenant, 'lead_capture') — desligado no toggle = 403 na hora, mesmo com chave válida
    A->>A: allowed_origins? confere Origin/Referer (defesa em profundidade, não a fronteira real)
    A->>A: checa rate limit da chave (10/min default) — acima = 429
    A->>A: validateAndNormalizeLead() — domínio puro, nome + (e-mail OU telefone) obrigatórios
    A->>DB: findOrCreateLeadClient(tenantId, lead) — casa por CNPJ, senão por e-mail sem documento
    alt cliente já existia
        DB-->>A: UPDATE só campos vazios (nunca sobrescreve dado editado pelo tenant)
        A-->>LP: 200 {id, created:false}
    else lead novo
        DB-->>A: INSERT clients (origin='landing_page')
        A-->>LP: 201 {id, created:true}
    end
    LP->>V: Confirmação de envio

    Note over O,F: O lead aparece na tela de Clientes já existente

    O->>F: Clientes → filtro "Origem: Landing page"
    F->>A: GET /v1/clients?origin=landing_page
    A-->>F: {data: [...]} — mesma listagem, mesmo cadastro, badge de origem
```

---

### Plano de Pagamento — Pedido → Nota Fiscal → Parcelas (regra 75)

```mermaid
sequenceDiagram
    actor U as Tenant
    participant F as Frontend (React)
    participant A as api-core (ECS)
    participant L as lambda-fiscal
    participant SEFAZ as SEFAZ / Focus NF-e
    participant W as nfeResultsWorker

    Note over U,F: Configuração — uma vez, ou já vem pronta ("À Vista" seedado no registro)

    U->>F: Empresa → Planos de Pagamento → Novo Plano ("3x sem juros": D+0/30/60, 33,34/33,33/33,33%)
    F->>A: POST /v1/payment-plans
    A->>A: validatePaymentPlanInstallments() — soma dos percentuais = 100%

    Note over U,F: Pedido de venda — escolhe o plano

    U->>F: Novo Pedido → Plano de Pagamento = "3x sem juros"
    F->>A: POST /v1/orders {..., payment_plan_id}

    Note over U,F: Nota fiscal herda a escolha do pedido

    U->>F: Emitir Nota a partir do Pedido
    F->>A: POST /v1/invoices {order_id, payment_plan_id herdado}
    U->>F: Emitir NF-e
    F->>A: POST /v1/invoices/:id/emit
    A->>A: generateInstallmentSchedule(total, hoje, installments) → duplicatas
    A->>L: SQS nfe-requests {..., duplicatas: [{numero,data_vencimento,valor}, ...]}
    L->>SEFAZ: Emite NF-e com o quadro FATURA/DUPLICATAS
    SEFAZ-->>L: Autorizada
    L->>W: SQS nfe-results {nfe_status: authorized}

    Note over W: Autorização é o fato gerador — nunca a confirmação do pedido (regra 60)

    W->>W: invoice.payment_plan_id setado?
    alt com plano
        W->>A: createReceivablesFromInvoiceWithPlan() → N receivables (installment_group_id compartilhado)
    else sem plano (comportamento de sempre)
        W->>A: createReceivableFromInvoice() → 1 receivable
    end
    U->>F: Contas a Receber → cada parcela pode gerar seu próprio boleto (POST /receivables/:id/emit-boleto, inalterado)
```

---

## Módulos do sistema (Web — backoffice)

| Módulo | Rota frontend | Tabelas principais |
|--------|--------------|-------------------|
| Dashboard | `/dashboard` | receivables, payables, invoices, orders |
| Fluxo de Caixa | `/dashboard` (seção) | receivables, payables (groupBy semana) |
| Clientes | `/clients` | clients, client_contacts |
| Histórico 360° | drawer de cliente | orders, invoices, receivables |
| Materiais | `/materials` | materials, material_images, material_price_history |
| Estoque | `/stock` | inventory, inventory_movements |
| Pedidos | `/orders` | orders, order_items |
| Propostas | `/proposals`, `/proposals/:id/print`, `/p/:token` | proposals, proposal_items |
| Notas Fiscais (NF-e) | `/invoices` | invoices, invoice_items, nfe_events |
| NFS-e | `/nfse` | nfse_invoices, nfse_events |
| Simples Remessa | `/simples-remessas` | simples_remessas, simples_remessa_items, simples_remessa_events |
| Contas a Receber | `/receivables` | receivables, receivable_payments, boletos |
| Centro de Custo | `/cost-centers`, `/cost-centers/:id` | cost_centers, cost_center_stock, cost_center_movements |
| Vendedores / Comissões | `/sellers`, `/sellers/:id` | sellers, commission_entries |
| Pedidos de Compra | `/purchase-orders` | purchase_orders, purchase_order_items |
| NF-e de Entrada | `/supplier-invoices` | supplier_invoices, supplier_invoice_items |
| DRE Gerencial | `/dre` | dre_categories + leitura de invoices/payables/nfse_invoices |
| Contas a Pagar | `/payables` | payables, payable_payments |
| Contratos *(opcional)* | `/contracts`, `/contracts/:contractId/print`, `/contracts/:contractId/billings/:billingId/receipt` | service_contracts, contract_billings, contract_field_definitions, contract_field_values |
| Fornecedores | `/suppliers` | suppliers, supplier_contacts |
| Relatórios | `/reports` | receivables (inadimplência), order_items (ranking), commission_entries |
| Usuários | `/users` | users |
| Perfis de Acesso *(só visível ao owner)* | `/access-profiles` | access_profiles, access_profile_permissions, access_profile_events |
| RH Simplificado *(opcional)* | `/employees`, `/payroll`, `/payroll/entries/:id/print` | employees, payroll_runs, payroll_entries, payroll_tax_brackets |
| Minha Empresa | `/company` | tenants, nfe_configs, notification_configs, bank_accounts |
| Empresas / Multi-CNPJ *(opcional)* | `/company` (aba Fiscal) | nfe_configs (N por tenant), fiscal_integration_events |
| Ordens de Serviço *(opcional)* | `/service-orders`, `/service-orders/agenda` | service_orders, service_order_items, service_visits, service_visit_field_definitions, service_visit_field_values |
| Técnicos *(opcional)* | `/technicians` | technicians, users |
| Portal do Técnico *(opcional, autenticado)* | `/tecnico/entrar`, `/tecnico/visitas`, `/tecnico/visitas/:id` | service_visits, service_visit_photos, service_visit_field_values |
| Integração Mercado Livre *(opcional)* | `/company` (aba Integrações), aba "Mercado Livre" em `/materials` | marketplace_connections, material_marketplace_links, marketplace_webhook_events |
| Funil de Vendas *(opcional)* | `/sales-pipeline` | sales_pipeline_stages, sales_opportunities, sales_opportunity_activities |
| PDV / NFC-e *(opcional)* | `/pos`, `/pos/caixa`, `/pos/sales`, `/pos/terminals`, `/pos/sessions` | pos_terminals, pos_sessions, pos_cash_movements, pos_sales, pos_sale_items, pos_sale_payments |
| Agendamento *(opcional)* | `/scheduling`, `/scheduling/calendar`, `/scheduling/professionals`, `/scheduling/areas`, `/scheduling/package-templates`, `/scheduling/settings` | scheduling_professionals, scheduling_areas, scheduling_availability_rules/exceptions, scheduling_sessions, scheduling_client_packages, scheduling_calendar_connections |
| Assinatura SaaS *(opt-in via `STRIPE_SECRET_KEY`)* | `/subscription` | plans, billing_events |
| WhatsApp — Cobranças e Notificações *(opcional, cobrado à parte)* | `/company` (aba Integrações), `/whatsapp` | whatsapp_accounts, whatsapp_message_templates, whatsapp_automations, whatsapp_messages, whatsapp_message_events, whatsapp_webhook_events |
| Projetos *(opcional)* | `/projects` | projects, project_professionals (+ orders.project_id, service_orders.project_id) |
| **Gestão Fiscal** *(opcional)* — importação (OFX/CSV/XLSX), conciliação, consolidação, emissão NFS-e (ABRASF próprio + Focus), apuração PGDAS-D, simulador de DAS, transmissão via SERPRO Integra Contador, Score Fiscal, alertas, fechamento de competência, Assistente Fiscal IA | `/fiscal` (painel executivo por empresa) | fiscal_company_config, fiscal_events, fiscal_revenue_monthly, fiscal_document_drafts, simples_apuracao, pgdasd_transmissions, fiscal_alerts, fiscal_closing_runs — ver `docs/fiscal-module.md` |
| **Contabilidade** *(opcional)* — livro diário, razão, balancete, livro caixa, DRE contábil, balanço, plano de contas (dupla entrada derivada dos fatos fiscais) | `/contabil` | chart_of_accounts, journal_entries, journal_lines — ver `docs/fiscal-module.md` |

---

## Adicionando um novo módulo

### Backend (obrigatório)

1. **Migration SQL** em `services/api-core/db/migrations/00NN_nome.sql` — cumulativa, nunca destrutiva.
2. **Schema Drizzle** em `services/api-core/src/db/schema.ts`.
3. **Adicionar a migration** ao array em `services/api-core/src/scripts/migrate.ts` — senão nunca roda.
4. **Domínio puro** (se houver regra de negócio não trivial) em `src/domain/<modulo>/`.
5. **Serviço** em `src/services/<modulo>Service.ts` — orquestração/I-O, chama o domínio.
6. **Rota Fastify** em `src/routes/<modulo>.ts` — só HTTP, chama o serviço.
7. **Registrar rota** em `src/app.ts`.
8. Se for módulo opcional: adicionar chave a `MODULE_KEYS` em `tenantModuleService.ts` e usar `requireModule('chave')` nas rotas.

### Frontend Web (backoffice)

9. **Página React** em `apps/backoffice/src/pages/<modulo>/<Modulo>Page.tsx`.
10. **Rota React Router** em `apps/backoffice/src/App.tsx`.
11. **Nav item + ícone SVG** em `apps/backoffice/src/components/Layout.tsx`.
12. **Chaves i18n** em `apps/backoffice/src/i18n/pt-BR.ts` E `en.ts` (regra 7).
13. **Atualizar a tabela "Módulos do sistema"** neste README.

Não é necessário atualizar manualmente listas de tabelas/rotas no Protocolo Anti-alucinação — as regras 1 e 2 apontam para o código-fonte como fonte de verdade; só adicionar o nome da tabela na lista de varredura rápida da regra 1, se for tabela nova.

### Soft-delete por módulo

| Módulo | Coluna | Valor inativo |
|--------|--------|---------------|
| clients | `is_active` | `false` |
| client_contacts | `is_active` | `false` |
| materials | `is_active` | `false` |
| users | `status` | `'disabled'` |
| suppliers | `is_active` | `false` |
| supplier_contacts | `is_active` | `false` |
| nfe_configs (empresas) | `is_active` | `false` (bloqueado se for a padrão ou a última ativa) |
| contract_field_definitions, service_visit_field_definitions | `is_active` | `false` (valores já salvos em contratos/visitas existentes nunca somem) |
| bank_accounts | `is_active` | `false` (bloqueado se for a padrão da empresa ou a última ativa daquela empresa) |
| material_marketplace_links | `status` | `'closed'` |
| cost_centers | `is_active` | `false` |
| sellers | `is_active` | `false` |
| orders, invoices, receivables, payables, service_contracts, proposals, purchase_orders, supplier_invoices, service_orders, service_visits, projects | `status` | `'cancelled'` |
| technicians | `is_active` | `false` (também desabilita `users.status='disabled'` do login vinculado) |
| boleto_events, nfe_events, nfse_events, cost_center_movements, service_visit_photos, sales_opportunity_activities, access_profile_events, payroll_tax_brackets | — | append-only, nunca deletar |

---

## Desenvolvimento local

### Pré-requisitos

- Node.js ≥ 20
- Docker + Docker Compose

### Iniciando o ambiente

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

### Acessos locais

| Serviço | URL |
|---------|-----|
| Backoffice Web | http://localhost:5173 |
| API Core | http://localhost:3000 |
| PostgreSQL | postgresql://erp_lite:erp_lite@localhost:5432/erp_lite |
| LocalStack (SQS/S3/SES) | http://localhost:4566 |

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
STRIPE_SECRET_KEY         # opt-in — sem isso, módulo de assinatura é no-op (regra 43)
STRIPE_WEBHOOK_SECRET     # verificação HMAC do webhook Stripe
```
