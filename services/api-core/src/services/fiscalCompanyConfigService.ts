// Cadastro fiscal por empresa (migration 0069) — camada de serviço.
// Escopo SEMPRE (tenantId do JWT, companyId validado por resolveCompanyId);
// toda mutação registra auditoria via fiscalAuditService.record().

import { eq, and, desc } from 'drizzle-orm';
import { db as _db } from '../db';
import {
  fiscalCompanyConfig, fiscalCompanyCnae, fiscalCompanyServiceCode,
  fiscalCompanyPayrollMonth, fiscalCertificates, nfeConfigs,
} from '../db/schema';
import { resolveCompanyId } from './companyService';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import {
  FiscalDomainError, ENQUADRAMENTOS, NFSE_PROVIDERS,
  normalizeCnae, normalizeLc116, validateCompetencia,
  parseA1Certificate, evaluateEmissionReadiness,
} from '../domain/fiscal/fiscalCompanyConfigDomain';

export type DrizzleDB = typeof _db;
export type FiscalConfig = typeof fiscalCompanyConfig.$inferSelect;

/** Config 1:1 — cria a linha default na primeira leitura (get-or-create). */
export async function getOrCreateConfig(tenantId: string, companyId: string, db: DrizzleDB = _db): Promise<FiscalConfig> {
  const resolved = (await resolveCompanyId(tenantId, companyId, db)).id;
  const [existing] = await db.select().from(fiscalCompanyConfig)
    .where(and(eq(fiscalCompanyConfig.tenant_id, tenantId), eq(fiscalCompanyConfig.company_id, resolved)));
  if (existing) return existing;
  try {
    const [created] = await db.insert(fiscalCompanyConfig)
      .values({ tenant_id: tenantId, company_id: resolved }).returning();
    return created;
  } catch (err) {
    if (isUniqueConstraintViolation(err)) { // corrida benigna: outra request criou
      const [row] = await db.select().from(fiscalCompanyConfig)
        .where(eq(fiscalCompanyConfig.company_id, resolved));
      return row;
    }
    throw err;
  }
}

// Allowlist de campos editáveis (mesmo racional do PATCH /v1/tenant).
const EDITABLE_FIELDS = [
  'enquadramento', 'optante_simples', 'data_opcao_simples', 'data_abertura',
  'anexo_padrao', 'fator_r_aplicavel', 'regime_apuracao', 'iss_retido_padrao',
  'iss_fixo', 'iss_fixo_valor', 'retencao_federal', 'retencoes',
  'receita_acumulada_abertura', 'rbt12_manual',
  'nfse_provider', 'nfse_provider_profile', 'rps_serie', 'rps_proximo_numero', 'lote_proximo_numero',
] as const;

export async function upsertConfig(
  tenantId: string, companyId: string, input: Record<string, unknown>, actorUserId: string | null, db: DrizzleDB = _db,
): Promise<FiscalConfig> {
  const current = await getOrCreateConfig(tenantId, companyId, db);

  const patch: Record<string, unknown> = {};
  for (const f of EDITABLE_FIELDS) if (input[f] !== undefined) patch[f] = input[f];

  if (patch.enquadramento !== undefined && !ENQUADRAMENTOS.includes(patch.enquadramento as any)) {
    throw new FiscalDomainError('invalid_enquadramento', { enquadramento: patch.enquadramento });
  }
  if (patch.nfse_provider !== undefined && !NFSE_PROVIDERS.includes(patch.nfse_provider as any)) {
    throw new FiscalDomainError('invalid_nfse_provider', { nfse_provider: patch.nfse_provider });
  }
  if (patch.anexo_padrao !== undefined && patch.anexo_padrao !== null) {
    const n = Number(patch.anexo_padrao);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new FiscalDomainError('invalid_anexo', { anexo: patch.anexo_padrao });
  }
  if (patch.regime_apuracao !== undefined && !['caixa', 'competencia'].includes(patch.regime_apuracao as string)) {
    throw new FiscalDomainError('invalid_regime_apuracao', { regime_apuracao: patch.regime_apuracao });
  }

  if (Object.keys(patch).length === 0) return current;

  const [updated] = await db.update(fiscalCompanyConfig)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(fiscalCompanyConfig.id, current.id)).returning();

  await recordFiscalEvent({
    tenantId, companyId: current.company_id, aggregateType: 'company_config', aggregateId: current.id,
    eventType: 'config_updated', actorUserId, requestPayload: patch,
  }, db);
  return updated;
}

