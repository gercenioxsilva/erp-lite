import { describe, it, expect, vi } from 'vitest';
import {
  listFieldDefinitions, createFieldDefinition, updateFieldDefinition, deactivateFieldDefinition,
  setFieldValuesForContract, getFieldValuesForContract, ContractFieldDomainError,
} from '../services/contractFieldService';

const TENANT_ID = 'tenant-1';

function baseDef(overrides: Record<string, unknown> = {}) {
  return {
    id: 'def-1', tenant_id: TENANT_ID, field_key: 'valor_do_contrato', label: 'Valor do Contrato',
    field_type: 'decimal', required: false, sort_order: 0, is_active: true,
    ...overrides,
  };
}

describe('listFieldDefinitions', () => {
  it('ordena por sort_order', async () => {
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([
        baseDef({ id: 'b', sort_order: 2, label: 'B' }),
        baseDef({ id: 'a', sort_order: 1, label: 'A' }),
      ]) }) }),
    };
    const rows = await listFieldDefinitions(TENANT_ID, db);
    expect(rows.map(r => r.id)).toEqual(['a', 'b']);
  });
});

describe('createFieldDefinition', () => {
  it('deriva a chave do label e insere', async () => {
    const inserted: any[] = [];
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }), // sem duplicata
      insert: () => ({ values: (v: any) => { inserted.push(v); return { returning: () => Promise.resolve([{ ...baseDef(), ...v, id: 'def-new' }]) }; } }),
    };
    const row = await createFieldDefinition(TENANT_ID, { label: 'Valor do Contrato', field_type: 'decimal' }, db);
    expect(inserted[0].field_key).toBe('valor_do_contrato');
    expect(row.id).toBe('def-new');
  });

  it('rejeita quando já existe uma definição com a mesma chave', async () => {
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 'existing' }]) }) }),
    };
    await expect(createFieldDefinition(TENANT_ID, { label: 'Valor do Contrato', field_type: 'decimal' }, db))
      .rejects.toMatchObject({ code: 'field_key_duplicate' });
  });

  it('rejeita field_type inválido antes de tocar o banco', async () => {
    const db: any = { select: vi.fn() };
    await expect(createFieldDefinition(TENANT_ID, { label: 'X', field_type: 'currency' }, db))
      .rejects.toMatchObject({ code: 'field_type_invalid' });
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('updateFieldDefinition', () => {
  it('atualiza label/required/sort_order, nunca aceita field_type no input', async () => {
    let setPayload: any;
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([baseDef()]) }) }),
      update: () => ({ set: (v: any) => { setPayload = v; return { where: () => ({ returning: () => Promise.resolve([{ ...baseDef(), ...v }]) }) }; } }),
    };
    await updateFieldDefinition(TENANT_ID, 'def-1', { label: 'Valor Total', required: true }, db);
    expect(setPayload.label).toBe('Valor Total');
    expect(setPayload.required).toBe(true);
    expect(setPayload.field_type).toBeUndefined();
  });

  it('404 quando a definição não existe (ou é de outro tenant)', async () => {
    const db: any = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) };
    await expect(updateFieldDefinition(TENANT_ID, 'def-x', { label: 'Y' }, db))
      .rejects.toMatchObject({ code: 'field_not_found' });
  });
});

describe('deactivateFieldDefinition', () => {
  it('soft-delete: seta is_active=false, nunca DELETE físico', async () => {
    let setPayload: any;
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 'def-1' }]) }) }),
      update: () => ({ set: (v: any) => { setPayload = v; return { where: () => Promise.resolve() }; } }),
    };
    await deactivateFieldDefinition(TENANT_ID, 'def-1', db);
    expect(setPayload.is_active).toBe(false);
  });
});

describe('setFieldValuesForContract', () => {
  it('valida cada valor contra o tipo da definição e insere só os não-nulos', async () => {
    const deleted: any[] = [];
    const inserted: any[] = [];
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([
        baseDef({ id: 'def-1', field_type: 'decimal' }),
        baseDef({ id: 'def-2', field_type: 'text', field_key: 'obs', label: 'Obs' }),
      ]) }) }),
      delete: () => ({ where: (w: any) => { deleted.push(w); return Promise.resolve(); } }),
      insert: () => ({ values: (v: any) => { inserted.push(...v); return Promise.resolve(); } }),
    };

    await setFieldValuesForContract('contract-1', TENANT_ID, [
      { field_definition_id: 'def-1', value: '1234,56' },
      { field_definition_id: 'def-2', value: null },
    ], db);

    expect(deleted).toHaveLength(1);
    expect(inserted).toHaveLength(1); // def-2 era null — não insere linha
    expect(inserted[0]).toMatchObject({ contract_id: 'contract-1', field_definition_id: 'def-1', value: '1234.56' });
  });

  it('rejeita um field_definition_id que não pertence ao tenant', async () => {
    const db: any = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) };
    await expect(setFieldValuesForContract('contract-1', TENANT_ID, [
      { field_definition_id: 'def-inexistente', value: 'x' },
    ], db)).rejects.toMatchObject({ code: 'field_not_found' });
  });

  it('rejeita um valor inválido pro tipo declarado (nunca insere parcialmente)', async () => {
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([baseDef({ id: 'def-1', field_type: 'decimal' })]) }) }),
      delete: vi.fn(),
      insert: vi.fn(),
    };
    await expect(setFieldValuesForContract('contract-1', TENANT_ID, [
      { field_definition_id: 'def-1', value: 'não é decimal' },
    ], db)).rejects.toMatchObject({ code: 'field_value_invalid_decimal' });
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('não-op quando a lista de valores está vazia', async () => {
    const db: any = { select: vi.fn() };
    await setFieldValuesForContract('contract-1', TENANT_ID, [], db);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('getFieldValuesForContract', () => {
  it('devolve os valores já com a definição junto (label, tipo)', async () => {
    const db: any = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve([
              { field_definition_id: 'def-1', field_key: 'valor_do_contrato', label: 'Valor do Contrato', field_type: 'decimal', required: false, value: '1234.56' },
            ]),
          }),
        }),
      }),
    };
    const rows = await getFieldValuesForContract('contract-1', TENANT_ID, db);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('1234.56');
    expect(rows[0].label).toBe('Valor do Contrato');
  });
});
