# Painel Executivo do Módulo Fiscal — Fase 1 (dashboard de visibilidade por empresa)

> Branch `feat/fiscal-simples-nacional` · Spec gerada em 2026-07-15 a partir de brainstorming conversacional.

## 1. Problema e motivação

O módulo Fiscal + Contábil (ver `docs/fiscal-module.md`) já cobre o pipeline completo por competência:
importar → conciliar → consolidar → emitir NFS-e → apurar DAS → simular → alertar → fechar → travar →
contabilizar, mais um assistente de IA que já propõe ações (E7/E8).

O pedido do usuário foi evoluir o módulo para "ficar ainda melhor/maior e mais funcional", citando como
exemplo um "CRM/dashboard". O brainstorming eliminou a leitura mais ambiciosa (pivotar para um modelo de
escritório contábil atendendo múltiplos tenants externos) e convergiu para algo mais focado: **um painel
executivo dentro do próprio tenant**, agregando as empresas/CNPJs que ele já tem via multi-empresa.

### Gap descoberto no código

Os endpoints de fiscal já aceitam `company_id` opcional:

- `GET /v1/fiscal/score` (`routes/fiscalScore.ts:28-29`)
- `GET /v1/fiscal/inconsistencies` (`routes/fiscalScore.ts:35-36`)
- `GET /v1/fiscal/apuracao`, `POST /v1/fiscal/apuracao`, `POST /v1/fiscal/das-payments`
  (`routes/fiscalApuracao.ts`)
- `GET /v1/fiscal/closing`, `POST /v1/fiscal/close-competencia`, lock/unlock
  (`routes/fiscalClosing.ts`)

Mas `apps/backoffice/src/pages/fiscal/FiscalPage.tsx` **nunca usa esse parâmetro** — nenhum estado
`companyId`/`company_id` existe no componente (confirmado por leitura direta do arquivo, 421 linhas). A tela
sempre mostra o agregado de todo o tenant. Ou seja, hoje **não existe nenhuma forma de ver o fiscal de uma
empresa específica na UI**, mesmo em tenants com múltiplas empresas cadastradas (multi-empresa já existe desde
o commit `b3efffd feat(multi-empresa)`).

Isso torna a Fase 1 majoritariamente **reuso**: nenhuma lógica fiscal nova — só orquestração dos services
puros já testados (`computeScore`, `detectInconsistencies`, `getClosingStatus`) por empresa, mais a UI para
expor o que o backend já sabe fazer.

## 2. Escopo

### Dentro da Fase 1

1. Endpoint agregado `GET /v1/fiscal/companies-overview` — visão de todas as empresas do tenant num round-trip.
2. Página nova `FiscalOverviewPage` — grid de cards, um por empresa, vira a rota-índice de `/fiscal`.
3. Drill-down: `FiscalPage.tsx` ganha seletor de empresa; clicar num card abre a `FiscalPage` filtrada.
4. Tenant com 1 única empresa pula o painel e vai direto pra `FiscalPage` (sem fricção pra quem não tem o que
   comparar).

### Fora da Fase 1 (decisão explícita, não esquecimento)

- **CRM operacional** (checklist mensal por empresa, atribuição de responsável, notas internas, histórico de
  ações) — camada ativa de trabalho, fica pra uma Fase 2 com spec própria, depois que o valor do dashboard
  passivo estiver validado em produção.
- **Modo escritório contábil** (um tenant gerenciando vários clientes externos, cada um seu próprio negócio) —
  pivô arquitetural maior, não é o que foi pedido.
- OCR de documentos e Fiscal Engine API pública — já registrados como próxima rodada do módulo em
  `docs/fiscal-module.md` §1 (migration 0079 reservada), não fazem parte desta spec.

## 3. Decisões de arquitetura e por quê