/* ── CNAEs ─────────────────────────────────────────────────────────────── */

export async function addCnae(
  tenantId: string, companyId: string, args: { codigo: string; descricao?: string | null; is_principal?: boolean },
  actorUserId: string | null, db: DrizzleDB = _db,
) {
  const resolved = (await resolveCompanyId(tenantId, companyId, db)).id;
  const codigo = normalizeCnae(args.codigo);
  if (args.is_principal) {
    await db.update(fiscalCompanyCnae).set({ is_principal: false })
      .where(and(eq(fiscalCompanyCnae.company_id, resolved), eq(fiscalCompanyCnae.is_principal, true)));
  }
  try {
    const [row] = await db.insert(fiscalCompanyCnae).values({
      tenant_id: tenantId, company_id: resolved, codigo,
      descricao: args.descricao ?? null, is_principal: args.is_principal ?? false,
    }).returning();
    await recordFiscalEvent({
      tenantId, companyId: resolved, aggregateType: 'cnae', aggregateId: row.id,
      eventType: 'cnae_added', actorUserId, requestPayload: { codigo, is_principal: row.is_principal },
    }, db);
    return row;
  } catch (err) {
    if (isUniqueConstraintViolation(err)) throw new FiscalDomainError('cnae_already_exists', { codigo });
    throw err;
  }
}

export async function removeCnae(tenantId: string, companyId: string, cnaeId: string, actorUserId: string | null, db: DrizzleDB = _db) {
  const resolved = (await resolveCompanyId(tenantId, companyId, db)).id;
  const [deleted] = await db.delete(fiscalCompanyCnae)
    .where(and(eq(fiscalCompanyCnae.id, cnaeId), eq(fiscalCompanyCnae.tenant_id, tenantId), eq(fiscalCompanyCnae.company_id, resolved)))
    .returning();
  if (!deleted) throw new FiscalDomainError('cnae_not_found', { id: cnaeId });
  await recordFiscalEvent({
    tenantId, companyId: resolved, aggregateType: 'cnae', aggregateId: cnaeId,
    eventType: 'cnae_removed', actorUserId, requestPayload: { codigo: deleted.codigo },
  }, db);
}

export async function listCnaes(tenantId: string, companyId: string, db: DrizzleDB = _db) {
  const resolved = (await resolveCompanyId(tenantId, companyId, db)).id;
  return db.select().from(fiscalCompanyCnae)
    .where(and(eq(fiscalCompanyCnae.tenant_id, tenantId), eq(fiscalCompanyCnae.company_id, resolved)));
}

/* ── Códigos de serviço (LC 116) ───────────────────────────────────────── */

export async function upsertServiceCode(
  tenantId: string, companyId: string,
  args: { codigo_lc116: string; codigo_municipal?: string | null; descricao?: string | null; aliquota_iss?: string | number | null; iss_retido?: boolean; anexo?: number | null; is_default?: boolean },
  actorUserId: string | null, db: DrizzleDB = _db,
) {
  const resolved = (await resolveCompanyId(tenantId, companyId, db)).id;
  const codigo = normalizeLc116(args.codigo_lc116);
  if (args.anexo !== undefined && args.anexo !== null && (!Number.isInteger(args.anexo) || args.anexo < 1 || args.anexo > 5)) {
    throw new FiscalDomainError('invalid_anexo', { anexo: args.anexo });
  }
  if (args.is_default) {
    await db.update(fiscalCompanyServiceCode).set({ is_default: false })
      .where(and(eq(fiscalCompanyServiceCode.company_id, resolved), eq(fiscalCompanyServiceCode.is_default, true)));
  }
  const values = {
    tenant_id: tenantId, company_id: resolved, codigo_lc116: codigo,
    codigo_municipal: args.codigo_municipal ?? null, descricao: args.descricao ?? null,
    aliquota_iss: args.aliquota_iss != null ? String(args.aliquota_iss) : null,
    iss_retido: args.iss_retido ?? false, anexo: args.anexo ?? null, is_default: args.is_default ?? false,
  };
  const [existing] = await db.select().from(fiscalCompanyServiceCode)
    .where(and(eq(fiscalCompanyServiceCode.company_id, resolved), eq(fiscalCompanyServiceCode.codigo_lc116, codigo)));
  const [row] = existing
    ? await db.update(fiscalCompanyServiceCode).set(values).where(eq(fiscalCompanyServiceCode.id, existing.id)).returning()
    : await db.insert(fiscalCompanyServiceCode).values(values).returning();
  await recordFiscalEvent({
    tenantId, companyId: resolved, aggregateType: 'service_code', aggregateId: row.id,
    eventType: 'service_code_upserted', actorUserId, requestPayload: { codigo_lc116: codigo },
  }, db);
  return row;
}

