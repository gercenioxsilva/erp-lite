// Resolução do RBT12: ledger (12 competências ANTERIORES, com
// proporcionalização de início de atividade) vs. bootstrap manual do cadastro.
// O ponto sensível é a transição: quem migra pro ERP com o ledger vazio depende
// do rbt12_manual até acumular 12 meses de histórico — e a 1ª nota emitida no
// mês não pode derrubar esse fallback (a receita do próprio mês nunca forma o
// seu RBT12).

import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { resolveRbt12 } from '../services/fiscalRevenueService';
import { SimplesDomainError } from '../domain/simples/simplesDomain';

const TENANT = 'tenant-1';
const COMPANY = 'company-1';
const COMPETENCIA = '2026-07';

/** db fake: o único SELECT do resolver é a receita por competência. */
const dbWithRevenue = (rows: Array<{ competencia: string; total: string }>) =>
  ({ execute: vi.fn(async () => ({ rows })) }) as any;

/** Empresa estabelecida (>12 meses de atividade) migrando pro ERP. */
const configEstabelecida = (over: Record<string, unknown> = {}) => ({
  data_abertura: '2019-06-01',
  rbt12_manual: '300000.00',
  receita_acumulada_abertura: null,
  ...over,
}) as any;

describe('resolveRbt12', () => {
  it('soma as 12 competências anteriores quando a janela tem receita', async () => {
    const db = dbWithRevenue([
      { competencia: '2026-06', total: '100000.00' },
      { competencia: '2026-05', total: '200000.00' },
    ]);

    const result = await resolveRbt12(TENANT, COMPANY, COMPETENCIA, configEstabelecida(), db);

    expect(result).toEqual({ rbt12: 300000, source: 'ledger' });
  });

  it('usa o bootstrap manual quando o ledger só tem receita da PRÓPRIA competência', async () => {
    // Empresa estabelecida, ledger vazio, primeira nota emitida no mês corrente.
    // A receita do próprio mês não entra no seu RBT12 — a janela anterior segue
    // vazia, então o cadastro continua sendo a única fonte válida.
    const db = dbWithRevenue([{ competencia: COMPETENCIA, total: '5000.00' }]);

    const result = await resolveRbt12(TENANT, COMPANY, COMPETENCIA, configEstabelecida(), db);

    expect(result).toEqual({ rbt12: 300000, source: 'manual' });
  });

  it('cai para receita_acumulada_abertura quando não há rbt12_manual', async () => {
    const db = dbWithRevenue([{ competencia: COMPETENCIA, total: '5000.00' }]);
    const config = configEstabelecida({ rbt12_manual: null, receita_acumulada_abertura: '180000.00' });

    const result = await resolveRbt12(TENANT, COMPANY, COMPETENCIA, config, db);

    expect(result).toEqual({ rbt12: 180000, source: 'manual' });
  });

  it('preserva a proporcionalização do 1º mês de atividade (receita × 12)', async () => {
    // Empresa nova: o ledger MANDA mesmo com receita só no mês corrente, porque
    // a proporcionalização de início de atividade produz um RBT12 real.
    const db = dbWithRevenue([{ competencia: COMPETENCIA, total: '5000.00' }]);
    const config = configEstabelecida({ data_abertura: '2026-07-01' });

    const result = await resolveRbt12(TENANT, COMPANY, COMPETENCIA, config, db);

    expect(result).toEqual({ rbt12: 60000, source: 'ledger' });
  });

  it('falha tipada quando não há ledger utilizável nem bootstrap manual', async () => {
    const db = dbWithRevenue([]);
    const config = configEstabelecida({ rbt12_manual: null, receita_acumulada_abertura: null });

    await expect(resolveRbt12(TENANT, COMPANY, COMPETENCIA, config, db))
      .rejects.toBeInstanceOf(SimplesDomainError);
  });
});
