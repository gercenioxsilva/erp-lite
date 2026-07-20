# Painel Executivo do Módulo Fiscal (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard that shows Score Fiscal, alertas, status da competência e próximo DAS de todas as empresas de um tenant lado a lado, com drill-down para o pipeline operacional já existente (`FiscalPage`).

**Architecture:** Um novo service de orquestração no backend (`getCompaniesOverview`) reaproveita os services já testados (`listCompanies`, `computeScore`, `getClosingStatus`, `listApuracoes`, `dasDueDate`) para montar, por empresa, um resumo num único endpoint. No frontend, uma página nova (`FiscalOverviewPage`) consome esse endpoint e vira a rota-índice de `/fiscal`; a `FiscalPage` existente (que passa a viver em `/fiscal/pipeline`) ganha um seletor de empresa que propaga `company_id` para as três chamadas que já aceitam o parâmetro (score, apuração, simulador).

**Tech Stack:** Fastify + Drizzle ORM + Postgres (api-core), React + Vite + react-router-dom (backoffice), Vitest em ambos.

## Global Constraints

- Nenhuma lógica fiscal nova: toda métrica vem de services já testados (`computeScore`, `detectInconsistencies` via `computeScore`, `getClosingStatus`, `listApuracoes`, `dasDueDate`). O novo código só orquestra e formata.
- Falha isolada no cálculo de UMA empresa nunca derruba a resposta inteira (`error: true` no item, resto intacto) — replica a correção do bug da Nova OS (unguarded `Promise.all` + JSON parse sem guard), desta vez desde o design.
- Ver o cadastro de uma empresa (`has_fiscal_config`) NUNCA deve disparar `getOrCreateConfig` (que cria a linha como efeito colateral) — usar sempre um `SELECT` direto contra `fiscal_company_config`.
- `GET /v1/fiscal/das-summary` e `GET /v1/fiscal/alerts` **não aceitam `company_id` hoje** (confirmado lendo `estimadoVsPago(tenantId, db)` em `apuracaoService.ts:220` e a rota em `fiscalAlerts.ts:28-32` — nenhum dos dois tem parâmetro de empresa). Essas duas chamadas na `FiscalPage` continuam tenant-wide mesmo com uma empresa selecionada — não é bug, é limitação real do backend atual, documentada aqui em vez de assumida.
- Seguir o padrão de arquivo já usado: strings em PT-BR hardcoded (nem `FiscalPage.tsx` nem os demais arquivos de `pages/fiscal/` usam o sistema de i18n — não introduzir `t()` nesses arquivos novos).

---

### Task 1: Service de orquestração `getCompaniesOverview`

**Files:**
- Create: `services/api-core/src/services/fiscalCompaniesOverviewService.ts`
- Test: `services/api-core/src/__tests__/fiscalCompaniesOverview.test.ts`

