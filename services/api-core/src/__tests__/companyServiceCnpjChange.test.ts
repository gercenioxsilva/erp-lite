import { describe, it, expect, vi } from 'vitest';
import { updateCompany, upsertDefaultCompany } from '../services/companyService';

// Bug real de produção: trocar o CNPJ de uma empresa sem informar um token
// novo mantinha o token antigo (emitido pelo emissor fiscal pra outro CNPJ)
// — toda emissão seguinte era rejeitada com "CNPJ do emitente não
// autorizado", sem nenhum aviso na hora da troca. CNPJ mudado precisa
// descartar todo o estado de integração fiscal amarrado ao CNPJ antigo.

const TENANT_ID  = 'tenant-1';
const COMPANY_ID = 'company-1';

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPANY_ID, tenant_id: TENANT_ID, is_default: true, is_active: true,
    cnpj: '11444777000161', razao_social: 'Empresa Antiga Ltda',
    logradouro: 'Rua A', numero: '1', bairro: 'Centro', municipio: 'SAO PAULO', uf: 'SP', cep: '01000000',
    regime_tributario: 1, focus_ambiente: 2,
    focus_token_homologacao: 'hml-token-antigo', focus_token_producao: 'prod-token-antigo',
    fiscal_integration_ref: 'focus-empresa-antiga', fiscal_registration_status: 'registered',
    fiscal_registration_error: null, certificado_cnpj: '11444777000161',
    certificado_valido_de: '2026-01-01', certificado_valido_ate: '2027-01-01',
    emite_nfe: true, emite_nfse: true,
    ...overrides,
  };
}

function makeSelectDb(selectSequence: unknown[][]) {
  let call = 0;
  let setPayload: Record<string, unknown> | undefined;
  const db: any = {
    select: vi.fn(() => ({
      from: () => ({ where: () => Promise.resolve(selectSequence[call++] ?? []) }),
    })),
    update: vi.fn(() => ({
      set: (data: Record<string, unknown>) => {
        setPayload = data;
        return { where: () => ({ returning: () => Promise.resolve([{ ...baseRow(), ...data }]) }) };
      },
    })),
  };
  return { db, getSetPayload: () => setPayload };
}

describe('updateCompany — troca de CNPJ descarta o estado fiscal antigo', () => {
  it('mantém os tokens quando o CNPJ não muda', async () => {
    const { db, getSetPayload } = makeSelectDb([[baseRow()]]);
    await updateCompany(TENANT_ID, COMPANY_ID, { razao_social: 'Novo Nome' } as any, db);

    const set = getSetPayload()!;
    expect(set.focus_token_producao).toBe('prod-token-antigo');
    expect(set.focus_token_homologacao).toBe('hml-token-antigo');
    expect(set.fiscal_integration_ref).toBeUndefined(); // nem tocado
  });

  it('descarta tokens e estado de integração fiscal quando o CNPJ muda, sem token novo informado', async () => {
    const { db, getSetPayload } = makeSelectDb([
      [baseRow()],   // resolveCompanyId
      [baseRow()],   // listAllCompanies (checagem de duplicidade)
    ]);
    await updateCompany(TENANT_ID, COMPANY_ID, { cnpj: 'B2C3D4E5F6G185' } as any, db);

    const set = getSetPayload()!;
    expect(set.focus_token_producao).toBeNull();
    expect(set.focus_token_homologacao).toBeNull();
    expect(set.fiscal_integration_ref).toBeNull();
    expect(set.fiscal_registration_status).toBeNull();
    expect(set.certificado_cnpj).toBeNull();
    expect(set.certificado_valido_ate).toBeNull();
  });

  it('usa o token novo informado junto com a troca de CNPJ, em vez de limpar', async () => {
    const { db, getSetPayload } = makeSelectDb([
      [baseRow()],
      [baseRow()],
    ]);
    await updateCompany(TENANT_ID, COMPANY_ID, {
      cnpj: 'B2C3D4E5F6G185', focus_token_producao: 'prod-token-novo',
    } as any, db);

    const set = getSetPayload()!;
    expect(set.focus_token_producao).toBe('prod-token-novo');
    // Homologação não foi informado — ainda é limpo (CNPJ mudou).
    expect(set.focus_token_homologacao).toBeNull();
  });
});

describe('upsertDefaultCompany — mesma trava no fluxo legado PUT /v1/nfe-config', () => {
  it('descarta tokens e estado de integração fiscal quando o CNPJ muda', async () => {
    const { db, getSetPayload } = makeSelectDb([[baseRow()]]); // getDefaultCompany
    await upsertDefaultCompany(TENANT_ID, {
      cnpj: 'B2C3D4E5F6G185', razao_social: 'Empresa Antiga Ltda',
      logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '01000000',
    } as any, db);

    const set = getSetPayload()!;
    expect(set.focus_token_producao).toBeNull();
    expect(set.focus_token_homologacao).toBeNull();
    expect(set.fiscal_integration_ref).toBeNull();
  });

  it('mantém os tokens quando o CNPJ não muda', async () => {
    const { db, getSetPayload } = makeSelectDb([[baseRow()]]);
    await upsertDefaultCompany(TENANT_ID, {
      cnpj: baseRow().cnpj as string, razao_social: 'Novo Nome',
      logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '01000000',
    } as any, db);

    const set = getSetPayload()!;
    expect(set.focus_token_producao).toBe('prod-token-antigo');
    expect(set.fiscal_integration_ref).toBeUndefined();
  });
});
