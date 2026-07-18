# Fiscal Engine API v1 — design

> Aprovado em 2026-07-17. Migration **0080**. Branch `feat/fiscal-simples-nacional`.
> Decisões do usuário: Engine antes da conciliação automática (Pluggy fica para a próxima rodada, contrato do agregador pode ser assinado em paralelo); **v1 é 100% cálculo puro (stateless)** — operações com estado (emitir/conciliar via API) ficam para v2; os **6 endpoints** incluem `pgdasd/payload`.

## 1. O produto

API pública de cálculo do **Simples Nacional** para sistemas de terceiros (ERPs, CRMs, sistemas de clínicas/academias/marketplaces): o consumidor manda os números no request, recebe o cálculo com a memória completa. **Nenhum dado do consumidor é persistido** — só contadores de uso por chave (metering). O diferencial: as tabelas legais (`tax_simples_nacional_brackets` + `tax_simples_repartition`, versionadas por `vigencia_ano`) vivem no nosso banco e são atualizadas centralmente — mudança de lei = INSERT com vigência nova, sem deploy de ninguém.

O motor já é o mesmo da apuração interna, **validado ao centavo contra um DAS real** (02/2026, R$ 168,00 principal — teste golden existente).

## 2. Endpoints (prefixo `/v1/engine`, auth por API key)

| # | Endpoint | Entrada → Saída | Reusa (pure domain) |
|---|---|---|---|
| 1 | `POST /engine/simples/apurar` | `{competencia, rbt12, anexos:[{anexo, receita, receita_com_retencao?}]}` → DAS por tributo + memória (`ApuracaoResult`) | `apurarSimples` (apuracaoDomain.ts:80) |
| 2 | `POST /engine/simples/rbt12` | `{competencia, receitas_por_competencia:{...}, data_abertura?}` → `{rbt12}` c/ proporcionalização de início de atividade | `computeRbt12` (simplesDomain.ts:91) |
| 3 | `POST /engine/simples/fator-r` | `{folha_12m, receita_12m, meses_com_folha}` → `{fator_r, anexo}` | `resolveAnexoByFatorR` (simplesDomain.ts:49) |
| 4 | `POST /engine/simples/projecao` | `{competencia, rbt12, anexo, receita_mes, receita_pipeline?}` → DAS projetado + alíquota efetiva + "faltam R$X para a próxima faixa" | `projetarCompetencia` + `distanciaProximaFaixa` (simuladorDomain.ts) |
| 5 | `GET /engine/tabelas/:anexo?vigencia=YYYY` | → faixas + repartição oficiais da vigência (transparência/auditoria) | `loadBrackets`/`loadReparticao` (apuracaoService.ts:33/48) |
| 6 | `POST /engine/pgdasd/payload` | apuração + cadastro mínimo → JSON `dados` do TRANSDECLARACAO11 pronto p/ SERPRO (sem transmitir) | `buildTransdeclaracaoDados` (payloadDomain.ts:77) |

Envelope de resposta (padrão do projeto): `{success, data, error}`. Erros de domínio (`SimplesDomainError`, `PgdasdPayloadError`) → 422 `{success:false, error:<code>}`; validação de entrada → 400; chave inválida/revogada → 401; sem escopo → 403; rate → 429.

## 3. Autenticação — padrão Stripe

- Header **`X-API-Key: ek_live_<32 hex>`** (prefixo `ek_test_` reservado, sem semântica na v1).
- Tabela **`api_keys`** (0080): `id, tenant_id (dono), name, key_prefix (10 chars, lookup), key_hash (SHA-256 — o segredo NUNCA é armazenado), scopes JSONB (v1: ["engine"]), rate_limit_per_min (default 60), status active|revoked, last_used_at, created_by, created_at`. UNIQUE em `key_prefix`.
- O segredo aparece **uma única vez** na resposta da criação. Comparação por hash com `timingSafeEqual`.
- `last_used_at` atualizado fire-and-forget (nunca bloqueia a request).

