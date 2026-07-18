# Conciliação bancária automática via Open Finance (Pluggy) — design

> Aprovado em 2026-07-17 (direção escolhida pelo usuário: Pluggy, depois do Engine). Migration **0081**. Branch `feat/fiscal-simples-nacional`.

## 1. O problema

Hoje o extrato bancário entra no ERP por **upload manual** (OFX/CSV/XLSX → `import_batches` → `imported_transactions` → conciliação). A conciliação em si já é automática (scoring NSU/valor/data, auto-confirm ≥0,90) — o gargalo é a **entrada**: alguém precisa baixar o arquivo no internet banking e subir.

## 2. A solução

**Pluggy** (agregador Open Finance brasileiro) sincroniza o extrato direto do banco:

```
conectar banco (widget Pluggy) → bank_connections (0081)
   → sync (botão OU ciclo 23:59) → GET /transactions (Pluggy)
   → normalizar → imported_transactions (source='bank', source_kind='openfinance',
     dedup `of:{accountId}:{txId}` — UNIQUE existente absorve re-sync)
   → runReconciliation (motor 0072 EXISTENTE, zero mudança)
```

PIX/TED/boleto chegam **no extrato unificado** — cobre o "PIX" do roadmap sem contrato com PSP. `paymentData` do Pluggy traz nome/documento do pagador → alimenta `customer_name`/`customer_document`, melhorando o matching.

## 3. Persistência (migration 0081)

- **`bank_connections`**: tenant_id, company_id (NOT NULL — receita é por CNPJ, como o Mercado Livre), provider ('pluggy'), item_id, institution, status ('active','error','disconnected'), last_synced_at, last_error, created_by. UNIQUE (tenant_id, item_id).
- **`bank_connection_accounts`**: connection_id, account_id (Pluggy), type/subtype, name, number_masked, currency, sync_enabled. UNIQUE (connection_id, account_id).
- **ALTER `import_batches`**: CHECK de `source_kind` ganha `'openfinance'` (cada sync vira um batch com contadores inserted/duplicate — reusa a telemetria existente; `original_filename` = descrição do sync, `checksum_sha256` = hash de connection+janela+timestamp para satisfazer o UNIQUE).
- **Fora**: CNAB 240/400 (adiado — Pluggy cobre os bancos do público-alvo; parser Febraban é rodada própria), webhook Pluggy (v1 = sync diário + botão; webhook exige URL pública e assinatura — documentado), PIX direto via PSP.

## 4. Integração Pluggy (`src/lib/pluggyClient.ts`)

- Auth: `POST {base}/auth {clientId, clientSecret}` → `apiKey` (TTL ~2h, cache em módulo com margem; molde serproClient).
- `POST /connect_token` (para o widget), `GET /accounts?itemId=`, `GET /transactions?accountId&from&to&page&pageSize=500` (paginado).
- **Gating por env** (molde anthropicClient): sem `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` → rotas 503 `openfinance_disabled`.
- **Modo `local-`** (convenção do repo, mesma do Focus/município): `PLUGGY_CLIENT_ID=local-...` → cliente devolve dados sintéticos determinísticos (1 item, 1 conta, transações fixas incl. PIX de cliente) — dev/E2E sem conta Pluggy.

## 5. Serviço (`src/services/openFinanceService.ts`)

- `createConnectToken(tenantId)` — token pro widget (e flag `simulated` no modo local).
- `registerConnection(tenantId, companyId, itemId, userId)` — busca item+contas na Pluggy, upsert connection+accounts, audita `fiscal_events` (`openfinance_connected`).
- `syncConnection(tenantId, id)` — janela: `last_synced_at − 3 dias` (overlap; o dedup absorve) ou 90 dias no 1º sync; pagina transações por conta habilitada; insere batch+linhas (idempotente); atualiza `last_synced_at`; roda `runReconciliation(tenant, {companyId})`; devolve contadores. Erro → `status='error'` + `last_error` (nunca lança pro ciclo).
- `syncAllActive()` — para o ciclo 23:59.
- Normalização **pura** em `src/domain/import/openFinanceDomain.ts` (mapeamento Pluggy→imported_transactions + dedup key) — testável sem I/O.

## 6. Rotas (`src/routes/fiscalOpenFinance.ts`, gating fiscal + permissões)

| Rota | Permissão |
|---|---|
| GET `/fiscal/openfinance/connections` | fiscal:view |
| POST `/fiscal/openfinance/connect-token` | **bank_accounts:manage** (credencial bancária — owner/admin) |
| POST `/fiscal/openfinance/connections` `{item_id, company_id}` | bank_accounts:manage |
| POST `/fiscal/openfinance/connections/:id/sync` | fiscal:import |
| DELETE `/fiscal/openfinance/connections/:id` | bank_accounts:manage (soft: status='disconnected') |

## 7. Ciclo agendado

`runFiscalScheduledCycle` (nfeResultsWorker.ts:18) ganha o passo 0: `syncAllActive()` **antes** da consolidação — o extrato da véspera entra sozinho, concilia, consolida e emite na mesma passada. Erro de sync é isolado por conexão (nunca derruba o ciclo).

## 8. UI (FiscalPage → card "Open Finance" na seção de importação)

- Lista conexões (banco, conta mascarada, último sync, status) + botões **Sincronizar** (fiscal:import) e **Desconectar**.
- **Conectar banco**: pede o connect-token; `simulated:true` → registra o item local na hora (dev); senão carrega o script oficial do widget Pluggy dinamicamente (`cdn.pluggy.ai`) e abre o Connect — `onSuccess(itemId)` → POST connections.
- Transações sincronizadas caem na fila de conciliação JÁ EXISTENTE da página.

## 9. Testes

- `openFinanceDomain.test.ts` — normalização pura: sinal do amount, PIX payer → customer_*, dedup key, occurred_at.
- `openFinanceService.test.ts` — sync idempotente (2ª passada = tudo duplicate), janela de overlap, erro marca a conexão sem lançar.
- `fiscalOpenFinance.test.ts` — 503 sem env, permissões (connect exige bank_accounts:manage), sync roda conciliação.
- E2E local: modo `local-` → conectar simulado → sync → transações na fila → conciliação roda.

## 10. Env

| Var | Efeito |
|---|---|
| `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` | liga o módulo; `local-` prefixo = simulação |
| `PLUGGY_BASE_URL` | default `https://api.pluggy.ai` |
