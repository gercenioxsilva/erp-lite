// E4: guard da trava de competência (helper único de enforcement).

import { describe, it, expect, vi } from 'vitest';
import { assertCompetenciaAberta, FiscalLockError } from '../services/fiscalPeriodLockGuard';

const makeDb = (locked: boolean) => ({
  select: vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => (locked ? [{ id: 'lock1' }] : []) }) }),
  })),
}) as any;

describe('assertCompetenciaAberta', () => {
  it('competência aberta passa', async () => {
    await expect(assertCompetenciaAberta('t1', 'co1', '2026-07', makeDb(false))).resolves.toBeUndefined();
  });

  it('competência travada lança erro tipado (→422 na rota)', async () => {
    try {
      await assertCompetenciaAberta('t1', 'co1', '2026-07', makeDb(true));
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(FiscalLockError);
      expect(e.code).toBe('competencia_travada');
      expect(e.payload.competencia).toBe('2026-07');
    }
  });

  it('fato sem company (companyId null) também é bloqueado por lock do tenant', async () => {
    await expect(assertCompetenciaAberta('t1', null, '2026-07', makeDb(true)))
      .rejects.toBeInstanceOf(FiscalLockError);
  });
});
