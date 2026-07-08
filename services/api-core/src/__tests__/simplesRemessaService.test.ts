import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSimplesRemessa, emitSimplesRemessa, registrarRetorno, applyRemessaStockMovement,
  SimplesRemessaDomainError,
} from '../services/simplesRemessaService';
import type { DrizzleDB } from '../services/simplesRemessaService';

// simplesRemessaService.ts é o coração da regra 51: cria a remessa (CFOP
// resolvido a partir do motivo + UF do cliente vs empresa), emite via Focus
// com a situação tributária de operação não onerosa (nunca a do material),
// registra retorno (só quando o motivo admite) e move estoque na
// autorização — nunca gera receivable nem comissão.

const getSqsClientMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/sqsClient', () => ({ getSqsClient: getSqsClientMock }));

const TENANT_ID = 'tenant-1';
const SR_ID     = 'sr-1';
const CLIENT_ID = 'client-1';

function baseCompanyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'company-1', tenant_id: TENANT_ID, is_default: true, is_active: true,
    cnpj: '11444777000161', razao_social: 'Empresa Teste', nome_fantasia: null,
    logradouro: 'Rua A', numero: '1', complemento: null, bairro: 'Centro',
    municipio: 'SAO PAULO', uf: 'SP', cep: '01000000', telefone: null, email: null,
    regime_tributario: 1, focus_ambiente: 2, focus_token_homologacao: 'hml-token', focus_token_producao: null,
    ...overrides,
  };
}

function makeMockDb(opts: {
  companyRows?: Record<string, unknown>[];
  clientRows?: Record<string, unknown>[];
  srRow?: Record<string, unknown>;
  itemsRows?: Record<string, unknown>[];
  originalRow?: Record<string, unknown>;
  originalItemsRows?: Record<string, unknown>[];
  stockRow?: Record<string, unknown>;
  remessaItemsForStock?: Record<string, unknown>[];
  inventoryRow?: Record<string, unknown>;
}) {
  const insertedRemessas: Record<string, unknown>[] = [];
  const insertedItems: Record<string, unknown>[] = [];
  const inventoryUpdates: string[] = [];
  const movementInserts: Record<string, unknown>[] = [];

  const db: any = {
    transaction: async (cb: any) => cb(db),
    select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve(opts.companyRows ?? []) }) })),
    execute: vi.fn(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      // Ordem: da query mais específica pra mais genérica — várias dessas
      // tabelas/colunas se sobrepõem em substring, então checar a mais
      // específica primeiro evita que uma capture errado a outra.
      if (/SELECT id, tenant_id, company_id, client_id, motivo, status FROM simples_remessas/i.test(text)) {
        return { rows: opts.originalRow ? [opts.originalRow] : [] };
      }
      if (/stock_applied_at FROM simples_remessas/i.test(text)) {
        return { rows: opts.stockRow ? [opts.stockRow] : [] };
      }
      if (/FROM simples_remessas sr JOIN clients/i.test(text)) {
        return { rows: opts.srRow ? [opts.srRow] : [] };
      }
      if (/material_id, name, ncm_code, quantity, unit_price FROM simples_remessa_items/i.test(text)) {
        return { rows: opts.originalItemsRows ?? [] };
      }
      if (/material_id, quantity FROM simples_remessa_items/i.test(text)) {
        return { rows: opts.remessaItemsForStock ?? [] };
      }
      if (/SELECT \* FROM simples_remessa_items/i.test(text)) {
        return { rows: opts.itemsRows ?? [] };
      }
      if (/SELECT state FROM clients/i.test(text)) {
        return { rows: opts.clientRows ?? [] };
      }
      if (/FROM inventory WHERE tenant_id/i.test(text)) {
        return { rows: opts.inventoryRow ? [opts.inventoryRow] : [] };
      }
      if (/UPDATE inventory SET quantity/i.test(text)) {
        inventoryUpdates.push(text);
        return { rows: [] };
      }
      return { rows: [] };
    }),
    insert: vi.fn((_table: unknown) => ({
      values: (data: Record<string, unknown>) => {
        const isHeader = 'client_id' in data && !('simples_remessa_id' in data);
        const row = isHeader
          ? { id: SR_ID, ...data }
          : { id: 'item-' + (insertedItems.length + 1), ...data };
        if (isHeader) {
          insertedRemessas.push(row);
        } else {
          insertedItems.push(row);
          if ('movement_type' in data) movementInserts.push(row);
        }
        // Thenable diretamente awaitable (usado sem .returning() nos itens)
        // e que também expõe .returning() (usado no header) — mesmo padrão
        // de valuesChain() já usado em materialsImport.test.ts.
        const p: any = Promise.resolve(undefined);
        p.returning = async () => [row];
        return p;
      },
    })),
    update: vi.fn((_table: unknown) => ({
      set: (_data: Record<string, unknown>) => ({ where: () => Promise.resolve(undefined) }),
    })),
  };

  return { db: db as DrizzleDB, insertedRemessas, insertedItems, inventoryUpdates, movementInserts };
}