## 4. Rate limit + metering

- **`src/lib/rateLimiter.ts`** — janela deslizante em memória, pura e testável (`allow(key, limit, nowMs)`), sem dependência npm nova. Limitação documentada: multi-instância = limite por instância.
- **`api_key_usage`** (0080): `(api_key_id, dia, endpoint) → count` com UPSERT increment — base do billing futuro (v1 só mede). Escrita fire-and-forget.

## 5. Gestão de chaves (JWT interno, não API key)

- `POST /v1/engine-keys` (cria; devolve o segredo uma vez) · `GET /v1/engine-keys` (lista, sem segredo) · `DELETE /v1/engine-keys/:id` (revoga; nunca DELETE físico).
- Permissão nova **`engine:manage`** — owner/admin apenas (roleMatrix; Gestor NÃO ganha: chave de API é credencial de longa duração).
- UI mínima: card "API do Motor Fiscal" em Minha Empresa → aba Integrações (`EngineKeysCard.tsx`) — criar (modal mostra o segredo uma vez, com aviso), listar (prefixo + last_used), revogar.

## 6. Arquivos

| Arquivo | Papel |
|---|---|
| `db/migrations/0080_engine_api_keys.sql` (+ linha no `migrate.ts`) | `api_keys` + `api_key_usage` |
| `src/db/schema.ts` | tabelas Drizzle |
| `src/lib/apiKeyAuth.ts` | geração/hash/verificação + preHandler `authenticateApiKey` (anexa `request.apiKey`) |
| `src/lib/rateLimiter.ts` | janela deslizante pura |
| `src/services/engineKeyService.ts` | CRUD de chaves + metering |
| `src/routes/engine.ts` | os 6 endpoints |
| `src/routes/engineKeys.ts` | gestão (JWT + `engine:manage`) |
| `src/rbac/permissions.ts` + `roleMatrix.ts` | permissão nova |
| `src/app.ts` | registra as 2 rotas |
| `apps/backoffice/.../EngineKeysCard.tsx` + wiring na CompanyPage | UI mínima |
| `docs/engine-api.md` | doc pública com exemplos curl |

## 7. Fora do escopo v1 (deliberado)

Cobrança real (só metering), OAuth/JWT para terceiros, SDKs, portal do desenvolvedor, webhooks, endpoints com estado (emitir NFS-e / conciliar — v2, exigem tenant por chave + LGPD pesada), rate limit distribuído (Redis), rotação automática de chave.

## 8. Testes

- `rateLimiter.test.ts` — janela, burst, chaves independentes.
- `apiKeyAuth.test.ts` — geração (prefixo/formato), hash estável, verificação timing-safe, revogada → 401.
- `engineRoutes.test.ts` — golden: `/apurar` com o caso real 02/2026 (Anexo III, RBT12, receita R$ 2.800) reproduz os 6 tributos ao centavo; contrato engine == apuração interna; 401 sem chave; 429 acima do limite; 422 em `SimplesDomainError`.
- `engineKeys.test.ts` — cria devolve segredo uma vez, lista nunca devolve, revogação, permissão negada p/ Gestor.

## 9. Verificação end-to-end

1. `npm run migrate:dev` aplica 0080.
2. Criar chave via UI (ou POST /v1/engine-keys), copiar o segredo.
3. `curl -X POST http://localhost:3004/v1/engine/simples/apurar -H "X-API-Key: ek_live_..." -d '{"competencia":"2026-02","rbt12":33600,"anexos":[{"anexo":"III","receita":2800}]}'` → DAS R$ 168,00 com IRPJ 6,72 / CSLL 5,88 / COFINS 21,54 / PIS 4,67 / CPP 72,91 / ISS 56,28.
4. Repetir 61× em 1 min → 429. Revogar a chave → 401.
5. `vitest run` + `tsc --noEmit` limpos.