**Interfaces:**
- Consumes: `listCompanies(tenantId, db)` de `../services/companyService` (retorna `Company[]`, cada uma com `.id: string`, `.razao_social: string`); `computeScore(tenantId, companyId, db)` de `../services/fiscalScoreService` (retorna `{ score: number, breakdown, findings: Array<{ rule, severity: 'info'|'warning'|'critical', ... }>, computedAt }`); `getClosingStatus(tenantId, companyId, competencia, db)` de `../services/fiscalClosingService` (retorna `{ run: {status: string} | null, lock: {status: string} | null }`); `listApuracoes(tenantId, companyId, db)` de `../services/apuracaoService` (retorna array ordenado por `competencia` desc, cada item com `.competencia: string` e `.das_total: string`); `dasDueDate(competencia: string): Date` de `../domain/fiscal/alertRulesDomain`; tabelas `fiscalCompanyConfig` e `dasPayments` de `../db/schema`.
- Produces: `getCompaniesOverview(tenantId: string, db?: DrizzleDB): Promise<CompanyOverview[]>`, onde `CompanyOverview` é `{ company_id: string, company_name: string, has_fiscal_config: boolean, score: number | null, alerts: { critical: number, warning: number, info: number } | null, competencia_atual: { competencia: string, status: 'aberta'|'fechada'|'travada' } | null, das: { competencia: string, valor: number, vencimento: string, dias_restantes: number, status: 'pendente'|'atrasado'|'pago' } | null, error: boolean }`. Task 2 (a rota) importa e chama exatamente essa função.

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `services/api-core/src/__tests__/fiscalCompaniesOverview.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/companyService', () => ({ listCompanies: vi.fn() }));
vi.mock('../services/fiscalScoreService', () => ({ computeScore: vi.fn() }));
vi.mock('../services/fiscalClosingService', () => ({ getClosingStatus: vi.fn() }));
vi.mock('../services/apuracaoService', () => ({ listApuracoes: vi.fn() }));

const mockDb = { select: vi.fn() } as any;

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

import { listCompanies } from '../services/companyService';
import { computeScore } from '../services/fiscalScoreService';
import { getClosingStatus } from '../services/fiscalClosingService';
import { listApuracoes } from '../services/apuracaoService';
import { getCompaniesOverview } from '../services/fiscalCompaniesOverviewService';

function selectReturning(rows: unknown[]) {
  return { from: () => ({ where: vi.fn().mockResolvedValue(rows) }) };
}

beforeEach(() => {
  vi.mocked(listCompanies).mockReset();
  vi.mocked(computeScore).mockReset();
  vi.mocked(getClosingStatus).mockReset();
  vi.mocked(listApuracoes).mockReset();
  mockDb.select.mockReset();
});

describe('getCompaniesOverview', () => {
  it('monta o resumo de 2 empresas configuradas, com score/alertas/das', async () => {
    vi.mocked(listCompanies).mockResolvedValue([
      { id: 'co-1', razao_social: 'Empresa Um' } as any,
      { id: 'co-2', razao_social: 'Empresa Dois' } as any,
    ]);
    mockDb.select
      .mockReturnValueOnce(selectReturning([{ id: 'cfg-1' }]))      // co-1: tem fiscal_company_config
      .mockReturnValueOnce(selectReturning([]))                     // co-1: sem das_payment pra última apuração
      .mockReturnValueOnce(selectReturning([{ id: 'cfg-2' }]))      // co-2: tem fiscal_company_config
      .mockReturnValueOnce(selectReturning([{ id: 'pay-1' }]));     // co-2: das da última apuração já foi pago
    vi.mocked(computeScore)
      .mockResolvedValueOnce({ score: 85, breakdown: [], findings: [{ rule: 'missing_cnae', severity: 'warning', title: 'x' }], computedAt: '' } as any)
      .mockResolvedValueOnce({ score: 40, breakdown: [], findings: [{ rule: 'iss_retention_mismatch', severity: 'critical', title: 'y' }], computedAt: '' } as any);
    vi.mocked(getClosingStatus)
      .mockResolvedValueOnce({ run: null, lock: null })
      .mockResolvedValueOnce({ run: { status: 'completed' }, lock: { status: 'locked' } } as any);
    vi.mocked(listApuracoes)
      .mockResolvedValueOnce([{ competencia: '2026-06', das_total: '1000.00' }] as any)
      .mockResolvedValueOnce([{ competencia: '2026-06', das_total: '2000.00' }] as any);

    const result = await getCompaniesOverview('tenant-1', mockDb);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      company_id: 'co-1', company_name: 'Empresa Um', has_fiscal_config: true,
      score: 85, alerts: { critical: 0, warning: 1, info: 0 },
      competencia_atual: { status: 'aberta' }, error: false,
    });
    expect(result[0].das).toMatchObject({ competencia: '2026-06', valor: 1000, status: 'pendente' });
    expect(result[1]).toMatchObject({
      company_id: 'co-2', has_fiscal_config: true, score: 40,
      alerts: { critical: 1, warning: 0, info: 0 },
      competencia_atual: { status: 'travada' },
    });
    expect(result[1].das).toMatchObject({ competencia: '2026-06', valor: 2000, status: 'pago' });
  });

  it('empresa sem fiscal_company_config entra com has_fiscal_config false, sem chamar computeScore', async () => {
    vi.mocked(listCompanies).mockResolvedValue([{ id: 'co-3', razao_social: 'Empresa Três' } as any]);
    mockDb.select.mockReturnValueOnce(selectReturning([])); // sem fiscal_company_config

    const result = await getCompaniesOverview('tenant-1', mockDb);

    expect(result).toEqual([{
      company_id: 'co-3', company_name: 'Empresa Três', has_fiscal_config: false,
      score: null, alerts: null, competencia_atual: null, das: null, error: false,
    }]);
    expect(computeScore).not.toHaveBeenCalled();
  });

  it('falha isolada no cálculo de uma empresa vira error:true sem derrubar as demais', async () => {
    vi.mocked(listCompanies).mockResolvedValue([
      { id: 'co-4', razao_social: 'Empresa Quatro' } as any,
      { id: 'co-5', razao_social: 'Empresa Cinco' } as any,
    ]);
    // Só 2 selects: hasFiscalConfig de co-4 e de co-5 — buildDas nunca chega a
    // consultar das_payments porque listApuracoes devolve [] pras duas (retorna
    // cedo, antes do 2º select).
    mockDb.select
      .mockReturnValueOnce(selectReturning([{ id: 'cfg-4' }]))
      .mockReturnValueOnce(selectReturning([{ id: 'cfg-5' }]));
    vi.mocked(computeScore)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ score: 100, breakdown: [], findings: [], computedAt: '' } as any);
    vi.mocked(getClosingStatus).mockResolvedValue({ run: null, lock: null });
    vi.mocked(listApuracoes).mockResolvedValue([]);

    const result = await getCompaniesOverview('tenant-1', mockDb);

    expect(result[0]).toMatchObject({ company_id: 'co-4', has_fiscal_config: true, error: true, score: null });
    expect(result[1]).toMatchObject({ company_id: 'co-5', has_fiscal_config: true, error: false, score: 100 });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd services/api-core && npx vitest run src/__tests__/fiscalCompaniesOverview.test.ts`
