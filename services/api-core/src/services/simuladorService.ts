// Simulador de DAS — camada de serviço (I/O). Carrega config/RBT12/receita/
// pipeline e delega ao domínio puro. NADA é persistido (100% stateless).

import { eq, and, inArray, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { fiscalDocumentDrafts } from '../db/schema';
import { getOrCreateConfig } from './fiscalCompanyConfigService';
import { resolveCompanyId } from './companyService';
import { resolveRbt12, revenueByCompetencia } from './fiscalRevenueService';
import { loadBrackets, loadReparticao, folha12m } from './apuracaoService';
import { toNumber, round2 } from '../lib/money';
import { assertApuravelPorPercentual, resolveAnexoByFatorR, windowCompetencias } from '../domain/simples/simplesDomain';
import {
  SimulatorBase, projetarCompetencia, distanciaProximaFaixa, simularCenarios,
  compararProLabore, Cenario,
} from '../domain/simples/simuladorDomain';

export type DrizzleDB = typeof _db;

const ANEXO_LABEL = ['I', 'II', 'III', 'IV', 'V'] as const;
const currentCompetencia = () => new Date().toISOString().slice(0, 7);

async function loadBase(tenantId: string, companyId: string | null | undefined, db: DrizzleDB): Promise<{ base: SimulatorBase; fatorR: number | null }> {
  const company = await resolveCompanyId(tenantId, companyId, db);
  const config = await getOrCreateConfig(tenantId, company.id, db);
  assertApuravelPorPercentual(config.enquadramento);

  const competencia = currentCompetencia();
  const { rbt12 } = await resolveRbt12(tenantId, company.id, competencia, config, db);
  const ano = Number(competencia.slice(0, 4));

  // Anexo efetivo: Fator R quando aplicável, senão anexo_padrao (default III).
  let anexo = config.anexo_padrao ? ANEXO_LABEL[config.anexo_padrao - 1] : 'III';
  let fatorR: number | null = null;
  if (config.fator_r_aplicavel) {
    const folha = await folha12m(tenantId, company.id, competencia, db);
    if (folha.meses >= 12) {
      const r = resolveAnexoByFatorR({ folha12m: folha.total, receita12m: rbt12, mesesComFolha: folha.meses });
      anexo = r.anexo; fatorR = r.fatorR;
    }
  }

  // Receita do mês já reconhecida (ledger) + pipeline não emitido (drafts).
  const receitas = await revenueByCompetencia(tenantId, company.id, [competencia], db);
  const receitaMesLedger = receitas[competencia] ?? 0;
  const drafts = await db.select({ amount: fiscalDocumentDrafts.amount }).from(fiscalDocumentDrafts)
    .where(and(
      eq(fiscalDocumentDrafts.tenant_id, tenantId),
      eq(fiscalDocumentDrafts.company_id, company.id),
      eq(fiscalDocumentDrafts.competency_ref, competencia),
      inArray(fiscalDocumentDrafts.status, ['open', 'sealed', 'calculated']),
    ));
  const receitaPipeline = round2(drafts.reduce((s, d) => s + toNumber(d.amount), 0));

  return {
    base: {
      competencia, rbt12, receitaMesLedger, receitaPipeline, anexo,
      brackets: await loadBrackets(anexo, ano, db),
      reparticao: await loadReparticao(anexo, ano, db),
    },
    fatorR,
  };
}

/** Projeção do mês + distância de faixa (GET /v1/fiscal/simulator). */
export async function getProjecao(tenantId: string, companyId: string | null | undefined, db: DrizzleDB = _db) {
  const { base, fatorR } = await loadBase(tenantId, companyId, db);
  const projecao = projetarCompetencia(base);
  const distancia = distanciaProximaFaixa(base.brackets, base.rbt12);
  // Cenários padrão de gestão (+5k/+10k/+15k hoje).
  const { cenarios } = simularCenarios(base, [
    { label: '+R$ 5.000', deltaReceita: 5000, timing: 'hoje' },
    { label: '+R$ 10.000', deltaReceita: 10000, timing: 'hoje' },
    { label: '+R$ 15.000', deltaReceita: 15000, timing: 'hoje' },
  ]);
  return { projecao, distancia, anexo: base.anexo, fator_r: fatorR, cenarios_rapidos: cenarios };
}

export interface WhatIfArgs {
  cenarios?: Array<{ label?: string; delta_receita: number; timing?: 'hoje' | 'proxima_competencia' }>;
  pro_labore_delta_mensal?: number;
}

/** What-if custom (POST /v1/fiscal/simulator/what-if). */
export async function simularWhatIf(tenantId: string, companyId: string | null | undefined, args: WhatIfArgs, db: DrizzleDB = _db) {
  const { base } = await loadBase(tenantId, companyId, db);

  // Receita do mês que SAI da janela ao avançar a competência.
  const janela = windowCompetencias(base.competencia);
  const mesQueSai = janela[janela.length - 1];
  const receitasSai = await revenueByCompetencia(tenantId, (await resolveCompanyId(tenantId, companyId, db)).id, [mesQueSai], db);

  const cenarios: Cenario[] = (args.cenarios ?? []).map((c, i) => ({
    label: c.label ?? `Cenário ${i + 1}`,
    deltaReceita: Number(c.delta_receita) || 0,
    timing: c.timing === 'proxima_competencia' ? 'proxima_competencia' : 'hoje',
  }));
  const resultado = simularCenarios(base, cenarios, { receitaMesQueSaiDaJanela: receitasSai[mesQueSai] ?? 0 });

  let proLabore = null;
  if (args.pro_labore_delta_mensal && args.pro_labore_delta_mensal > 0) {
    const company = await resolveCompanyId(tenantId, companyId, db);
    const folha = await folha12m(tenantId, company.id, base.competencia, db);
    const ano = Number(base.competencia.slice(0, 4));
    proLabore = compararProLabore({
      base: {
        competencia: base.competencia, rbt12: base.rbt12,
        receitaMesLedger: base.receitaMesLedger, receitaPipeline: base.receitaPipeline,
      },
      folha12mAtual: folha.total, mesesComFolha: folha.meses,
      deltaProLaboreMensal: args.pro_labore_delta_mensal,
      tabelas: {
        III: { brackets: await loadBrackets('III', ano, db), reparticao: await loadReparticao('III', ano, db) },
        V:   { brackets: await loadBrackets('V', ano, db),   reparticao: await loadReparticao('V', ano, db) },
      },
    });
  }

  return { ...resultado, pro_labore: proLabore };
}