export async function removeServiceCode(tenantId: string, companyId: string, id: string, actorUserId: string | null, db: DrizzleDB = _db) {
  const resolved = (await resolveCompanyId(tenantId, companyId, db)).id;
  const [deleted] = await db.delete(fiscalCompanyServiceCode)
    .where(and(eq(fiscalCompanyServiceCode.id, id), eq(fiscalCompanyServiceCode.tenant_id, tenantId), eq(fiscalCompanyServiceCode.company_id, resolved)))
    .returning();
  if (!deleted) throw new FiscalDomainError('service_code_not_found', { id });
  await recordFiscalEvent({
    tenantId, companyId: resolved, aggregateType: 'service_code', aggregateId: id,
    eventType: 'service_code_removed', actorUserId, requestPayload: { codigo_lc116: deleted.codigo_lc116 },
  }, db);
}

export async function listServiceCodes(tenantId: string, companyId: string, db: DrizzleDB = _db) {
  const resolved = (await resolveCompanyId(tenantId, companyId, db)).id;
  return db.select().from(fiscalCompanyServiceCode)
    .where(and(eq(fiscalCompanyServiceCode.tenant_id, tenantId), eq(fiscalCompanyServiceCode.company_id, resolved)));
}

/* ── Folha 12m (Fator R) ───────────────────────────────────────────────── */

export async function recordPayrollMonth(
  tenantId: string, companyId: string,
  args: { competencia: string; folha_amount: string | number; pro_labore_amount?: string | number },
  actorUserId: string | null, db: DrizzleDB = _db,
) {
  const resolved = (await resolveCompanyId(tenantId, companyId, db)).id;
  const competencia = validateCompetencia(args.competencia);
  const values = {
    folha_amount: String(args.folha_amount ?? 0),
    pro_labore_amount: String(args.pro_labore_amount ?? 0),
    source: 'manual' as const,
  };
  const [existing] = await db.select().from(fiscalCompanyPayrollMonth)
    .where(and(eq(fiscalCompanyPayrollMonth.company_id, resolved), eq(fiscalCompanyPayrollMonth.competencia, competencia)));
  const [row] = existing
    ? await db.update(fiscalCompanyPayrollMonth).set({ ...values, updated_at: new Date() })
        .where(eq(fiscalCompanyPayrollMonth.id, existing.id)).returning()
    : await db.insert(fiscalCompanyPayrollMonth).values({
        tenant_id: tenantId, company_id: resolved, competencia, ...values, created_by: actorUserId,
      }).returning();
  await recordFiscalEvent({
    tenantId, companyId: resolved, aggregateType: 'payroll', aggregateId: row.id,
    eventType: 'payroll_recorded', actorUserId,
    requestPayload: { competencia, ...values },
    idempotencyKey: undefined, // upsert por UNIQUE(company,competencia) já garante 1 linha
  }, db);
  return row;
}

export async function listPayrollMonths(tenantId: string, companyId: string, db: DrizzleDB = _db) {
  const resolved = (await resolveCompanyId(tenantId, companyId, db)).id;
  return db.select().from(fiscalCompanyPayrollMonth)
    .where(and(eq(fiscalCompanyPayrollMonth.tenant_id, tenantId), eq(fiscalCompanyPayrollMonth.company_id, resolved)))
    .orderBy(desc(fiscalCompanyPayrollMonth.competencia));
}

/* ── Certificado A1 ────────────────────────────────────────────────────── */

export interface CertificateStatus {
  present:    boolean;
  cn:         string | null;
  not_before: Date | null;
  not_after:  Date | null;
  thumbprint: string | null;
  expired:    boolean;
}

