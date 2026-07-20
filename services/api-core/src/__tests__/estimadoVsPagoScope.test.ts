// Regressão do bug de escopo: estimadoVsPago agregava por tenant e ignorava a
// empresa, nas DUAS metades (estimado + subquery correlacionada do pago). Num
// tenant multi-empresa isso inflava o "pago" com pagamentos de empresas irmãs
// e SUPRIMIA o alerta de DAS não pago. Um db mockado não executa SQL, então
// aqui serializamos o chunk `sql` gerado (PgDialect) e provamos que o predicado
// de company_id aparece no WHERE externo E na subquery — não só num deles.

import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../db', () => ({ db: {} }));

import { estimadoVsPago } from '../services/apuracaoService';

const dialect = new PgDialect();

/** Captura o chunk sql passado a db.execute e devolve SQL + params ligados. */
async function renderQuery(companyId: string | null): Promise<{ sql: string; params: unknown[] }> {
  let captured: unknown;
  const db = { execute: vi.fn(async (q: unknown) => { captured = q; return { rows: [] }; }) } as any;
  await estimadoVsPago('tenant-1', companyId, db);
  return dialect.sqlToQuery(captured as any);
}

describe('estimadoVsPago — escopo por empresa', () => {
  it('o predicado de company_id existe nas DUAS metades (subquery do pago + WHERE externo)', async () => {
    const { sql } = await renderQuery('company-1');
    // p.company_id na subquery (pago) E a.company_id no WHERE externo (estimado).
    expect(sql).toContain('p.company_id');
    expect(sql).toContain('a.company_id');
  });

  it('com companyId: o id é ligado em ambas as posições (pago e estimado)', async () => {
    const { params } = await renderQuery('company-1');
    // O bug arquivava por tenant e nunca ligava a empresa. Aqui o id tem de
    // aparecer ≥2× nos params (subquery + WHERE externo).
    expect(params.filter((p) => p === 'company-1').length).toBeGreaterThanOrEqual(2);
  });

  it('sem companyId: rollup tenant-wide (os slots de empresa ficam null)', async () => {
    const { params } = await renderQuery(null);
    expect(params.filter((p) => p === null).length).toBeGreaterThanOrEqual(2);
  });
});
