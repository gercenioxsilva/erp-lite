// Orquestração de envio de mensagem WhatsApp (migration 0067) — único ponto
// que monta e enfileira uma mensagem. Nunca chamado direto pelas rotas
// financeiras/fiscais — sempre via whatsappAutomationService, que decide QUAL
// evento dispara QUAL template (mesmo desacoplamento de sendNotificationIfEnabled
// pro e-mail).

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { eq, and, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { whatsappMessages, whatsappAutomations, whatsappMessageTemplates, clients } from '../db/schema';
import { getSqsClient } from '../lib/sqsClient';
import type { WhatsAppSendMessage } from '../lib/whatsapp-types';
import { WHATSAPP_TEMPLATES } from '../lib/whatsappTemplateContent';
import {
  WhatsAppDomainError, assertCanSend, interpolateTemplate, toE164BR, type TemplateKey,
} from '../domain/whatsapp/whatsappDomain';
import { resolveConnectedAccount } from './whatsappAccountService';

export { WhatsAppDomainError };

export type DrizzleDB = typeof _db;

export interface SendTemplateInput {
  tenantId: string;
  clientId: string;
  templateKey: TemplateKey;
  variables: Record<string, string>;
  receivableId?: string | null;
  invoiceId?: string | null;
  proposalId?: string | null;
}

/**
 * Valida elegibilidade completa (assertCanSend), monta a mensagem (texto
 * final via interpolateTemplate, só pra registro/log — o envio de verdade usa
 * ContentSid + variables no adapter), grava `whatsapp_messages` com
 * status='queued' e publica na fila de request. Lança WhatsAppDomainError com
 * o código exato do que impediu o envio — nunca envia silenciosamente errado.
 */
export async function sendTemplateMessage(input: SendTemplateInput, db: DrizzleDB = _db): Promise<typeof whatsappMessages.$inferSelect> {
  const { tenantId, clientId, templateKey, variables } = input;

  const [client] = await db.select({
    mobile: clients.mobile, phone: clients.phone, whatsapp_opt_in: clients.whatsapp_opt_in,
  }).from(clients).where(and(eq(clients.id, clientId), eq(clients.tenant_id, tenantId)));

  const phone = toE164BR(client?.mobile || client?.phone);

  const account = await resolveConnectedAccount(tenantId, db).catch(() => null);

  const [template] = await db.select().from(whatsappMessageTemplates)
    .where(and(eq(whatsappMessageTemplates.tenant_id, tenantId), eq(whatsappMessageTemplates.template_key, templateKey)));

  const [automation] = await db.select().from(whatsappAutomations)
    .where(and(eq(whatsappAutomations.tenant_id, tenantId), eq(whatsappAutomations.template_key, templateKey)));

  assertCanSend({
    accountStatus:     account?.status ?? null,
    templateStatus:    template?.status ?? null,
    automationEnabled: automation?.enabled ?? false,
    clientOptIn:       client?.whatsapp_opt_in ?? false,
    phone,
  });

  // account/template garantidos não-nulos pelo assertCanSend acima (status
  // 'connected'/'approved' só existe em linha existente).
  const queueUrl = process.env.WHATSAPP_REQUESTS_QUEUE_URL;
  if (!queueUrl) throw new WhatsAppDomainError('whatsapp_queue_not_configured');

  const [message] = await db.insert(whatsappMessages).values({
    tenant_id:     tenantId,
    client_id:     clientId,
    phone_e164:    phone!,
    template_key:  templateKey,
    receivable_id: input.receivableId ?? null,
    invoice_id:    input.invoiceId ?? null,
    proposal_id:   input.proposalId ?? null,
    status:        'queued',
  }).returning();

  // Content API do Twilio espera variáveis numeradas ({{1}}, {{2}}...) na
  // ordem de aprovação do template — nunca por nome. WHATSAPP_TEMPLATES[key]
  // é a única fonte da ordem; o Lambda só numera pela posição do array.
  const orderedVariables = WHATSAPP_TEMPLATES[templateKey].variables.map(name => variables[name] ?? '');

  const sqsPayload: WhatsAppSendMessage = {
    whatsapp_message_id: message.id,
    tenant_id:            tenantId,
    to_phone_e164:        phone!,
    template_key:         templateKey,
    provider_template_id: template!.provider_template_id!,
    variables: orderedVariables,
    account: {
      provider:        account!.provider,
      whatsapp_number: account!.whatsapp_number!,
      credentials:     (account!.credentials as Record<string, string>) ?? {},
    },
  };

  await getSqsClient().send(new SendMessageCommand({
    QueueUrl:    queueUrl,
    MessageBody: JSON.stringify(sqsPayload),
  }));

  return message;
}

/** Texto de referência interpolado — usado só pra preview/log, nunca enviado
 * cru ao provedor (o envio real usa ContentSid + ContentVariables). */
export function previewTemplateText(templateKey: TemplateKey, variables: Record<string, string>): string {
  return interpolateTemplate(WHATSAPP_TEMPLATES[templateKey].body, variables);
}

export interface ListMessagesFilters {
  client_id?: string;
  status?: string;
  page?: number;
  per_page?: number;
}

/** Log de mensagens — paginado (regra 12, per_page ≤ 100), mais recente primeiro. */
export async function listMessages(tenantId: string, filters: ListMessagesFilters, db: DrizzleDB = _db) {
  const limit  = Math.min(Number(filters.per_page) || 20, 100);
  const offset = (Math.max(Number(filters.page) || 1, 1) - 1) * limit;

  const clientFilter = filters.client_id ? sql`AND m.client_id = ${filters.client_id}::uuid` : sql``;
  const statusFilter  = filters.status    ? sql`AND m.status = ${filters.status}`             : sql``;

  const [{ rows }, { rows: [cnt] }] = await Promise.all([
    db.execute<any>(sql`
      SELECT m.id, m.template_key, m.phone_e164, m.status, m.status_reason,
             m.sent_at, m.delivered_at, m.read_at, m.created_at,
             m.receivable_id, m.invoice_id, m.proposal_id,
             COALESCE(c.company_name, c.full_name) AS client_name
      FROM whatsapp_messages m
      LEFT JOIN clients c ON c.id = m.client_id
      WHERE m.tenant_id = ${tenantId} ${clientFilter} ${statusFilter}
      ORDER BY m.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count FROM whatsapp_messages m
      WHERE m.tenant_id = ${tenantId} ${clientFilter} ${statusFilter}
    `),
  ]);

  return { data: rows, total: Number(cnt.count), page: Number(filters.page) || 1, per_page: limit };
}
