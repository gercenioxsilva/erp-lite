// Orquestração de I/O — Plano de Pagamento (migration 0086, regra 75).
// Plano (payment_plans) e parcelas (payment_plan_installments) são sempre
// escritos juntos, na mesma transação — um plano nunca existe sem pelo
// menos 1 parcela (validado no domínio antes de tocar o banco), mesmo
// padrão de definições+valores em contractFieldService.ts.

import { eq, and, asc } from 'drizzle-orm';
import { db as _db } from '../db';
import { paymentPlans, paymentPlanInstallments } from '../db/schema';
import {
  validatePaymentPlanInstallments, PaymentPlanDomainError,
  type PaymentPlanInstallmentInput,
} from '../domain/paymentPlan/paymentPlanDomain';

export type DrizzleDB = typeof _db;
export { PaymentPlanDomainError };

export class PaymentPlanServiceError extends Error {
  constructor(public code: 'payment_plan_not_found', public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'PaymentPlanServiceError';
  }
}

export type PaymentPlan = typeof paymentPlans.$inferSelect;
export type PaymentPlanInstallmentRow = typeof paymentPlanInstallments.$inferSelect;
export interface PaymentPlanWithInstallments extends PaymentPlan {
  installments: PaymentPlanInstallmentRow[];
}

async function loadInstallments(planId: string, db: DrizzleDB): Promise<PaymentPlanInstallmentRow[]> {
  return db.select().from(paymentPlanInstallments)
    .where(eq(paymentPlanInstallments.payment_plan_id, planId))
    .orderBy(asc(paymentPlanInstallments.installment_number));
}

export interface PaymentPlanInput {
  name:         string;
  description?: string | null;
  is_default?:  boolean;
  installments: PaymentPlanInstallmentInput[];
}

/**
 * Cria o plano + suas parcelas na mesma transação. `is_default=true` rebaixa
 * qualquer outro default do tenant — a garantia de "no máximo 1 default por
 * tenant" fica no service (não dá pra expressar isso num CHECK/UNIQUE simples
 * de coluna), sempre dentro da mesma transação pra nunca deixar dois defaults
 * simultâneos, mesmo sob concorrência.
 */
export async function createPlan(
  tenantId: string, input: PaymentPlanInput, db: DrizzleDB = _db,
): Promise<PaymentPlanWithInstallments> {
  if (!input.name?.trim()) throw new PaymentPlanDomainError('payment_plan_name_required');
  validatePaymentPlanInstallments(input.installments);

  return db.transaction(async (tx) => {
    if (input.is_default) {
      await tx.update(paymentPlans).set({ is_default: false })
        .where(and(eq(paymentPlans.tenant_id, tenantId), eq(paymentPlans.is_default, true)));
    }

    const [plan] = await tx.insert(paymentPlans).values({
      tenant_id:   tenantId,
      name:        input.name.trim(),
      description: input.description?.trim() || null,
      is_default:  input.is_default ?? false,
    }).returning();

    const installments = await tx.insert(paymentPlanInstallments).values(
      input.installments.map(it => ({
        payment_plan_id:    plan.id,
        installment_number: it.installment_number,
        days_offset:        it.days_offset,
        percentage:          String(it.percentage),
      })),
    ).returning();

    return { ...plan, installments };
  });
}

/** Lista paginada pra tela de gestão (Empresa → Planos de Pagamento). */
export async function listPlans(
  tenantId: string, db: DrizzleDB = _db,
): Promise<PaymentPlanWithInstallments[]> {
  const plans = await db.select().from(paymentPlans)
    .where(eq(paymentPlans.tenant_id, tenantId))
    .orderBy(asc(paymentPlans.created_at));

  const withInstallments = await Promise.all(
    plans.map(async (plan) => ({ ...plan, installments: await loadInstallments(plan.id, db) })),
  );
  return withInstallments;
}

/**
 * Lista leve (sem paginação) só de planos ativos, com parcelas — pro
 * `<select>` do pedido/nota, mesmo padrão de `GET /cost-centers/active`.
 */
