# Módulo Fiscal + Contábil (Simples Nacional)

> Branch `feat/fiscal-simples-nacional` · PR #174 (draft) · migrations fiscais **0068–0079** (12 arquivos) · 1312+ testes · mergeado com `develop` em 2026-07-17.
> Documento gerado a partir do código em 2026-07-12 (atualizado 2026-07-16 com a transmissão PGDAS-D via SERPRO; 2026-07-17 com o merge de `develop`). Cobre: **o que foi feito**, **como funciona**, **o que é configurável** e **o que é preciso para funcionar**.
>
> **Correção importante (2026-07-16):** a premissa anterior "o PGDAS-D não tem API oficial de transmissão" era **FALSA**. A **SERPRO Integra Contador** transmite o PGDAS-D (`TRANSDECLARACAO11`) e gera o DAS oficial em PDF (`GERARDAS12`) — ver §2.14. A transmissão foi implementada na migration 0079; onde este documento ainda disser "sem API oficial", vale o §2.14.
>
> **Nota de merge (2026-07-17):** `develop` chegou com o PR #183 (módulo de Projetos) usando os **mesmos números** `0068`/`0069`/`0070` para migrations diferentes (`0068_projects.sql` vs. `0068_fiscal_core.sql`, etc.) — nomes de arquivo únicos, sem colisão de conteúdo, mesmo padrão já tolerado em `0065` (ver `migrate.ts`). A **próxima migration fiscal livre é a 0080** (a Fiscal Engine API pública mencionada no roadmap, ainda não iniciada, usaria esse número).

---

## 1. Visão geral

O módulo transforma o ERP num sistema que cobre grande parte da operação contábil de empresas do **Simples Nacional**:

```
importar (OFX/CSV/XLSX) → conciliar → consolidar → emitir NFS-e → apurar DAS (PGDAS-D)
        → simular → alertar → fechar competência → travar → contabilizar (dupla entrada)
        → conversar com o Assistente Fiscal IA (que também propõe notas e a guia de impostos)
```

Foi entregue em **três rodadas**:

| Rodada | Migrations | Entregas |
|---|---|---|
| 1 | 0068–0075 | Auditoria unificada, cadastro fiscal por empresa, tabelas do Simples versionadas, importação, conciliação, consolidação, motor NFS-e ABRASF próprio (assinatura A1), apuração PGDAS-D completa, ciclo agendado 23:59, receita→RBT12 auto-alimentado |
| 2 | 0076–0078 | Simulador de DAS + what-if (E1), Score Fiscal + detector de inconsistências (E2), Central de alertas (E3), Robô de fechamento + trava de competência (E4), Motor contábil de dupla entrada (E5), Assistente Fiscal IA (E6) |
| 3 | — (sem migration) | Assistente **propõe** NFS-e com confirmação humana (E7), **guia de impostos** do mês imprimível (E8), pontas soltas: seams contábeis de POS/payable + estornos, **feriados nacionais** no vencimento do DAS, CRUD de regras de conciliação e de municípios (E9) |

**Fora do escopo (próxima rodada):** OCR de documentos e Fiscal Engine API pública (`/v1/engine/*` + `api_keys`).

**Rodada 4 (migration 0079):** transmissão PGDAS-D + geração do DAS oficial via SERPRO Integra Contador — ver §2.14.

### Arquitetura

- **api-core** (Fastify + Drizzle + Postgres): todas as rotas `/v1/fiscal/*`, `/v1/accounting/*`, `/v1/nfse/*`; domínio puro em `src/domain/` (sem I/O), serviços em `src/services/`, workers in-process no boot.
- **lambda-fiscal**: transporte apenas — consome a fila SQS `nfe_requests`, fala SOAP com o webservice municipal (ou Focus NF-e) e publica o resultado em `nfe_results`. **O certificado A1 nunca sai do api-core** (o lambda recebe XML já assinado).
- **backoffice** (React/Vite): `FiscalPage` (hub do pipeline), `AccountingPage` (`/contabil`), `AssistantChat`, aba fiscal/módulos em Minha Empresa.
- **EventBridge Scheduler** (`terraform/scheduler-fiscal.tf`): cron `59 23 * * ? *` America/Sao_Paulo publica `{type:'fiscal_consolidation_run'}` na fila `nfe_results` — sem Lambda nem endpoint novo.
- **Gating em camadas** em toda rota: `authenticate` → `requireModule('fiscal'|'contabil')` (403 `ModuleNotEnabled`) → `requirePermission` (403 `PermissionDenied`). O backend é sempre a autoridade; o menu só esconde por UX.

---

## 2. O que foi feito, subsistema por subsistema

### 2.1 Fundação (0068 — auditoria, 0069 — cadastro, 0070 — tabelas do Simples)

- **`fiscal_events`** — trilha de auditoria unificada e append-only de todo o módulo. Escrita **exclusivamente** via `fiscalAuditService.record()`: mascara segredos (`senha|password|token|secret|credential|pfx|private_key|client_secret`) e garante idempotência física por `UNIQUE (tenant_id, idempotency_key)` (retry de SQS nunca duplica).
- **`fiscal_company_config`** — cadastro fiscal 1:1 por empresa (filha de `nfe_configs`), criada por get-or-create. Campos em §4.2.
- **`fiscal_company_cnae`** (1 principal por empresa), **`fiscal_company_service_code`** (LC 116, com override de anexo/alíquota/retenção por serviço e 1 default), **`fiscal_company_payroll_month`** (folha + pró-labore por competência — insumo do Fator R, entrada manual no MVP).
- **`fiscal_certificates`** — certificado digital A1 (.pfx) por empresa; metadados extraídos por node-forge no upload; 1 ativo por empresa; troca preserva histórico. Credenciais em texto puro no JSONB (decisão registrada; KMS é Fase 2) — nunca logadas, nunca retornadas pela API.
- **Tabelas globais versionadas por vigência** (parametrização anual **sem deploy** — o resolver usa `MAX(vigencia_ano) <= ano`):
  - `tax_simples_nacional_brackets` — faixas dos Anexos I–V (seed 2018, LC 155/2016);
  - `tax_simples_repartition` — repartição do DAS por tributo (seed 2018 na 0075; Anexo IV com CPP=0);
  - `tax_cnae_anexo_map` — sugestão CNAE→Anexo (heurística de cadastro, validação humana obrigatória).
- **`fiscal_revenue_monthly`** — ledger de receita por empresa/competência, fonte única do RBT12. Idempotente por documento (`UNIQUE` parcial em `source_doc_type + source_doc_id`).
- `pos_sales` e `orders` ganharam `company_id` (backfill para a empresa default) — receita atribuível a CNPJ em tenant multiempresa.

