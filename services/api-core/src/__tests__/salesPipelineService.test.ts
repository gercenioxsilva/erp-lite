import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listStages, createOpportunity, updateOpportunity, moveStage, markWon, markLost,
  logActivity, convertToProposal, SalesPipelineDomainError,
} from '../services/salesPipelineService';
import type { DrizzleDB } from '../services/salesPipelineService';

// salesPipelineService.ts é o coração do Funil de Vendas (CRM opcional):
// etapas configuráveis com seed idempotente, timeline de atividades com log
// automático de mudança de etapa/resultado (nunca manual), e conversão em
// Proposta reaproveitando o schema de `proposals` já existente.

const TENANT_ID = 'tenant-1';
const OPP_ID    = 'opp-1';
const STAGE_ID  = 'stage-1';
const NEW_STAGE_ID = 'stage-2';

function baseOpportunityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OPP_ID, tenant_id: TENANT_ID, stage_id: STAGE_ID, client_id: null, seller_id: null,
    proposal_id: null, title: 'Venda de ar condicionado', value: '1000.00', status: 'open',
    notes: null, contact_name: null, contact_email: null, contact_phone: null,
    ...overrides,
  };
}

function baseStageRow(overrides: Record<string, unknown> = {}) {
  return { id: STAGE_ID, tenant_id: TENANT_ID, name: 'Novo Lead', sort_order: 0, is_active: true, ...overrides };
}

// values() precisa ser awaitable diretamente (usado sem .returning() nos
// inserts de atividade) E encadeável com .returning() (usado nos demais) —
// mesmo padrão de valuesChain() já usado em materialsImport.test.ts.
function valuesChain(returningRows: unknown[] = []) {
  const p: any = Promise.resolve(undefined);
  p.returning = () => Promise.resolve(returningRows);
  return p;
}

function makeMockDb(opts: {
  stagesRows?: Record<string, unknown>[];
  opportunityRow?: Record<string, unknown> | null;
  newStageRow?: Record<string, unknown> | null;
  maxProposalNumber?: string;
}) {
  const insertedActivities: Record<string, unknown>[] = [];
  const insertedStages: Record<string, unknown>[] = [];
  const insertedProposals: Record<string, unknown>[] = [];
  const insertedProposalItems: Record<string, unknown>[] = [];
  const updatedOpportunities: Record<string, unknown>[] = [];

  // select() é chamado em sequência com tabelas diferentes dentro da mesma
  // função (ex.: moveStage lê salesOpportunities, depois salesPipelineStages)
  // — uma fila de retornos por chamada, na ordem em que os testes os configuram.
  const selectQueue: unknown[][] = [];
  if (opts.opportunityRow !== undefined) selectQueue.push(opts.opportunityRow ? [opts.opportunityRow] : []);
  if (opts.newStageRow !== undefined)    selectQueue.push(opts.newStageRow ? [opts.newStageRow] : []);
  if (opts.stagesRows !== undefined)     selectQueue.push(opts.stagesRows);

  const db: any = {
    transaction: async (cb: any) => cb(db),
    select: vi.fn(() => {
      const rows = selectQueue.length ? selectQueue.shift()! : [];
      return { from: () => ({ where: () => Promise.resolve(rows), orderBy: () => Promise.resolve(rows) }) };
    }),
    execute: vi.fn(async () => ({ rows: [{ max_number: opts.maxProposalNumber ?? '0' }] })),
    insert: vi.fn((table: unknown) => ({
      values: (data: Record<string, unknown>) => {
        if ('type' in data) { insertedActivities.push(data); return valuesChain([{ id: 'activity-1', ...data }]); }
        if ('sort_order' in data && 'name' in data && 'quantity' in data === false && 'sku' in data === false) {
          insertedStages.push(data); return valuesChain([{ id: 'new-stage-1', ...data }]);
        }
        if ('number' in data) { insertedProposals.push(data); return valuesChain([{ id: 'proposal-1', ...data }]); }
        if ('quantity' in data) { insertedProposalItems.push(data); return valuesChain([{ id: 'item-1', ...data }]); }
        insertedStages.push(data); return valuesChain([{ id: 'row-1', ...data }]);
      },
    })),
    update: vi.fn(() => ({
      set: (data: Record<string, unknown>) => {
        updatedOpportunities.push(data);
        return { where: () => ({ returning: () => Promise.resolve([{ ...baseOpportunityRow(), ...data }]) }) };
      },
    })),
  };

  return { db: db as DrizzleDB, insertedActivities, insertedStages, insertedProposals, insertedProposalItems, updatedOpportunities };
}