Expected: FAIL — `Cannot find module '../services/fiscalCompaniesOverviewService'` (o arquivo ainda não existe).

- [ ] **Step 3: Implementar `fiscalCompaniesOverviewService.ts`**

```typescript
// Painel executivo (Fase 1): resumo por empresa reaproveitando os services já
// testados de score/fechamento/apuração. Nenhum cálculo fiscal novo aqui —
// só orquestração e formatação. Processamento SEQUENCIAL (não Promise.all no
// nível de empresa) para manter a ordem determinística e permitir que uma
// falha isolada vire `error: true` sem afetar as demais.

import { eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { fiscalCompanyConfig, dasPayments } from '../db/schema';
import { listCompanies } from './companyService';
import { computeScore } from './fiscalScoreService';
import { getClosingStatus } from './fiscalClosingService';
import { listApuracoes } from './apuracaoService';
import { dasDueDate } from '../domain/fiscal/alertRulesDomain';

export type DrizzleDB = typeof _db;

export interface CompanyOverview {
  company_id: string;
  company_name: string;
  has_fiscal_config: boolean;
  score: number | null;
  alerts: { critical: number; warning: number; info: number } | null;
  competencia_atual: { competencia: string; status: 'aberta' | 'fechada' | 'travada' } | null;
  das: { competencia: string; valor: number; vencimento: string; dias_restantes: number; status: 'pendente' | 'atrasado' | 'pago' } | null;
  error: boolean;
}

/** Mesma convenção da FiscalPage: a competência de trabalho é o mês anterior. */
function currentCompetencia(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function hasFiscalConfig(tenantId: string, companyId: string, db: DrizzleDB): Promise<boolean> {
  const rows = await db.select().from(fiscalCompanyConfig)
    .where(and(eq(fiscalCompanyConfig.tenant_id, tenantId), eq(fiscalCompanyConfig.company_id, companyId)));
  return rows.length > 0;
}

async function buildDas(
  tenantId: string, companyId: string, db: DrizzleDB,
): Promise<CompanyOverview['das']> {
  const apuracoes = await listApuracoes(tenantId, companyId, db);
  const latest = apuracoes[0];
  if (!latest) return null;

  const payments = await db.select().from(dasPayments)
    .where(and(eq(dasPayments.tenant_id, tenantId), eq(dasPayments.company_id, companyId),
      eq(dasPayments.competencia, latest.competencia)));

  const due = dasDueDate(latest.competencia);
  const diasRestantes = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  const status: 'pendente' | 'atrasado' | 'pago' =
    payments.length > 0 ? 'pago' : diasRestantes < 0 ? 'atrasado' : 'pendente';

  return {
    competencia: latest.competencia,
    valor: Number(latest.das_total),
    vencimento: due.toISOString().slice(0, 10),
    dias_restantes: diasRestantes,
    status,
  };
}

async function buildConfiguredOverview(
  tenantId: string, companyId: string, companyName: string, competencia: string, db: DrizzleDB,
): Promise<CompanyOverview> {
  try {
    const [scoreResult, closing, das] = await Promise.all([
      computeScore(tenantId, companyId, db),
      getClosingStatus(tenantId, companyId, competencia, db),
      buildDas(tenantId, companyId, db),
    ]);

    const alerts = { critical: 0, warning: 0, info: 0 };
    for (const f of scoreResult.findings) alerts[f.severity as 'critical' | 'warning' | 'info']++;

    const status: 'aberta' | 'fechada' | 'travada' =
      closing.lock?.status === 'locked' ? 'travada'
      : (closing.run && closing.run.status !== 'failed') ? 'fechada'
      : 'aberta';

    return {
      company_id: companyId, company_name: companyName, has_fiscal_config: true,
      score: scoreResult.score, alerts,
      competencia_atual: { competencia, status },
      das, error: false,
    };
  } catch {
    return {
      company_id: companyId, company_name: companyName, has_fiscal_config: true,
      score: null, alerts: null, competencia_atual: null, das: null, error: true,
    };
  }
}

export async function getCompaniesOverview(tenantId: string, db: DrizzleDB = _db): Promise<CompanyOverview[]> {
  const companies = await listCompanies(tenantId, db);
  const competencia = currentCompetencia();
  const result: CompanyOverview[] = [];

  for (const company of companies) {
    const configured = await hasFiscalConfig(tenantId, company.id, db);
    if (!configured) {
      result.push({
        company_id: company.id, company_name: company.razao_social, has_fiscal_config: false,
        score: null, alerts: null, competencia_atual: null, das: null, error: false,
      });
      continue;
    }
    result.push(await buildConfiguredOverview(tenantId, company.id, company.razao_social, competencia, db));
  }

  return result;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd services/api-core && npx vitest run src/__tests__/fiscalCompaniesOverview.test.ts`