describe('createSimplesRemessa', () => {
  it('resolve CFOP intra-estadual quando cliente é da mesma UF da empresa', async () => {
    const { db, insertedRemessas, insertedItems } = makeMockDb({
      companyRows: [baseCompanyRow({ uf: 'SP' })],
      clientRows:  [{ state: 'SP' }],
    });

    const sr = await createSimplesRemessa({
      tenantId: TENANT_ID, clientId: CLIENT_ID, motivo: 'conserto',
      items: [{ name: 'Item 1', quantity: 1, unit_price: 100 }],
    }, db);

    expect(sr.cfop).toBe('5915');
    expect(insertedRemessas).toHaveLength(1);
    expect(insertedItems).toHaveLength(1);
  });

  it('resolve CFOP interestadual quando cliente é de UF diferente', async () => {
    const { db } = makeMockDb({
      companyRows: [baseCompanyRow({ uf: 'SP' })],
      clientRows:  [{ state: 'RJ' }],
    });

    const sr = await createSimplesRemessa({
      tenantId: TENANT_ID, clientId: CLIENT_ID, motivo: 'conserto',
      items: [{ name: 'Item 1', quantity: 1, unit_price: 100 }],
    }, db);

    expect(sr.cfop).toBe('6915');
  });

  it('lança erro de domínio quando o motivo é inválido — nunca chega a bater no banco', async () => {
    const { db, insertedRemessas } = makeMockDb({});
    await expect(createSimplesRemessa({
      tenantId: TENANT_ID, clientId: CLIENT_ID, motivo: 'venda',
      items: [{ name: 'Item 1', quantity: 1, unit_price: 100 }],
    }, db)).rejects.toMatchObject({ code: 'remessa_motivo_invalido' });
    expect(insertedRemessas).toHaveLength(0);
  });

  it('lança erro quando o cliente não é encontrado', async () => {
    const { db } = makeMockDb({ companyRows: [baseCompanyRow()], clientRows: [] });
    await expect(createSimplesRemessa({
      tenantId: TENANT_ID, clientId: CLIENT_ID, motivo: 'conserto',
      items: [{ name: 'Item 1', quantity: 1, unit_price: 100 }],
    }, db)).rejects.toMatchObject({ code: 'remessa_cliente_nao_encontrado' });
  });
});

describe('emitSimplesRemessa', () => {
  const originalQueueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
  beforeEach(() => { getSqsClientMock.mockReset(); process.env.NFE_REQUESTS_QUEUE_URL = 'http://localhost/queue'; });
  afterEach(() => {
    if (originalQueueUrl === undefined) delete process.env.NFE_REQUESTS_QUEUE_URL;
    else process.env.NFE_REQUESTS_QUEUE_URL = originalQueueUrl;
  });

  function srRow(overrides: Record<string, unknown> = {}) {
    return {
      id: SR_ID, tenant_id: TENANT_ID, company_id: 'company-1', status: 'draft',
      cfop: '5915', natureza_operacao: 'Remessa para conserto ou reparo',
      person_type: 'PF', full_name: 'Cliente X', client_cpf: '12345678900',
      icms_taxpayer: '9', client_state: 'SP',
      ...overrides,
    };
  }

  it('bloqueia emissão quando a fila não está configurada', async () => {
    delete process.env.NFE_REQUESTS_QUEUE_URL;
    const { db } = makeMockDb({});
    await expect(emitSimplesRemessa(SR_ID, TENANT_ID, db)).rejects.toMatchObject({ code: 'remessa_emissao_nao_configurada' });
  });

  it('lança not_found quando a remessa não existe', async () => {
    const { db } = makeMockDb({ srRow: undefined });
    await expect(emitSimplesRemessa(SR_ID, TENANT_ID, db)).rejects.toMatchObject({ code: 'remessa_not_found' });
  });

  it('bloqueia emissão de itens sem NCM', async () => {
    const { db } = makeMockDb({
      srRow: srRow(), itemsRows: [{ name: 'Item 1', ncm_code: null, quantity: '1', unit_price: '100', total: '100' }],
    });
    await expect(emitSimplesRemessa(SR_ID, TENANT_ID, db)).rejects.toMatchObject({ code: 'remessa_item_sem_ncm' });
  });

  it('emite com sucesso: usa CSOSN 400 para Simples Nacional e zera IBS/CBS', async () => {
    const sendMock = vi.fn().mockResolvedValue({});
    getSqsClientMock.mockReturnValue({ send: sendMock });

    const { db } = makeMockDb({
      srRow: srRow(),
      itemsRows: [{ material_id: null, name: 'Item 1', ncm_code: '12345678', cfop: '5915', quantity: '1', unit_price: '100', total: '100' }],
      companyRows: [baseCompanyRow({ regime_tributario: 1 })],
    });

    const result = await emitSimplesRemessa(SR_ID, TENANT_ID, db);

    expect(result.status).toBe('processing');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentMessage = JSON.parse(sendMock.mock.calls[0][0].input.MessageBody);
    expect(sentMessage.type).toBe('remessa');
    expect(sentMessage.remessa_id).toBe(SR_ID);
    expect(sentMessage.itens[0].icms_csosn).toBe('400');
    expect(sentMessage.itens[0].icms_cst).toBeUndefined();
    expect(sentMessage.itens[0].ibs_aliquota).toBe(0);
    expect(sentMessage.itens[0].cbs_aliquota).toBe(0);
  });

  it('bloqueia emissão em produção sem token configurado', async () => {
    const { db } = makeMockDb({
      srRow: srRow(),
      itemsRows: [{ material_id: null, name: 'Item 1', ncm_code: '12345678', cfop: '5915', quantity: '1', unit_price: '100', total: '100' }],
      companyRows: [baseCompanyRow({ focus_ambiente: 1, focus_token_producao: null })],
    });
    await expect(emitSimplesRemessa(SR_ID, TENANT_ID, db)).rejects.toMatchObject({ code: 'remessa_producao_sem_token' });
  });

  it('bloqueia emitir uma remessa que não está em draft/rejected', async () => {
    const { db } = makeMockDb({
      srRow: srRow({ status: 'authorized' }),
      itemsRows: [{ material_id: null, name: 'Item 1', ncm_code: '12345678', cfop: '5915', quantity: '1', unit_price: '100', total: '100' }],
      companyRows: [baseCompanyRow()],
    });
    await expect(emitSimplesRemessa(SR_ID, TENANT_ID, db)).rejects.toMatchObject({ code: 'invalid_remessa_transition' });
  });
});