| Decisão | Alternativa considerada | Por que essa opção |
|---|---|---|
| Endpoint agregado novo no backend | Frontend dispara 1 chamada por empresa (`Promise.allSettled`) | Evita repetir o padrão de N+1 chamadas frágeis a permissão que causou o bug corrigido na Nova OS nesta mesma sessão (uma 403 isolada travando a tela inteira). 1 round-trip é mais fácil de cachear depois e mantém a resiliência a erro-por-item dentro do próprio backend. |
| Painel vira rota-índice de `/fiscal` | Item novo e separado no menu | A maioria dos tenants tem 1 empresa só — forçar 2 cliques pra chegar no pipeline operacional seria regressão de UX. O redirect automático (1 empresa → direto pro pipeline) resolve isso sem duplicar entrada de menu. |
| Reaproveitar services puros existentes | Recalcular métricas dentro do endpoint novo | `computeScore`/`detectInconsistencies`/`getClosingStatus` já são testados e são a fonte única de verdade dessas métricas — duplicar o cálculo quebraria a garantia de "número igual em qualquer tela que mostrar Score/Alertas". |

## 4. Design detalhado

### 4.1 Backend — `GET /v1/fiscal/companies-overview`

- Arquivo: `services/api-core/src/routes/fiscalScore.ts` (colocar perto de `/fiscal/score`) ou um arquivo novo
  `routes/fiscalOverview.ts` se isso deixar `fiscalScore.ts` grande demais — decidir no momento da
  implementação olhando o tamanho atual do arquivo.
- Gate: `authenticate` → `requireModule('fiscal')` → `requirePermission('fiscal:view')` (mesmo padrão de toda
  rota fiscal).
- Lógica: busca as empresas do tenant com `fiscal_company_config` (mesma fonte de dados que
  `routes/fiscalCompanyConfig.ts` já usa para o get-or-create), e para cada uma chama em paralelo
  (`Promise.all` **com try/catch por item**, não um `Promise.all` que derruba tudo num erro):
  - `computeScore(tenantId, companyId)`
  - `detectInconsistencies(tenantId, companyId, competenciaAtual)`
  - `getClosingStatus(tenantId, companyId, competenciaAtual)`
  - resumo do próximo DAS (reaproveitar a query usada por `das-summary`/`apuracao`, já filtrável por
    `company_id`)

Contrato de resposta:

```json
{
  "data": [
    {
      "company_id": "uuid",
      "company_name": "Empresa X Ltda",
      "has_fiscal_config": true,
      "score": 78,
      "alerts": { "critical": 1, "warning": 3, "info": 0 },
      "competencia_atual": { "competencia": "2026-07", "status": "aberta" },
      "das": { "valor": 4040.00, "vencimento": "2026-08-20", "dias_restantes": 12, "status": "pendente" },
      "error": false
    }
  ]
}
```

- Empresa sem `fiscal_company_config`: `has_fiscal_config: false`, demais campos `null`.
- Falha isolada no cálculo de uma empresa (exceção em qualquer um dos services): item entra com `error: true`
  e os demais campos `null`, sem derrubar a resposta inteira. Este é o requisito de resiliência mais importante
  da spec — replica a correção aplicada ao bug da Nova OS, mas desta vez desenhada desde o início em vez de
  corrigida depois.

### 4.2 Backend — nenhuma rota nova para o drill-down

O parâmetro `company_id` já existe nos endpoints que a `FiscalPage` consome. O trabalho é 100% de threading no
frontend (item 4.4).

### 4.3 Frontend — `FiscalOverviewPage`

- Arquivo novo: `apps/backoffice/src/pages/fiscal/FiscalOverviewPage.tsx`.
- Roteamento: `/fiscal` passa a renderizar `FiscalOverviewPage`; a `FiscalPage` atual (hub operacional do
  pipeline) move para `/fiscal/pipeline`. Todo link/deep-link interno que hoje aponta pra `/fiscal` esperando o
  hub operacional precisa ser atualizado para `/fiscal/pipeline` (checar menu lateral e quaisquer
  `navigate('/fiscal')` existentes no código).
