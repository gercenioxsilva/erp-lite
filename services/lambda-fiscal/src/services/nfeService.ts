import type { SQSRecord } from 'aws-lambda';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { buildFocusPayload, buildFocusNfsePayload } from '../lib/focusNfe';
import { FocusNfeClient, FocusNfseClient } from '../lib/focusNfe';
import type { FocusResponse, FocusNfseResponse } from '../lib/focusNfe';
import type {
  NfeEmitMessage, NfeResultMessage, NfseEmitMessage, NfseResultMessage,
  RemessaEmitMessage, RemessaResultMessage,
} from '../lib/types';

/** Constrói um motivo de rejeição legível a partir da resposta do Focus.
 *  Nunca devolve "status=undefined" — sempre um texto compreensível. */
function describeRejection(result: FocusResponse): string {
  if (result.erros?.length) {
    return result.erros.map(e => `[${e.codigo}] ${e.mensagem}`).join('; ');
  }
  if (result.mensagem_sefaz) return result.mensagem_sefaz;
  if (result.codigo || result.mensagem) {
    return [result.codigo, result.mensagem].filter(Boolean).join(': ');
  }
  if (result.status) return `Status Focus: ${result.status}`;
  return 'Falha ao comunicar com o Focus NF-e (sem detalhes no retorno — verifique o token de homologação)';
}

export async function processRecord(app: FastifyInstance, record: SQSRecord): Promise<void> {
  const msg: NfeEmitMessage = JSON.parse(record.body);
  const { invoice_id, tenant_id, focus_ref, ambiente } = msg;

  const focusBaseUrl = ambiente === 1
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br';

  const toAbsoluteUrl = (path: string | undefined): string | undefined => {
    if (!path) return undefined;
    return path.startsWith('http') ? path : `${focusBaseUrl}${path}`;
  };

  app.log.info({ event: 'nfe_start', invoice_id, tenant_id, focus_ref, ambiente });

  // Per-tenant token takes precedence; global env var is the fallback
  const token = msg.focus_token || app.config.focusToken;
  if (!token) throw new Error(`No Focus NF-e token for tenant ${tenant_id} — set FOCUS_NFE_TOKEN or configure per-tenant token`);

  const focus   = new FocusNfeClient(token, ambiente);
  const payload = buildFocusPayload(msg);

  let result = await focus.emitir(focus_ref, payload);
  app.log.info({ event: 'nfe_submitted', invoice_id, focus_status: result.status });

  if (result.status === 'processando') {
    result = await focus.aguardarAutorizacao(focus_ref, 60_000);
  }

  let resultMsg: NfeResultMessage;

  if (result.status === 'autorizado') {
    // Download do XML + upload S3 é secundário: nunca deve invalidar a autorização.
    let xmlKey: string | undefined;
    try {
      const xmlPath = result.caminho_xml_nota_fiscal ?? focus_ref;
      const xml     = await focus.downloadXml(xmlPath);
      const year    = new Date().getFullYear();
      xmlKey = `${tenant_id}/${year}/${focus_ref}.xml`;

      await app.s3.send(new PutObjectCommand({
        Bucket:               app.config.nfeBucket,
        Key:                  xmlKey,
        Body:                 xml,
        ContentType:          'application/xml',
        ServerSideEncryption: 'AES256',
        Metadata:             { invoice_id, tenant_id },
      }));
    } catch (err) {
      xmlKey = undefined;
      app.log.warn({ event: 'nfe_xml_download_failed', invoice_id, error: String(err) });
    }

    resultMsg = {
      invoice_id,
      tenant_id,
      nfe_status:    'authorized',
      nfe_chave:     result.chave_nfe,
      nfe_protocol:  result.protocolo ?? result.numero_protocolo,
      nfe_auth_date: result.data_autorizacao ?? msg.data_emissao,
      xml_s3_key:    xmlKey,
      danfe_url:     toAbsoluteUrl(result.caminho_danfe),
    };

    app.log.info({
      event:        'nfe_authorized',
      invoice_id,
      nfe_chave:    result.chave_nfe,
      nfe_protocol: result.numero_protocolo,
    });

  } else {
    const reason = describeRejection(result);

    resultMsg = { invoice_id, tenant_id, nfe_status: 'rejected', nfe_reject_reason: reason };
    app.log.warn({ event: 'nfe_rejected', invoice_id, reason });
  }

  await app.sqs.send(new SendMessageCommand({
    QueueUrl:    app.config.nfeResultsQueueUrl,
    MessageBody: JSON.stringify(resultMsg),
  }));
}

