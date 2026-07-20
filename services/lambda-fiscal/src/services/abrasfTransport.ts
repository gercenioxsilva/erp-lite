// Transporte ABRASF (motor NFS-e próprio) — o api-core monta e ASSINA o XML
// (certificado nunca chega aqui); este módulo só envelopa em SOAP, POSTa no
// webservice municipal e devolve o resultado normalizado pela fila de results.
//
// Simulação: endpoint começando com 'local-' nunca sai para a rede — devolve
// 'authorized' sintético (emit) ou 'cancelled' (cancel), mesmo padrão do
// token 'local-' do Focus. Permite o ciclo completo em dev/testes.

import axios from 'axios';
import type { FastifyInstance } from 'fastify';
import type { SQSRecord } from 'aws-lambda';
import { SendMessageCommand } from '@aws-sdk/client-sqs';

interface AbrasfMessage {
  type: 'nfse';
  action: 'emit' | 'cancel';
  provider: 'abrasf';
  tenant_id: string;
  nfse_id: string;
  ambiente: number;
  endpoint: string;
  abrasf_versao: string | null;
  perfil: string | null;
  signed_xml: string;
}

const SOAP_ENVELOPE = (inner: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">` +
  `<soap:Body>${inner}</soap:Body></soap:Envelope>`;

/** Extrai o primeiro valor de uma tag (namespace-agnóstico) da resposta. */
export function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([^<]+)</(?:\\w+:)?${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

/** Mensagens de erro ABRASF vêm em ListaMensagemRetorno/MensagemRetorno. */
export function extractErrors(xml: string): string | null {
  const codes = [...xml.matchAll(/<(?:\w+:)?Codigo[^>]*>([^<]+)<\/(?:\w+:)?Codigo>/gi)].map((m) => m[1]);
  const msgs = [...xml.matchAll(/<(?:\w+:)?Mensagem[^>]*>([^<]+)<\/(?:\w+:)?Mensagem>/gi)].map((m) => m[1]);
  if (msgs.length === 0) return null;
  return msgs.map((m, i) => `${codes[i] ?? ''} ${m}`.trim()).join('; ');
}

export async function processAbrasfRecord(app: FastifyInstance, record: SQSRecord): Promise<void> {
  const msg = JSON.parse(record.body) as AbrasfMessage;
  const resultsQueue = (app as any).config.nfeResultsQueueUrl as string;

  const publish = async (payload: Record<string, unknown>) => {
    await (app as any).sqs.send(new SendMessageCommand({
      QueueUrl: resultsQueue,
      MessageBody: JSON.stringify({ type: 'nfse', ...payload }),
    }));
  };

  // ── Simulação local (padrão 'local-' do Focus) ─────────────────────────
  if (msg.endpoint.startsWith('local-')) {
    app.log.info({ event: 'abrasf_simulated', nfse_id: msg.nfse_id, action: msg.action });
    if (msg.action === 'cancel') {
      await publish({ action: 'cancel', nfse_id: msg.nfse_id, tenant_id: msg.tenant_id, nfse_status: 'cancelled' });
    } else {
      await publish({
        action: 'emit', nfse_id: msg.nfse_id, tenant_id: msg.tenant_id, nfse_status: 'authorized',
        nfse_number: String(Math.abs(hash(msg.nfse_id)) % 1_000_000),
        nfse_verify_code: 'SIMULADO', nfse_protocol: `SIM-${msg.nfse_id.slice(0, 8)}`,
        nfse_auth_date: new Date().toISOString(),
      });
    }
    return;
  }

  // ── Envio real: SOAP 1.2 POST do XML já assinado ───────────────────────
  let responseXml: string;
  try {
    const { data } = await axios.post(msg.endpoint, SOAP_ENVELOPE(msg.signed_xml), {
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
      timeout: 60_000,
      // Aceita 4xx/5xx para extrair a mensagem de erro ABRASF do corpo.
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    responseXml = String(data ?? '');
  } catch (err) {
    // Falha de rede: relança para o retry/DLQ do SQS (maxReceiveCount=3).
    app.log.error({ event: 'abrasf_transport_error', nfse_id: msg.nfse_id, error: String(err) });
    throw err;
  }

  const errors = extractErrors(responseXml);

  if (msg.action === 'cancel') {
    const confirmed = /Cancelamento|DataHora/i.test(responseXml) && !errors;
    await publish({
      action: 'cancel', nfse_id: msg.nfse_id, tenant_id: msg.tenant_id,
      nfse_status: confirmed ? 'cancelled' : 'rejected',
      nfse_reject_reason: errors ?? (confirmed ? null : 'Resposta municipal não reconhecida'),
    });
    return;
  }

  const numero = extractTag(responseXml, 'Numero');
  const codigoVerificacao = extractTag(responseXml, 'CodigoVerificacao');
  const protocolo = extractTag(responseXml, 'Protocolo') ?? extractTag(responseXml, 'NumeroLote');

  if (numero && !errors) {
    await publish({
      action: 'emit', nfse_id: msg.nfse_id, tenant_id: msg.tenant_id, nfse_status: 'authorized',
      nfse_number: numero, nfse_verify_code: codigoVerificacao, nfse_protocol: protocolo,
      nfse_auth_date: extractTag(responseXml, 'DataEmissao') ?? new Date().toISOString(),
    });
  } else if (protocolo && !errors) {
    // Lote assíncrono aceito: fica 'processing'; a reconsulta entra na fase
    // de homologação por município (consultarLote).
    app.log.info({ event: 'abrasf_lote_accepted', nfse_id: msg.nfse_id, protocolo });
  } else {
    await publish({
      action: 'emit', nfse_id: msg.nfse_id, tenant_id: msg.tenant_id, nfse_status: 'rejected',
      nfse_reject_reason: errors ?? 'Resposta municipal sem número de NFS-e nem erro estruturado',
    });
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
