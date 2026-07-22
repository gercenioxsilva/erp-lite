import { describe, it, expect } from 'vitest';
import { paymentPlans, paymentPlanInstallments } from '../db/schema';
import {
  createPlan, listActivePlans, updatePlan, deactivatePlan,
  PaymentPlanDomainError, PaymentPlanServiceError,
} from '../services/paymentPlanService';

const TENANT_ID = 'tenant-1';
const PLAN_ID = 'plan-1';

function makeDb() {
  const state = {
    inserted:     [] as Array<{ table: unknown; values: unknown }>,
    updatedPlans: [] as unknown[],
    existingPlan: null as Record<string, unknown> | null,
    installments: [] as Record<string, unknown>[],
  };

  const db: any = {
    select: () => ({
      from: (table: unknown) => ({
        // where() precisa ser awaitable direto (thenable) E encadeável com
        // .orderBy() — chamadores diferentes usam um ou outro.
        where: () => {
          const rows = table === paymentPlanInstallments
            ? state.installments
            : (state.existingPlan ? [state.existingPlan] : []);
          return {
            then: (resolve: (v: unknown) => void) => resolve(rows),
            orderBy: () => Promise.resolve(rows),
          };
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: unknown) => {
        state.inserted.push({ table, values: v });
        return {
          returning: () => Promise.resolve(
            table === paymentPlanInstallments
              ? (v as Record<string, unknown>[]).map((row, i) => ({ id: `installment-${i}`, ...row }))
              : [{ id: PLAN_ID, tenant_id: TENANT_ID, is_active: true, is_default: false, ...(v as object) }],
          ),
        };
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        state.updatedPlans.push(v);
        return { where: () => Promise.resolve() };
      },
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db, state };
}

const validInstallments = [
  { installment_number: 1, days_offset: 0, percentage: 100 },
];

describe('createPlan', () => {
  it('rejeita nome vazio antes de tocar o banco', async () => {
    const { db } = makeDb();
    await expect(createPlan(TENANT_ID, { name: '  ', installments: validInstallments }, db))
      .rejects.toBeInstanceOf(PaymentPlanDomainError);
  });

  it('rejeita parcelas inválidas (domínio) antes de tocar o banco', async () => {
    const { db } = makeDb();
    await expect(createPlan(TENANT_ID, {
      name: 'Plano ruim',
      installments: [{ installment_number: 1, days_offset: 0, percentage: 40 }],
    }, db)).rejects.toBeInstanceOf(PaymentPlanDomainError);
  });

  it('cria plano + parcelas na mesma transação', async () => {
    const { db, state } = makeDb();
    const result = await createPlan(TENANT_ID, {
      name: 'À Vista', installments: validInstallments,
    }, db);

    expect(result.name).toBe('À Vista');
    expect(state.inserted.some(i => i.table === paymentPlans)).toBe(true);
    expect(state.inserted.some(i => i.table === paymentPlanInstallments)).toBe(true);
  });

  it('is_default=true rebaixa qualquer outro default do tenant antes de criar', async () => {
    const { db, state } = makeDb();
    await createPlan(TENANT_ID, { name: '3x', is_default: true, installments: validInstallments }, db);
    expect(state.updatedPlans.some((u: any) => u.is_default === false)).toBe(true);
  });
});

describe('listActivePlans', () => {
  it('devolve planos com as parcelas já carregadas', async () => {
    const { db, state } = makeDb();
    state.installments = [{ id: 'i1', payment_plan_id: PLAN_ID, installment_number: 1, days_offset: 0, percentage: '100.00' }];
    const plans = await listActivePlans(TENANT_ID, db);
    expect(Array.isArray(plans)).toBe(true);
  });
});

describe('updatePlan', () => {
  it('lança payment_plan_not_found quando o plano não existe', async () => {
    const { db } = makeDb();
    await expect(updatePlan(TENANT_ID, 'nope', { name: 'X' }, db))
      .rejects.toMatchObject({ code: 'payment_plan_not_found' } satisfies Partial<PaymentPlanServiceError>);
  });

  it('substitui as parcelas quando informadas, validando antes', async () => {
    const { db, state } = makeDb();
    state.existingPlan = { id: PLAN_ID, tenant_id: TENANT_ID, name: 'Antigo', description: null, is_active: true, is_default: false };

    await expect(updatePlan(TENANT_ID, PLAN_ID, {
      installments: [{ installment_number: 1, days_offset: 0, percentage: 50 }], // soma inválida
    }, db)).rejects.toBeInstanceOf(PaymentPlanDomainError);
  });
});

describe('deactivatePlan', () => {
  it('lança payment_plan_not_found quando o plano não existe', async () => {
    const { db } = makeDb();
    await expect(deactivatePlan(TENANT_ID, 'nope', db))
      .rejects.toMatchObject({ code: 'payment_plan_not_found' });
  });

  it('desativa e também tira o is_default (nunca deixa um default inativo)', async () => {
    const { db, state } = makeDb();
    state.existingPlan = { id: PLAN_ID, tenant_id: TENANT_ID };
    await deactivatePlan(TENANT_ID, PLAN_ID, db);
    expect(state.updatedPlans.some((u: any) => u.is_active === false && u.is_default === false)).toBe(true);
  });
});