Expected: PASS — 3 testes.

- [ ] **Step 5: Commit**

```bash
git add services/api-core/src/services/fiscalCompaniesOverviewService.ts services/api-core/src/__tests__/fiscalCompaniesOverview.test.ts
git commit -m "feat(fiscal): service de orquestracao do painel executivo por empresa"
```

---

### Task 2: Rota `GET /v1/fiscal/companies-overview`

**Files:**
- Modify: `services/api-core/src/routes/fiscalScore.ts`

**Interfaces:**
- Consumes: `getCompaniesOverview(tenantId, db?)` de `../services/fiscalCompaniesOverviewService` (Task 1).
- Produces: `GET /v1/fiscal/companies-overview` → `{ data: CompanyOverview[] }`, gated por `requireModule('fiscal')` + `requirePermission('fiscal:view')` (mesmo `guard` já definido no arquivo).

- [ ] **Step 1: Adicionar a rota**

Editar `services/api-core/src/routes/fiscalScore.ts` — adicionar o import e a rota nova, reaproveitando o `guard` já existente no arquivo:

```typescript
import { getCompaniesOverview } from '../services/fiscalCompaniesOverviewService';
```

(adicionar essa linha junto aos outros imports, após `import { detectInconsistencies } from '../services/fiscalInconsistencyService';`)

```typescript
  fastify.get('/fiscal/companies-overview', guard, async (request) => {
    const { tenantId } = (request as any).user;
    return { data: await getCompaniesOverview(tenantId) };
  });
```

(adicionar essa rota logo após o bloco da rota `/fiscal/inconsistencies`, antes do `};` que fecha o plugin)

- [ ] **Step 2: Rodar a suíte do backend inteira pra garantir que nada quebrou**

Run: `cd services/api-core && npx vitest run`
Expected: PASS — todos os testes existentes + os 3 novos de `fiscalCompaniesOverview.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add services/api-core/src/routes/fiscalScore.ts
git commit -m "feat(fiscal): rota GET /v1/fiscal/companies-overview"
```

---

### Task 3: Seletor de empresa na `FiscalPage`