### 2.2 Importação (0071)

Upload multipart em `POST /v1/fiscal/imports` (máx. **25 MB**, 1 arquivo): tipo detectado por **magic bytes** (nunca MIME), original vai ao S3 (`FISCAL_IMPORTS_BUCKET`, SSE AES256) com checksum sha256 — re-upload do mesmo arquivo é 409 `duplicate_file`. Parse **inline no backend**:

- **OFX** — `ofx-data-extractor` (extrato bancário/cartão), decode win1252, FITID/valor sinalizado.
- **CSV/XLSX** — exige **template** (`import_source_templates`): `column_map` traduz campo canônico → coluna da fonte, com delimiter/encoding/date_format/decimal_separator/skip_rows por adquirente (Cielo/Rede/Stone/…). XLSX via `exceljs` (nunca SheetJS — CVEs conhecidas).

Cada linha vira `imported_transactions` (ledger canônico, 14 campos + `raw` JSONB sem perda) com `dedup_key` (`ofx:{conta}:{FITID}` ou `acq:{adquirente}:{nsu}:{dia}:{valor}`); erro em 1 linha nunca derruba o batch (`partially_failed` com contadores). `POST /v1/fiscal/imports/:id/reprocess` baixa o original do S3 (útil após corrigir template).

### 2.3 Conciliação (0072)

`POST /v1/fiscal/reconciliation/run` (também chamado pelo fechamento): varre até 500 transações `pending` e casa contra **receivables** abertos com scoring em cascata (domínio puro `reconciliationDomain.ts`):

- valor exato **+0,5** / dentro da tolerância **+0,35** (incompatível descarta);
- NSU na descrição do receivable **+0,6**, senão código de autorização **+0,5**;
- data na janela **+0,4** com decaimento linear.

Score ≥ threshold (default **0,90**) e sem empate → **auto-confirma**: cria `reconciliation_matches` confirmado e chama `registerReceivablePayment` (baixa o recebível). Senão vira sugestão ou cai na fila **Pendente de Conciliação** (`GET .../transactions`), onde o operador faz match manual 1↔1 (`POST .../:id/match` — valida competência aberta) ou ignora. Regras por empresa em `reconciliation_rules` (tolerância/janela/threshold/líquido-vs-bruto) — sem registro vale o default `0.01 / 3 dias / 0.90 / líquido`. **`reconciliationService` é o único escritor de `reconciliation_status`.**

### 2.4 Consolidação (0073)

`consolidateMatched` agrupa transações conciliadas em **`fiscal_document_drafts`** segundo a regra ativa (`consolidation_rules`, especificidade contrato > cliente > empresa; default `monthly`). Estratégias: `per_sale`, `daily`, `weekly`, `monthly`, `per_client`, `per_contract`. A `grouping_key` é determinística e embute o `service_code` (LC 116 heterogêneo nunca vira 1 nota); reprocesso é idempotente (`UNIQUE` em grouping_key e em transaction_id). `calculateDraft` grava o snapshot tributário (RBT12 + alíquota efetiva + ISS **informativo** — no Simples o ISS está dentro do DAS) e exige competência aberta. MEI é bloqueado.

### 2.5 Emissão NFS-e (0074 — motor próprio ABRASF)

`POST /v1/fiscal/consolidation/drafts/:id/emit`:

1. **Gate de prontidão** (`emission-readiness`): inscrição municipal + ≥1 código de serviço + (se provider ≠ `focus`) certificado A1 válido. Lista **todas** as pendências de uma vez.
2. Trava de dupla emissão: `UPDATE status calculated→emitting WHERE status='calculated' RETURNING` + `draft.nfse_id`.
3. **Provider `abrasf`**: carrega o município do registry global **`nfse_municipalities`** (endpoints, versão ABRASF, perfil, `rsa-sha1|rsa-sha256`, C14N `inclusive|exclusive` — seed: Patos/PB WebISS 2.02), aloca o RPS **atomicamente** (`UPDATE ... RETURNING` em `rps_proximo_numero`; reenvio reusa o número), monta o XML ABRASF 2.x, **assina no api-core** (xml-crypto, enveloped + C14N, X509) e envia à fila `NFE_REQUESTS_QUEUE_URL`.
4. **lambda-fiscal** envelopa em SOAP 1.2, POSTa no webservice (timeout 60s), interpreta a resposta (autorizada / lote assíncrono / rejeitada) e publica em `NFE_RESULTS_QUEUE_URL`.
5. **`nfeResultsWorker`** fecha o ciclo: nota `authorized` → grava número/código de verificação/protocolo, fecha o draft (`emitted`), **projeta receita no ledger do RBT12** (`recordRevenue`, idempotente), **posta o lançamento contábil** e notifica o cliente; `rejected` → draft `failed` com o motivo.
- **Cancelamento**: `POST /v1/nfse/:id/cancel` (motivo obrigatório) — assina `InfPedidoCancelamento` e segue o mesmo trajeto.
- **Simulação local**: endpoint do município começando com `local-` → o lambda devolve autorização sintética sem rede (mesmo padrão do token `local-` do Focus). Provider **`focus`** continua como default/fallback (dispensa certificado próprio).

### 2.6 Apuração PGDAS-D (0075)

`POST /v1/fiscal/apuracao` roda `apurarSimples` (função **pura** em `apuracaoDomain.ts` — todo cálculo de DAS do sistema passa por ela):

- **RBT12**: soma móvel das 12 competências **anteriores** no ledger; início de atividade proporcionaliza (1º mês = receita×12; <12 meses = média×12); fallback `rbt12_manual`/`receita_acumulada_abertura` do cadastro.
- **Alíquota efetiva** (LC 123): `max(0, nominal − parcela_deduzir×100/RBT12)` na faixa do RBT12.
- **Fator R** (se `fator_r_aplicavel`): folha 12m / RBT12 — **≥ 0,28 → Anexo III**, senão **Anexo V**. Exige 12 meses de folha ou trava com `folha_12m_incompleta` (não assume zero — jogaria a empresa indevidamente no anexo mais caro).
- **Teto de 5% do ISS** com redistribuição proporcional do excedente entre os demais tributos; **sublimite R$ 3,6M** tira ICMS/ISS do DAS *sem* redistribuição (recolhidos por fora); **Anexo IV sem CPP** (INSS patronal via GPS); **ISS retido** pelo tomador abatido proporcionalmente; **empresa mista** soma vários anexos.
- **MEI é bloqueado** (`mei_das_fixo_nao_suportado`) — DAS-SIMEI é valor fixo.

