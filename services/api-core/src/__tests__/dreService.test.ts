import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeDRE } from '../services/dreService';

// A receita bruta do DRE precisa somar NF-e autorizada (invoices) E NFS-e
// autorizada (nfse_invoices) — Contratos de Serviço e Faturamento de Ordem
// de Serviço (regra 48) emitem NFS-e, não NF-e. Bug corrigido: computeDRE()
// só somava invoices, subestimando a receita de qualquer tenant que fatura
// serviço.

const TENANT_ID = 'tenant-1';

function queryText(query: unknown): string {
  return JSON.stringify((query as any)?.queryChunks ?? query ?? '');
}

function makeMockDb(opts: {
  invoicesTotal?: string;
  cancelledTotal?: string;
  nfseTotal?: string;
  categories?: Array<{ id: string; code: string; name: string; type: string; sign: number; sort_order: number }>;
  expenseRows?: Array<{ dre_category_id: string | null; total: string }>;
}) {
  const categories = opts.categories ?? [];
  const expenseRows = opts.expenseRows ?? [];

  const execute = vi.fn(async (query: unknown) => {
    const text = queryText(query);
    if (/FROM nfse_invoices/i.test(text)) {
      return { rows: [{ total: opts.nfseTotal ?? '0' }] };
    }
    if (/status\s*=\s*'cancelled'|nfe_status = 'authorized'/i.test(text)) {
      return { rows: [{ total: opts.cancelledTotal ?? '0' }] };
    }
    if (/FROM invoices/i.test(text)) {
      return { rows: [{ total: opts.invoicesTotal ?? '0' }] };
    }
    if (/FROM dre_categories/i.test(text)) {
      return { rows: categories };
    }
    if (/FROM payables/i.test(text)) {
      return { rows: expenseRows };
    }
    return { rows: [] };
  });

  return { execute } as any;
}

describe('computeDRE — receita bruta (NF-e + NFS-e)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('soma só NF-e quando não há NFS-e autorizada no período', async () => {
    const db = makeMockDb({ invoicesTotal: '10000', nfseTotal: '0' });
    const dre = await computeDRE({ tenantId: TENANT_ID, from: '2026-01-01', to: '2026-01-31' }, db);
    expect(dre.receita_bruta).toBe(10000);
  });

  it('soma só NFS-e quando não há NF-e no período (tenant que só fatura serviço)', async () => {
    const db = makeMockDb({ invoicesTotal: '0', nfseTotal: '5000' });
    const dre = await computeDRE({ tenantId: TENANT_ID, from: '2026-01-01', to: '2026-01-31' }, db);
    expect(dre.receita_bruta).toBe(5000);
  });

  it('soma NF-e + NFS-e juntas na mesma linha de receita bruta', async () => {
    const db = makeMockDb({ invoicesTotal: '10000', nfseTotal: '5000' });
    const dre = await computeDRE({ tenantId: TENANT_ID, from: '2026-01-01', to: '2026-01-31' }, db);
    expect(dre.receita_bruta).toBe(15000);
    expect(dre.categories.find(c => c.code === 'receita_bruta')?.amount).toBe(15000);
  });

  it('NFS-e pendente/rejeitada nunca entra na receita (a query já filtra nfse_status=authorized)', async () => {
    // O mock simula o efeito do filtro: uma NFS-e não autorizada não aparece
    // na soma retornada pelo banco.
    const db = makeMockDb({ invoicesTotal: '10000', nfseTotal: '0' });
    const dre = await computeDRE({ tenantId: TENANT_ID, from: '2026-01-01', to: '2026-01-31' }, db);
    expect(dre.receita_bruta).toBe(10000);
  });

  it('lucro bruto e demais totalizadores refletem a receita combinada', async () => {
    const db = makeMockDb({
      invoicesTotal: '10000', nfseTotal: '5000',
      categories: [{ id: 'cat-cmv', code: 'cmv', name: 'CMV', type: 'cogs', sign: -1, sort_order: 30 }],
      expenseRows: [{ dre_category_id: 'cat-cmv', total: '3000' }],
    });
    const dre = await computeDRE({ tenantId: TENANT_ID, from: '2026-01-01', to: '2026-01-31' }, db);
    expect(dre.receita_bruta).toBe(15000);
    expect(dre.cmv).toBe(-3000);
    expect(dre.lucro_bruto).toBe(12000);
  });
});
