// Emissão NFS-e com adapters PRÓPRIOS (0074) — lado api-core.
// Divisão de responsabilidade: aqui a nota é montada e ASSINADA (o certificado
// A1 vive no banco e o domínio é 100% testável); o lambda-fiscal só transporta
// (SOAP POST no webservice municipal) e devolve o resultado pela fila de
// results. Focus continua sendo o default/fallback (nfse_provider='focus').
//
// Simulação: endpoint do registry começando com 'local-' nunca sai para a
// rede — o lambda devolve 'authorized' sintético (mesmo padrão do token
// 'local-' do Focus), permitindo o ciclo completo em dev.

import { eq, and, sql } from 'drizzle-orm';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { db as _db } from '../db';
import {
  nfseInvoices, nfseMunicipalities, nfeConfigs, fiscalCertificates, clients,
} from '../db/schema';
import { getSqsClient } from '../lib/sqsClient';
import { getOrCreateConfig } from './fiscalCompanyConfigService';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { toNumber } from '../lib/money';
import { FiscalDomainError } from '../domain/fiscal/fiscalCompanyConfigDomain';
import { buildRpsXml, buildLoteXml, buildCancelXml, rpsInfId, CANCEL_INF_ID } from '../domain/nfse/abrasfXml';
import { loadCertificateFromPfx, signXmlElement, LoadedCertificate } from '../domain/nfse/xmlSigner';

export type DrizzleDB = typeof _db;

export interface AbrasfEmitMessage {
  type: 'nfse';
  action: 'emit' | 'cancel';
  provider: 'abrasf';
  tenant_id: string;
  nfse_id: string;
  ambiente: number;              // 1=produção, 2=homologação
  endpoint: string;
  abrasf_versao: string | null;
  perfil: string | null;
  signed_xml: string;            // lote (emit) ou pedido de cancelamento assinado
}

async function loadActiveCertificate(companyId: string, db: DrizzleDB): Promise<LoadedCertificate> {
  const [row] = await db.select().from(fiscalCertificates)
    .where(and(eq(fiscalCertificates.company_id, companyId), eq(fiscalCertificates.is_active, true)));
  if (!row) throw new FiscalDomainError('certificate_missing');
  const creds = row.credentials as { pfx_base64?: string; senha?: string };
  if (!creds?.pfx_base64) throw new FiscalDomainError('certificate_missing');
  if (row.not_after && row.not_after <= new Date()) throw new FiscalDomainError('certificate_expired');
  return loadCertificateFromPfx(creds.pfx_base64, creds.senha ?? '');
}

async function loadMunicipality(codigoIbge: string | null, db: DrizzleDB) {
  if (!codigoIbge) throw new FiscalDomainError('municipio_ibge_missing');
  const [m] = await db.select().from(nfseMunicipalities)
    .where(eq(nfseMunicipalities.codigo_ibge, codigoIbge));
  if (!m || !m.ativo) throw new FiscalDomainError('municipality_not_registered', { codigoIbge });
  if (m.provider !== 'abrasf') throw new FiscalDomainError('provider_not_supported_yet', { provider: m.provider });
  return m;
}

/**
 * Monta, assina e enfileira a emissão ABRASF de uma nfse_invoice existente.
 * Idempotente: nota que já tem rps_numero não realoca; status-guard no update.
 */