Resultado: upsert idempotente em `simples_apuracao` (memória de cálculo completa em JSONB) + eventos. `GET /v1/fiscal/apuracao/:id/export` devolve o **roteiro assistido** de 6 passos com os valores exatos por tributo (para quem lança no portal manualmente). `POST /v1/fiscal/das-payments` registra o DAS pago; `GET /v1/fiscal/das-summary` mostra estimado vs pago das últimas 12 competências. **A transmissão automática do PGDAS-D e a geração do DAS oficial estão em §2.14 (SERPRO Integra Contador).**

### 2.7 Simulador de DAS (E1 — sem migration, 100% stateless)

`GET /v1/fiscal/simulator`: DAS projetado do mês (receita = ledger + **pipeline** de drafts abertos), alíquota efetiva, RBT12, "faltam R$ X para a próxima faixa" e cenários rápidos (+5k/+10k/+15k). `POST /v1/fiscal/simulator/what-if`: cenários custom com **semântica de timing**:

- `hoje` — o delta soma na base do mês; **RBT12 não muda** (a receita do próprio mês não entra no seu RBT12);
- `proxima_competencia` — a janela desloca: `RBT12' = RBT12 + receita do mês − receita do mês que sai da janela`.

`pro_labore_delta_mensal` compara Fator R atual vs simulado (Anexo III vs V) e devolve a economia mensal de DAS. **Regra de ouro** (garantida por teste de contrato): o simulador não calcula nada — delega 100% ao `apurarSimples` da apuração oficial.

### 2.8 Score Fiscal + inconsistências (E2 — sem migration)

`GET /v1/fiscal/inconsistencies` roda o detector (`inconsistencyDomain.ts`, **dono único** dos checks de dados), 7 regras:

| Regra | Severidade | O que detecta |
|---|---|---|
| `payment_without_invoice` | warning | recebimento sem NF/NFS-e/venda vinculada (90 dias) |
| `invoice_without_payment` | warning → **critical ≥60 dias** | nota autorizada há >30 dias sem recebimento |
| `card_revenue_mismatch` | warning → **critical >20%** | receita da maquininha ≠ receita de notas (±5%, 3 meses) |
| `iss_retention_mismatch` | warning | `iss_retido` da nota diverge do padrão do cadastro |
| `invoice_missing_service_code` | warning | NFS-e sem código de serviço |
| `missing_cnae` | warning | empresa sem CNAE principal |
| `das_above_moving_avg` | info | DAS >25% acima da média móvel (exige ≥4 apurações) |

`GET /v1/fiscal/score` compõe o **Score Fiscal 0–100**: `100 − penalidades` com pesos critical=10 / warning=4 / info=1 e **caps por categoria** (inconsistências 50, cadastro 25, conciliação 25). **Carências para empresa nova**: cadastro só pontua após a 1ª emissão autorizada; conciliação só após o 1º import — senão toda empresa nasceria ~60/100. A resposta inclui `assistantEnabled` (flag do assistente IA).

### 2.9 Central de alertas (E3 — migration 0076)

Tabela `fiscal_alerts` com **dedupe físico**: `dedupe_key = rule|refId|periodo`, `UNIQUE` parcial `WHERE status <> 'resolved'` — re-detecção vira touch de `last_detected_at` (23505), e alerta cujo fato sumiu é **auto-resolvido** (`resolution='auto'`). Regras temporais em `alertRulesDomain.ts`:

- `das_due` — vencimento dia 20 do mês seguinte, prorrogado se fim de semana (feriados: limitação documentada); warning ≤8 dias, critical vencido;
- `certificado_expirando` — warning ≤30 dias, critical ≤7/expirado;
- `mudou_de_faixa` (via brackets, nunca parser de memória), `perdeu_fator_r` (<0,28), `municipio_nao_cadastrado` (só provider ≠ focus);
- - os 7 findings do detector (E2), mapeados 1:1.

**E-mail apenas para `critical`**, uma vez (`email_sent`), ao owner do tenant via `sendSystemNotification`; o alerta in-app cobre o resto. Gatilhos: worker diário `fiscalAlertsWorker` (loop de 23h, erro isolado por empresa), `POST /v1/fiscal/alerts/evaluate` on-demand e o passo `alertas` do fechamento. UI: card 🔔 na FiscalPage com OK/Resolver (`fiscal:acknowledge`).

### 2.10 Robô de fechamento + trava (E4 — migration 0077)

`POST /v1/fiscal/close-competencia` executa o **checklist** (steps JSONB em `fiscal_closing_runs`; concorrência barrada por `UNIQUE` parcial `WHERE status='running'` → 409):

```
reconcile → consolidate → emit (por-draft da competência) → apurar → inconsistencias → alertas → report
```

Cada passo é isolado (erro vira step `error` e o run segue). Status final: `completed` | `completed_with_warnings` (ex.: drafts ainda `emitting` — a emissão é assíncrona) | `failed`.

**Fechar ≠ travar.** A trava é ação separada (`POST /v1/fiscal/period-locks/:competencia/lock`) e é **recusada** (422 `drafts_pendentes`) enquanto houver draft `open/sealed/calculated/emitting` na competência. O enforcement é um helper único — `assertCompetenciaAberta` (`fiscalPeriodLockGuard.ts`, módulo leve para evitar import circular) — aplicado em: apuração, cálculo/emissão de draft, conciliação manual e posting contábil. Fato sem empresa (companyId `null`) é bloqueado se **qualquer** empresa do tenant estiver travada na competência.

**Reabrir** (`POST .../unlock`, permissão `fiscal:reopen` — só owner/admin) exige `reason` e dispara **reapuração forçada**. **Late-arriving**: documento autorizado após a trava nunca é bloqueado no ledger/razão (é fato gerador real — posta na competência corrente); a correção do mês travado passa pelo fluxo reabrir → reapurar.

### 2.11 Motor contábil (E5 — migration 0078, módulo `contabil`)

**Dupla entrada** derivada dos fatos do sistema — nenhuma digitação para o dia a dia:

- **`chart_of_accounts`** — 32 contas seed **globais** (`tenant_id NULL`), plano BR simplificado com `system_key` estável (`caixa`, `bancos`, `clientes`, `impostos_retidos`, `simples_a_recolher`, `receita_vendas`, `receita_servicos`, `despesa_simples`, `cpp_por_fora`, `sublimite_por_fora`, `cmv`, `despesa_*`…) e de-para com as categorias do DRE gerencial. Conta custom do tenant com o mesmo `system_key` **sobrepõe** a global.
- **`journal_entries` + `journal_lines`** — `SUM(D)=SUM(C)` validado no domínio; idempotência por `UNIQUE (tenant, source_type, source_id)`; **estorno via entry `reversal`** (razão é append-only, nunca DELETE).

