// E7: guardas do endpoint determinístico de emissão avulsa. O modelo nunca
// chega aqui — mas o payload que a UI envia é revalidado server-side.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { resolveCompanyMock, readinessMock, lockMock } = vi.hoisted(() => ({
  resolveCompanyMock: vi.fn(),
  readinessMock: vi.fn(),
  lockMock: vi.fn(),
}));

vi.mock('../services/companyService', () => ({
  resolveCompanyId: resolveCompanyMock,
  CompanyDomainError: class CompanyDomainError extends Error {},
}));
vi.mock('../services/fiscalCompanyConfigService', () => ({
  getEmissionReadiness: readinessMock,
  getOrCreateConfig: vi.fn(async () => ({ nfse_provider: 'abrasf' })),
}));
vi.mock('../services/fiscalPeriodLockGuard', () => ({
  assertCompetenciaAberta: lockMock,
  FiscalLockError: class FiscalLockError extends Error { code = 'competencia_travada'; },
}));
vi.mock('../services/nfseProviderService', () => ({ enqueueAbrasfEmission: vi.fn(async () => ({ enqueued: true, simulated: true })) }));
vi.mock('../services/fiscalAuditService', () => ({ record: vi.fn(async () => ({ duplicate: false })) }));

import { createAndEmitNfse, NfseCreateError } from '../services/nfseCreateService';

const TENANT = 'tenant-1';

/** db fake: selects devolvem linhas na ordem enfileirada. */
function queuedDb(selectRows: any[][]) {
  const q = [...selectRows];
  const chain = { from: () => chain, where: () => Promise.resolve(q.shift() ?? []) } as any;
  return {
    select: () => chain,
    execute: vi.fn(async () => ({ rows: [] })),
    transaction: vi.fn(),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  } as any;
}

const CLIENT = { id: 'client-1', tenant_id: TENANT, person_type: 'PJ', company_name: 'ACME' };

beforeEach(() => {
  resolveCompanyMock.mockReset();
  resolveCompanyMock.mockResolvedValue({ id: 'comp-1', aliquota_iss_padrao: '5', codigo_servico_padrao: '0107' });
  readinessMock.mockReset(); readinessMock.mockResolvedValue({ ready: true, reasons: [] });
  lockMock.mockReset(); lockMock.mockResolvedValue(undefined);
});

describe('createAndEmitNfse — guardas', () => {
  it('valor <= 0 recusa ANTES de tocar o banco', async () => {
    const db = { select: () => { throw new Error('não deveria consultar'); } } as any;
    await expect(createAndEmitNfse(TENANT, { clientId: 'x', amount: 0, description: 'y' }, null, db))
      .rejects.toMatchObject({ code: 'invalid_amount' });
  });

  it('cliente de outro tenant → client_not_found', async () => {
    const db = queuedDb([[]]); // client lookup vazio
    await expect(createAndEmitNfse(TENANT, { clientId: 'estranho', amount: 100, description: 'y' }, null, db))
      .rejects.toMatchObject({ code: 'client_not_found' });
  });

  it('cadastro incompleto → emission_not_ready com reasons', async () => {
    readinessMock.mockResolvedValue({ ready: false, reasons: ['certificate_missing'] });
    const db = queuedDb([[CLIENT]]);
    await expect(createAndEmitNfse(TENANT, { clientId: 'client-1', amount: 100, description: 'y' }, null, db))
      .rejects.toMatchObject({ code: 'emission_not_ready', payload: { reasons: ['certificate_missing'] } });
  });

  it('competência travada propaga o erro do guard', async () => {
    lockMock.mockRejectedValue(Object.assign(new Error('lock'), { code: 'competencia_travada' }));
    const db = queuedDb([[CLIENT]]);
    await expect(createAndEmitNfse(TENANT, { clientId: 'client-1', amount: 100, description: 'y' }, null, db))
      .rejects.toMatchObject({ code: 'competencia_travada' });
  });

  it('sem código de serviço resolvível → service_code_missing', async () => {
    resolveCompanyMock.mockResolvedValue({ id: 'comp-1', aliquota_iss_padrao: '5', codigo_servico_padrao: null });
    // client lookup + lastEmissionDefaults(execute→sem linhas): serviceCode fica vazio.
    const db = queuedDb([[CLIENT]]);
    await expect(createAndEmitNfse(TENANT, { clientId: 'client-1', amount: 100, description: 'y' }, null, db))
      .rejects.toMatchObject({ code: 'service_code_missing' });
  });

  it('NfseCreateError é a classe exportada esperada', () => {
    expect(new NfseCreateError('invalid_amount').name).toBe('NfseCreateError');
  });
});
