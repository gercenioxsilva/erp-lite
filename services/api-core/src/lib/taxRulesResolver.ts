// Camada de acesso às tabelas fiscais centrais (tax_icms_*, tax_fcp_rates,
// tax_st_rules, tax_simples_nacional_brackets — migration 0037).
// Mantidas pela Orquestra, nunca editáveis por tenant (ver regra 33 do README).
//
// Esta camada SÓ faz lookup — nenhuma decisão de negócio (DIFAL, qual regime
// aplicar etc.) mora aqui. Isso fica em taxCalculationService.ts.

import { sql } from 'drizzle-orm';
import { db as _db } from '../db';

export type DrizzleDB = typeof _db;

export class TaxRuleNotFoundError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'TaxRuleNotFoundError';
  }
}

// ── cache em memória ──────────────────────────────────────────────────────────
// Alíquotas legais mudam raramente — cache curto evita bater no banco a cada
// linha de item de uma nota com muitos itens.

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = { value: T; expiresAt: number };

const icmsCache: Map<string, CacheEntry<number>> = new Map();
const fcpCache:  Map<string, CacheEntry<number>> = new Map();

export function clearTaxRulesCache(): void {
  icmsCache.clear();
  fcpCache.clear();
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return undefined; }
  return entry.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── ICMS (interno ou interestadual) ────────────────────────────────────────────

export async function getIcmsRate(originUf: string, destUf: string, db: DrizzleDB): Promise<number> {
  const key = `${originUf}:${destUf}`;
  const cached = getCached(icmsCache, key);
  if (cached !== undefined) return cached;

  if (originUf === destUf) {
    const { rows } = await db.execute<{ rate: string }>(
      sql`SELECT rate FROM tax_icms_internal_rates WHERE uf = ${originUf}`
    );
    if (!rows[0]) throw new TaxRuleNotFoundError('icms_internal_rate_not_found', { uf: originUf });
    const rate = Number(rows[0].rate);
    setCached(icmsCache, key, rate);
    return rate;
  }

  const { rows } = await db.execute<{ rate: string }>(
    sql`SELECT rate FROM tax_icms_interstate_rates WHERE origin_uf = ${originUf} AND dest_uf = ${destUf}`
  );
  if (!rows[0]) throw new TaxRuleNotFoundError('icms_interstate_rate_not_found', { originUf, destUf });
  const rate = Number(rows[0].rate);
  setCached(icmsCache, key, rate);
  return rate;
}

// ── FCP — Fundo de Combate à Pobreza ──────────────────────────────────────────
// Sem regra configurada para a UF => 0 (não bloqueia o cálculo; tabela é
// populada por demanda — ver regra 33 do README).

export async function getFcpRate(uf: string, db: DrizzleDB): Promise<number> {
  const cached = getCached(fcpCache, uf);
  if (cached !== undefined) return cached;

  const { rows } = await db.execute<{ rate: string }>(
    sql`SELECT rate FROM tax_fcp_rates WHERE uf = ${uf}`
  );
  const rate = rows[0] ? Number(rows[0].rate) : 0;
  setCached(fcpCache, uf, rate);
  return rate;
}

// ── ICMS-ST — Substituição Tributária ─────────────────────────────────────────
// Tabela criada vazia nesta fase (ver análise/README) — retorna null quando não
// há regra cadastrada, e o chamador simplesmente não aplica ST (não inventa MVA).

export async function getStRule(
  ncm: string, originUf: string, destUf: string, db: DrizzleDB,
): Promise<{ mvaPercent: number } | null> {
  const { rows } = await db.execute<{ mva_percent: string }>(
    sql`SELECT mva_percent FROM tax_st_rules
        WHERE ncm = ${ncm} AND origin_uf = ${originUf} AND dest_uf = ${destUf}`
  );
  if (!rows[0]) return null;
  return { mvaPercent: Number(rows[0].mva_percent) };
}

// ── Simples Nacional — alíquota efetiva por faixa de RBT12 ────────────────────
// Fórmula oficial LC 123/2006 (Anexo I — Comércio):
//   Alíquota efetiva (%) = Aliq. Nominal − (Parcela a Deduzir × 100 / RBT12)

export async function getSimplesEffectiveRate(
  rbt12: number, db: DrizzleDB, anexo = 'I',
): Promise<number> {
  if (rbt12 <= 0) return 0;

  const { rows } = await db.execute<{ aliquota_nominal: string; parcela_deduzir: string }>(
    sql`SELECT aliquota_nominal, parcela_deduzir FROM tax_simples_nacional_brackets
        WHERE anexo = ${anexo} AND ${rbt12} BETWEEN rbt12_min AND rbt12_max`
  );
  const bracket = rows[0];
  if (!bracket) throw new TaxRuleNotFoundError('simples_bracket_not_found', { rbt12, anexo });

  const aliquotaNominal = Number(bracket.aliquota_nominal);
  const parcelaDeduzir  = Number(bracket.parcela_deduzir);
  const effective = aliquotaNominal - (parcelaDeduzir * 100) / rbt12;
  return Math.max(0, effective);
}