/** Motivo de rejeição legível para NFS-e (mesma lógica do NF-e). */
function describeNfseRejection(result: FocusNfseResponse): string {
  if (result.erros?.length) {
    return result.erros.map(e => `[${e.codigo}] ${e.mensagem}`).join('; ');
  }
  if (result.mensagem_sefaz) return result.mensagem_sefaz;
  if (result.codigo || result.mensagem) {
    return [result.codigo, result.mensagem].filter(Boolean).join(': ');
  }
  if (result.status) return `Status Focus: ${result.status}`;
  return 'Falha ao comunicar com o Focus NFS-e (sem detalhes no retorno — verifique o token e a inscrição municipal)';
}

export async function processNfseRecord(app: FastifyInstance, record: SQSRecord): Promise<void> {
  const msg: NfseEmitMessage = JSON.parse(record.body);
  const { nfse_id, tenant_id, focus_ref, ambiente } = msg;

  // Mensagem malformada (nfse_id/focus_ref ausentes) jamais fecha o ciclo: o
  // resultado voltaria com nfse_id undefined e o nfeResultsWorker não casa
  // nenhuma linha. Estourar manda o record para a DLQ (visível/retentável) em
  // vez de postar em /v2/nfse?ref=undefined.
  if (!nfse_id || !focus_ref) {
    throw new Error(`processNfseRecord: mensagem sem nfse_id/focus_ref (nfse_id=${nfse_id}, focus_ref=${focus_ref})`);
  }

  app.log.info({ event: 'nfse_start', nfse_id, tenant_id, focus_ref, ambiente });

  const token = msg.focus_token || app.config.focusToken;
  if (!token) throw new Error(`No Focus token for tenant ${tenant_id} — set FOCUS_NFE_TOKEN or configure per-tenant token`);

  const focus   = new FocusNfseClient(token, ambiente);
  const payload = buildFocusNfsePayload(msg);

  let result = await focus.emitir(focus_ref, payload);
  app.log.info({ event: 'nfse_submitted', nfse_id, focus_status: result.status });

  if (result.status === 'processando') {
    result = await focus.aguardarAutorizacao(focus_ref, 60_000);
  }

  let resultMsg: NfseResultMessage;

  if (result.status === 'autorizado') {
    resultMsg = {
      type:             'nfse',
      nfse_id,
      tenant_id,
      nfse_status:      'authorized',
      nfse_number:      result.numero_nfse,
      nfse_chave:       result.chave,
      nfse_verify_code: result.codigo_verificacao,
      nfse_protocol:    result.protocolo ?? result.numero_protocolo,
      nfse_auth_date:   result.data_emissao ?? msg.data_emissao,
      nfse_pdf_url:     result.link_download_pdf,
    };
    app.log.info({ event: 'nfse_authorized', nfse_id, nfse_number: result.numero_nfse });
  } else {
    const reason = describeNfseRejection(result);
    resultMsg = { type: 'nfse', nfse_id, tenant_id, nfse_status: 'rejected', nfse_reject_reason: reason };
    app.log.warn({ event: 'nfse_rejected', nfse_id, reason });
  }

  await app.sqs.send(new SendMessageCommand({
    QueueUrl:    app.config.nfeResultsQueueUrl,
    MessageBody: JSON.stringify(resultMsg),
  }));
}