**Regras de lançamento** (todas como testes em `accountingDomain.test.ts`) por `(source_type, regime_apuracao)`:

| Fato | Regime competência | Regime caixa |
|---|---|---|
| NF-e/NFS-e autorizada | D-Clientes (líquido de ISS retido) + D-Impostos Retidos / C-Receita | **não posta** (reconhece no recebimento) |
| Recebimento | D-Caixa/Bancos / C-Clientes **se houve autorização prévia**; senão C-Receita direta (Clientes nunca fica negativo) | D-Caixa/Bancos / C-Receita |
| Pagamento de DAS | D-Despesa Simples / C-Bancos — **na competência da APURAÇÃO**, não a do pagamento | idem |
| POS suprimento/sangria | D-Caixa/C-Bancos e vice-versa (venda só via recebimento — sem dupla contagem) | idem |

Correções do Simples embutidas: **o ISS do optante está DENTRO do DAS** — a nota nunca gera "ISS a recolher"; só o **ISS retido na fonte** reduz Clientes e vira ativo compensável. CPP do Anexo IV e ICMS/ISS de sublimite têm contas próprias (`cpp_por_fora`, `sublimite_por_fora`) para lançamento manual.

Seams automáticos (fire-and-forget — erro nunca quebra o fluxo de negócio, só loga `accounting_post_error`): autorização de nota (`nfeResultsWorker`), recebimento (`receivableService`), pagamento de DAS (`apuracaoService`). Lançamento manual e **saldo de abertura** via `POST /v1/accounting/entries` (`opening=true`).

**Relatórios 100% derivados do razão** (`/v1/accounting/reports/*`): Livro Diário, Razão por conta, Balancete (com flag "fecha"), Livro Caixa (caixa+bancos), **DRE contábil** (rotulado — difere do DRE gerencial por construção) e **Balanço** (exige saldo de abertura para fechar; a UI avisa). Disclaimer permanente: **não substitui ECD/SPED Contábil**. UI: página `/contabil` com 5 abas.

### 2.12 Assistente Fiscal IA (E6 — sem migration)

`POST /v1/fiscal/assistant` — chat read-only sobre a API Anthropic com **4 gates de segurança**:

1. **Anti-cálculo**: system prompt proíbe o modelo de calcular DAS/alíquota/RBT12/Fator R — todo número deve vir de um `tool_result`, com competência e fonte citadas.
2. **Tools read-only com identidade do JWT**: 6 tools de `input_schema` vazio — `get_simulator`, `get_apuracao` (últimas 6, sem a memória JSONB), `get_score`, `get_alerts` (campos reduzidos), `get_revenue_by_month` (12 meses), `get_top_clients` (top 5, só nome/total/nº de notas — sem documento/contato). `tenantId`/`companyId` entram por **closure** — o modelo não passa identificadores.
3. **LGPD**: `fiscal_events` guarda **só** metadata (model, iterações, tools usadas, tokens, stop_reason) — o conteúdo das conversas não é persistido em lugar nenhum (vive só no estado React do cliente).
4. **Cap diário por tenant** (`ASSISTANT_DAILY_CAP`, default 50) contado em `fiscal_events` → 429.

Loop tool-use manual: máx. **6 iterações**, `max_tokens` 1500, histórico cortado a 12 mensagens, tool output truncado a 4 KB, mensagem ≤2000 chars. Modelo `claude-sonnet-5` (override por `ANTHROPIC_MODEL`), **sem `temperature`** (o modelo rejeita). Sem `ANTHROPIC_API_KEY` → 503 `assistant_disabled` e a UI **nem renderiza o card** (gating por `assistantEnabled` do `/v1/fiscal/score`).

### 2.13 Assistente que propõe ações (E7 — sem migration)

Além de responder, o assistente pode **propor** duas ações; **o modelo nunca executa** — ele devolve um objeto `action` que a UI transforma em card, e a execução real passa por um endpoint determinístico com todos os gates de sempre.

- **Emitir NFS-e "como da última vez"**: tools read-only `find_client` (busca por nome/CNPJ), `get_client_emission_defaults` (código de serviço/ISS/descrição da última nota autorizada) e `propose_nfse`. O executor de `propose_nfse` valida o cliente contra o tenant **server-side** (o `client_id` do modelo é sempre reconferido) e monta o rascunho com defaults preenchidos e um `idempotency_key`. `runAssistant` devolve `action = {type:'nfse_proposal', draft}`; a UI renderiza um card com Cliente/Valor/Código/ISS/Competência e botões **Aceitar** (só com `nfse:emit`) / **Cancelar**. Aceitar chama `POST /v1/nfse` → `createAndEmitNfse`, que revalida cliente ∈ tenant, resolve a empresa emitente, roda `getEmissionReadiness` (422 lista pendências), `assertCompetenciaAberta`, cria receivable + nfse numa transação e enfileira a emissão (ABRASF assina no api-core, senão Focus). `idempotency_key` (UNIQUE tenant+chave) evita duplo-clique. Prompt injection num nome de cliente não emite nada: o modelo só produz o rascunho, o humano confirma.
- **Guia de impostos do mês** (E8): tool read-only `get_guia_impostos(competencia)` — acha a apuração da competência; se não existe, instrui a apurar; se existe, devolve `action = {type:'open_guia', apuracaoId, dasTotal, vencimento}`. A UI abre `/fiscal/apuracao/:id/guia` numa nova aba — página **imprimível** (padrão `window.print()`, sem lib de PDF) com DAS, **vencimento em dia útil**, repartição por tributo, os 6 passos do portal e o aviso legal (não é a guia oficial com código de barras — essa só o PGDAS-D gera). O backend serve `GET /v1/fiscal/apuracao/:id/guia` (read-only, **sem** o efeito colateral `exported` do `/export`), reusando o builder puro `domain/fiscal/guiaDomain`.

Auditoria (LGPD): `fiscal_events` guarda apenas o **tipo** da ação proposta (`action_type`), nunca dados do cliente ou valores. A emissão em si audita `nfse_created`.

### 2.14 Transmissão PGDAS-D + DAS oficial (Rodada 4 — migration 0079, SERPRO Integra Contador)

Corrige a premissa falsa "o PGDAS-D não tem API oficial". A **SERPRO Integra Contador** (SERPRO + RFB, em produção) transmite a declaração e gera o DAS:

