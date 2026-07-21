// Domínio de Plano de Pagamento (migration 0086, regra 75) — regras de
// negócio puras, sem I/O. Generaliza o parcelamento já existente em
// supplierInvoiceDomain.ts (splitInstallmentAmounts/addMonthsToDateStr, só
// mensal e por contagem) pra parcelas nomeadas, reutilizáveis, com peso
// percentual e vencimento em dias corridos (30/60/90 dias corridos ≠ mês
// calendário) — o suficiente pra "à vista", "3x sem juros" e "30/60/90".

export class PaymentPlanDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'PaymentPlanDomainError';
  }
}

export interface PaymentPlanInstallmentInput {
  installment_number: number;
  days_offset:        number;
  percentage:         number;
}

export interface InstallmentSchedule {
  installment_number: number;
  installment_total:  number;
  due_date:            string; // YYYY-MM-DD
  amount:               string; // "0.00", pronto pra decimal do banco
}

// Tolerância em "centésimos de percentual" (1 = 0.01pp) — comparada em
// inteiros de propósito: subtrair floats como 100.01-100 pode devolver
// 0.010000000000005 em vez de 0.01 exato, rejeitando planos numericamente
// corretos se comparado direto em ponto flutuante.
const PERCENTAGE_TOLERANCE_CENTS = 1;

/**
 * Valida a lista de parcelas de um plano: não pode ser vazia, números de
 * parcela formam 1..N sem lacuna nem duplicata, dias não podem regredir
 * conforme o número da parcela avança, e a soma dos percentuais tem que
 * bater 100% (com tolerância de 1 centésimo pra erro de arredondamento).
 */
export function validatePaymentPlanInstallments(installments: PaymentPlanInstallmentInput[]): void {
  if (!installments.length) throw new PaymentPlanDomainError('payment_plan_no_installments');

  const sorted = [...installments].sort((a, b) => a.installment_number - b.installment_number);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].installment_number !== i + 1) {
      throw new PaymentPlanDomainError('payment_plan_installment_numbers_invalid', {
        expected: i + 1, found: sorted[i].installment_number,
      });
    }
    if (sorted[i].days_offset < 0) {
      throw new PaymentPlanDomainError('payment_plan_days_offset_negative', { installment_number: sorted[i].installment_number });
    }
    if (i > 0 && sorted[i].days_offset < sorted[i - 1].days_offset) {
      throw new PaymentPlanDomainError('payment_plan_days_offset_out_of_order', { installment_number: sorted[i].installment_number });
    }
    if (sorted[i].percentage <= 0) {
      throw new PaymentPlanDomainError('payment_plan_percentage_invalid', { installment_number: sorted[i].installment_number });
    }
  }

  const totalCentsPct = Math.round(sorted.reduce((s, it) => s + it.percentage, 0) * 100);
  if (Math.abs(totalCentsPct - 10000) > PERCENTAGE_TOLERANCE_CENTS) {
    throw new PaymentPlanDomainError('payment_plan_percentage_sum_invalid', { total: totalCentsPct / 100 });
  }
}

/**
 * Soma `days` (corridos, não mês calendário) a uma data `YYYY-MM-DD` — é o
 * que faz "30/60/90" virar 3 vencimentos exatos 30/60/90 dias corridos após
 * a base, diferente de addMonthsToDateStr (supplierInvoiceDomain.ts), que
 * segue rollover de mês calendário.
 */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Gera o cronograma de parcelas de um plano aplicado a um valor total: cada
 * parcela recebe `percentage`% do total (arredondado ao centavo) e vence
 * `days_offset` dias corridos após `baseDate`. O resto de centavos do
 * arredondamento é sempre absorvido pela ÚLTIMA parcela (mesmo espírito de
 * splitInstallmentAmounts em supplierInvoiceDomain.ts) — garante que a soma
 * das parcelas bate exatamente com `totalAmount`, nunca sobra/falta centavo.
 */
export function generateInstallmentSchedule(
  totalAmount: number, baseDate: string, installments: PaymentPlanInstallmentInput[],
): InstallmentSchedule[] {
  validatePaymentPlanInstallments(installments);

  const sorted = [...installments].sort((a, b) => a.installment_number - b.installment_number);
  const totalCents = Math.round(totalAmount * 100);

  let allocatedCents = 0;
  const schedule = sorted.map((it, idx) => {
    const isLast = idx === sorted.length - 1;
    const cents = isLast
      ? totalCents - allocatedCents
      : Math.round(totalCents * (it.percentage / 100));
    allocatedCents += cents;
    return {
      installment_number: it.installment_number,
      installment_total:  sorted.length,
      due_date:             addDaysToDateStr(baseDate, it.days_offset),
      amount:                (cents / 100).toFixed(2),
    };
  });

  return schedule;
}
