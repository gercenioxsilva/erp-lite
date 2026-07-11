# Orquestra ERP — SaaS Multi-tenant ERP on AWS

> **Este README é o prompt principal para geração de código por IA.**
> Antes de implementar qualquer funcionalidade, leia este arquivo na íntegra.
> Ele define a fonte da verdade sobre arquitetura, convenções e regras de negócio do backoffice **web** (`apps/backoffice`) e da API (`services/api-core` + `services/lambda-*`).
> **Não existe app mobile neste repositório** — só `apps/backoffice`. Se alguma referência a Flutter/mobile aparecer em código antigo ou comentário, é resíduo a ignorar, nunca fonte de verdade.

---

## Protocolo Anti-alucinação (leia primeiro)

Regras que toda IA assistindo este projeto DEVE seguir antes de gerar código. Fatos que mudam com frequência (schema exato, lista de rotas) **apontam para o código-fonte em vez de serem copiados aqui** — copiar gera drift (este README já teve isso corrigido uma vez; não repetir).

1. **Nunca inventar tabelas ou colunas.** Fonte de verdade: `services/api-core/src/db/schema.ts` (definição Drizzle) + `services/api-core/db/migrations/00NN_*.sql` (histórico cumulativo, nunca destrutivo). Antes de usar qualquer tabela/coluna, `grep` o nome em `schema.ts` — nunca assumir que existe pela lembrança de uma feature. Tabelas existentes (nomes, para varredura rápida — schema completo de cada uma está em `schema.ts`): `tenants`, `users`, `materials`, `material_images`, `material_price_history`, `inventory`, `inventory_movements`, `clients`, `client_contacts`, `orders`, `order_items`, `invoices`, `invoice_items`, `nfe_configs`, `nfe_events`, `notification_configs`, `receivables`, `receivable_payments`, `payables`, `payable_payments`, `boletos`, `boleto_events`, `service_contracts`, `contract_billings`, `nfse_invoices`, `nfse_events`, `suppliers`, `supplier_contacts`, `proposals`, `proposal_items`, `cost_centers`, `cost_center_stock`, `cost_center_movements`, `sellers`, `commission_entries`, `tax_icms_interstate_rates`, `tax_icms_internal_rates`, `tax_fcp_rates`, `tax_st_rules`, `tax_simples_nacional_brackets`, `tax_ibs_cbs_rates`, `purchase_orders`, `purchase_order_items`, `supplier_invoices`, `supplier_invoice_items`, `dre_categories`, `tenant_modules`, `technicians`, `service_orders`, `service_order_items`, `service_visits`, `service_visit_photos`, `bank_accounts`, `marketplace_connections`, `material_marketplace_links`, `marketplace_webhook_events`, `plans`, `billing_events`, `simples_remessas`, `simples_remessa_items`, `simples_remessa_events`, `sales_pipeline_stages`, `sales_opportunities`, `sales_opportunity_activities`, `access_profiles`, `access_profile_permissions`, `access_profile_events`, `employees`, `payroll_runs`, `payroll_entries`, `payroll_tax_brackets`, `pos_terminals`, `pos_sessions`, `pos_cash_movements`, `pos_sales`, `pos_sale_items`, `pos_sale_payments`, `scheduling_settings`, `scheduling_professionals`, `scheduling_areas`, `scheduling_professional_areas`, `scheduling_availability_rules`, `scheduling_availability_exceptions`, `scheduling_package_templates`, `scheduling_client_packages`, `scheduling_sessions`, `scheduling_calendar_connections`, `scheduling_package_movements`.

2. **Nunca inventar rotas de API.** Fonte de verdade: `grep -n "fastify\.\(get\|post\|patch\|delete\)(" services/api-core/src/routes/*.ts` — se uma rota não aparece nesse grep, ela não existe, crie antes de usar. Toda rota autenticada usa `onRequest: [(fastify as any).authenticate]` e extrai `tenantId` de `request.user.tenantId` (nunca do body/query, exceto a exceção legada documentada na regra 4). Domínios cobertos hoje (um arquivo de rota por domínio em `routes/`, nome do arquivo = nome do domínio): auth (login/registro/verificação de e-mail/reset de senha), clients (+ contacts + import + history 360°), materials (+ images + import + price-history + marketplace-links), stock, orders, invoices (+ emit/cancel/nfe-status/events), nfse, simples-remessas, tax (calculate + simples-effective-rate), nfe-config, companies (multi-empresa), bank-accounts, receivables (+ payments + emit-boleto), payables (+ payments), suppliers (+ contacts + payables), service-contracts (+ billings), users, access-profiles (RBAC), employees + payroll (RH), tenant (+ logo + modules), notification-config, proposals (+ send/convert/duplicate/cancel/print + portal público `/public/proposals/:token`), dashboard (+ cashflow), reports (overdue/top-products/commissions/dre), cost-centers (+ active/stock/movements/entries/adjustments), sellers (+ active/commissions), purchase-orders (+ approve/cancel), supplier-invoices (+ confirm/cancel/lookup-by-key/document), technicians (+ resend-invite), service-orders (+ visits/billing/print/cancel), technician (portal do técnico, `/v1/technician/*`, role-gated), integrations/mercadolivre (+ callback público + webhook público), subscription (Stripe, + webhook público), sales-pipeline (stages + opportunities + activities), pos (terminais/sessões/vendas), scheduling (+ scheduling-portal + scheduling-sessions + calendar-integration).

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

