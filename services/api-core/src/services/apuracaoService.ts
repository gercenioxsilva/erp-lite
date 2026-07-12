// Apuração PGDAS-D (0075) — camada de serviço.
// apurarCompetencia: cadastro (MEI bloqueado, optante) → RBT12 (ledger com
// proporcionalização / bootstrap manual) → Fator R (define III vs V quando
// aplicável) → receita segregada por anexo → apurarSimples (memória completa)
// → upsert idempotente por (empresa, competência). LIMITE LEGAL explícito:
// nada aqui transmite ao portal — export/roteiro para lançamento manual.

import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import {
  simplesApuracao, simplesApuracaoEvents, dasPayments,
  fiscalCompanyPayrollMonth,
} from '../db/schema';
import { getOrCreateConfig } from './fiscalCompanyConfigService';
import { resolveRbt12, revenueForCompetenciaByAnexo } from './fiscalRevenueService';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { toNumber, toDecimalString, round2 } from '../lib/money';
import {
  assertApuravelPorPercentual, resolveAnexoByFatorR, windowCompetencias, SimplesDomainError,
} from '../domain/simples/simplesDomain';
import { validateCompetencia } from '../domain/fiscal/fiscalCompanyConfigDomain';
import { apurarSimples, BracketRow, ReparticaoRow } from '../domain/simples/apuracaoDomain';

export type DrizzleDB = typeof _db;
export type Apuracao = typeof simplesApuracao.$inferSelect;

const ANEXO_LABEL = ['I', 'II', 'III', 'IV', 'V'] as const;

export async function loadBrackets(anexo: string, ano: number, db: DrizzleDB): Promise<BracketRow[]> {
  const { rows } = await db.execute<any>(
    sql`SELECT faixa, rbt12_min, rbt12_max, aliquota_nominal, parcela_deduzir
        FROM tax_simples_nacional_brackets
        WHERE anexo = ${anexo} AND vigencia_ano = (
          SELECT MAX(vigencia_ano) FROM tax_simples_nacional_brackets
          WHERE anexo = ${anexo} AND vigencia_ano <= ${ano})
        ORDER BY faixa`
  );
  return rows.map((r: any) => ({
    faixa: Number(r.faixa), rbt12_min: Number(r.rbt12_min), rbt12_max: Number(r.rbt12_max),
    aliquota_nominal: Number(r.aliquota_nominal), parcela_deduzir: Number(r.parcela_deduzir),
  }));
}

export async function loadReparticao(anexo: string, ano: number, db: DrizzleDB): Promise<ReparticaoRow[]> {
  const { rows } = await db.execute<any>(
    sql`SELECT * FROM tax_simples_repartition
        WHERE anexo = ${anexo} AND vigencia_ano = (
          SELECT MAX(vigencia_ano) FROM tax_simples_repartition
          WHERE anexo = ${anexo} AND vigencia_ano <= ${ano})
        ORDER BY faixa`
  );
  if (rows.length === 0) throw new SimplesDomainError('reparticao_not_found', { anexo });
  return rows.map((r: any) => ({
    faixa: Number(r.faixa),
    irpj: Number(r.irpj), csll: Number(r.csll), cofins: Number(r.cofins), pis: Number(r.pis),
    cpp: Number(r.cpp), icms: Number(r.icms), ipi: Number(r.ipi), iss: Number(r.iss),
  }));
}

/** Folha 12m (folha+pró-labore) da janela anterior à competência. */
export async function folha12m(tenantId: string, companyId: string, competencia: string, db: DrizzleDB) {
  const janela = windowCompetencias(competencia);
  const rows = await db.select().from(fiscalCompanyPayrollMonth)
    .where(and(eq(fiscalCompanyPayrollMonth.tenant_id, tenantId), eq(fiscalCompanyPayrollMonth.company_id, companyId)));
  const map = new Map(rows.map((r) => [r.competencia, r]));
  let total = 0, meses = 0;
  for (const c of janela) {
    const row = map.get(c);
    if (row) { total += toNumber(row.folha_amount) + toNumber(row.pro_labore_amount); meses++; }
  }
  return { total: round2(total), meses };
}

