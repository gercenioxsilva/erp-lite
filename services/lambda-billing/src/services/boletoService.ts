import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { FastifyInstance } from 'fastify';
import type { SQSRecord } from 'aws-lambda';
import type { BillingEmitMessage, BillingResultMessage } from '../lib/types';

export async function processRecord(app: FastifyInstance, record: SQSRecord): Promise<void> {
  const msg: BillingEmitMessage = JSON.parse(record.body);

  app.log.info({
    event:         'boleto_emit_received',
    boleto_id:     msg.boleto_id,
    receivable_id: msg.receivable_id,
    tenant_id:     msg.tenant_id,
    bank_code:     msg.banking.bank_code,
    provider:      msg.banking.billing_provider,
  });

  let result: BillingResultMessage;

  try {
    const adapter = app.getAdapter(msg.banking.bank_code, msg.banking);

    const boletoResult = await adapter.emit({
      amount:        Number(msg.amount),
      due_date:      msg.due_date,
      description:   msg.description,
      days_to_expire: msg.days_to_expire,
      banking:       msg.banking,
    });

    result = {
      boleto_id:     msg.boleto_id,
      receivable_id: msg.receivable_id,
      tenant_id:     msg.tenant_id,
      boleto_status: 'generated',
      external_id:   boletoResult.external_id,
      nosso_numero:  boletoResult.nosso_numero,
      brcode:        boletoResult.brcode,
      pix_qr_code:   boletoResult.pix_qr_code,
      boleto_url:    boletoResult.boleto_url,
      pdf_s3_key:    boletoResult.pdf_s3_key,
      issued_at:     boletoResult.issued_at,
      expires_at:    boletoResult.expires_at,
    };

    app.log.info({
      event:        'boleto_generated',
      boleto_id:    msg.boleto_id,
      nosso_numero: boletoResult.nosso_numero,
    });

  } catch (err: any) {
    app.log.error({
      event:        'boleto_emit_failed',
      boleto_id:    msg.boleto_id,
      receivable_id: msg.receivable_id,
      error:         err.message,
    });

    result = {
      boleto_id:     msg.boleto_id,
      receivable_id: msg.receivable_id,
      tenant_id:     msg.tenant_id,
      boleto_status: 'error',
      error_reason:  err.message,
    };
  }

  await app.sqs.send(new SendMessageCommand({
    QueueUrl:    app.config.billingResultsQueueUrl,
    MessageBody: JSON.stringify(result),
  }));
}