describe('listStages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve as etapas existentes, ordenadas, sem semear nada', async () => {
    const { db, insertedStages } = makeMockDb({
      stagesRows: [baseStageRow({ id: 'b', sort_order: 1, name: 'Negociação' }), baseStageRow({ id: 'a', sort_order: 0, name: 'Novo Lead' })],
    });
    const stages = await listStages(TENANT_ID, db);
    expect(stages.map((s: any) => s.name)).toEqual(['Novo Lead', 'Negociação']);
    expect(insertedStages).toHaveLength(0);
  });

  it('semeia as etapas padrão na primeira leitura de um tenant sem nenhuma etapa (idempotente)', async () => {
    const { db, insertedStages } = makeMockDb({ stagesRows: [] });
    const stages = await listStages(TENANT_ID, db);
    expect(insertedStages).toHaveLength(4); // DEFAULT_STAGES
    expect(stages).toHaveLength(4);
  });
});

describe('createOpportunity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cria a oportunidade quando a etapa pertence ao tenant', async () => {
    const { db } = makeMockDb({ newStageRow: baseStageRow() });
    const opp = await createOpportunity({ tenantId: TENANT_ID, stageId: STAGE_ID, title: 'Nova venda' }, db);
    expect(opp).toMatchObject({ title: 'Nova venda' });
  });

  it('lança stage_not_found quando a etapa não pertence ao tenant', async () => {
    const { db } = makeMockDb({ newStageRow: null });
    await expect(createOpportunity({ tenantId: TENANT_ID, stageId: 'ghost', title: 'Nova venda' }, db))
      .rejects.toMatchObject({ code: 'stage_not_found' });
  });

  it('lança opportunity_title_required quando o título é vazio', async () => {
    const { db } = makeMockDb({});
    await expect(createOpportunity({ tenantId: TENANT_ID, stageId: STAGE_ID, title: '   ' }, db))
      .rejects.toMatchObject({ code: 'opportunity_title_required' });
  });
});

describe('moveStage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('move de etapa e loga stage_change automaticamente na timeline', async () => {
    const { db, insertedActivities, updatedOpportunities } = makeMockDb({
      opportunityRow: baseOpportunityRow({ stage_id: STAGE_ID }),
      newStageRow: baseStageRow({ id: NEW_STAGE_ID, name: 'Negociação' }),
    });
    await moveStage(OPP_ID, TENANT_ID, NEW_STAGE_ID, 'user-1', db);

    expect(updatedOpportunities[0]).toMatchObject({ stage_id: NEW_STAGE_ID });
    expect(insertedActivities[0]).toMatchObject({ type: 'stage_change', description: 'Movida para "Negociação"' });
  });

  it('é um no-op quando a oportunidade já está na etapa de destino — não loga nada', async () => {
    const { db, insertedActivities } = makeMockDb({
      opportunityRow: baseOpportunityRow({ stage_id: STAGE_ID }),
      newStageRow: baseStageRow({ id: STAGE_ID }),
    });
    await moveStage(OPP_ID, TENANT_ID, STAGE_ID, 'user-1', db);
    expect(insertedActivities).toHaveLength(0);
  });
});

