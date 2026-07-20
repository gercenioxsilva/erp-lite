// Orquestração de I/O — Captação de Leads via API pública (migration 0084).
// Ponto único de escrita anônima em `clients`: valida contra o domínio puro,
// resolve duplicidade (nunca cria linha nova pro mesmo lead que já existe) e
// marca origin='landing_page' — nunca confunde com o cadastro feito pelo
// próprio tenant no backoffice (origin='erp', default).

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { clients } from '../db/schema';
import { normalizeCNPJ } from '../domain/cnpj/cnpjDomain';
import {
  validateAndNormalizeLead, LeadCaptureDomainError, type LeadCaptureInput,
} from '../domain/leadCapture/leadCaptureDomain';

export type DrizzleDB = typeof _db;
export { LeadCaptureDomainError };
export type Client = typeof clients.$inferSelect;

export interface LeadCaptureResult {
  client: Client;
  created: boolean; // false = já existia e foi atualizado (merge), nunca duplicado
}

/**
 * Cria o lead em `clients`, ou atualiza o registro já existente pro mesmo
 * CNPJ (documento sempre é a chave mais forte) ou pro mesmo e-mail quando
 * não há documento algum — mesmo racional "nunca dead-end, sempre
 * linkar/mesclar" já usado em `technicianService.ts::findLinkableUser()`
 * (regra 67), aplicado aqui pra nunca poluir a carteira do tenant com
 * duplicata de um lead que já mandou o formulário antes.
 *
 * NUNCA sobrescreve campos que o tenant já qualificou manualmente (ex.: um
 * lead que virou cliente de verdade, com endereço fiscal completo) — o merge
 * só preenche o que está vazio, nunca substitui um valor já existente.
 */
export async function findOrCreateLeadClient(
  tenantId: string, input: LeadCaptureInput, db: DrizzleDB = _db,
): Promise<LeadCaptureResult> {
  const lead = validateAndNormalizeLead(input);
  const cnpj = lead.cnpj ? normalizeCNPJ(lead.cnpj) : null;

  const existing = cnpj
    ? await findOneBy(db, and(eq(clients.tenant_id, tenantId), eq(clients.cnpj, cnpj)))
    : lead.email
      ? await findOneBy(db, and(
          eq(clients.tenant_id, tenantId),
          sql`lower(${clients.email}) = ${lead.email}`,
          isNull(clients.cnpj), isNull(clients.cpf),
        ))
      : null;

  if (existing) {
    const [updated] = await db.update(clients).set({
      // COALESCE: só preenche o que estava vazio — nunca pisa em dado que o
      // tenant já editou/qualificou manualmente depois do primeiro envio.
      phone:        existing.phone        ?? lead.phone,
      email:        existing.email        ?? lead.email,
      company_name: existing.company_name ?? lead.company_name,
      notes:        existing.notes ? existing.notes : lead.notes,
      updated_at:   new Date(),
    }).where(eq(clients.id, existing.id)).returning();
    return { client: updated, created: false };
  }

  const [created] = await db.insert(clients).values({
    tenant_id:     tenantId,
    person_type:   lead.person_type,
    full_name:     lead.full_name,
    company_name:  lead.company_name,
    cnpj,
    email:         lead.email,
    phone:         lead.phone,
    notes:         lead.notes,
    consumer_type: lead.person_type === 'PF' ? '1' : '0',
    icms_taxpayer: '9', // nunca inferido — lead não declara regime tributário
    origin:        'landing_page',
  }).returning();
  return { client: created, created: true };
}

async function findOneBy(db: DrizzleDB, where: ReturnType<typeof and>): Promise<Client | null> {
  const [row] = await db.select().from(clients).where(where);
  return row ?? null;
}