- Ao montar: busca `/v1/fiscal/companies-overview`. Se `data.length === 1`, `navigate('/fiscal/pipeline', { replace: true })` imediatamente (pula o painel).
- Caso contrário, renderiza grid responsivo de cards, ordenado por urgência: score mais baixo primeiro,
  desempate por maior contagem de alertas `critical`.
- Card por empresa mostra: nome, Score Fiscal (cor por faixa — reaproveitar a paletização que `FiscalPage` já
  usa hoje pro Score, não inventar uma nova), contagem de alertas por severidade, status da competência atual
  (aberta/fechada/travada), próximo DAS (valor + vencimento + dias restantes, ou "atrasado" em destaque).
- Card com `has_fiscal_config: false`: visual neutro, CTA "Configurar" → rota de cadastro fiscal daquela
  empresa.
- Card com `error: true`: estado de erro isolado (ex.: "Não foi possível carregar" + botão de retry pontual),
  sem afetar os demais cards.
- Loading: skeleton nos cards enquanto a chamada única está pendente.
- Clicar num card (com `has_fiscal_config: true`) → `navigate(`/fiscal/pipeline?company_id=${id}`)`.

### 4.4 Frontend — `FiscalPage.tsx` ganha seletor de empresa

- `<select>` de empresa no topo da página, populado por `GET /v1/companies` (mesmo padrão de
  `apps/backoffice/src/pages/invoices/InvoiceNewPage.tsx`, que já resolve empresa emitente).
- Estado local `companyId`, inicializado a partir de `?company_id=` na URL (se presente) — padrão
  URL-as-state já usado em outras telas do projeto, sem introduzir estado global novo.
- `companyId` é propagado como `company_id` em todas as chamadas que já aceitam o parâmetro: score,
  inconsistencies, apuracao, das-summary, closing-status. Chamadas que não têm esse conceito (ex.: import,
  conciliação bruta se não for por empresa) permanecem como estão.
- Trocar a empresa no seletor atualiza a URL (`?company_id=`) e reexecuta os fetches — mesmo padrão de outros
  filtros já existentes no projeto (ex.: filtro de status em listas).

## 5. Testes

- **Backend** (`services/api-core`): teste do service/rota de overview cobrindo:
  - tenant com N empresas, todas com `fiscal_company_config` — retorna N itens com métricas corretas
    (comparando com chamadas diretas a `computeScore`/`detectInconsistencies`/`getClosingStatus`, para garantir
    que não há duplicação de lógica).
  - empresa sem `fiscal_company_config` — item com `has_fiscal_config: false`.
  - uma empresa cujo `computeScore` (ou outro service) lança exceção — item correspondente com `error: true`,
    demais itens intactos.
- **Frontend** (`apps/backoffice`): 
  - `FiscalOverviewPage`: grid renderiza N cards, ordenação por urgência, CTA "Configurar" no card sem
    cadastro, card de erro isolado, redirect automático para `/fiscal/pipeline` quando só há 1 empresa.
  - `FiscalPage`: seletor de empresa propaga `company_id` nas chamadas; leitura de `?company_id=` da URL
    pré-seleciona o `<select>` na entrada.

## 6. Verificação end-to-end

1. `cd services/api-core && npx vitest run` — testes novos + suíte completa sem regressão.
2. `cd apps/backoffice && npx vitest run` — testes novos + suíte completa sem regressão.
3. `npx tsc --noEmit` em `apps/backoffice` e `services/api-core`.
4. Manual: rodar o backoffice localmente com um tenant seed de 2+ empresas (uma com `fiscal_company_config`
   completo, outra sem) e confirmar visualmente: painel mostra os cards certos na ordem certa, card sem
   cadastro tem o CTA, clicar num card abre a `FiscalPage` já filtrada por aquela empresa, e um tenant com 1
   empresa só pula direto pro pipeline sem mostrar o painel.

## 7. Próximos passos (fora desta spec)

- Fase 2 (CRM operacional) — spec própria após validar o valor da Fase 1 em produção.
- OCR de documentos + Fiscal Engine API pública — já reservado como próxima rodada do módulo
  (`docs/fiscal-module.md` §1, migration 0079).