/**
 * NF-e de Simples Remessa — mesmo modelo 55, mesmo endpoint Focus e mesmo
 * cliente (FocusNfeClient) que uma NF-e de venda comum; só o CFOP/natureza/
 * situação tributária dos itens diferem, já resolvidos pelo domínio de
 * remessa em api-core antes de a mensagem chegar aqui. buildFocusPayload()
 * não lê `invoice_id` — reaproveitado tal como está, sem duplicar lógica.
 */
export async function processRemessaRecord(app: FastifyInstance, record: SQSRecord): Promise<void> {
  const msg: RemessaEmitMessage = JSON.parse(record.body);
  const { remessa_id, tenant_id, focus_ref, ambiente } = msg;

  const focusBaseUrl = ambiente === 1
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br';

  const toAbsoluteUrl = (path: string | undefined): string | undefined => {
    if (!path) return undefined;
    return path.startsWith('http') ? path : `${focusBaseUrl}${path}`;
  };

  app.log.info({ event: 'remessa_start', remessa_id, tenant_id, focus_ref, ambiente });

  const token = msg.focus_token || app.config.focusToken;
  if (!token) throw new Error(`No Focus NF-e token for tenant ${tenant_id} — set FOCUS_NFE_TOKEN or configure per-tenant token`);

  const focus   = new FocusNfeClient(token, ambiente);
  const payload = buildFocusPayload({ ...msg, invoice_id: remessa_id } as NfeEmitMessage);

  let result = await focus.emitir(focus_ref, payload);
  app.log.info({ event: 'remessa_submitted', remessa_id, focus_status: result.status });

  if (result.status === 'processando') {
    result = await focus.aguardarAutorizacao(focus_ref, 60_000);
  }

  let resultMsg: RemessaResultMessage;

  if (result.status === 'autorizado') {
    // Download do XML + upload S3 é secundário: nunca deve invalidar a autorização.
    let xmlKey: string | undefined;
    try {
      const xmlPath = result.caminho_xml_nota_fiscal ?? focus_ref;
      const xml     = await focus.downloadXml(xmlPath);
      const year    = new Date().getFullYear();
      xmlKey = `${tenant_id}/${year}/remessa-${focus_ref}.xml`;

      await app.s3.send(new PutObjectCommand({
        Bucket:               app.config.nfeBucket,
        Key:                  xmlKey,
        Body:                 xml,
        ContentType:          'application/xml',
        ServerSideEncryption: 'AES256',
        Metadata:             { remessa_id, tenant_id },
      }));
    } catch (err) {
      xmlKey = undefined;
      app.log.warn({ event: 'remessa_xml_download_failed', remessa_id, error: String(err) });
    }

    resultMsg = {
      type:          'remessa',
      remessa_id,
      tenant_id,
      nfe_status:    'authorized',
      nfe_chave:     result.chave_nfe,
      nfe_protocol:  result.protocolo ?? result.numero_protocolo,
      nfe_auth_date: result.data_autorizacao ?? msg.data_emissao,
      xml_s3_key:    xmlKey,
      danfe_url:     toAbsoluteUrl(result.caminho_danfe),
    };

    app.log.info({
      event: 'remessa_authorized', remessa_id,
      nfe_chave: result.chave_nfe, nfe_protocol: result.numero_protocolo,
    });

  } else {
    const reason = describeRejection(result);
    resultMsg = { type: 'remessa', remessa_id, tenant_id, nfe_status: 'rejected', nfe_reject_reason: reason };
    app.log.warn({ event: 'remessa_rejected', remessa_id, reason });
  }

  await app.sqs.send(new SendMessageCommand({
    QueueUrl:    app.config.nfeResultsQueueUrl,
    MessageBody: JSON.stringify(resultMsg),
  }));
}
