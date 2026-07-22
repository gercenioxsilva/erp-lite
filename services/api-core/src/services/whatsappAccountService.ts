// Orquestração de I/O da conta WhatsApp (migration 0067) — 1 por tenant nesta
// fase. Único ponto de leitura/escrita de credencial, mesmo padrão de
// bankAccountService.ts.

import { eq } from 'drizzle-orm';
import { db as _db } from '../db';
import { whatsappAccounts } from '../db/schema';
import { WhatsAppDomainError, assertProviderCredentials, type WhatsAppCredentials } from '../domain/whatsapp/whatsappDomain';
import { testarConexaoProvider, type WhatsAppConnectionTestResult } from './whatsappConnectionClient';

export { WhatsAppDomainError };

export type DrizzleDB = typeof _db;
export type WhatsAppAccount = typeof whatsappAccounts.$inferSelect;

export interface WhatsAppAccountInput {
  provider?: string;
  whatsapp_number?: string | null;
  display_name?: string | null;
  credentials?: WhatsAppCredentials;
}

// String vazia (ou chave ausente) em `incoming` nunca apaga o que já está
// gravado — mesmo racional de mergeCredentials em bankAccountService.ts:
// o frontend nunca deveria reenviar o auth_token mascarado como se fosse
// valor novo.
function mergeCredentials(
  current: Record<string, string> | null | undefined,
  incoming: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!incoming) return current ?? null;
  const merged: Record<string, string> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(incoming)) {
    if (value) merged[key] = value;
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

export async function getWhatsAppAccount(tenantId: string, db: DrizzleDB = _db): Promise<WhatsAppAccount | null> {
  const [row] = await db.select().from(whatsappAccounts).where(eq(whatsappAccounts.tenant_id, tenantId));
  return row ?? null;
}

/**
 * Webhook do Twilio não carrega tenant_id nenhum — o único jeito de rotear é
 * pelo número do remetente (status callback: `From` = nosso número) ou
 * destinatário (mensagem recebida: `To` = nosso número). Usado só pelo
 * webhook público; nunca por rota autenticada (que já tem tenantId do JWT).
 */
export async function findAccountByWhatsAppNumber(whatsappNumber: string, db: DrizzleDB = _db): Promise<WhatsAppAccount | null> {
  const [row] = await db.select().from(whatsappAccounts).where(eq(whatsappAccounts.whatsapp_number, whatsappNumber));
  return row ?? null;
}

/**
 * Resolve a conta pra uso em envio — precisa existir e estar 'connected'.
 * Único ponto de resolução; nenhuma rota/worker deve consultar whatsappAccounts
 * diretamente pra montar uma mensagem de envio.
 */
export async function resolveConnectedAccount(tenantId: string, db: DrizzleDB = _db): Promise<WhatsAppAccount> {
  const account = await getWhatsAppAccount(tenantId, db);
  if (!account || account.status !== 'connected') {
    throw new WhatsAppDomainError('account_not_connected', { tenantId });
  }
  return account;
}

/**
 * Cria ou atualiza a conta do tenant — upsert simples (1 por tenant nesta
 * fase). Credencial passa por mergeCredentials, nunca sobrescreve com valor
 * vazio. Conectar (status='connected') só acontece quando credenciais válidas
 * pro provedor escolhido estão presentes após o merge.
 */
export async function upsertWhatsAppAccount(
  tenantId: string, input: WhatsAppAccountInput, db: DrizzleDB = _db,
): Promise<WhatsAppAccount> {
  const existing = await getWhatsAppAccount(tenantId, db);
  const provider = input.provider ?? existing?.provider ?? 'twilio';
  const mergedCredentials = mergeCredentials(
    existing?.credentials as Record<string, string> | null, input.credentials,
  );

  assertProviderCredentials(provider, mergedCredentials);

  const values = {
    provider,
    credentials:     mergedCredentials,
    whatsapp_number: input.whatsapp_number ?? existing?.whatsapp_number ?? null,
    display_name:    input.display_name    ?? existing?.display_name    ?? null,
    status:          'connected' as const,
    connected_at:    new Date(),
    updated_at:      new Date(),
  };

  if (existing) {
    const [row] = await db.update(whatsappAccounts).set(values)
      .where(eq(whatsappAccounts.tenant_id, tenantId)).returning();
    return row;
  }

  const [row] = await db.insert(whatsappAccounts).values({ tenant_id: tenantId, ...values }).returning();
  return row;
}

/**
 * Teste síncrono de conexão — confirma que as credenciais salvas realmente
 * autenticam no provedor, sem enviar mensagem nenhuma. `status='connected'`
 * gravado no upsert só reflete presença de credencial (regra do upsert
 * acima); este é o único ponto que de fato bate no Twilio, mesmo racional de
 * testCompanyFiscalConnection em fiscalIntegrationService.ts pro Focus.
 */
export async function testWhatsAppConnection(tenantId: string, db: DrizzleDB = _db): Promise<WhatsAppConnectionTestResult> {
  const account = await getWhatsAppAccount(tenantId, db);
  if (!account) throw new WhatsAppDomainError('account_not_connected', { tenantId });
  return testarConexaoProvider(account.provider, account.credentials as Record<string, string> | null);
}

export async function disconnectWhatsAppAccount(tenantId: string, db: DrizzleDB = _db): Promise<void> {
  await db.update(whatsappAccounts)
    .set({ status: 'disconnected', updated_at: new Date() })
    .where(eq(whatsappAccounts.tenant_id, tenantId));
}
