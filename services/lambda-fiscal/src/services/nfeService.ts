import type { SQSRecord } from 'aws-lambda';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { buildFocusPayload } from '../lib/focusNfe';
import { FocusNfeClient } from '../lib/focusNfe';
import type { NfeEmitMessage, NfeResultMessage } from '../lib/types';

export async function processRecord(app: FastifyInstance, record: SQSRecord): Promise<void> {
  const msg: NfeEmitMessage = JSON.parse(record.body);
  const { invoice_id, tenant_id, focus_ref, ambiente } = msg;

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
    const xml    = await focus.downloadXml(focus_ref);
    const year   = new Date().getFullYear();
    const xmlKey = `${tenant_id}/${year}/${focus_ref}.xml`;

    await app.s3.send(new PutObjectCommand({
      Bucket:               app.config.nfeBucket,
      Key:                  xmlKey,
      Body:                 xml,
      ContentType:          'application/xml',
      ServerSideEncryption: 'AES256',
      Metadata:             { invoice_id, tenant_id },
    }));

    resultMsg = {
      invoice_id,
      tenant_id,
      nfe_status:    'authorized',
      nfe_chave:     result.chave_nfe,
      nfe_protocol:  result.numero_protocolo,
      nfe_auth_date: result.data_autorizacao,
      xml_s3_key:    xmlKey,
      danfe_url:     result.caminho_danfe,
    };

    app.log.info({
      event:        'nfe_authorized',
      invoice_id,
      nfe_chave:    result.chave_nfe,
      nfe_protocol: result.numero_protocolo,
    });

  } else {
    const reason = result.erros?.map(e => `[${e.codigo}] ${e.mensagem}`).join('; ')
      ?? result.mensagem_sefaz
      ?? `status=${result.status}`;

    resultMsg = { invoice_id, tenant_id, nfe_status: 'rejected', nfe_reject_reason: reason };
    app.log.warn({ event: 'nfe_rejected', invoice_id, reason });
  }

  await app.sqs.send(new SendMessageCommand({
    QueueUrl:    app.config.nfeResultsQueueUrl,
    MessageBody: JSON.stringify(resultMsg),
  }));
}