**Files:**
- Modify: `apps/backoffice/src/pages/fiscal/FiscalPage.tsx:1-121` (imports, estado, `load()`)
- Test: `apps/backoffice/src/pages/fiscal/__tests__/FiscalPage.test.tsx` (novo arquivo)

**Interfaces:**
- Consumes: `GET /v1/companies` (já usado em `InvoiceNewPage.tsx`, retorna `{ data: Array<{ id: string, razao_social: string, is_default: boolean }> }`); `useSearchParams` de `react-router-dom`.
- Produces: nenhuma interface nova consumida por outra task — a `FiscalOverviewPage` (Task 4) navega para `/fiscal/pipeline?company_id=<id>`, e este `?company_id=` é o único contrato entre as duas tasks.

- [ ] **Step 1: Escrever o teste (falhando)**

Criar `apps/backoffice/src/pages/fiscal/__tests__/FiscalPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FiscalPage } from '../FiscalPage';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: vi.fn(), postForm: vi.fn() },
}));

vi.mock('../../../rbac', () => ({
  usePermissions: () => ({ can: () => true }),
}));

const EMPTY = { data: [] };

function mockDefaultResponses() {
  mockGet.mockImplementation((path: string) => {
    if (path === '/v1/companies') {
      return Promise.resolve({ data: [
        { id: 'co-1', razao_social: 'Empresa Um', is_default: true },
        { id: 'co-2', razao_social: 'Empresa Dois', is_default: false },
      ] });
    }
    // score/simulator devolvem objeto único (não lista) — a FiscalPage real já
    // trata 422 (MEI/sem RBT12) com .catch(() => setScore(null)); reproduzir
    // esse caminho aqui evita que o componente tente ler score.findings de um
    // objeto {data:[]} que não tem essa forma.
    if (path.startsWith('/v1/fiscal/score') || path.startsWith('/v1/fiscal/simulator')) {
      return Promise.reject(new Error('sem dados'));
    }
    return Promise.resolve(EMPTY);
  });
}

beforeEach(() => { mockGet.mockReset(); mockDefaultResponses(); });

describe('FiscalPage — seletor de empresa', () => {
  it('carrega score/apuracao/simulador com company_id da empresa selecionada', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/fiscal/pipeline']}><FiscalPage /></MemoryRouter>);

    await screen.findByText('Empresa Um');
    mockGet.mockClear();

    await user.selectOptions(screen.getByLabelText('Empresa'), 'co-2');

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/fiscal/score?company_id=co-2'));
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/fiscal/apuracao?company_id=co-2'));
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/fiscal/simulator?company_id=co-2'));
    });
  });

  it('pré-seleciona a empresa a partir de ?company_id= na URL', async () => {
    render(<MemoryRouter initialEntries={['/fiscal/pipeline?company_id=co-2']}><FiscalPage /></MemoryRouter>);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/fiscal/score?company_id=co-2'));
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd apps/backoffice && npx vitest run src/pages/fiscal/__tests__/FiscalPage.test.tsx`
Expected: FAIL — `getByLabelText('Empresa')` não encontra nada (seletor ainda não existe) e as URLs não têm `company_id`.

- [ ] **Step 3: Implementar o seletor e o threading de `company_id`**

Em `apps/backoffice/src/pages/fiscal/FiscalPage.tsx`, adicionar o import de `useSearchParams` (linha 6, junto dos demais imports de `react`/router):

```typescript
import { useSearchParams } from 'react-router-dom';
```

Adicionar estado de empresas e o `companyId` controlado pela URL, logo após a declaração de `alerts` (linha 89):

```typescript
  const [companies, setCompanies] = useState<{ id: string; razao_social: string; is_default: boolean }[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const companyId = searchParams.get('company_id') ?? '';
```

Buscar a lista de empresas uma vez, no mount (novo `useEffect`, logo após a declaração de `fileRef` na linha 97):

```typescript
  useEffect(() => {
    api.get<{ data: { id: string; razao_social: string; is_default: boolean }[] }>('/v1/companies')
      .then((r) => setCompanies(r.data)).catch(() => setCompanies([]));
  }, []);
```

Alterar `load` (linhas 99-119) para depender de `companyId` e propagar o parâmetro nas 3 chamadas que já o aceitam (score, apuração, simulador) — as demais (`reconciliation/summary`, `imports`, `consolidation/drafts`, `reconciliation/transactions`, `das-summary`, `alerts`) continuam sem o parâmetro, pois o backend não o suporta hoje (ver Global Constraints):

