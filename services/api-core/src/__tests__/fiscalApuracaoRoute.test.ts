// POST /v1/fiscal/apuracao — contrato HTTP do adapter. A regra de cálculo vive
// em apuracaoDomain (testada à parte); aqui o que importa é a tradução de erro
// tipado → status. Competência travada é recusa de negócio esperada (422 com
// código legível), nunca 500 — o usuário fecha/trava o mês e a UI precisa dizer
// "reabra para corrigir", não "Internal Server Error".

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

vi.mock('../services/apuracaoService', () => ({
  apurarCompetencia: vi.fn(),
  exportApuracao: vi.fn(),
  getGuia: vi.fn(),
  listApuracoes: vi.fn(),
  registerDasPayment: vi.fn(),
  estimadoVsPago: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const selectOnce = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

describe('POST /v1/fiscal/apuracao', () => {
  let app: FastifyInstance;
  let apurarCompetencia: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // requireModule('fiscal') consulta tenant_modules antes de chegar na rota.
    mockDb.select.mockReturnValue(selectOnce([{ enabled: true }]));
    apurarCompetencia = (await import('../services/apuracaoService')).apurarCompetencia as any;
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  const post = (body: Record<string, unknown>) => app.inject({
    method: 'POST',
    url: '/v1/fiscal/apuracao',
    headers: { authorization: `Bearer ${app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'owner' })}` },
    payload: body,
  });

  it('competência travada → 422 com código legível (não 500)', async () => {
    const { FiscalLockError } = await import('../services/fiscalPeriodLockGuard');
    apurarCompetencia.mockRejectedValue(
      new FiscalLockError('competencia_travada', { competencia: '2026-07', companyId: 'co-1' }),
    );

    const res = await post({ competencia: '2026-07' });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'competencia_travada', competencia: '2026-07' });
  });
});
