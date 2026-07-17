// Application Service — Integração Fiscal automatizada (regra 70).
// Orquestra o registro ASSÍNCRONO da empresa no emissor fiscal (mesma fila
// nfe-requests/nfe-results de nfe/nfse/remessa, discriminada por
// type='company_registration') e as operações SÍNCRONAS de upload de
// certificado digital e teste de conexão. Nunca expõe o nome do provedor
// (Focus) pro tenant — só o backend/infra sabe disso.

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { eq } from 'drizzle-orm';
import { db as _db } from '../db';
import { nfeConfigs, fiscalIntegrationEvents } from '../db/schema';
import {
  assertCanRegister, assertCanUploadCertificate, assertCanTestConnection,
  validateCertificateUpload, deriveFiscalIntegrationStatus,
  FiscalIntegrationDomainError,
  type FiscalRegistrationStatus, type FiscalIntegrationDisplayStatus,
} from '../domain/fiscalIntegration/fiscalIntegrationDomain';
import { resolveCompanyId, type Company } from './companyService';
import { buildCompanyRegistrationEmitMessage } from '../lib/companyRegistration';
import { uploadCertificado, testarConexaoFiscal } from './fiscal/fiscalIntegrationClient';
import { getSqsClient } from '../lib/sqsClient';

export type DrizzleDB = typeof _db;
export { FiscalIntegrationDomainError };

export interface FiscalIntegrationState {
  companyId:            string;
  status:               FiscalIntegrationDisplayStatus;
  registrationError:    string | null;
  certificadoCnpj:      string | null;
  certificadoValidoAte: string | null;
}

export function toFiscalIntegrationState(cfg: Company): FiscalIntegrationState {
  return {
    companyId: cfg.id,
    status: deriveFiscalIntegrationStatus({
      fiscal_integration_ref:     cfg.fiscal_integration_ref,
      fiscal_registration_status: cfg.fiscal_registration_status as FiscalRegistrationStatus,
      certificado_valido_ate:     cfg.certificado_valido_ate,
    }),
    registrationError:    cfg.fiscal_registration_error,
    certificadoCnpj:      cfg.certificado_cnpj,
    certificadoValidoAte: cfg.certificado_valido_ate,
  };
}

/** Dispara o registro assíncrono da empresa no emissor fiscal. */
export async function registerCompanyFiscalIntegration(
  tenantId: string, companyId: string, db: DrizzleDB = _db,
): Promise<FiscalIntegrationState> {
  const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
  if (!queueUrl) throw new FiscalIntegrationDomainError('registration_not_configured');

  const cfg = await resolveCompanyId(tenantId, companyId, db);
  assertCanRegister(cfg.fiscal_registration_status as FiscalRegistrationStatus);

  const message = buildCompanyRegistrationEmitMessage({ tenant_id: tenantId, cfg });
  const previousStatus = cfg.fiscal_registration_status;

  await db.update(nfeConfigs).set({
    fiscal_registration_status:   'pending',
    fiscal_registration_attempts: cfg.fiscal_registration_attempts + 1,
    fiscal_registration_error:    null,
    updated_at: new Date(),
  }).where(eq(nfeConfigs.id, companyId));

  try {
    await getSqsClient().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
  } catch (err) {
    // Nunca deixa a empresa "presa" em pending sem ninguém processando —
    // mesmo princípio de tolerância a falha de simplesRemessaService.ts.
    await db.update(nfeConfigs).set({ fiscal_registration_status: previousStatus }).where(eq(nfeConfigs.id, companyId));
    throw err;
  }

  const [updated] = await db.update(nfeConfigs).set({ fiscal_registration_status: 'processing' })
    .where(eq(nfeConfigs.id, companyId)).returning();

  await db.insert(fiscalIntegrationEvents).values({
    company_id: companyId, tenant_id: tenantId, event_type: 'registration_requested',
  });

  return toFiscalIntegrationState(updated);
}

export interface CertificateUploadInput {
  certificado_base64: string;
  senha_certificado:  string;
}

/** Upload síncrono do certificado digital A1 — exige a empresa já registrada. */
export async function uploadCompanyCertificate(
  tenantId: string, companyId: string, input: CertificateUploadInput, db: DrizzleDB = _db,
): Promise<FiscalIntegrationState> {
  const cfg = await resolveCompanyId(tenantId, companyId, db);
  assertCanUploadCertificate(cfg.fiscal_integration_ref);
  validateCertificateUpload(input);

  const result = await uploadCertificado(
    cfg.fiscal_integration_ref!, cfg.focus_ambiente, input.certificado_base64, input.senha_certificado,
  );

  if (!result.ok) {
    await db.insert(fiscalIntegrationEvents).values({
      company_id: companyId, tenant_id: tenantId, event_type: 'certificate_rejected',
      payload: { reason: result.reason },
    });
    throw new FiscalIntegrationDomainError('certificate_upload_failed', { reason: result.reason });
  }

  const [updated] = await db.update(nfeConfigs).set({
    certificado_cnpj:       result.certificado_cnpj       ?? cfg.certificado_cnpj,
    certificado_valido_de:  result.certificado_valido_de  ?? cfg.certificado_valido_de,
    certificado_valido_ate: result.certificado_valido_ate ?? cfg.certificado_valido_ate,
    updated_at: new Date(),
  }).where(eq(nfeConfigs.id, companyId)).returning();

  await db.insert(fiscalIntegrationEvents).values({
    company_id: companyId, tenant_id: tenantId, event_type: 'certificate_uploaded',
    payload: { certificado_valido_ate: result.certificado_valido_ate },
  });

  return toFiscalIntegrationState(updated);
}

export interface ConnectionTestResult {
  ok:     boolean;
  reason?: string;
}

/** Teste síncrono de conexão — só confirma que a empresa está acessível no emissor fiscal. */
export async function testCompanyFiscalConnection(
  tenantId: string, companyId: string, db: DrizzleDB = _db,
): Promise<ConnectionTestResult> {
  const cfg = await resolveCompanyId(tenantId, companyId, db);
  assertCanTestConnection(cfg.fiscal_integration_ref);

  const result = await testarConexaoFiscal(cfg.fiscal_integration_ref!, cfg.focus_ambiente);

  await db.insert(fiscalIntegrationEvents).values({
    company_id: companyId, tenant_id: tenantId,
    event_type:  'connection_test',
    status_code: result.ok ? 'ok' : 'error',
    payload:     result.ok ? null : { reason: result.reason },
  });

  return result;
}