- `TRANSDECLARACAO11` → `POST /Declarar` transmite; `GERARDAS12` → `POST /Emitir` devolve o **DAS oficial em PDF base64** (código de barras + PIX); `CONSULTIMADECREC14` consulta a última declaração.
- Auth **mTLS** com **e-CNPJ A1** (.pfx) + Basic `consumerKey:consumerSecret` + header `Role-Type: TERCEIROS` → `access_token` **e** `jwt_token` (`src/lib/serproClient.ts`, `node:https`, zero deps novas). Custo ≈ **R$0,96/mês**; sem mensalidade/fidelidade. **Procuração dispensada** ao declarar o próprio CNPJ (contratante = autor = contribuinte).

**Arquitetura (molde do assistente IA — gating por env):**
- **Domínio puro** (`src/domain/pgdasd/`): `atividadesDomain` (`resolveIdAtividade` — enum 1..43, **não** LC116/CNAE; dev de software = **11**), `payloadDomain` (`buildTransdeclaracaoDados` — `pa` numérico, `valoresParaComparacao` sem zeros), `readinessDomain` (lista **todos** os bloqueios; inclui `ledger_incompleto` — a única classe de erro que a conferência não pega), `responseDomain` (parse defensivo do retorno + diff).
- **Serviço** (`src/services/pgdasdService.ts`): readiness → conferir → transmitir → gerar DAS. **Sem SQS** (HTTP síncrono; redelivery sobre declaração não-idempotente é o pior transporte).
- **`pgdasd_transmissions`** (agregado separado — **não** um status em `simples_apuracao`, que é clobbered pelo `/export`). `UNIQUE` parcial em-voo (`indicador_transmissao AND status IN ('building','sent')`) impede duplo-clique; **não** `UNIQUE(apuracao_id)` (proibiria retificadora). `status: building|sent|confirmed|failed|failed_unknown`.

**Disciplina legal:**
1. **Conferência** (`indicadorTransmissao=false`, `indicadorComparacao=true`): a RFB calcula e devolve os números dela **sem transmitir** — R$0,40, **zero efeito jurídico**. Rede de segurança antes do ato.
2. **Transmissão** (`=true`): ato **irreversível**. Exige `confirmar:true` no corpo. Persiste o número **antes** de gerar o DAS. **Nunca faz blind-retry do Declarar** — timeout depois dos bytes saírem ⇒ `failed_unknown` (TERMINAL; reconciliar via `CONSULTIMADECREC14`), nunca `failed`.
3. **`indicadorComparacao` sempre true**: divergência de R$0,01 bloqueia. RFB no Anexo V vs nós no III ⇒ guard funcionando (investigar o Fator R, não contornar).
4. **RBAC**: `fiscal:transmit` fica **fora** do Gestor por padrão (só owner/admin) — protocola declaração federal e gasta dinheiro.

**Casos ainda não suportados (guard 422, nunca adivinhados):** ISS fixo, ISS retido (`qualificacoesTributarias` não documentada pela SERPRO), multi-anexo, sublimite, exportação, retificadora, `rbt12_source='manual'` (sem quebra mensal). Cada um vira um motivo de readiness.

**Verificado:** motor + payload reproduzem o DAS real 02/2026 (R$168,00) ao centavo (teste golden). Cliente SERPRO, parse, diff e a classificação `failed_unknown` testados com a **rede mockada**. **A verificação de ponta a ponta contra a SERPRO real exige contrato + e-CNPJ A1** (roda fora do CI).

### 2.15 Fiscal Engine API (Rodada 6 — migration 0080) e Open Finance (Rodada 7 — migration 0081)

- **Engine** (`/v1/engine/*`, spec `docs/superpowers/specs/2026-07-17-fiscal-engine-api-design.md`, doc pública `docs/engine-api.md`): 6 endpoints stateless de cálculo do Simples para terceiros, autenticados por API key (padrão Stripe: hash+prefixo, segredo mostrado 1×), rate limit 60/min por chave, metering em `api_key_usage`. Permissão `engine:manage` (owner/admin); chaves em Minha Empresa → Integrações.
- **Open Finance / conciliação automática** (spec `docs/superpowers/specs/2026-07-17-openfinance-pluggy-design.md`): conexões bancárias via **Pluggy** (`bank_connections`/`bank_connection_accounts`) sincronizam o extrato direto para `imported_transactions` (`source_kind='openfinance'`, dedup `of:{account}:{tx}`) e disparam a conciliação existente. Sync = botão na FiscalPage + **passo 0 do ciclo 23:59**. Cartão de crédito fica com `sync_enabled=false` por default (fatura não é recebimento). Env: `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` (ausente ⇒ 503; prefixo `local-` ⇒ simulação determinística p/ dev). Conectar/desconectar exige `bank_accounts:manage`; sincronizar, `fiscal:import`. Adiado: CNAB 240/400, webhook Pluggy, PIX direto via PSP.

---

## 3. Referência de API (todas sob `/v1`, JWT obrigatório)

Legenda de permissão: tudo em `/v1/fiscal/*` e `/v1/accounting/*` exige também o módulo (`fiscal` / `contabil`) habilitado no tenant.

### Cadastro fiscal — `routes/fiscalCompanyConfig.ts`

| Método/Rota | Permissão |
|---|---|
| GET `/companies/:companyId/fiscal-config` | fiscal:view |
| PUT `/companies/:companyId/fiscal-config` | fiscal:config |
| GET/POST/DELETE `.../fiscal-config/cnaes[/:id]` | view / config |
| GET/POST/DELETE `.../fiscal-config/service-codes[/:id]` | view / config |
| GET/POST `.../fiscal-config/payroll` | view / config |
| GET `.../fiscal-config/certificate/status` | fiscal:view |
| POST/DELETE `.../fiscal-config/certificate` | **fiscal:manage_certificate** |
| GET `.../fiscal-config/emission-readiness` | fiscal:view |

### Importação e conciliação

| Método/Rota | Permissão |
|---|---|
| POST `/fiscal/imports` (multipart, ≤25 MB) · POST `/fiscal/imports/:id/reprocess` | fiscal:import |
| GET `/fiscal/imports[/:id]` · GET `/fiscal/import-templates` | fiscal:view |
| POST/DELETE `/fiscal/import-templates[/:id]` | fiscal:import |
| GET `/fiscal/reconciliation/transactions` · `.../:id/candidates` · `/fiscal/reconciliation/summary` · `/fiscal/reconciliation/rules` | fiscal:view |
| POST `/fiscal/reconciliation/transactions/:id/match` · `.../:id/ignore` · `/fiscal/reconciliation/run` | fiscal:reconcile |
| POST/PUT/DELETE `/fiscal/reconciliation/rules[/:id]` (regras de conciliação — antes só SQL) | fiscal:reconcile |
| GET `/fiscal/nfse-municipalities` (registro global) | fiscal:view |
| POST/DELETE `/fiscal/nfse-municipalities[/:codigoIbge]` (**só owner/admin** — global) | fiscal:config + owner/admin |