describe('markWon / markLost', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marca como ganha e loga a atividade "won"', async () => {
    const { db, insertedActivities, updatedOpportunities } = makeMockDb({
      opportunityRow: baseOpportunityRow({ status: 'open' }),
    });
    await markWon(OPP_ID, TENANT_ID, 'user-1', db);
    expect(updatedOpportunities[0]).toMatchObject({ status: 'won' });
    expect(insertedActivities[0]).toMatchObject({ type: 'won' });
  });

  it('marca como perdida com motivo e loga a atividade "lost"', async () => {
    const { db, insertedActivities, updatedOpportunities } = makeMockDb({
      opportunityRow: baseOpportunityRow({ status: 'open' }),
    });
    await markLost(OPP_ID, TENANT_ID, 'Preço acima do orçamento', 'user-1', db);
    expect(updatedOpportunities[0]).toMatchObject({ status: 'lost', lost_reason: 'Preço acima do orçamento' });
    expect(insertedActivities[0]).toMatchObject({ type: 'lost', description: 'Preço acima do orçamento' });
  });

  it('bloqueia marcar como ganha uma oportunidade já perdida (estado terminal)', async () => {
    const { db } = makeMockDb({ opportunityRow: baseOpportunityRow({ status: 'lost' }) });
    await expect(markWon(OPP_ID, TENANT_ID, 'user-1', db))
      .rejects.toMatchObject({ code: 'opportunity_not_open' });
  });

  it('bloqueia marcar como perdida uma oportunidade já ganha (estado terminal)', async () => {
    const { db } = makeMockDb({ opportunityRow: baseOpportunityRow({ status: 'won' }) });
    await expect(markLost(OPP_ID, TENANT_ID, null, 'user-1', db))
      .rejects.toMatchObject({ code: 'opportunity_not_open' });
  });
});

describe('logActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registra uma nota manual', async () => {
    const { db, insertedActivities } = makeMockDb({ opportunityRow: baseOpportunityRow() });
    await logActivity({ opportunityId: OPP_ID, tenantId: TENANT_ID, type: 'note', description: 'Cliente pediu desconto', userId: 'user-1' }, db);
    expect(insertedActivities[0]).toMatchObject({ type: 'note', description: 'Cliente pediu desconto' });
  });

  it('rejeita logar manualmente um tipo automático (stage_change/won/lost/proposal_linked)', async () => {
    const { db } = makeMockDb({ opportunityRow: baseOpportunityRow() });
    await expect(logActivity({ opportunityId: OPP_ID, tenantId: TENANT_ID, type: 'stage_change' as any, userId: 'user-1' }, db))
      .rejects.toMatchObject({ code: 'activity_type_not_manual' });
  });
});

describe('convertToProposal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cria uma proposta em rascunho com 1 item-placeholder e vincula de volta à oportunidade', async () => {
    const { db, insertedProposals, insertedProposalItems, insertedActivities, updatedOpportunities } = makeMockDb({
      opportunityRow: baseOpportunityRow({ client_id: 'client-1', proposal_id: null, value: '2500.00' }),
      maxProposalNumber: '7',
    });

    const result = await convertToProposal(OPP_ID, TENANT_ID, 'user-1', 'vendedor@example.com', db);

    expect(insertedProposals[0]).toMatchObject({ status: 'draft', number: '00008', client_id: 'client-1', total: '2500' });
    expect(insertedProposalItems[0]).toMatchObject({ quantity: '1', unit_price: '2500' });
    expect(updatedOpportunities[0]).toMatchObject({ proposal_id: 'proposal-1' });
    expect(insertedActivities[0]).toMatchObject({ type: 'proposal_linked' });
    expect(result.proposal).toMatchObject({ id: 'proposal-1' });
  });

  it('bloqueia converter de novo uma oportunidade já vinculada a uma proposta', async () => {
    const { db } = makeMockDb({ opportunityRow: baseOpportunityRow({ proposal_id: 'existing-proposal' }) });
    await expect(convertToProposal(OPP_ID, TENANT_ID, 'user-1', null, db))
      .rejects.toMatchObject({ code: 'opportunity_already_converted' });
  });
});

describe('updateOpportunity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lança opportunity_not_found quando a oportunidade não existe', async () => {
    const { db } = makeMockDb({ opportunityRow: null });
    await expect(updateOpportunity(OPP_ID, TENANT_ID, { title: 'Novo título' }, db))
      .rejects.toMatchObject({ code: 'opportunity_not_found' });
  });
});