export async function apurarCompetencia(
  tenantId: string, companyId: string, competencia: string, actorUserId: string | null, db: DrizzleDB = _db,
): Promise<Apuracao> {
  validateCompetencia(competencia);
  const config = await getOrCreateConfig(tenantId, companyId, db);
  assertApuravelPorPercentual(config.enquadramento);
  if (!config.optante_simples) throw new SimplesDomainError('empresa_nao_optante');

  const { rbt12, source } = await resolveRbt12(tenantId, config.company_id, competencia, config, db);
  const ano = Number(competencia.slice(0, 4));

  // Fator R (quando aplicável) decide III vs V para a receita de serviço.
  let fatorR: number | null = null;
  let anexoServico = config.anexo_padrao ? ANEXO_LABEL[config.anexo_padrao - 1] : 'III';
  if (config.fator_r_aplicavel) {
    const folha = await folha12m(tenantId, config.company_id, competencia, db);
    const resolved = resolveAnexoByFatorR({ folha12m: folha.total, receita12m: rbt12, mesesComFolha: folha.meses });
    fatorR = resolved.fatorR;
    anexoServico = resolved.anexo;
  }

  // Receita segregada por anexo; linhas sem anexo assumem o anexo resolvido.
  const porAnexoRaw = await revenueForCompetenciaByAnexo(tenantId, config.company_id, competencia, db);
  if (porAnexoRaw.length === 0) throw new SimplesDomainError('sem_receita_na_competencia', { competencia });
  const grouped = new Map<string, { receita: number; comRetencao: number }>();
  for (const r of porAnexoRaw) {
    const label = r.anexo ? ANEXO_LABEL[r.anexo - 1] : anexoServico;
    const acc = grouped.get(label) ?? { receita: 0, comRetencao: 0 };
    acc.receita = round2(acc.receita + r.receita);
    acc.comRetencao = round2(acc.comRetencao + r.comRetencao);
    grouped.set(label, acc);
  }

  const anexos = [];
  for (const [anexo, { receita, comRetencao }] of grouped) {
    anexos.push({
      anexo, receita, receitaComRetencao: comRetencao,
      brackets: await loadBrackets(anexo, ano, db),
      reparticao: await loadReparticao(anexo, ano, db),
    });
  }

  const result = apurarSimples({ competencia, rbt12, anexos });
  const receitaCompetencia = round2(anexos.reduce((s, a) => s + a.receita, 0));

  const values = {
    rbt12: toDecimalString(rbt12), rbt12_source: source,
    receita_competencia: toDecimalString(receitaCompetencia),
    fator_r: fatorR !== null ? String(fatorR.toFixed(4)) : null,
    sublimite_excedido: result.sublimiteExcedido,
    das_total: toDecimalString(result.dasTotal),
    valor_irpj: toDecimalString(result.tributos.irpj), valor_csll: toDecimalString(result.tributos.csll),
    valor_cofins: toDecimalString(result.tributos.cofins), valor_pis: toDecimalString(result.tributos.pis),
    valor_cpp: toDecimalString(result.tributos.cpp), valor_icms: toDecimalString(result.tributos.icms),
    valor_ipi: toDecimalString(result.tributos.ipi), valor_iss: toDecimalString(result.tributos.iss),
    iss_retido: toDecimalString(result.issRetidoTotal),
    memoria: result.memoria, status: 'calculated' as const, updated_at: new Date(),
  };

  // Upsert idempotente por (empresa, competência); reapurar = recalculated.
  const [existing] = await db.select().from(simplesApuracao)
    .where(and(eq(simplesApuracao.tenant_id, tenantId), eq(simplesApuracao.company_id, config.company_id),
      eq(simplesApuracao.competencia, competencia)));
  const [row] = existing
    ? await db.update(simplesApuracao).set(values).where(eq(simplesApuracao.id, existing.id)).returning()
    : await db.insert(simplesApuracao).values({
        tenant_id: tenantId, company_id: config.company_id, competencia, ...values, created_by: actorUserId,
      }).returning();

  await db.insert(simplesApuracaoEvents).values({
    tenant_id: tenantId, apuracao_id: row.id,
    event_type: existing ? 'recalculated' : 'calculated',
    payload: { das_total: result.dasTotal, rbt12, fator_r: fatorR }, created_by: actorUserId,
  });
  await recordFiscalEvent({
    tenantId, companyId: config.company_id, aggregateType: 'apuracao', aggregateId: row.id,
    eventType: existing ? 'apuracao_recalculated' : 'apuracao_calculated', actorUserId,
    responsePayload: { competencia, das_total: result.dasTotal, sublimite: result.sublimiteExcedido },
  }, db);

  return row;
}