```typescript
  const load = useCallback(async () => {
    const q = companyId ? `?company_id=${companyId}` : '';
    const [s, b, d, p, a, ds] = await Promise.all([
      api.get<Record<string, number>>('/v1/fiscal/reconciliation/summary').catch(() => ({})),
      api.get<{ data: Batch[] }>('/v1/fiscal/imports').catch(() => ({ data: [] })),
      api.get<{ data: Draft[] }>('/v1/fiscal/consolidation/drafts').catch(() => ({ data: [] })),
      api.get<{ data: PendingTx[] }>('/v1/fiscal/reconciliation/transactions?status=pending,unmatched').catch(() => ({ data: [] })),
      api.get<{ data: Apuracao[] }>(`/v1/fiscal/apuracao${q}`).catch(() => ({ data: [] })),
      api.get<{ data: DasSummaryRow[] }>('/v1/fiscal/das-summary').catch(() => ({ data: [] })),
    ]);
    setSummary(s);
    setBatches(b.data.slice(0, 8));
    setDrafts(d.data.slice(0, 8));
    setPending(p.data.slice(0, 8));
    setApuracoes(a.data.slice(0, 8));
    setDasSummary(ds.data);
    // Simulador/score falham com 422 (MEI/sem RBT12) — cards não aparecem.
    api.get<Simulacao>(`/v1/fiscal/simulator${q}`).then(setSim).catch(() => setSim(null));
    api.get<ScoreData>(`/v1/fiscal/score${q}`).then(setScore).catch(() => setScore(null));
    api.get<{ data: FiscalAlert[] }>('/v1/fiscal/alerts?status=open,acknowledged&limit=20')
      .then((r) => setAlerts(r.data)).catch(() => setAlerts([]));
  }, [companyId]);
```

Adicionar o `<select>` no `<header>`, logo depois do bloco `<p>` da linha 147 (dentro da primeira `<div>` do header, antes do `</div>` que fecha em torno da linha 148):

```tsx
          {companies.length > 1 && (
            <div style={{ marginTop: 8 }}>
              <label htmlFor="fiscal-company" style={{ fontSize: 12, color: 'var(--muted, #64748b)', marginRight: 6 }}>Empresa</label>
              <select id="fiscal-company" value={companyId}
                onChange={(e) => setSearchParams(e.target.value ? { company_id: e.target.value } : {})}>
                <option value="">Todas</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.razao_social}{c.is_default ? ' (padrão)' : ''}</option>
                ))}
              </select>
            </div>
          )}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd apps/backoffice && npx vitest run src/pages/fiscal/__tests__/FiscalPage.test.tsx`
Expected: PASS — 2 testes.

- [ ] **Step 5: Rodar a suíte inteira do frontend pra garantir que nada quebrou**

Run: `cd apps/backoffice && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/src/pages/fiscal/FiscalPage.tsx apps/backoffice/src/pages/fiscal/__tests__/FiscalPage.test.tsx
git commit -m "feat(fiscal): seletor de empresa na FiscalPage (drill-down do painel)"
```

---

### Task 4: `FiscalOverviewPage` + roteamento

**Files:**
- Create: `apps/backoffice/src/pages/fiscal/FiscalOverviewPage.tsx`
- Test: `apps/backoffice/src/pages/fiscal/__tests__/FiscalOverviewPage.test.tsx`
- Modify: `apps/backoffice/src/App.tsx:25,141` (import + rotas)

**Interfaces:**
- Consumes: `GET /v1/fiscal/companies-overview` (Task 2) → `{ data: CompanyOverview[] }` (mesmo shape do Task 1, campos `company_id`, `company_name`, `has_fiscal_config`, `score`, `alerts`, `competencia_atual`, `das`, `error`).
- Produces: nenhuma interface nova — é a folha da árvore de tasks.

- [ ] **Step 1: Escrever o teste (falhando)**

