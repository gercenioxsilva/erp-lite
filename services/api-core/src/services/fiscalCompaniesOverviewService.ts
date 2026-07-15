// Painel executivo (Fase 1): resumo por empresa reaproveitando os services já
// testados de score/fechamento/apuração. Nenhum cálculo fiscal novo aqui —
// só orquestração e formatação. Processamento SEQUENCIAL (não Promise.all no
// nível de empresa) para manter a ordem determinística e permitir que uma
// falha isolada vire `error: true` sem afetar as demais.

import { eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { fiscalCompanyConfig, dasPayments } from '../db/schema';
import { listCompanies } from './companyService';
import { computeScore } from './fiscalScoreService';
import { getClosingStatus } from './fiscalClosingService';
import { listApuracoes } from './apuracaoService';
import { dasDueDate } from '../domain/fiscal/alertRulesDomain';

export type DrizzleDB = typeof _db;

export interface CompanyOverview {
  company_id: string;
  company_name: string;
  has_fiscal_config: boolean;
  score: number | null;
  alerts: { critical: number; warning: number; info: number } | null;
  competencia_atual: { competencia: string; status: 'aberta' | 'fechada' | 'travada' } | null;
  das: { competencia: string; valor: number; vencimento: string; dias_restantes: number; status: 'pendente' | 'atrasado' | 'pago' } | null;
  error: boolean;
}

/** Mesma convenção da FiscalPage: a competência de trabalho é o mês anterior. */
function currentCompetencia(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function hasFiscalConfig(tenantId: string, companyId: string, db: DrizzleDB): Promise<boolean> {
  const rows = await db.select().from(fiscalCompanyConfig)
    .where(and(eq(fiscalCompanyConfig.tenant_id, tenantId), eq(fiscalCompanyConfig.company_id, companyId)));
  return rows.length > 0;
}

async function buildDas(
  tenantId: string, companyId: string, db: DrizzleDB,
): Promise<CompanyOverview['das']> {
  const apuracoes = await listApuracoes(tenantId, companyId, db);
  const latest = apuracoes[0];
  if (!latest) return null;

  const payments = await db.select().from(dasPayments)
    .where(and(eq(dasPayments.tenant_id, tenantId), eq(dasPayments.company_id, companyId),
      eq(dasPayments.competencia, latest.competencia)));

  const due = dasDueDate(latest.competencia);
  const diasRestantes = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  const status: 'pendente' | 'atrasado' | 'pago' =
    payments.length > 0 ? 'pago' : diasRestantes < 0 ? 'atrasado' : 'pendente';

  return {
    competencia: latest.competencia,
    valor: Number(latest.das_total),
    vencimento: due.toISOString().slice(0, 10),
    dias_restantes: diasRestantes,
    status,
  };
}

async function buildConfiguredOverview(
  tenantId: string, companyId: string, companyName: string, competencia: string, db: DrizzleDB,
): Promise<CompanyOverview> {
  try {
    const [scoreResult, closing, das] = await Promise.all([
      computeScore(tenantId, companyId, db),
      getClosingStatus(tenantId, companyId, competencia, db),
      buildDas(tenantId, companyId, db),
    ]);

    const alerts = { critical: 0, warning: 0, info: 0 };
    for (const f of scoreResult.findings) alerts[f.severity as 'critical' | 'warning' | 'info']++;

    const status: 'aberta' | 'fechada' | 'travada' =
      closing.lock?.status === 'locked' ? 'travada'
      : (closing.run && closing.run.status !== 'failed') ? 'fechada'
      : 'aberta';

    return {
      company_id: companyId, company_name: companyName, has_fiscal_config: true,
      score: scoreResult.score, alerts,
      competencia_atual: { competencia, status },
      das, error: false,
    };
  } catch {
    return {
      company_id: companyId, company_name: companyName, has_fiscal_config: true,
      score: null, alerts: null, competencia_atual: null, das: null, error: true,
    };
  }
}

export async function getCompaniesOverview(tenantId: string, db: DrizzleDB = _db): Promise<CompanyOverview[]> {
  const companies = await listCompanies(tenantId, db);
  const competencia = currentCompetencia();
  const result: CompanyOverview[] = [];

  for (const company of companies) {
    const configured = await hasFiscalConfig(tenantId, company.id, db);
    if (!configured) {
      result.push({
        company_id: company.id, company_name: company.razao_social, has_fiscal_config: false,
        score: null, alerts: null, competencia_atual: null, das: null, error: false,
      });
      continue;
    }
    result.push(await buildConfiguredOverview(tenantId, company.id, company.razao_social, competencia, db));
  }

  return result;
}