/** Export/roteiro assistido: os valores EXATOS a lançar no portal, campo a campo. */
export async function exportApuracao(tenantId: string, apuracaoId: string, actorUserId: string | null, db: DrizzleDB = _db) {
  const [row] = await db.select().from(simplesApuracao)
    .where(and(eq(simplesApuracao.id, apuracaoId), eq(simplesApuracao.tenant_id, tenantId)));
  if (!row) throw new SimplesDomainError('apuracao_not_found', { apuracaoId });

  await db.update(simplesApuracao).set({ status: 'exported', updated_at: new Date() })
    .where(eq(simplesApuracao.id, row.id));
  await db.insert(simplesApuracaoEvents).values({
    tenant_id: tenantId, apuracao_id: row.id, event_type: 'exported', created_by: actorUserId,
  });

  return {
    aviso: 'O PGDAS-D não possui API oficial de transmissão. Lance os valores abaixo manualmente no portal (www8.receita.fazenda.gov.br) — este export é a memória de cálculo assistida.',
    competencia: row.competencia,
    passos: [
      '1. Acesse o PGDAS-D no portal do Simples Nacional com certificado ou código de acesso.',
      `2. Selecione o período de apuração ${row.competencia}.`,
      `3. Informe a receita bruta do mês: R$ ${row.receita_competencia}.`,
      '4. Confira a RBT12 calculada pelo portal contra a memória abaixo.',
      '5. Segregue as receitas por atividade/anexo conforme a memória.',
      '6. Confira o DAS apurado com o valor estimado e gere o DAS para pagamento.',
    ],
    valores: {
      rbt12: row.rbt12, receita_competencia: row.receita_competencia,
      das_total: row.das_total, fator_r: row.fator_r, sublimite_excedido: row.sublimite_excedido,
      tributos: {
        irpj: row.valor_irpj, csll: row.valor_csll, cofins: row.valor_cofins, pis: row.valor_pis,
        cpp: row.valor_cpp, icms: row.valor_icms, ipi: row.valor_ipi, iss: row.valor_iss,
        iss_retido_abatido: row.iss_retido,
      },
    },
    memoria: row.memoria,
  };
}

export async function listApuracoes(tenantId: string, companyId: string | null, db: DrizzleDB = _db) {
  const conditions = [eq(simplesApuracao.tenant_id, tenantId)];
  if (companyId) conditions.push(eq(simplesApuracao.company_id, companyId));
  return db.select().from(simplesApuracao).where(and(...conditions))
    .orderBy(desc(simplesApuracao.competencia)).limit(60);
}

export async function registerDasPayment(
  tenantId: string, args: { companyId: string; competencia: string; paidAt: string; amount: number; reference?: string | null },
  actorUserId: string | null, db: DrizzleDB = _db,
) {
  validateCompetencia(args.competencia);
  const [row] = await db.insert(dasPayments).values({
    tenant_id: tenantId, company_id: args.companyId, competencia: args.competencia,
    paid_at: args.paidAt, amount: toDecimalString(args.amount),
    reference: args.reference ?? null, created_by: actorUserId,
  }).returning();
  await recordFiscalEvent({
    tenantId, companyId: args.companyId, aggregateType: 'das_payment', aggregateId: row.id,
    eventType: 'das_paid', actorUserId, requestPayload: { competencia: args.competencia, amount: args.amount },
  }, db);
  return row;
}

/** Estimado vs pago (dashboard) — últimos 12 meses. */
export async function estimadoVsPago(tenantId: string, db: DrizzleDB = _db) {
  const { rows } = await db.execute<any>(
    sql`SELECT a.competencia,
               SUM(a.das_total) AS estimado,
               COALESCE((SELECT SUM(p.amount) FROM das_payments p
                         WHERE p.tenant_id = a.tenant_id AND p.competencia = a.competencia), 0) AS pago
        FROM simples_apuracao a
        WHERE a.tenant_id = ${tenantId}
        GROUP BY a.tenant_id, a.competencia
        ORDER BY a.competencia DESC LIMIT 12`
  );
  return rows.map((r: any) => ({ competencia: String(r.competencia).trim(), estimado: Number(r.estimado), pago: Number(r.pago) }));
}
