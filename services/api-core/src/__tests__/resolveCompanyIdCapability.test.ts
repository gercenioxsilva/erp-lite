import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveCompanyId, CompanyDomainError } from '../services/companyService';

// resolveCompanyId() com docType (regra 53) — cobre os 4 ramos de resolução
// documentados no README: empresa padrão qualifica; único candidato não
// padrão; nenhum candidato; múltiplos candidatos ambíguos. Também cobre que
// docType omitido preserva o comportamento anterior a esta regra (usado por
// tax.ts/bankAccountService.ts/marketplaceConnectionService.ts).

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = 'tenant-1';

function selectOnce(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(rows) };
}

function company(overrides: Record<string, unknown> = {}) {
  return {
    id: 'company-1', tenant_id: TENANT_ID, is_default: false, is_active: true,
    emite_nfe: true, emite_nfse: true,
    ...overrides,
  };
}

describe('resolveCompanyId — docType omitido (comportamento anterior à regra 53, inalterado)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sem companyId, sem docType: devolve a empresa padrão, mesmo se ela não tiver nenhuma capacidade', () => {
    mockDb.select.mockReturnValueOnce(selectOnce([
      company({ id: 'default-co', is_default: true, emite_nfe: false, emite_nfse: false }),
    ]));
    return expect(resolveCompanyId(TENANT_ID, null, mockDb as any)).resolves.toMatchObject({ id: 'default-co' });
  });

  it('com companyId, sem docType: valida só posse/is_active, nunca capacidade', () => {
    mockDb.select.mockReturnValueOnce(selectOnce([
      company({ id: 'company-x', emite_nfe: false, emite_nfse: false }),
    ]));
    return expect(resolveCompanyId(TENANT_ID, 'company-x', mockDb as any)).resolves.toMatchObject({ id: 'company-x' });
  });
});

describe('resolveCompanyId — companyId explícito + docType', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolve normalmente quando a empresa tem a capacidade pedida', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([company({ id: 'company-x', emite_nfse: true })]));
    const result = await resolveCompanyId(TENANT_ID, 'company-x', mockDb as any, 'nfse');
    expect(result.id).toBe('company-x');
  });

  it('lança company_missing_capability quando a empresa não tem a capacidade pedida', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([company({ id: 'company-x', emite_nfse: false })]));
    await expect(resolveCompanyId(TENANT_ID, 'company-x', mockDb as any, 'nfse'))
      .rejects.toMatchObject({ code: 'company_missing_capability' });
  });

  it('lança company_not_found quando a empresa não existe/não pertence ao tenant', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([]));
    await expect(resolveCompanyId(TENANT_ID, 'ghost', mockDb as any, 'nfe'))
      .rejects.toMatchObject({ code: 'company_not_found' });
  });
});

describe('resolveCompanyId — companyId omitido + docType (fallback em 4 ramos)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ramo 1: a empresa padrão já tem a capacidade — resolve pra ela', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([
      company({ id: 'default-co', is_default: true, emite_nfe: true, emite_nfse: true }),
      company({ id: 'other-co',   is_default: false, emite_nfe: true, emite_nfse: false }),
    ]));
    const result = await resolveCompanyId(TENANT_ID, null, mockDb as any, 'nfe');
    expect(result.id).toBe('default-co');
  });

  it('ramo 2: a padrão não tem a capacidade, mas só UMA outra empresa tem — resolve sozinho, sem ambiguidade', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([
      company({ id: 'default-co', is_default: true, emite_nfe: true, emite_nfse: false }),
      company({ id: 'nfse-co',    is_default: false, emite_nfe: false, emite_nfse: true }),
    ]));
    const result = await resolveCompanyId(TENANT_ID, null, mockDb as any, 'nfse');
    expect(result.id).toBe('nfse-co');
  });

  it('ramo 3: nenhuma empresa do tenant tem a capacidade — no_company_for_doc_type', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([
      company({ id: 'default-co', is_default: true, emite_nfe: true, emite_nfse: false }),
    ]));
    await expect(resolveCompanyId(TENANT_ID, null, mockDb as any, 'nfse'))
      .rejects.toMatchObject({ code: 'no_company_for_doc_type' });
  });

  it('ramo 4: mais de uma empresa qualifica e nenhuma é a padrão — company_selection_required (nunca escolhe sozinho)', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([
      company({ id: 'default-co', is_default: true, emite_nfe: true, emite_nfse: false }),
      company({ id: 'nfse-co-a',  is_default: false, emite_nfe: false, emite_nfse: true }),
      company({ id: 'nfse-co-b',  is_default: false, emite_nfe: false, emite_nfse: true }),
    ]));
    await expect(resolveCompanyId(TENANT_ID, null, mockDb as any, 'nfse'))
      .rejects.toMatchObject({ code: 'company_selection_required' });
  });

  it('tenant com 1 empresa só (default true/true) — comportamento idêntico a antes da regra 53', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([
      company({ id: 'only-co', is_default: true, emite_nfe: true, emite_nfse: true }),
    ]));
    const nfe  = await resolveCompanyId(TENANT_ID, null, mockDb as any, 'nfe');
    expect(nfe.id).toBe('only-co');
  });
});

describe('CompanyDomainError instance check', () => {
  it('erros de resolveCompanyId são instâncias de CompanyDomainError', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([]));
    try {
      await resolveCompanyId(TENANT_ID, 'ghost', mockDb as any, 'nfe');
      expect.fail('esperava lançar');
    } catch (err) {
      expect(err).toBeInstanceOf(CompanyDomainError);
    }
  });
});