export async function uploadA1Certificate(
  tenantId: string, companyId: string, pfxBase64: string, senha: string,
  actorUserId: string | null, db: DrizzleDB = _db,
): Promise<CertificateStatus> {
  const resolved = (await resolveCompanyId(tenantId, companyId, db)).id;
  const parsed = parseA1Certificate(pfxBase64, senha); // valida senha + extrai metadados

  // Troca atômica: desativa o anterior (histórico preservado) e insere o novo.
  await db.update(fiscalCertificates).set({ is_active: false })
    .where(and(eq(fiscalCertificates.company_id, resolved), eq(fiscalCertificates.is_active, true)));
  const [row] = await db.insert(fiscalCertificates).values({
    tenant_id: tenantId, company_id: resolved,
    credentials: { pfx_base64: pfxBase64, senha },
    cn: parsed.cn, not_before: parsed.notBefore, not_after: parsed.notAfter,
    thumbprint: parsed.thumbprint, created_by: actorUserId,
  }).returning();

  // Payload de auditoria SÓ com metadados — nunca pfx/senha (e o
  // fiscalAuditService ainda sanitiza por chave como cinto de segurança).
  await recordFiscalEvent({
    tenantId, companyId: resolved, aggregateType: 'certificate', aggregateId: row.id,
    eventType: 'certificate_uploaded', actorUserId,
    requestPayload: { cn: parsed.cn, not_after: parsed.notAfter.toISOString(), thumbprint: parsed.thumbprint },
  }, db);

  return { present: true, cn: parsed.cn, not_before: parsed.notBefore, not_after: parsed.notAfter, thumbprint: parsed.thumbprint, expired: parsed.notAfter <= new Date() };
}

export async function getCertificateStatus(tenantId: string, companyId: string, db: DrizzleDB = _db): Promise<CertificateStatus> {
  const resolved = (await resolveCompanyId(tenantId, companyId, db)).id;
  const [row] = await db.select({
    cn: fiscalCertificates.cn, not_before: fiscalCertificates.not_before,
    not_after: fiscalCertificates.not_after, thumbprint: fiscalCertificates.thumbprint,
  }).from(fiscalCertificates)
    .where(and(eq(fiscalCertificates.company_id, resolved), eq(fiscalCertificates.is_active, true)));
  if (!row) return { present: false, cn: null, not_before: null, not_after: null, thumbprint: null, expired: false };
  return { present: true, ...row, expired: !!row.not_after && row.not_after <= new Date() };
}

export async function removeCertificate(tenantId: string, companyId: string, actorUserId: string | null, db: DrizzleDB = _db) {
  const resolved = (await resolveCompanyId(tenantId, companyId, db)).id;
  const [deactivated] = await db.update(fiscalCertificates).set({ is_active: false })
    .where(and(eq(fiscalCertificates.company_id, resolved), eq(fiscalCertificates.is_active, true)))
    .returning();
  if (!deactivated) throw new FiscalDomainError('certificate_not_found');
  await recordFiscalEvent({
    tenantId, companyId: resolved, aggregateType: 'certificate', aggregateId: deactivated.id,
    eventType: 'certificate_removed', actorUserId,
  }, db);
}

/* ── Readiness (gate VALIDAR da emissão) ───────────────────────────────── */

export async function getEmissionReadiness(
  tenantId: string, companyId: string, db: DrizzleDB = _db,
): Promise<{ ready: boolean; reasons: string[] }> {
  const config = await getOrCreateConfig(tenantId, companyId, db);
  const [company] = await db.select({ inscricao_municipal: nfeConfigs.inscricao_municipal })
    .from(nfeConfigs).where(eq(nfeConfigs.id, config.company_id));
  const serviceCodes = await db.select({ id: fiscalCompanyServiceCode.id }).from(fiscalCompanyServiceCode)
    .where(eq(fiscalCompanyServiceCode.company_id, config.company_id));
  const cert = await getCertificateStatus(tenantId, config.company_id, db);

  return evaluateEmissionReadiness({
    docType: 'nfse',
    optanteSimples: config.optante_simples,
    enquadramento: config.enquadramento,
    nfseProvider: config.nfse_provider,
    hasServiceCode: serviceCodes.length > 0,
    inscricaoMunicipal: company?.inscricao_municipal ?? null,
    certificate: cert.present ? { notAfter: cert.not_after } : null,
    now: new Date(),
  });
}
