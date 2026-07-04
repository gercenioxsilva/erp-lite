// Domínio do Fluxo de Caixa — cálculo puro (sem I/O) do relatório de caixa.
//
// Diferença em relação ao widget do Dashboard (dashboard.ts /dashboard/cashflow):
// aqui separamos REALIZADO (pagamentos que de fato ocorreram, por payment_date) de
// PROJETADO (títulos em aberto por due_date), sobre um período configurável, com
// saldo acumulado (running balance) a partir de um saldo de abertura.
//
// O service faz as queries e monta os buckets; esta função apenas agrega/totaliza.

export type CashflowGranularity = 'week' | 'month';

export interface CashflowBucketInput {
  period:            string; // início do bucket, YYYY-MM-DD
  realized_inflow:   number; // recebimentos efetivados no bucket
  realized_outflow:  number; // pagamentos efetivados no bucket
  projected_inflow:  number; // a receber em aberto com vencimento no bucket
  projected_outflow: number; // a pagar em aberto com vencimento no bucket
}

export interface CashflowBucket extends CashflowBucketInput {
  realized_net:  number; // realized_inflow - realized_outflow
  projected_net: number; // projected_inflow - projected_outflow
  net:           number; // realized_net + projected_net
  accumulated:   number; // saldo acumulado (abertura + soma dos net até este bucket)
}

export interface CashflowResult {
  period_from:     string;
  period_to:       string;
  granularity:     CashflowGranularity;
  opening_balance: number;
  buckets:         CashflowBucket[];
  summary: {
    total_realized_inflow:   number;
    total_realized_outflow:  number;
    total_projected_inflow:  number;
    total_projected_outflow: number;
    realized_net:            number;
    projected_net:           number;
    net:                     number;
    closing_balance:         number;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildCashflow(
  periodFrom:     string,
  periodTo:       string,
  granularity:    CashflowGranularity,
  openingBalance: number,
  rows:           CashflowBucketInput[],
): CashflowResult {
  let running = round2(openingBalance);

  const buckets: CashflowBucket[] = rows.map(r => {
    const realized_net  = round2(r.realized_inflow  - r.realized_outflow);
    const projected_net = round2(r.projected_inflow - r.projected_outflow);
    const net           = round2(realized_net + projected_net);
    running             = round2(running + net);
    return {
      period:            r.period,
      realized_inflow:   round2(r.realized_inflow),
      realized_outflow:  round2(r.realized_outflow),
      projected_inflow:  round2(r.projected_inflow),
      projected_outflow: round2(r.projected_outflow),
      realized_net,
      projected_net,
      net,
      accumulated:       running,
    };
  });

  const sum = (pick: (b: CashflowBucket) => number) =>
    round2(buckets.reduce((s, b) => s + pick(b), 0));

  const total_realized_inflow   = sum(b => b.realized_inflow);
  const total_realized_outflow  = sum(b => b.realized_outflow);
  const total_projected_inflow  = sum(b => b.projected_inflow);
  const total_projected_outflow = sum(b => b.projected_outflow);
  const realized_net            = round2(total_realized_inflow  - total_realized_outflow);
  const projected_net           = round2(total_projected_inflow - total_projected_outflow);
  const net                     = round2(realized_net + projected_net);

  return {
    period_from:     periodFrom,
    period_to:       periodTo,
    granularity,
    opening_balance: round2(openingBalance),
    buckets,
    summary: {
      total_realized_inflow,
      total_realized_outflow,
      total_projected_inflow,
      total_projected_outflow,
      realized_net,
      projected_net,
      net,
      closing_balance: round2(openingBalance + net),
    },
  };
}