### Consolidação e NFS-e

| Método/Rota | Permissão |
|---|---|
| GET `/fiscal/consolidation/rules` · GET `/fiscal/consolidation/drafts[/:id]` | fiscal:view |
| POST/DELETE `/fiscal/consolidation/rules[/:id]` · POST `.../drafts/:id/calculate` · POST `/fiscal/consolidation/run` | fiscal:consolidate |
| POST `/fiscal/consolidation/drafts/:id/emit` · POST `/fiscal/consolidation/run-scheduled` | fiscal:emit |
| GET `/nfse[/:id[/events]]` | nfse:view (sem gate de módulo) |
| **POST `/nfse`** (emissão avulsa: cria+emite; alvo do "Aceitar" do assistente) | nfse:emit |
| POST `/nfse/:id/emit` | nfse:emit |
| POST `/nfse/:id/cancel` (motivo obrigatório; só provider abrasf) | nfse:cancel |

### Apuração, simulador, score

| Método/Rota | Permissão |
|---|---|
| GET `/fiscal/apuracao` · GET `/fiscal/das-summary` | fiscal:view |
| POST `/fiscal/apuracao` · GET `/fiscal/apuracao/:id/export` · POST `/fiscal/das-payments` | fiscal:apurar |
| GET `/fiscal/simulator` · POST `/fiscal/simulator/what-if` | fiscal:view |
| GET `/fiscal/score` (inclui `assistantEnabled`) · GET `/fiscal/inconsistencies` | fiscal:view |

### PGDAS-D via SERPRO (§2.14 — 503 sem credenciais SERPRO)

| Método/Rota | Permissão |
|---|---|
| GET `/fiscal/apuracao/:id/pgdasd/readiness` · `.../pgdasd/payload` · `.../pgdasd/transmissions` | fiscal:view |
| POST `/fiscal/apuracao/:id/pgdasd/conferir` (dry-run, R$0,40, sem efeito legal) | **fiscal:transmit** |
| POST `/fiscal/apuracao/:id/pgdasd/transmitir` (corpo `{confirmar:true}`; ato irreversível) | **fiscal:transmit** |
| POST `/fiscal/pgdasd/transmissions/:tid/das` (gera o DAS oficial em PDF) | **fiscal:transmit** |

### Alertas, fechamento, trava

| Método/Rota | Permissão |
|---|---|
| GET `/fiscal/alerts` · GET `/fiscal/alerts/summary` · POST `/fiscal/alerts/evaluate` | fiscal:view |
| POST `/fiscal/alerts/:id/acknowledge` · `.../:id/resolve` | fiscal:acknowledge |
| POST `/fiscal/close-competencia` · POST `/fiscal/period-locks/:competencia/lock` | fiscal:close |
| GET `/fiscal/closing?competencia=` · GET `/fiscal/period-locks` | fiscal:view |
| POST `/fiscal/period-locks/:competencia/unlock` (reason obrigatório) | **fiscal:reopen** |

### Contabilidade e assistente

| Método/Rota | Permissão |
|---|---|
| GET `/accounting/accounts` · GET `/accounting/reports/{diario,razao,balancete,livro-caixa,dre,balanco}` | contabil:view |
| POST `/accounting/entries` (manual/abertura) · POST `/accounting/entries/reverse` | contabil:post |
| POST `/fiscal/assistant` (503 sem key; 429 no cap) | fiscal:view |
| GET `/tenant/modules` · PATCH `/tenant/modules/:key` | autenticado / tenant_modules:manage |

---

## 4. O que é configurável

### 4.1 Módulos por tenant

Backoffice → **Minha Empresa → aba Módulos** (ou `PATCH /v1/tenant/modules/:key`, permissão `tenant_modules:manage`). Chaves: **`fiscal`** e **`contabil`** (independentes). Sem o módulo, todas as rotas retornam 403 e o item de menu some; o worker de alertas e o ciclo 23:59 só processam tenants com `fiscal` habilitado.

### 4.2 Cadastro fiscal por empresa (`PUT /v1/companies/:id/fiscal-config`)

| Campo | Valores / efeito |
|---|---|
| `enquadramento` | `MEI` \| `ME` \| `EPP` (default ME). **MEI bloqueia apuração/simulador/cálculo de draft** |
| `optante_simples` + `data_opcao_simples` | obrigatório `true` para apurar |
| `data_abertura` | <12 meses proporcionaliza o RBT12 |
| `anexo_padrao` | 1–5; usado quando o Fator R não se aplica (default III); override por código de serviço |
| `fator_r_aplicavel` | liga a dinâmica Anexo III/V pelo Fator R (exige 12 meses de folha) |
| `regime_apuracao` | `caixa` \| `competencia` (default) — **define as regras de lançamento contábil** |
| `iss_retido_padrao`, `iss_fixo(_valor)`, `retencao_federal`, `retencoes` | retenções; `iss_retido_padrao` também é baseline do check de inconsistência |
| `receita_acumulada_abertura`, `rbt12_manual` | bootstrap do RBT12 na transição (o ledger passa a mandar quando tiver receita) |
| `nfse_provider` + `nfse_provider_profile` | `focus` (default, dispensa certificado) \| `abrasf` (motor próprio) — `nacional`/`saopaulo` reservados |
| `rps_serie`, `rps_proximo_numero`, `lote_proximo_numero` | numeração de RPS (alocação atômica) |

Complementos por empresa: **CNAEs** (1 principal), **códigos de serviço LC 116** (1 default; override de anexo/alíquota/ISS retido por serviço), **folha/pró-labore mensal** (Fator R), **certificado A1** (permissão dedicada `fiscal:manage_certificate`). Campos que já existem em `nfe_configs` (inscrição municipal, código IBGE, alíquota ISS padrão…) são lidos por JOIN, nunca duplicados.

### 4.3 Regras parametrizáveis

