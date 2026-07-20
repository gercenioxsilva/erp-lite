// Segurança LEGAL da transmissão. O caso que separa este módulo de uma emissão
// qualquer: um timeout DEPOIS que os bytes do Declarar saíram pode ter valido —
// então o status vira failed_unknown (TERMINAL, reconciliar via consulta),
// NUNCA failed (que convidaria a um retry que duplicaria a declaração).
// DB e SERPRO mockados; a verificação de ponta a ponta exige o trial SERPRO.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/fiscalCompanyConfigService', () => ({
  getOrCreateConfig: vi.fn(async () => ({
    company_id: 'co-1', enquadramento: 'ME', optante_simples: true, iss_fixo: false,
    iss_retido_padrao: false, regime_apuracao: 'competencia', data_abertura: '2024-01-01',
    fator_r_aplicavel: true, anexo_padrao: 3,
  })),
}));
vi.mock('../services/fiscalRevenueService', () => ({
  revenueByCompetencia: vi.fn(async () => {
    // janela completa 2025-02..2026-01 com receita (ledger completo → ready)
    const map: Record<string, number> = {};
    for (let m = 2; m <= 13; m++) {
      const yy = m <= 12 ? 2025 : 2026; const mm = ((m - 1) % 12) + 1;
      map[`${yy}-${String(mm).padStart(2, '0')}`] = 2800;
    }
    return map;
  }),
  revenueForCompetenciaByAnexo: vi.fn(async () => [{ anexo: 3, receita: 2800, comRetencao: 0 }]),
}));
vi.mock('../services/apuracaoService', () => ({
  folha12m: vi.fn(async () => ({ total: 12000, meses: 12, porCompetencia: [{ competencia: '2026-01', valor: 1000 }] })),
}));
vi.mock('../services/fiscalAuditService', () => ({ record: vi.fn(async () => ({ duplicate: false, event: null })) }));
vi.mock('../lib/pgErrors', () => ({ isUniqueConstraintViolation: (e: any) => e?.code === '23505' }));

import { transmitir } from '../services/pgdasdService';
import type { HttpTransport } from '../lib/serproClient';
import { simplesApuracao, nfeConfigs } from '../db/schema';

const APU = {
  id: 'apu-1', tenant_id: 't-1', company_id: 'co-1', competencia: '2026-02',
  receita_competencia: '2800.00', das_total: '168.00', rbt12_source: 'ledger', sublimite_excedido: false,
  valor_irpj: '6.72', valor_csll: '5.88', valor_cofins: '21.54', valor_pis: '4.67',
  valor_cpp: '72.91', valor_icms: '0', valor_ipi: '0', valor_iss: '56.28',
};
const NFE = { id: 'co-1', cnpj: '48.994.778/0001-90', inscricao_municipal: '12345' };

/** db fake: select por tabela; insert.returning; update captura os set(). */
function makeDb(updates: any[], insertBehavior: 'ok' | 'unique' = 'ok') {
  const selectFrom = (t: any) => ({
    where: async () => (t === simplesApuracao ? [APU] : t === nfeConfigs ? [NFE] : []),
  });
  const insertResult = (rows: any[]) => {
    const p: any = Promise.resolve(rows);
    p.returning = async () => rows;
    return p;
  };
  return {
    select: () => ({ from: selectFrom }),
    insert: (_t: any) => ({
      values: (v: any) => {
        if (insertBehavior === 'unique') { const e: any = new Error('dup'); e.code = '23505'; throw e; }
        return insertResult([{ id: 'tx-1', ...v }]);
      },
    }),
    update: (_t: any) => ({ set: (v: any) => { updates.push(v); return { where: async () => [] }; } }),
  } as any;
}

const okConsulta = { status: 200, body: JSON.stringify({ status: 200, dados: JSON.stringify([]) }) };
const authOk = { status: 200, body: JSON.stringify({ access_token: 'tok', jwt_token: 'j', expires_in: 2008 }) };

beforeAll(() => {
  process.env.SERPRO_CONSUMER_KEY = 'ck'; process.env.SERPRO_CONSUMER_SECRET = 'cs';
  process.env.SERPRO_MTLS_PFX_BASE64 = Buffer.from('pfx').toString('base64');
  process.env.SERPRO_MTLS_PFX_PASSWORD = 'pw'; process.env.SERPRO_ENV = 'trial';
});
afterAll(() => {
  delete process.env.SERPRO_CONSUMER_KEY; delete process.env.SERPRO_CONSUMER_SECRET;
  delete process.env.SERPRO_MTLS_PFX_BASE64; delete process.env.SERPRO_MTLS_PFX_PASSWORD; delete process.env.SERPRO_ENV;
});

describe('transmitir — segurança do ato irreversível', () => {
  it('timeout/erro de rede no Declarar → failed_unknown (nunca failed)', async () => {
    const updates: any[] = [];
    const db = makeDb(updates);
    const transport: HttpTransport = async (req) => {
      if (req.url.includes('/authenticate')) return authOk;
      if (req.url.includes('/Consultar')) return okConsulta;
      throw new Error('ETIMEDOUT'); // erro de rede no /Declarar (bytes podem ter valido)
    };
    await expect(transmitir('t-1', 'apu-1', 'u-1', db, transport)).rejects.toThrow();
    const statuses = updates.map((u) => u.status).filter(Boolean);
    expect(statuses).toContain('failed_unknown');
    expect(statuses).not.toContain('failed');
    // e NUNCA chega a 'confirmed'
    expect(statuses).not.toContain('confirmed');
  });

  it('rejeição determinística (HTTP 422) no Declarar → failed (não failed_unknown)', async () => {
    const updates: any[] = [];
    const db = makeDb(updates);
    const transport: HttpTransport = async (req) => {
      if (req.url.includes('/authenticate')) return authOk;
      if (req.url.includes('/Consultar')) return okConsulta;
      return { status: 422, body: JSON.stringify({ mensagens: [{ codigo: 'erro' }] }) };
    };
    await expect(transmitir('t-1', 'apu-1', 'u-1', db, transport)).rejects.toThrow();
    const statuses = updates.map((u) => u.status).filter(Boolean);
    expect(statuses).toContain('failed');
    expect(statuses).not.toContain('failed_unknown');
  });

  it('sucesso → persiste numero_declaracao e status confirmed', async () => {
    const updates: any[] = [];
    const db = makeDb(updates);
    const transport: HttpTransport = async (req) => {
      if (req.url.includes('/authenticate')) return authOk;
      if (req.url.includes('/Consultar')) return okConsulta;
      return { status: 200, body: JSON.stringify({ status: 200, dados: JSON.stringify([{ numeroDeclaracao: 'DEC-999' }]) }) };
    };
    const res = await transmitir('t-1', 'apu-1', 'u-1', db, transport);
    expect(res.status).toBe('confirmed');
    expect(res.numeroDeclaracao).toBe('DEC-999');
    const confirmUpdate = updates.find((u) => u.status === 'confirmed');
    expect(confirmUpdate.numero_declaracao).toBe('DEC-999');
  });

  it('duplo-clique concorrente (UNIQUE em-voo) → transmissao_em_andamento', async () => {
    const updates: any[] = [];
    const db = makeDb(updates, 'unique');
    const transport: HttpTransport = async (req) =>
      req.url.includes('/authenticate') ? authOk : okConsulta;
    await expect(transmitir('t-1', 'apu-1', 'u-1', db, transport))
      .rejects.toMatchObject({ code: 'transmissao_em_andamento' });
  });
});