describe('registrarRetorno', () => {
  it('bloqueia retorno quando a remessa original não está autorizada', async () => {
    const { db } = makeMockDb({ originalRow: { id: SR_ID, tenant_id: TENANT_ID, company_id: 'company-1', client_id: CLIENT_ID, motivo: 'conserto', status: 'processing' } });
    await expect(registrarRetorno(SR_ID, { tenantId: TENANT_ID }, db)).rejects.toMatchObject({ code: 'remessa_nao_autorizada_para_retorno' });
  });

  it('bloqueia retorno para motivo que não admite (amostra grátis)', async () => {
    const { db } = makeMockDb({
      originalRow: { id: SR_ID, tenant_id: TENANT_ID, company_id: 'company-1', client_id: CLIENT_ID, motivo: 'amostra_gratis', status: 'authorized' },
      companyRows: [baseCompanyRow()],
      clientRows: [{ state: 'SP' }],
    });
    await expect(registrarRetorno(SR_ID, { tenantId: TENANT_ID }, db)).rejects.toMatchObject({ code: 'remessa_motivo_sem_retorno' });
  });

  it('cria o retorno copiando os itens da remessa original quando nenhum item é informado', async () => {
    const { db, insertedRemessas, insertedItems } = makeMockDb({
      originalRow: { id: SR_ID, tenant_id: TENANT_ID, company_id: 'company-1', client_id: CLIENT_ID, motivo: 'conserto', status: 'authorized' },
      companyRows: [baseCompanyRow({ uf: 'SP' })],
      clientRows: [{ state: 'SP' }],
      originalItemsRows: [{ material_id: null, name: 'Item 1', ncm_code: '12345678', quantity: '1', unit_price: '100' }],
    });

    const retorno = await registrarRetorno(SR_ID, { tenantId: TENANT_ID }, db);

    expect(retorno.parent_remessa_id).toBe(SR_ID);
    expect(retorno.cfop).toBe('5916');
    expect(insertedRemessas).toHaveLength(1);
    expect(insertedItems).toHaveLength(1);
  });
});

describe('applyRemessaStockMovement', () => {
  it('é idempotente — não move estoque de novo se stock_applied_at já está setado', async () => {
    const { db, movementInserts } = makeMockDb({ stockRow: { stock_applied_at: '2026-01-01T00:00:00Z' } });
    await applyRemessaStockMovement(SR_ID, TENANT_ID, 'out', db);
    expect(movementInserts).toHaveLength(0);
  });

  it('baixa estoque (out) na saída da remessa', async () => {
    const { db, movementInserts } = makeMockDb({
      stockRow: { stock_applied_at: null },
      remessaItemsForStock: [{ material_id: 'mat-1', quantity: '3' }],
      inventoryRow: { id: 'inv-1', quantity: '10' },
    });
    await applyRemessaStockMovement(SR_ID, TENANT_ID, 'out', db);
    expect(movementInserts).toHaveLength(1);
    expect(movementInserts[0].movement_type).toBe('out');
    expect(movementInserts[0].quantity_before).toBe('10');
    expect(movementInserts[0].quantity_after).toBe('7');
  });

  it('devolve estoque (in) no retorno', async () => {
    const { db, movementInserts } = makeMockDb({
      stockRow: { stock_applied_at: null },
      remessaItemsForStock: [{ material_id: 'mat-1', quantity: '3' }],
      inventoryRow: { id: 'inv-1', quantity: '7' },
    });
    await applyRemessaStockMovement(SR_ID, TENANT_ID, 'in', db);
    expect(movementInserts[0].movement_type).toBe('in');
    expect(movementInserts[0].quantity_after).toBe('10');
  });
});