| O quê | Onde | Como |
|---|---|---|
| Estratégia de consolidação | `consolidation_rules` (API + permissão fiscal:consolidate) | `per_sale`/`daily`/`weekly`/`monthly`/`per_client`/`per_contract`, escopo empresa/cliente/contrato, `service_code` opcional |
| Matching da conciliação | `reconciliation_rules` (**sem API/UI — via SQL**) | `amount_tolerance` (0.01), `date_window_days` (3), `auto_confirm_threshold` (0.90), `match_net_amount` (true) |
| Templates de importação | `import_source_templates` (API) | `column_map`, delimiter, encoding, date_format, decimal_separator, skip_rows, dedup_strategy — um por adquirente |
| Municípios NFS-e | `nfse_municipalities` (**global, sem API/UI — via SQL/seed**) | 1 INSERT por prefeitura: endpoints homolog/produção, versão ABRASF, perfil, `signature_algo`, `c14n`, `lote_assincrono`. Seed: Patos/PB |
| Faixas e repartição do Simples | `tax_simples_nacional_brackets` / `tax_simples_repartition` (globais) | atualização legal anual por INSERT com novo `vigencia_ano` — **sem deploy** |
| Mapa CNAE→Anexo | `tax_cnae_anexo_map` (global) | heurística de cadastro; validação humana obrigatória |
| Plano de contas custom | `chart_of_accounts` (**sem API ainda** — `contabil:manage` reservada) | INSERT com `tenant_id` + mesmo `system_key` sobrepõe a conta global |

### 4.4 RBAC

Catálogo (`src/rbac/permissions.ts`): **13 ações `fiscal:*`** (`view, import, reconcile, consolidate, config, manage_certificate, apurar, acknowledge, close, reopen, emit, cancel, substitute`) + **3 `contabil:*`** (`view, post, manage`) + grupo `nfse:*`. Papéis de sistema:

- **owner** — tudo, por código (não depende de seed);
- **admin** — tudo exceto `billing:manage`;
- **Gestor (manager)** — todo o fiscal **exceto** `fiscal:manage_certificate` e `fiscal:reopen` (certificado é a identidade digital da empresa; reabertura de competência é ato sensível);
- **Operador/technician/professional/client** — nenhuma permissão fiscal.

Papéis **custom por tenant** podem receber qualquer grant pela tela de perfis.

### 4.5 Variáveis de ambiente (api-core, salvo indicado)

| Env | Default | Efeito |
|---|---|---|
| `DATABASE_URL` (ou `DB_*`) | localhost:5432 | Postgres |
| `PGSSLMODE` | — | `require` liga SSL do pool (produção/ECS) |
| `NFE_REQUESTS_QUEUE_URL` | — | fila de emissão. **Ausente: emissão não enfileira** (draft marcado emitted com `enqueued:false` — tolerância de dev) |
| `NFE_RESULTS_QUEUE_URL` | — | fila de resultados. **Ausente: `nfeResultsWorker` desligado** → sem fechamento de notas nem ciclo 23:59 |
| `NFE_BUCKET` | — | S3 de XML/PDF (obrigatória no lambda-fiscal) |
| `FISCAL_IMPORTS_BUCKET` | — | S3 dos originais de importação. Ausente: upload pulado (só checksum; `/reprocess` indisponível) |
| `FOCUS_NFE_TOKEN` / `FOCUS_NFE_BASE_URL` | — / homologação | integração Focus (fallback); token `local-` simula |
| `ANTHROPIC_API_KEY` | — | **liga o Assistente Fiscal IA**; ausente = 503 + card oculto |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | modelo do assistente (lido a cada chamada) |
| `ASSISTANT_DAILY_CAP` | `50` | mensagens/dia/tenant do assistente |
| `SERPRO_CONSUMER_KEY` / `SERPRO_CONSUMER_SECRET` | — | **liga a transmissão PGDAS-D** (§2.14); ausente = rotas pgdasd 503 |
| `SERPRO_MTLS_PFX_BASE64` / `SERPRO_MTLS_PFX_PASSWORD` | — | e-CNPJ A1 (.pfx) do mTLS — **o mesmo usado para contratar na loja SERPRO** |
| `SERPRO_ENV` | `trial` | `producao` \| `trial` (gateway Integra Contador) |
| `FISCAL_DOCS_BUCKET` | (→ `FISCAL_IMPORTS_BUCKET`) | S3 do DAS gerado. Ausente: PDF devolvido inline (base64) |
| `NOTIFICATIONS_QUEUE_URL` | — | fila de e-mail (alertas critical, notas emitidas). Ausente: envio ignorado com warn |
| `AWS_REGION` / `AWS_ENDPOINT_URL` | us-east-1 / — | clientes SQS/S3 (LocalStack em dev) |
| `JWT_SECRET`, `PORT`, `HOST`, `NODE_ENV`, `LOG_LEVEL` | — | básicos do serviço |

### 4.6 Fixos no código (mudar exige código)

Thresholds do detector (`DEFAULT_THRESHOLDS`: 30 dias sem recebimento, ±5%, +25% da média, ≥3 apurações), antecedências de alerta (DAS 8 dias, certificado 30 dias), pesos/caps do score, limites do assistente (6 iterações, 1500 tokens, 12 msgs, 4 KB, 2000 chars), limites de listagem (conciliação 500/200, diário 500, razão 1000), upload 25 MB, horário do ciclo (23:59 — alterável só via Terraform).

---

## 5. O que preciso fazer para funcionar

### 5.1 Rodar local (dev)

```bash
# 1. Infra local (Postgres + LocalStack SQS/S3 + serviços)
docker compose up -d
# Nesta máquina o docker-compose.override.yml (gitignored) remapeia:
#   Postgres 5433 · api-core 3004 · backoffice 5174 · LocalStack 4567

# 2. Migrations (todas as 79, ordem explícita em src/scripts/migrate.ts)
docker compose run --rm migrate        # ou: npm run migrate:dev --workspace services/api-core

# 3. Testes
cd services/api-core && npx vitest run   # 1138 passando (2 falhas de integração pré-existentes)
```

Sem AWS real: filas/buckets vêm do LocalStack (`scripts/localstack-init.sh`); emissão de NFS-e pode ser 100% simulada com endpoints `local-` no registry de municípios (ou token Focus `local-`).

### 5.2 Colocar em produção (checklist)