Criar `apps/backoffice/src/pages/fiscal/__tests__/FiscalOverviewPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FiscalOverviewPage } from '../FiscalOverviewPage';

const { mockGet, mockNavigate } = vi.hoisted(() => ({ mockGet: vi.fn(), mockNavigate: vi.fn() }));

vi.mock('../../../lib/api', () => ({ api: { get: mockGet } }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

beforeEach(() => { mockGet.mockReset(); mockNavigate.mockReset(); });

const COMPANY_OK = {
  company_id: 'co-1', company_name: 'Empresa Boa', has_fiscal_config: true,
  score: 90, alerts: { critical: 0, warning: 0, info: 0 },
  competencia_atual: { competencia: '2026-06', status: 'aberta' },
  das: { competencia: '2026-06', valor: 1000, vencimento: '2026-07-20', dias_restantes: 5, status: 'pendente' },
  error: false,
};

const COMPANY_RUIM = {
  company_id: 'co-2', company_name: 'Empresa Ruim', has_fiscal_config: true,
  score: 30, alerts: { critical: 2, warning: 1, info: 0 },
  competencia_atual: { competencia: '2026-06', status: 'travada' },
  das: { competencia: '2026-06', valor: 500, vencimento: '2026-07-20', dias_restantes: -3, status: 'atrasado' },
  error: false,
};

const COMPANY_SEM_CADASTRO = {
  company_id: 'co-3', company_name: 'Empresa Nova', has_fiscal_config: false,
  score: null, alerts: null, competencia_atual: null, das: null, error: false,
};

describe('FiscalOverviewPage', () => {
  it('renderiza um card por empresa, ordenado por urgência (score mais baixo primeiro)', async () => {
    mockGet.mockResolvedValue({ data: [COMPANY_OK, COMPANY_RUIM, COMPANY_SEM_CADASTRO] });
    render(<MemoryRouter><FiscalOverviewPage /></MemoryRouter>);

    const cards = await screen.findAllByTestId('fiscal-overview-card');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('Empresa Ruim');
    expect(cards[1]).toHaveTextContent('Empresa Boa');
    expect(cards[2]).toHaveTextContent('Empresa Nova');
    expect(cards[2]).toHaveTextContent('Configurar');
  });

  it('clicar num card navega pra FiscalPage filtrada por aquela empresa', async () => {
    mockGet.mockResolvedValue({ data: [COMPANY_OK, COMPANY_RUIM] });
    const user = userEvent.setup();
    render(<MemoryRouter><FiscalOverviewPage /></MemoryRouter>);

    const card = await screen.findByText('Empresa Boa');
    await user.click(card);

    expect(mockNavigate).toHaveBeenCalledWith('/fiscal/pipeline?company_id=co-1');
  });

  it('redireciona direto pro pipeline quando só há 1 empresa', async () => {
    mockGet.mockResolvedValue({ data: [COMPANY_OK] });
    render(<MemoryRouter><FiscalOverviewPage /></MemoryRouter>);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/fiscal/pipeline', { replace: true }));
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd apps/backoffice && npx vitest run src/pages/fiscal/__tests__/FiscalOverviewPage.test.tsx`
Expected: FAIL — `Cannot find module '../FiscalOverviewPage'`.

- [ ] **Step 3: Implementar `FiscalOverviewPage.tsx`**

