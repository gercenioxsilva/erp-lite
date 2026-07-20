// Receita fiscal por empresa/competência — fonte ÚNICA do RBT12 calculado.
// Consumido pela consolidação (snapshot do draft) e pela apuração PGDAS-D;
// alimentado pela projeção fire-and-forget do nfeResultsWorker (documentos
// autorizados) com idempotência física por documento (UNIQUE source_doc).

import { eq, and, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { fiscalRevenueMonthly } from '../db/schema';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import { toNumber, toDecimalString } from '../lib/money';
import { computeRbt12, windowCompetencias, SimplesDomainError } from '../domain/simples/simplesDomain';
import type { FiscalConfig } from './fiscalCompanyConfigService';

export type DrizzleDB = typeof _db;

/** Receita bruta por competência dentro de uma janela (mapa competência→total). */
export async function revenueByCompetencia(
  tenantId: string, companyId: string, competencias: string[], db: DrizzleDB = _db,
): Promise<Record<string, number>> {
  if (competencias.length === 0) return {};
  const { rows } = await db.execute<{ competencia: string; total: string }>(
    sql`SELECT competencia, SUM(receita_bruta) AS total FROM fiscal_revenue_monthly
        WHERE tenant_id = ${tenantId} AND company_id = ${companyId}
          AND competencia IN (${sql.join(competencias.map((c) => sql`${c}`), sql`, `)})
        GROUP BY competencia`
  );
  return Object.fromEntries(rows.map((r) => [r.competencia.trim(), Number(r.total)]));
}

export interface ResolvedRbt12 {
  rbt12: number;
  source: 'ledger' | 'manual';
}

/**
 * RBT12 da competência: ledger (com proporcionalização de início de atividade)
 * quando há receita registrada; bootstrap manual do cadastro como fallback no
 * período de transição. Falha tipada quando nenhum dos dois existe.
 */
export async function resolveRbt12(
  tenantId: string, companyId: string, competencia: string, config: FiscalConfig, db: DrizzleDB = _db,
): Promise<ResolvedRbt12> {
  const janela = windowCompetencias(competencia);
  const receitas = await revenueByCompetencia(tenantId, companyId, [...janela, competencia], db);
  if (Object.keys(receitas).length > 0) {
    // computeRbt12 é o dono único das regras de janela/proporcionalização; a
    // competência corrente vai junto porque o 1º mês de atividade deriva dela.
    const rbt12 = computeRbt12({ receitasPorCompetencia: receitas, competencia, dataAbertura: config.data_abertura });
    // Ledger com receita só na PRÓPRIA competência (1ª nota de quem está
    // migrando) não forma RBT12 — a janela é dos 12 meses anteriores e ainda
    // está vazia. Sem este guard, a 1ª emissão zeraria o RBT12 e derrubaria o
    // bootstrap do cadastro justamente na transição em que ele é a única fonte.
    if (rbt12 > 0) return { rbt12, source: 'ledger' };
  }
  const manual = toNumber(config.rbt12_manual ?? config.receita_acumulada_abertura);
  if (manual > 0) return { rbt12: manual, source: 'manual' };
  throw new SimplesDomainError('rbt12_unavailable', {
    hint: 'Sem receita no ledger e sem rbt12_manual/receita_acumulada_abertura no cadastro fiscal.',
  });
}

/** Receita segregada da PRÓPRIA competência, agregada por anexo (empresa mista). */
export async function revenueForCompetenciaByAnexo(
  tenantId: string, companyId: string, competencia: string, db: DrizzleDB = _db,
): Promise<Array<{ anexo: number | null; receita: number; comRetencao: number }>> {
  const { rows } = await db.execute<{ anexo: number | null; receita: string; com_retencao: string }>(
    sql`SELECT anexo, SUM(receita_tributavel) AS receita, SUM(receita_com_retencao) AS com_retencao
        FROM fiscal_revenue_monthly
        WHERE tenant_id = ${tenantId} AND company_id = ${companyId} AND competencia = ${competencia}
        GROUP BY anexo`
  );
  return rows.map((r) => ({ anexo: r.anexo, receita: Number(r.receita), comRetencao: Number(r.com_retencao) }));
}

export interface RecordRevenueArgs {
  tenantId: string;
  companyId: string;
  competencia: string;          // 'YYYY-MM'
  anexo?: number | null;
  municipioIbge?: string | null;
  amount: number;               // receita bruta = tributável neste MVP
  comRetencao?: number;
  sourceDocType: 'invoice' | 'nfse' | 'pos_sale' | 'manual';
  sourceDocId: string | null;
}

/** Projeção idempotente: 1 documento nunca soma 2× (UNIQUE parcial + 23505). */
export async function recordRevenue(args: RecordRevenueArgs, db: DrizzleDB = _db): Promise<{ duplicate: boolean }> {
  try {
    await db.insert(fiscalRevenueMonthly).values({
      tenant_id: args.tenantId, company_id: args.companyId, competencia: args.competencia,
      anexo: args.anexo ?? null, municipio_ibge: args.municipioIbge ?? null,
      receita_bruta: toDecimalString(args.amount),
      receita_tributavel: toDecimalString(args.amount),
      receita_com_retencao: toDecimalString(args.comRetencao ?? 0),
      source_doc_type: args.sourceDocType, source_doc_id: args.sourceDocId,
    });
    return { duplicate: false };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return { duplicate: true };
    throw err;
  }
}
