import type { SQSHandler, SQSRecord } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { FocusNfeClient, buildFocusPayload } from './focusNfe';
import type { NfeEmitMessage, NfeResultMessage } from './types';
import { config } from './config';

const sqs = new SQSClient({ region: config.awsRegion });
const s3  = new S3Client({ region: config.awsRegion });

// Cache Focus client across warm invocations (same ambiente assumed per Lambda env)
let focusClient: FocusNfeClient | null = null;
function getClient(ambiente: 1 | 2) {
  if (!focusClient) focusClient = new FocusNfeClient(config.focusToken, ambiente);
  return focusClient;
}

export const handler: SQSHandler = async (event) => {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error', event: 'record_failed',
        invoice_id: safeInvoiceId(record), error: String(err),
      }));
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  // report_batch_item_failures: only failed records return to queue for retry
  if (failures.length) return { batchItemFailures: failures };
};

async function processRecord(record: SQSRecord): Promise<void> {
  const msg: NfeEmitMessage = JSON.parse(record.body);
  const { invoice_id, tenant_id, focus_ref, ambiente } = msg;

  log('info', 'nfe_start', { invoice_id, tenant_id, focus_ref, ambiente });

  const focus   = getClient(ambiente);
  const payload = buildFocusPayload(msg);

  // Submit to Focus NF-e (which handles XML generation, signing, and SEFAZ communication)
  let result = await focus.emitir(focus_ref, payload);
  log('info', 'nfe_submitted', { invoice_id, focus_status: result.status });

  if (result.status === 'processando') {
    result = await focus.aguardarAutorizacao(focus_ref, 60_000);
  }

  let resultMsg: NfeResultMessage;

  if (result.status === 'autorizado') {
    // Download the SEFAZ-signed XML from Focus and store in our S3 for legal retention
    const xml    = await focus.downloadXml(focus_ref);
    const year   = new Date().getFullYear();
    const xmlKey = `${tenant_id}/${year}/${focus_ref}.xml`;

    await s3.send(new PutObjectCommand({
      Bucket:               config.nfeBucket,
      Key:                  xmlKey,
      Body:                 xml,
      ContentType:          'application/xml',
      ServerSideEncryption: 'AES256',
      Metadata:             { invoice_id, tenant_id },
    }));

    resultMsg = {
      invoice_id,
      tenant_id,
      nfe_status:   'authorized',
      nfe_chave:    result.chave_nfe,
      nfe_protocol: result.numero_protocolo,
      nfe_auth_date: result.data_autorizacao,
      xml_s3_key:   xmlKey,
      danfe_url:    result.caminho_danfe,
    };

    log('info', 'nfe_authorized', {
      invoice_id, nfe_chave: result.chave_nfe, nfe_protocol: result.numero_protocolo,
    });

  } else {
    const reason = result.erros?.map(e => `[${e.codigo}] ${e.mensagem}`).join('; ')
      ?? result.mensagem_sefaz
      ?? `status=${result.status}`;

    resultMsg = { invoice_id, tenant_id, nfe_status: 'rejected', nfe_reject_reason: reason };
    log('warn', 'nfe_rejected', { invoice_id, reason });
  }

  // Publish result to SQS for the api-core polling worker to pick up and update RDS
  await sqs.send(new SendMessageCommand({
    QueueUrl:    config.nfeResultsQueueUrl,
    MessageBody: JSON.stringify(resultMsg),
  }));
}

function log(level: string, event: string, extra: object) {
  console.log(JSON.stringify({ level, event, ...extra, ts: new Date().toISOString() }));
}

function safeInvoiceId(record: SQSRecord): string {
  try { return (JSON.parse(record.body) as NfeEmitMessage).invoice_id; }
  catch { return 'unknown'; }
}
