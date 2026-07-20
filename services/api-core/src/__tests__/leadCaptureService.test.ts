import { describe, it, expect, vi } from 'vitest';
import { findOrCreateLeadClient, LeadCaptureDomainError } from '../services/leadCaptureService';

const TENANT_ID = 'tenant-1';

function makeDb(opts: { existing?: Record<string, unknown> | null }) {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const db: any = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(opts.existing ? [opts.existing] : []) }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => {
      inserted.push(v);
      return { returning: () => Promise.resolve([{ id: 'new-client-1', ...v }]) };
    } }),
    update: () => ({ set: (v: Record<string, unknown>) => {
      updated.push(v);
      return { where: () => ({ returning: () => Promise.resolve([{ ...opts.existing, ...v }]) }) };
    } }),
  };
  return { db, inserted, updated };
}

describe('findOrCreateLeadClient', () => {
  it('cria um cliente novo com origin=landing_page quando não há duplicata', async () => {
    const { db, inserted } = makeDb({ existing: null });
    const result = await findOrCreateLeadClient(TENANT_ID, { name: 'Ana', email: 'ana@ex.com' }, db);

    expect(result.created).toBe(true);
    expect(inserted[0]).toMatchObject({
      tenant_id: TENANT_ID, person_type: 'PF', full_name: 'Ana',
      email: 'ana@ex.com', origin: 'landing_page', icms_taxpayer: '9',
    });
  });

  it('rejeita entrada inválida antes de tocar o banco (domínio)', async () => {
    const { db } = makeDb({ existing: null });
    await expect(findOrCreateLeadClient(TENANT_ID, { name: 'Ana' }, db))
      .rejects.toBeInstanceOf(LeadCaptureDomainError);
  });

  it('mescla com o cliente existente pelo CNPJ, em vez de duplicar', async () => {
    const existing = { id: 'client-1', cnpj: '11444777000161', phone: null, email: null, company_name: 'Acme', notes: null };
    const { db, inserted, updated } = makeDb({ existing });
    const result = await findOrCreateLeadClient(TENANT_ID, {
      name: 'Acme', cnpj: '11.444.777/0001-61', phone: '11999999999',
    }, db);

    expect(result.created).toBe(false);
    expect(inserted).toHaveLength(0);
    expect(updated[0].phone).toBe('11999999999'); // preenchia vazio
  });

  it('mescla com o cliente existente pelo e-mail quando nenhum dos dois tem documento', async () => {
    const existing = { id: 'client-1', cnpj: null, cpf: null, email: 'ana@ex.com', phone: null, company_name: null, notes: null };
    const { db, inserted, updated } = makeDb({ existing });
    const result = await findOrCreateLeadClient(TENANT_ID, { name: 'Ana', email: 'ANA@EX.COM', phone: '11988887777' }, db);

    expect(result.created).toBe(false);
    expect(inserted).toHaveLength(0);
    expect(updated[0].phone).toBe('11988887777');
  });

  it('nunca sobrescreve um campo já preenchido no cliente existente (merge, não substitui)', async () => {
    const existing = { id: 'client-1', cnpj: null, cpf: null, email: 'ana@ex.com', phone: '11900000000', company_name: null, notes: 'Observação antiga' };
    const { db, updated } = makeDb({ existing });
    await findOrCreateLeadClient(TENANT_ID, { name: 'Ana', email: 'ana@ex.com', phone: '11999999999', message: 'Mensagem nova' }, db);

    expect(updated[0].phone).toBe('11900000000'); // mantém o valor já existente
    expect(updated[0].notes).toBe('Observação antiga');
  });

  it('sem CNPJ nem e-mail (só telefone), sempre cria um registro novo — sem chave de dedup confiável', async () => {
    const { db, inserted } = makeDb({ existing: null });
    const result = await findOrCreateLeadClient(TENANT_ID, { name: 'Ana', phone: '11999999999' }, db);

    expect(result.created).toBe(true);
    expect(inserted[0].phone).toBe('11999999999');
    expect(inserted[0].email).toBeNull();
  });

  it('infere PJ e monta consumer_type/icms_taxpayer default nunca inferidos do tenant', async () => {
    const { db, inserted } = makeDb({ existing: null });
    await findOrCreateLeadClient(TENANT_ID, { name: 'Acme', email: 'contato@acme.com', company_name: 'Acme Ltda' }, db);

    expect(inserted[0]).toMatchObject({ person_type: 'PJ', consumer_type: '0', icms_taxpayer: '9' });
  });
});
