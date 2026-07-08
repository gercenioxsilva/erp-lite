import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Rotas de Funil de Vendas são finas — mockamos o service inteiro (já
// testado isoladamente em salesPipelineService.test.ts) e verificamos só o
// contrato HTTP: status codes, gate de módulo opcional, mapeamento de erro
// de domínio, autenticação. Mesmo padrão de serviceOrderBillingRoute.test.ts.

vi.mock('../services/salesPipelineService', () => ({
  listStages: vi.fn(), createStage: vi.fn(), updateStage: vi.fn(),
  listOpportunities: vi.fn(), createOpportunity: vi.fn(), updateOpportunity: vi.fn(),
  moveStage: vi.fn(), markWon: vi.fn(), markLost: vi.fn(),
  listActivities: vi.fn(), logActivity: vi.fn(), convertToProposal: vi.fn(),
  SalesPipelineDomainError: class SalesPipelineDomainError extends Error {
    code: string; payload?: Record<string, unknown>;
    constructor(code: string, payload?: Record<string, unknown>) { super(code); this.code = code; this.payload = payload; }
  },
}));

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

function selectOnce(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OPP_ID    = '22222222-2222-2222-2222-222222222222';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('rotas de /v1/sales-pipeline', () => {
  let app: FastifyInstance;
  let svc: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // requireModule('sales_pipeline') sempre precisa do módulo habilitado
    // pra chegar na rota — mesmo padrão de serviceOrderBillingRoute.test.ts.
    mockDb.select.mockReturnValue(selectOnce([{ enabled: true }]));
    svc = await import('../services/salesPipelineService') as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sales-pipeline/opportunities' });
    expect(res.statusCode).toBe(401);
  });

  it('403 quando o módulo sales_pipeline não está habilitado para o tenant', async () => {
    mockDb.select.mockReturnValue(selectOnce([])); // isModuleEnabled → false
    const res = await app.inject({
      method: 'GET', url: '/v1/sales-pipeline/opportunities',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(403);
    expect(svc.listOpportunities).not.toHaveBeenCalled();
  });

  it('GET /stages retorna a lista de etapas', async () => {
    svc.listStages.mockResolvedValue([{ id: 'stage-1', name: 'Novo Lead' }]);
    const res = await app.inject({
      method: 'GET', url: '/v1/sales-pipeline/stages',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('POST /opportunities 201 quando criada com sucesso', async () => {
    svc.createOpportunity.mockResolvedValue({ id: OPP_ID, title: 'Venda de peças' });
    const res = await app.inject({
      method: 'POST', url: '/v1/sales-pipeline/opportunities',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { stage_id: 'stage-1', title: 'Venda de peças' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(OPP_ID);
  });

  it('POST /opportunities 422 quando o service lança erro de domínio de validação', async () => {
    const { SalesPipelineDomainError } = await import('../services/salesPipelineService');
    svc.createOpportunity.mockRejectedValue(new (SalesPipelineDomainError as any)('opportunity_title_required'));
    const res = await app.inject({
      method: 'POST', url: '/v1/sales-pipeline/opportunities',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { stage_id: 'stage-1', title: '' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('opportunity_title_required');
  });

  it('POST /opportunities 404 quando a etapa informada não existe', async () => {
    const { SalesPipelineDomainError } = await import('../services/salesPipelineService');
    svc.createOpportunity.mockRejectedValue(new (SalesPipelineDomainError as any)('stage_not_found'));
    const res = await app.inject({
      method: 'POST', url: '/v1/sales-pipeline/opportunities',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { stage_id: 'ghost', title: 'Venda' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /opportunities/:id/move 400 sem stage_id', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/sales-pipeline/opportunities/${OPP_ID}/move`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(svc.moveStage).not.toHaveBeenCalled();
  });

  it('POST /opportunities/:id/won 422 quando a oportunidade já está fechada', async () => {
    const { SalesPipelineDomainError } = await import('../services/salesPipelineService');
    svc.markWon.mockRejectedValue(new (SalesPipelineDomainError as any)('opportunity_not_open', { status: 'lost' }));
    const res = await app.inject({
      method: 'POST', url: `/v1/sales-pipeline/opportunities/${OPP_ID}/won`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'opportunity_not_open', status: 'lost' });
  });

  it('POST /opportunities/:id/activities 400 sem type', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/sales-pipeline/opportunities/${OPP_ID}/activities`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: { description: 'Ligar amanhã' },
    });
    expect(res.statusCode).toBe(400);
    expect(svc.logActivity).not.toHaveBeenCalled();
  });

  it('POST /opportunities/:id/activities 201 quando registrada', async () => {
    svc.logActivity.mockResolvedValue({ id: 'activity-1', type: 'note' });
    const res = await app.inject({
      method: 'POST', url: `/v1/sales-pipeline/opportunities/${OPP_ID}/activities`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: { type: 'note', description: 'Cliente pediu desconto' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('POST /opportunities/:id/convert-to-proposal 201 e repassa o resultado do service', async () => {
    svc.convertToProposal.mockResolvedValue({ proposal: { id: 'proposal-1' } });
    const res = await app.inject({
      method: 'POST', url: `/v1/sales-pipeline/opportunities/${OPP_ID}/convert-to-proposal`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().proposal.id).toBe('proposal-1');
  });

  it('POST /opportunities/:id/convert-to-proposal 422 quando já convertida', async () => {
    const { SalesPipelineDomainError } = await import('../services/salesPipelineService');
    svc.convertToProposal.mockRejectedValue(new (SalesPipelineDomainError as any)('opportunity_already_converted'));
    const res = await app.inject({
      method: 'POST', url: `/v1/sales-pipeline/opportunities/${OPP_ID}/convert-to-proposal`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(422);
  });
});