63. **Dropdown de centro de custo sempre vazio em "Novo Pedido" (`OrdersPage.tsx`) — causa raiz: `GET /v1/cost-centers/active` devolvia um array "nu" (`return rows`) em vez de `{ data: [...] }`, o contrato usado por todo o resto da API (inclusive pelo próprio `GET /v1/cost-centers`, sem o `/active`).** Sem centro de custo escolhido no pedido, a nota fiscal gerada a partir dele também não tinha centro de custo (regra 61 só herda o que o pedido já tem) — impacto direto na contabilidade, exatamente como reportado. Achado: já existia um teste de regressão (`costCentersActive.test.ts`) descrevendo esse bug e as 4 telas afetadas, escrito mas nunca commitado nem com a correção aplicada. **Fix: `routes/costCenters.ts` (`GET /cost-centers/active`) passa a devolver `{ data: rows }`.** Duas telas (`EmployeesPage.tsx`, `PayablesPage.tsx`) já tratavam a resposta como array puro (`Array.isArray(d) ? d : []`) — corrigidas nesta mesma correção pra ler `d.data ?? []`, senão ficariam quebradas pela mudança de contrato. As outras quatro (`OrdersPage.tsx`, `InvoiceNewPage.tsx`, `InvoicesPage.tsx`, `ReceivablesPage.tsx`) já esperavam `{ data: [...] }` — corrigidas automaticamente, sem mudança de código nelas. Sempre por tenant (`WHERE tenant_id = ...`, sem alteração no filtro).

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
```

---

### C4 Nível 2 — Containers

```mermaid
C4Container
    title C4 Nível 2 — Containers do Orquestra ERP

    Person(user, "Usuário ERP", "Opera o backoffice")
    Person_Ext(client, "Cliente Final", "Acessa portal de propostas")

    Container_Boundary(aws, "AWS Cloud") {
        Container(cdn, "CloudFront + S3 Static", "AWS CDN / S3", "Entrega a SPA e assets. Roteia /v1/* para NLB. Certificado ACM us-east-1")
        Container(spa, "React SPA", "React 18 · TypeScript · Vite", "Backoffice completo + portal público /p/:token")
        Container(api, "api-core", "Node 22 · Fastify · Drizzle ORM · ECS Fargate Spot", "API REST multi-tenant. Workers in-process: nfeResults, boletoResults, contractBilling, recurringPayables, dueSoon, marketplaceSyncResults")
        ContainerDb(db, "RDS PostgreSQL 16", "PostgreSQL · SSL obrigatório", "Todos os dados isolados por tenant_id. Migrations em db/migrations/")
        ContainerDb(sqs, "SQS Queues", "Amazon SQS", "nfe-requests/results · billing-requests/results · notifications(-dlq) · marketplace-sync-requests/results(-dlq)")
        ContainerDb(s3data, "S3 Data Buckets", "Amazon S3", "nfe-xml (lifecycle 5 anos) · billing-pdf (lifecycle 7 anos) · service-visit-photos (privado, SSE-KMS)")
        Container(lfiscal, "lambda-fiscal", "Node 22 · ECR Container", "Emite NF-e, NFS-e e Simples Remessa via Focus. Discrimina por type. Salva XML no S3")
        Container(lbilling, "lambda-billing", "Node 22 · ECR Container", "Emite boleto/Pix via Itaú ou C6 Bank (adapter por bank_accounts.billing_provider). Salva PDF no S3")
        Container(lnotif, "lambda-notifications", "Node 22 · ECR Container", "Renderiza templates HTML e envia via SES v2. Rebuild obrigatório ao adicionar tipo")
        Container(lmarket, "lambda-marketplace", "Node 22 · ECR Container", "OAuth2 refresh, sync de preço/estoque e import de pedido via API do Mercado Livre")
    }

    System_Ext(focus, "Focus NF-e API", "Gateway fiscal")
    System_Ext(itau, "Itaú API v2", "Boleto + Pix")
    System_Ext(c6, "C6 Bank API", "Boleto")
    System_Ext(ses, "Amazon SES v2", "Relay de e-mail")
    System_Ext(ml, "Mercado Livre API", "OAuth2 + sync + pedidos")
    System_Ext(stripe, "Stripe", "Assinatura SaaS")

    Rel(user, cdn, "Acessa via browser", "HTTPS")
    Rel(client, cdn, "Acessa /p/:token", "HTTPS")
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
    Rel(lfiscal, focus, "POST /v2/nfe ou /v2/nfse", "REST HTTPS")
    Rel(lfiscal, s3data, "Salva XML", "AWS SDK PutObject")
    Rel(lbilling, itau, "OAuth2 token + POST /boletos", "REST HTTPS")
    Rel(lbilling, c6, "OAuth2 token + mTLS + POST /boletos", "REST HTTPS")
    Rel(lbilling, s3data, "Salva PDF", "AWS SDK PutObject")
    Rel(lnotif, ses, "SendEmail com template HTML", "AWS SDK v3")
    Rel(lmarket, ml, "OAuth2 refresh + PUT/GET items/orders", "REST HTTPS")
    Rel(api, ml, "OAuth2 connect/callback + recebe webhook", "REST HTTPS")
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
    end

    subgraph Externos["Sistemas Externos"]
        SF["SEFAZ / Focus"]
        BK["Itaú / C6 Bank"]
        ML["Mercado Livre"]
        ST["Stripe"]
    end

    OW --> UC1["Emitir NF-e / NFS-e / Simples Remessa"]
    OW --> UC2["Gerenciar Contas a Pagar/Receber"]
    OW --> UC3["Configurar Empresa, Perfis de Acesso, Módulos"]
    OW --> UC4["Fechar Folha de Pagamento"]
    OW --> UC5["Consultar DRE Gerencial"]
    OW --> UC6["Gerenciar Centro de Custo"]

    VD --> UC7["Criar Pedido de Venda"]
    VD --> UC8["Enviar Proposta Comercial"]
    VD --> UC9["Gerenciar Funil de Vendas (CRM)"]
    VD --> UC10["Consultar Comissões"]

    TC --> UC11["Fazer Check-in/Check-out de Visita"]
    TC --> UC12["Registrar Fotos e Assinatura do Cliente"]

    CL --> UC13["Visualizar e Aceitar/Rejeitar Proposta"]

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
| Contratos | `/contracts` | service_contracts, contract_billings |
| Fornecedores | `/suppliers` | suppliers, supplier_contacts |
| Relatórios | `/reports` | receivables (inadimplência), order_items (ranking), commission_entries |
| Usuários | `/users` | users |
| Perfis de Acesso *(só visível ao owner)* | `/access-profiles` | access_profiles, access_profile_permissions, access_profile_events |
| RH Simplificado *(opcional)* | `/employees`, `/payroll`, `/payroll/entries/:id/print` | employees, payroll_runs, payroll_entries, payroll_tax_brackets |
| Minha Empresa | `/company` | tenants, nfe_configs, notification_configs, bank_accounts |
| Empresas / Multi-CNPJ *(opcional)* | `/company` (aba Fiscal) | nfe_configs (N por tenant) |
| Ordens de Serviço *(opcional)* | `/service-orders` | service_orders, service_order_items, service_visits |
| Técnicos *(opcional)* | `/technicians` | technicians, users |
| Portal do Técnico *(opcional, autenticado)* | `/tecnico/entrar`, `/tecnico/visitas`, `/tecnico/visitas/:id` | service_visits, service_visit_photos |
| Integração Mercado Livre *(opcional)* | `/company` (aba Integrações), aba "Mercado Livre" em `/materials` | marketplace_connections, material_marketplace_links, marketplace_webhook_events |
| Funil de Vendas *(opcional)* | `/sales-pipeline` | sales_pipeline_stages, sales_opportunities, sales_opportunity_activities |
| PDV / NFC-e *(opcional)* | `/pos`, `/pos/caixa`, `/pos/sales`, `/pos/terminals`, `/pos/sessions` | pos_terminals, pos_sessions, pos_cash_movements, pos_sales, pos_sale_items, pos_sale_payments |
| Agendamento *(opcional)* | `/scheduling`, `/scheduling/calendar`, `/scheduling/professionals`, `/scheduling/areas`, `/scheduling/package-templates`, `/scheduling/settings` | scheduling_professionals, scheduling_areas, scheduling_availability_rules/exceptions, scheduling_sessions, scheduling_client_packages, scheduling_calendar_connections |
| Assinatura SaaS *(opt-in via `STRIPE_SECRET_KEY`)* | `/subscription` | plans, billing_events |

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
| bank_accounts | `is_active` | `false` (bloqueado se for a padrão da empresa ou a última ativa daquela empresa) |
| material_marketplace_links | `status` | `'closed'` |
| cost_centers | `is_active` | `false` |
| sellers | `is_active` | `false` |
| orders, invoices, receivables, payables, service_contracts, proposals, purchase_orders, supplier_invoices, service_orders, service_visits | `status` | `'cancelled'` |
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