export async function enqueueAbrasfEmission(tenantId: string, nfseId: string, db: DrizzleDB = _db): Promise<{ enqueued: boolean; simulated: boolean }> {
  const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
  const [nfse] = await db.select().from(nfseInvoices)
    .where(and(eq(nfseInvoices.id, nfseId), eq(nfseInvoices.tenant_id, tenantId)));
  if (!nfse) throw new FiscalDomainError('nfse_not_found', { nfseId });
  const companyId = nfse.company_id;
  if (!companyId) throw new FiscalDomainError('nfse_without_company', { nfseId });

  const [company] = await db.select().from(nfeConfigs).where(eq(nfeConfigs.id, companyId));
  if (!company) throw new FiscalDomainError('company_not_found');
  const fiscalConfig = await getOrCreateConfig(tenantId, companyId, db);
  const municipality = await loadMunicipality(nfse.municipio_ibge ?? company.codigo_municipio_ibge, db);
  const cert = await loadActiveCertificate(companyId, db);

  // Número de RPS: reusa o já alocado (reenvio) ou aloca o próximo.
  let rpsNumero = nfse.rps_numero;
  let rpsSerie = nfse.rps_serie ?? fiscalConfig.rps_serie;
  if (!rpsNumero) {
    const { rows } = await db.execute<{ n: number; s: string }>(
      sql`UPDATE fiscal_company_config
          SET rps_proximo_numero = rps_proximo_numero + 1, updated_at = NOW()
          WHERE id = ${fiscalConfig.id}
          RETURNING rps_proximo_numero - 1 AS n, rps_serie AS s`
    );
    rpsNumero = Number(rows[0].n);
    rpsSerie = rows[0].s;
  }

  const [client] = nfse.client_id
    ? await db.select().from(clients).where(eq(clients.id, nfse.client_id))
    : [null];

  const rpsInput = {
    rpsNumero, rpsSerie,
    dataEmissao: new Date(),
    valorServicos: toNumber(nfse.amount),
    deducoes: nfse.deducoes ? toNumber(nfse.deducoes) : 0,
    aliquotaIss: toNumber(nfse.iss_rate),
    issRetido: nfse.iss_retido,
    itemListaServico: nfse.service_code || company.codigo_servico_padrao || '',
    codigoMunicipioIbge: municipality.codigo_ibge,
    discriminacao: nfse.description,
    prestador: { cnpj: company.cnpj.replace(/\D/g, ''), inscricaoMunicipal: company.inscricao_municipal ?? '' },
    tomador: client ? {
      document: (client.cnpj ?? client.cpf ?? '')?.replace(/\D/g, '') || null,
      razaoSocial: client.company_name ?? client.full_name ?? null,
    } : null,
    optanteSimples: fiscalConfig.optante_simples,
  };

  const signedRps = signXmlElement(buildRpsXml(rpsInput), {
    referenceId: rpsInfId(rpsInput), elementName: 'InfDeclaracaoPrestacaoServico',
    algo: municipality.signature_algo as 'rsa-sha1' | 'rsa-sha256',
    c14n: municipality.c14n as 'inclusive' | 'exclusive',
    cert,
  });
  const lote = buildLoteXml({ loteId: rpsNumero, prestador: rpsInput.prestador, signedRpsXml: [signedRps] });

  const ambiente = nfse.ambiente ?? 2;
  const endpoint = (ambiente === 1 ? municipality.endpoint_producao : municipality.endpoint_homolog) ?? '';
  if (!endpoint) throw new FiscalDomainError('municipality_endpoint_missing', { ambiente });

  await db.update(nfseInvoices).set({
    provider: 'abrasf', municipio_ibge: municipality.codigo_ibge, ambiente,
    rps_numero: rpsNumero, rps_serie: rpsSerie,
    nfse_status: 'pending', nfse_attempts: sql`nfse_attempts + 1`,
  }).where(eq(nfseInvoices.id, nfse.id));

  const message: AbrasfEmitMessage = {
    type: 'nfse', action: 'emit', provider: 'abrasf',
    tenant_id: tenantId, nfse_id: nfse.id, ambiente, endpoint,
    abrasf_versao: municipality.abrasf_versao, perfil: municipality.perfil,
    signed_xml: lote,
  };

  await recordFiscalEvent({
    tenantId, companyId: companyId, aggregateType: 'nfse', aggregateId: nfse.id,
    eventType: 'abrasf_emit_enqueued',
    requestPayload: { rps: `${rpsSerie}/${rpsNumero}`, municipio: municipality.codigo_ibge, ambiente },
    idempotencyKey: `abrasf_emit:${nfse.id}:${rpsNumero}`,
  }, db);

  if (!queueUrl) {
    // Sem fila local: mantém 'pending' (mesma tolerância do enqueueNfseEmission).
    return { enqueued: false, simulated: endpoint.startsWith('local-') };
  }
  await getSqsClient().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
  await db.update(nfseInvoices).set({ nfse_status: 'processing' }).where(eq(nfseInvoices.id, nfse.id));
  return { enqueued: true, simulated: endpoint.startsWith('local-') };
}

/** Cancelamento ABRASF: assina o pedido e enfileira action:'cancel'. */
export async function enqueueAbrasfCancel(
  tenantId: string, nfseId: string, reason: string, actorUserId: string | null, db: DrizzleDB = _db,
): Promise<{ enqueued: boolean }> {
  const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
  const [nfse] = await db.select().from(nfseInvoices)
    .where(and(eq(nfseInvoices.id, nfseId), eq(nfseInvoices.tenant_id, tenantId)));
  if (!nfse) throw new FiscalDomainError('nfse_not_found', { nfseId });
  if (nfse.nfse_status !== 'authorized') throw new FiscalDomainError('nfse_not_cancellable', { status: nfse.nfse_status });
  if (!nfse.nfse_number) throw new FiscalDomainError('nfse_number_missing');
  if (nfse.provider !== 'abrasf') throw new FiscalDomainError('cancel_not_supported_for_provider', { provider: nfse.provider });
  const companyId = nfse.company_id;
  if (!companyId) throw new FiscalDomainError('nfse_without_company', { nfseId });

  const [company] = await db.select().from(nfeConfigs).where(eq(nfeConfigs.id, companyId));
  const municipality = await loadMunicipality(nfse.municipio_ibge, db);
  const cert = await loadActiveCertificate(companyId, db);

  const cancelXml = buildCancelXml({
    nfseNumero: nfse.nfse_number,
    prestador: { cnpj: company!.cnpj.replace(/\D/g, ''), inscricaoMunicipal: company!.inscricao_municipal ?? '' },
    codigoMunicipioIbge: municipality.codigo_ibge,
  });
  const signed = signXmlElement(cancelXml, {
    referenceId: CANCEL_INF_ID(nfse.nfse_number), elementName: 'InfPedidoCancelamento',
    algo: municipality.signature_algo as 'rsa-sha1' | 'rsa-sha256',
    c14n: municipality.c14n as 'inclusive' | 'exclusive',
    cert,
  });

  const endpoint = (nfse.ambiente === 1 ? municipality.endpoint_producao : municipality.endpoint_homolog) ?? '';
  await db.update(nfseInvoices).set({ cancel_reason: reason }).where(eq(nfseInvoices.id, nfse.id));

  await recordFiscalEvent({
    tenantId, companyId: companyId, aggregateType: 'nfse', aggregateId: nfse.id,
    eventType: 'abrasf_cancel_enqueued', actorUserId, requestPayload: { reason },
  }, db);

  if (!queueUrl) return { enqueued: false };
  const message: AbrasfEmitMessage = {
    type: 'nfse', action: 'cancel', provider: 'abrasf',
    tenant_id: tenantId, nfse_id: nfse.id, ambiente: nfse.ambiente, endpoint,
    abrasf_versao: municipality.abrasf_versao, perfil: municipality.perfil,
    signed_xml: signed,
  };
  await getSqsClient().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
  return { enqueued: true };
}