export async function listActivePlans(
  tenantId: string, db: DrizzleDB = _db,
): Promise<PaymentPlanWithInstallments[]> {
  const plans = await db.select().from(paymentPlans)
    .where(and(eq(paymentPlans.tenant_id, tenantId), eq(paymentPlans.is_active, true)))
    .orderBy(asc(paymentPlans.name));

  const withInstallments = await Promise.all(
    plans.map(async (plan) => ({ ...plan, installments: await loadInstallments(plan.id, db) })),
  );
  return withInstallments;
}

export async function getPlanWithInstallments(
  tenantId: string, id: string, db: DrizzleDB = _db,
): Promise<PaymentPlanWithInstallments> {
  const [plan] = await db.select().from(paymentPlans)
    .where(and(eq(paymentPlans.id, id), eq(paymentPlans.tenant_id, tenantId)));
  if (!plan) throw new PaymentPlanServiceError('payment_plan_not_found', { id });
  return { ...plan, installments: await loadInstallments(plan.id, db) };
}

export interface PaymentPlanUpdateInput {
  name?:         string;
  description?:  string | null;
  is_default?:   boolean;
  installments?: PaymentPlanInstallmentInput[];
}

/**
 * Atualiza nome/descrição/default e, se `installments` vier, SUBSTITUI o
 * conjunto inteiro de parcelas (delete + insert) — plano de pagamento não
 * tem o mesmo problema de "histórico já usado" de campo personalizado de
 * contrato (regra dedicada), porque a parcela real já gerada em
 * `receivables` é uma cópia (installment_number/due_date/amount), nunca lê
 * `payment_plan_installments` depois do fato — editar o plano nunca
 * retroage sobre parcelas já cobradas.
 */
export async function updatePlan(
  tenantId: string, id: string, input: PaymentPlanUpdateInput, db: DrizzleDB = _db,
): Promise<PaymentPlanWithInstallments> {
  const [current] = await db.select().from(paymentPlans)
    .where(and(eq(paymentPlans.id, id), eq(paymentPlans.tenant_id, tenantId)));
  if (!current) throw new PaymentPlanServiceError('payment_plan_not_found', { id });

  if (input.name !== undefined && !input.name.trim()) {
    throw new PaymentPlanDomainError('payment_plan_name_required');
  }
  if (input.installments) validatePaymentPlanInstallments(input.installments);

  return db.transaction(async (tx) => {
    if (input.is_default) {
      await tx.update(paymentPlans).set({ is_default: false })
        .where(and(eq(paymentPlans.tenant_id, tenantId), eq(paymentPlans.is_default, true)));
    }

    const [plan] = await tx.update(paymentPlans).set({
      name:        input.name?.trim() ?? current.name,
      description: input.description !== undefined ? (input.description?.trim() || null) : current.description,
      is_default:  input.is_default   ?? current.is_default,
      updated_at:  new Date(),
    }).where(eq(paymentPlans.id, id)).returning();

    if (input.installments) {
      await tx.delete(paymentPlanInstallments).where(eq(paymentPlanInstallments.payment_plan_id, id));
      await tx.insert(paymentPlanInstallments).values(
        input.installments.map(it => ({
          payment_plan_id:    id,
          installment_number: it.installment_number,
          days_offset:        it.days_offset,
          percentage:          String(it.percentage),
        })),
      );
    }

    return { ...plan, installments: await loadInstallments(id, tx as unknown as DrizzleDB) };
  });
}

/** Soft-delete (regra 8) — nunca some dos pedidos/notas que já usaram este plano. */
export async function deactivatePlan(tenantId: string, id: string, db: DrizzleDB = _db): Promise<void> {
  const [current] = await db.select({ id: paymentPlans.id }).from(paymentPlans)
    .where(and(eq(paymentPlans.id, id), eq(paymentPlans.tenant_id, tenantId)));
  if (!current) throw new PaymentPlanServiceError('payment_plan_not_found', { id });

  await db.update(paymentPlans).set({ is_active: false, is_default: false, updated_at: new Date() })
    .where(eq(paymentPlans.id, id));
}
