import { describe, it, expect, vi } from 'vitest';
import {
  listVisitFieldDefinitions, createVisitFieldDefinition, updateVisitFieldDefinition, deactivateVisitFieldDefinition,
  setFieldValuesForVisit, getFieldValuesForVisit, ServiceVisitFieldDomainError,
} from '../services/serviceVisitFieldService';

// Mesmo molde de contractFieldService.test.ts — o domínio puro é
// compartilhado (domain/customFields/customFieldDomain.ts), só a tabela e o
// nome da FK mudam (service_visit_id em vez de contract_id).

const TENANT_ID = 'tenant-1';

function baseDef(overrides: Record<string, unknown> = {}) {
  return {
    id: 'def-1', tenant_id: TENANT_ID, field_key: 'tem_internet_no_local', label: 'Tem internet no local?',
    field_type: 'boolean', required: false, sort_order: 0, is_active: true,
    ...overrides,
  };
}

describe('listVisitFieldDefinitions', () => {
  it('ordena por sort_order', async () => {
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([
        baseDef({ id: 'b', sort_order: 2, label: 'B' }),
        baseDef({ id: 'a', sort_order: 1, label: 'A' }),
      ]) }) }),
    };
    const rows = await listVisitFieldDefinitions(TENANT_ID, db);
    expect(rows.map(r => r.id)).toEqual(['a', 'b']);
  });
});

describe('createVisitFieldDefinition', () => {
  it('deriva a chave do label e insere', async () => {
    const inserted: any[] = [];
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }), // sem duplicata
      insert: () => ({ values: (v: any) => { inserted.push(v); return { returning: () => Promise.resolve([{ ...baseDef(), ...v, id: 'def-new' }]) }; } }),
    };
    const row = await createVisitFieldDefinition(TENANT_ID, { label: 'Tem internet no local?', field_type: 'boolean' }, db);
    expect(inserted[0].field_key).toBe('tem_internet_no_local');
    expect(row.id).toBe('def-new');
  });

  it('rejeita quando já existe uma definição com a mesma chave', async () => {
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 'existing' }]) }) }),
    };
    await expect(createVisitFieldDefinition(TENANT_ID, { label: 'Tem internet no local?', field_type: 'boolean' }, db))
      .rejects.toMatchObject({ code: 'field_key_duplicate' });
  });

  it('rejeita field_type inválido antes de tocar o banco', async () => {
    const db: any = { select: vi.fn() };
    await expect(createVisitFieldDefinition(TENANT_ID, { label: 'X', field_type: 'currency' }, db))
      .rejects.toMatchObject({ code: 'field_type_invalid' });
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('updateVisitFieldDefinition', () => {
  it('atualiza label/required/sort_order, nunca aceita field_type no input', async () => {
    let setPayload: any;
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([baseDef()]) }) }),
      update: () => ({ set: (v: any) => { setPayload = v; return { where: () => ({ returning: () => Promise.resolve([{ ...baseDef(), ...v }]) }) }; } }),
    };
    await updateVisitFieldDefinition(TENANT_ID, 'def-1', { label: 'Internet disponível?', required: true }, db);
    expect(setPayload.label).toBe('Internet disponível?');
    expect(setPayload.required).toBe(true);
    expect(setPayload.field_type).toBeUndefined();
  });

  it('404 quando a definição não existe (ou é de outro tenant)', async () => {
    const db: any = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) };
    await expect(updateVisitFieldDefinition(TENANT_ID, 'def-x', { label: 'Y' }, db))
      .rejects.toMatchObject({ code: 'field_not_found' });
  });
});

describe('deactivateVisitFieldDefinition', () => {
  it('soft-delete: seta is_active=false, nunca DELETE físico', async () => {
    let setPayload: any;
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 'def-1' }]) }) }),
      update: () => ({ set: (v: any) => { setPayload = v; return { where: () => Promise.resolve() }; } }),
    };
    await deactivateVisitFieldDefinition(TENANT_ID, 'def-1', db);
    expect(setPayload.is_active).toBe(false);
  });
});

describe('setFieldValuesForVisit', () => {
  it('valida cada valor contra o tipo da definição e insere só os não-nulos', async () => {
    const deleted: any[] = [];
    const inserted: any[] = [];
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([
        baseDef({ id: 'def-1', field_type: 'boolean' }),
        baseDef({ id: 'def-2', field_type: 'text', field_key: 'obs', label: 'Obs' }),
      ]) }) }),
      delete: () => ({ where: (w: any) => { deleted.push(w); return Promise.resolve(); } }),
      insert: () => ({ values: (v: any) => { inserted.push(...v); return Promise.resolve(); } }),
    };

    await setFieldValuesForVisit('visit-1', TENANT_ID, [
      { field_definition_id: 'def-1', value: 'true' },
      { field_definition_id: 'def-2', value: null },
    ], db);

    expect(deleted).toHaveLength(1);
    expect(inserted).toHaveLength(1); // def-2 era null — não insere linha
    expect(inserted[0]).toMatchObject({ service_visit_id: 'visit-1', field_definition_id: 'def-1', value: 'true' });
  });

  it('campo obrigatório sem resposta lança field_value_required (bloqueia conclusão da visita)', async () => {
    const db: any = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([
        baseDef({ id: 'def-1', field_type: 'boolean', required: true }),
      ]) }) }),
      delete: vi.fn(),
      insert: vi.fn(),
    };
    await expect(setFieldValuesForVisit('visit-1', TENANT_ID, [
      { field_definition_id: 'def-1', value: '' },
    ], db)).rejects.toMatchObject({ code: 'field_value_required' });
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('rejeita um field_definition_id que não pertence ao tenant', async () => {
    const db: any = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) };
    await expect(setFieldValuesForVisit('visit-1', TENANT_ID, [
      { field_definition_id: 'def-inexistente', value: 'x' },
    ], db)).rejects.toMatchObject({ code: 'field_not_found' });
  });

  it('não-op quando a lista de valores está vazia', async () => {
    const db: any = { select: vi.fn() };
    await setFieldValuesForVisit('visit-1', TENANT_ID, [], db);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('getFieldValuesForVisit', () => {
  it('devolve os valores já com a definição junto (label, tipo)', async () => {
    const db: any = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve([
              { field_definition_id: 'def-1', field_key: 'tem_internet_no_local', label: 'Tem internet no local?', field_type: 'boolean', required: false, value: 'true' },
            ]),
          }),
        }),
      }),
    };
    const rows = await getFieldValuesForVisit('visit-1', TENANT_ID, db);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('true');
    expect(rows[0].label).toBe('Tem internet no local?');
  });
});

describe('ServiceVisitFieldDomainError export', () => {
  it('é a mesma classe reexportada de CustomFieldDomainError (instanceof funciona nas rotas)', async () => {
    try {
      await createVisitFieldDefinition(TENANT_ID, { label: '', field_type: 'text' }, {} as any);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceVisitFieldDomainError);
    }
  });
});
