import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('../services/companyService', () => ({ listCompanies: vi.fn() }));
vi.mock('../services/fiscalScoreService', () => ({ computeScore: vi.fn() }));
vi.mock('../services/fiscalClosingService', () => ({ getClosingStatus: vi.fn() }));
vi.mock('../services/apuracaoService', () => ({ listApuracoes: vi.fn() }));
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
      .mockResolvedValueOnce({ run: null, lock: null } as any)
      .mockResolvedValueOnce({ run: { status: 'completed' }, lock: { status: 'locked' } } as any);
    vi.mocked(listApuracoes)
      .mockResolvedValueOnce([{ competencia: '2026-06', das_total: '1000.00' }] as any)
      .mockResolvedValueOnce([{ competencia: '2026-06', das_total: '2000.00' }] as any);

    // now fixo, anterior ao vencimento do DAS da competência 2026-06 (dia 20/07/2026)
    // — sem isso o teste vira "time bomb": passa até o relógio real cruzar essa
    // data e o status computado vira 'atrasado' sozinho, sem nenhuma mudança de código.
    const result = await getCompaniesOverview('tenant-1', mockDb as any, new Date('2026-07-01T12:00:00Z'));

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

    const result = await getCompaniesOverview('tenant-1', mockDb as any);

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
    vi.mocked(getClosingStatus).mockResolvedValue({ run: null, lock: null } as any);
    vi.mocked(listApuracoes).mockResolvedValue([]);

    const result = await getCompaniesOverview('tenant-1', mockDb as any);

    expect(result[0]).toMatchObject({ company_id: 'co-4', has_fiscal_config: true, error: true, score: null });
    expect(result[1]).toMatchObject({ company_id: 'co-5', has_fiscal_config: true, error: false, score: 100 });
  });

  it('falha isolada em hasFiscalConfig não derruba outras empresas', async () => {
    vi.mocked(listCompanies).mockResolvedValue([
      { id: 'co-6', razao_social: 'Empresa Seis' } as any,
      { id: 'co-7', razao_social: 'Empresa Sete' } as any,
    ]);
    // co-6: hasFiscalConfig throws; co-7: tem fiscal_company_config + dasPayments
    mockDb.select
      .mockReturnValueOnce({ from: () => ({ where: vi.fn().mockRejectedValue(new Error('DB error')) }) })
      .mockReturnValueOnce(selectReturning([{ id: 'cfg-7' }]))
      .mockReturnValueOnce(selectReturning([{ id: 'pay-7' }])); // co-7: das da última apuração já foi pago
    vi.mocked(computeScore).mockResolvedValueOnce({
      score: 75,
      breakdown: [],
      findings: [{ rule: 'missing_doc', severity: 'info', title: 'x' }],
      computedAt: '',
    } as any);
    vi.mocked(getClosingStatus).mockResolvedValueOnce({ run: null, lock: null } as any);
    vi.mocked(listApuracoes).mockResolvedValueOnce([{ competencia: '2026-06', das_total: '500.00' }] as any);

    const result = await getCompaniesOverview('tenant-1', mockDb as any);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      company_id: 'co-6', company_name: 'Empresa Seis', has_fiscal_config: true,
      score: null, alerts: null, competencia_atual: null, das: null, error: true,
    });
    expect(result[1]).toMatchObject({
      company_id: 'co-7', company_name: 'Empresa Sete', has_fiscal_config: true,
      score: 75, error: false,
      alerts: { critical: 0, warning: 0, info: 1 },
    });
  });
});