1. **Migrations** — deploy roda `npm run migrate` (0068–0078 já registradas no `migrate.ts`; **nunca** descartar linha do array em conflito de merge).
2. **Terraform** — `terraform apply` para o **EventBridge Scheduler 23:59** (`scheduler-fiscal.tf`) e o lambda-fiscal (`lambda.tf`). O ECS já injeta `NFE_*_QUEUE_URL`/`NFE_BUCKET`; **`ANTHROPIC_API_KEY`, `ASSISTANT_DAILY_CAP` e `FISCAL_IMPORTS_BUCKET` NÃO estão nos .tf** — configurar via secrets/console, senão assistente fica 503 e uploads ficam sem S3 (fallback silencioso).
3. **Habilitar módulos por tenant** — Minha Empresa → Módulos: ligar `fiscal` (e `contabil` se for usar a contabilidade).
4. **Cadastro fiscal por empresa** — preencher `fiscal-config` (enquadramento, optante, anexo, Fator R, regime), CNAE principal, ≥1 código de serviço LC 116 (com default), inscrição municipal (em `nfe_configs`) e, para Fator R, os 12 meses de folha.
5. **Certificado A1** — upload do `.pfx` + senha (permissão `fiscal:manage_certificate`) se `nfse_provider='abrasf'`; com `focus` não é necessário.
6. **Município** — conferir/cadastrar a prefeitura em `nfse_municipalities` (SQL) e **homologar contra o webservice real** (Patos/PB WebISS é o seed; endpoints a confirmar no manual do provedor). Trocar `ambiente` para produção (1) depois da homologação.
7. **Assistente IA** — setar `ANTHROPIC_API_KEY` (opcional `ANTHROPIC_MODEL`/`ASSISTANT_DAILY_CAP`). Sem a key, tudo funciona menos o chat.
8. **Contabilidade** — lançar o **saldo de abertura** (`POST /v1/accounting/entries` com `opening=true`) para o balanço fechar em empresas com histórico anterior.
9. **RBAC** — conferir papéis: Gestor opera tudo; certificado e reabertura de competência ficam com owner/admin.

### 5.3 Operação do dia a dia (fluxo do usuário)

1. **Importar** o extrato/relatório da maquininha (FiscalPage → upload). CSV/XLSX de adquirente pede template na primeira vez.
2. **Conciliar** — rodar a conciliação; resolver a fila de pendências (match manual ou ignorar).
3. **Consolidar / emitir** — manual pelos botões, ou deixar o **ciclo 23:59** consolidar→calcular→emitir sozinho.
4. **Acompanhar** — Simulador (DAS projetado, cenários), Score Fiscal, sino de alertas.
5. **Apurar** a competência (PGDAS-D) → usar o **roteiro do export** para lançar no portal → registrar o **DAS pago**.
6. **Fechar competência** (1 botão) → conferir o checklist → quando todos os drafts estiverem autorizados, **Travar**. Precisou corrigir depois? **Reabrir** (com justificativa) → reapuração automática.
7. **Contabilidade** (`/contabil`) — balancete/diário/livro caixa/DRE/balanço já alimentados automaticamente.
8. **Perguntar ao assistente** — "Quanto vou pagar de DAS este mês?", "Por que aumentou?", etc.

---

## 6. Limitações conhecidas e pontos de atenção

- ~~PGDAS-D não tem API oficial~~ — **corrigido na Rodada 4** (migration 0079, §2.14): a SERPRO Integra Contador transmite a declaração e gera o DAS oficial. O roteiro assistido do `/export` continua existindo como fallback para quem não configurou a integração SERPRO.
- **MEI** — cadastro aceito, mas apuração/simulação percentual bloqueadas (DAS-SIMEI é fixo).
- **Feriados nacionais** entram na prorrogação do vencimento do DAS (fixos + móveis via Páscoa, `domain/fiscal/holidays.ts`). Feriados **municipais/estaduais** permanecem fora de escopo (variam por cidade, sem cadastro).
- **Lote assíncrono ABRASF** (aceito com protocolo, sem número) deixa a nota em `processing` — a reconsulta (`consultarLote`) entra na homologação por município.
- **Sem UI/API** (ainda via SQL): `acquirer_accounts`, plano de contas custom (`contabil:manage` declarada, sem rota). `reconciliation_rules` ganhou CRUD + painel (rodada 3); `nfse_municipalities` ganhou GET + write owner/admin (rodada 3).
- **Seams contábeis de POS (suprimento/sangria), pagamento de payable e estorno de pagamentos** agora estão ligados (rodada 3): postam/estornam no razão fire-and-forget. Falta apenas o gate de módulo `contabil` nesses seams (postam mesmo com o módulo desligado — o razão é preenchido de qualquer forma).
- Posting contábil é **fire-and-forget**: falha vira log (`accounting_post_error`) sem alertar o usuário; os seams postam mesmo com o módulo `contabil` desligado (o gate é só nas rotas).
- ~~O worker usa a data do processamento como competência~~ — **corrigido** (bug de auditoria adversarial, `domain/fiscal/competencia.ts`): a competência da receita/lançamento vem de `nfe_auth_date`/`nfse_auth_date` no fuso fiscal (`America/Sao_Paulo`), não de `new Date()` em UTC — o ciclo 23:59 rodava já em 1º do mês seguinte em UTC e arquivava a última noite do mês na competência errada.
- Relatórios contábeis são **tenant-wide** (multi-empresa consolidado); estorno não passa pela trava de competência (deliberado: corrigir erro não pode ser bloqueado).
- Run de fechamento que morrer no meio fica `running` e bloqueia novos fechamentos (sem reaper — intervenção manual no banco).
- E-mail de alerta critical depende do template no consumidor externo da fila de notificações (in-app cobre).
- Certificado A1 e credenciais de adquirente em **texto puro** no JSONB (decisão registrada; envelope KMS é Fase 2). Nunca são logados nem retornados pela API.
- Score/inconsistências: thresholds fixos (não configuráveis por tenant); listas com LIMIT (a nota satura pelos caps, mas a lista exibida pode truncar).

## 7. Verificação

- `npx tsc --noEmit` limpo em **api-core, lambda-fiscal e backoffice**.
- `npx vitest run` — **1138 testes passando** (2 falhas de integração pré-existentes do develop, dependentes de conexão local).
- **79 migrations aplicadas do zero** em banco limpo (0001–0078; seed contábil = 32 contas).
- Testes-chave de domínio: contrato simulador==apuração (mesmo DAS), RBT12 janela-anterior nos 2 timings de what-if, balancete zera / balanço fecha, ISS dentro do DAS, DAS na competência da apuração, fechar≠travar (lock recusado com draft em emissão), carências do score, dedupe de alerta (23505→touch), dia útil do vencimento, flag do assistente + sanitização de histórico.
- Apuração validada com valores oficiais à mão: Anexo III, RBT12 300k → efetiva 8,08%, DAS R$ 4.040,00, ISS R$ 1.292,80 ✓.