```tsx
// Painel executivo do módulo Fiscal: dashboard de visibilidade por empresa,
// rota-índice de /fiscal. Vira o hub operacional (FiscalPage, /fiscal/pipeline)
// filtrado por empresa ao clicar num card.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface CompanyOverview {
  company_id: string;
  company_name: string;
  has_fiscal_config: boolean;
  score: number | null;
  alerts: { critical: number; warning: number; info: number } | null;
  competencia_atual: { competencia: string; status: string } | null;
  das: { competencia: string; valor: number; vencimento: string; dias_restantes: number; status: string } | null;
  error: boolean;
}

function scoreColor(score: number): string {
  return score >= 90 ? '#16a34a' : score >= 70 ? '#d97706' : '#dc2626';
}

function urgencyRank(c: CompanyOverview): number {
  if (c.error) return -1;
  if (!c.has_fiscal_config) return 1000;
  return (c.score ?? 0) - (c.alerts?.critical ?? 0) * 100;
}

export function FiscalOverviewPage() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<CompanyOverview[] | null>(null);

  useEffect(() => {
    api.get<{ data: CompanyOverview[] }>('/v1/fiscal/companies-overview')
      .then((r) => setCompanies(r.data))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (companies && companies.length === 1) {
      navigate('/fiscal/pipeline', { replace: true });
    }
  }, [companies, navigate]);

  if (companies === null) {
    return (
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ height: 140, borderRadius: 12, background: 'var(--surface-2, #f1f5f9)' }} />
        ))}
      </div>
    );
  }

  if (companies.length <= 1) return null; // redirect em andamento

  const sorted = [...companies].sort((a, b) => urgencyRank(a) - urgencyRank(b));

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Painel Fiscal</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--muted, #64748b)', fontSize: 13 }}>
          Visão consolidada das empresas do tenant
        </p>
      </header>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {sorted.map((c) => (
          <button key={c.company_id} type="button" data-testid="fiscal-overview-card"
            onClick={() => navigate(`/fiscal/pipeline?company_id=${c.company_id}`)}
            style={{
              textAlign: 'left', cursor: 'pointer', background: 'var(--surface, #fff)',
              border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 16,
            }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{c.company_name}</div>

            {c.error && <p style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>Não foi possível carregar</p>}

            {!c.error && !c.has_fiscal_config && (
              <>
                <p style={{ fontSize: 13, color: 'var(--muted, #64748b)' }}>Cadastro fiscal pendente</p>
                <span className="btn btn-sm">Configurar</span>
              </>
            )}

            {!c.error && c.has_fiscal_config && c.score !== null && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontWeight: 800, color: '#fff', background: scoreColor(c.score),
                }}>{c.score}</div>
                <div style={{ fontSize: 12 }}>
                  {c.alerts && (c.alerts.critical + c.alerts.warning) > 0 && (
                    <div>{c.alerts.critical} crítico(s) · {c.alerts.warning} aviso(s)</div>
                  )}
                  {c.competencia_atual && <div>Competência {c.competencia_atual.competencia}: {c.competencia_atual.status}</div>}
                  {c.das && (
                    <div style={{ color: c.das.status === 'atrasado' ? '#dc2626' : 'inherit' }}>
                      DAS {BRL.format(c.das.valor)} — {c.das.status === 'atrasado' ? `atrasado ${-c.das.dias_restantes}d` : `${c.das.dias_restantes}d`}
                    </div>
                  )}
                </div>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd apps/backoffice && npx vitest run src/pages/fiscal/__tests__/FiscalOverviewPage.test.tsx`
Expected: PASS — 3 testes.

- [ ] **Step 5: Ligar a rota em `App.tsx`**

Adicionar o import logo após a linha do `FiscalPage` (linha 25):

```typescript
import { FiscalOverviewPage } from './pages/fiscal/FiscalOverviewPage';
```

Trocar a linha da rota `/fiscal` (linha 141) por duas rotas:

```tsx
        <Route path="/fiscal"          element={gate('fiscal:view', <FiscalOverviewPage />)} />
        <Route path="/fiscal/pipeline" element={gate('fiscal:view', <FiscalPage />)} />
```

- [ ] **Step 6: Rodar a suíte inteira do frontend**

Run: `cd apps/backoffice && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backoffice/src/pages/fiscal/FiscalOverviewPage.tsx apps/backoffice/src/pages/fiscal/__tests__/FiscalOverviewPage.test.tsx apps/backoffice/src/App.tsx
git commit -m "feat(fiscal): painel executivo (dashboard por empresa) como rota-indice de /fiscal"
```

---

### Task 5: Verificação final

- [ ] **Step 1: Typecheck backend**

Run: `cd services/api-core && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 2: Typecheck frontend**

Run: `cd apps/backoffice && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Suíte completa dos dois workspaces**

Run: `cd services/api-core && npx vitest run && cd ../../apps/backoffice && npx vitest run`
Expected: PASS em ambos, sem regressão nos testes existentes.

- [ ] **Step 4: Verificação manual**

Rodar o backoffice localmente (`docker compose up -d` + `npm run dev` conforme `docs/fiscal-module.md` §5.1) com um tenant seed de 2+ empresas — uma com `fiscal_company_config` completo, outra sem. Confirmar: `/fiscal` mostra os cards na ordem certa (pior score/mais alertas críticos primeiro), o card sem cadastro tem o CTA "Configurar", clicar num card abre `/fiscal/pipeline?company_id=...` com o seletor já preenchido, e um tenant com 1 empresa só é redirecionado direto pro pipeline sem ver o painel.
