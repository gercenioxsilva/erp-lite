// Orquestração de I/O para o domínio de Conta Bancária (regra 41). Cada empresa
// (nfe_configs) pode ter N contas — este serviço é o único ponto de leitura/
// escrita, mesmo padrão de companyService.ts para empresas.

import { eq, and, ne } from 'drizzle-orm';
import { db as _db } from '../db';
import { bankAccounts } from '../db/schema';
import { canDeactivate, BankAccountDomainError, type BankAccountLike } from '../domain/bankAccount/bankAccountDomain';
import { validateBankingData, isValidBillingProvider } from '../lib/banking';
import { getDefaultCompany, resolveCompanyId } from './companyService';

export { BankAccountDomainError };

export type DrizzleDB = typeof _db;
export type BankAccount = typeof bankAccounts.$inferSelect;

export interface BankAccountInput {
  company_id?: string;
  label?: string | null;
  bank_code: string;
  agency: string;
  account: string;
  account_digit: string;
  billing_provider?: string;
  billing_days_to_expire?: number;
  itau_client_id?: string | null;
  itau_client_secret?: string | null;
}

function assertValid(input: Partial<BankAccountInput>) {
  try {
    validateBankingData({
      bank_code: input.bank_code, agency: input.agency,
      account: input.account, account_digit: input.account_digit,
    });
  } catch (err) {
    throw new BankAccountDomainError('invalid_banking_data', { message: (err as Error).message });
  }
  if (input.billing_provider && !isValidBillingProvider(input.billing_provider)) {
    throw new BankAccountDomainError('invalid_billing_provider', { billing_provider: input.billing_provider });
  }
  if (input.billing_days_to_expire != null) {
    const days = Number(input.billing_days_to_expire);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new BankAccountDomainError('invalid_billing_days_to_expire', { billing_days_to_expire: input.billing_days_to_expire });
    }
  }
}

function toValues(input: BankAccountInput) {
  return {
    label: input.label ?? null,
    bank_code: input.bank_code,
    agency: input.agency,
    account: input.account,
    account_digit: input.account_digit,
    billing_provider: input.billing_provider ?? 'brcode',
    billing_days_to_expire: input.billing_days_to_expire ?? 30,
    itau_client_id: input.itau_client_id ?? null,
    itau_client_secret: input.itau_client_secret ?? null,
  };
}

/** Todas as contas ativas do tenant, opcionalmente filtradas por empresa — padrão primeiro. */
export async function listBankAccounts(tenantId: string, companyId?: string, db: DrizzleDB = _db): Promise<BankAccount[]> {
  const conditions = [eq(bankAccounts.tenant_id, tenantId), eq(bankAccounts.is_active, true)];
  if (companyId) conditions.push(eq(bankAccounts.company_id, companyId));
  const rows = await db.select().from(bankAccounts).where(and(...conditions));
  return rows.sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
}

async function listAllForCompany(tenantId: string, companyId: string, db: DrizzleDB): Promise<BankAccount[]> {
  return db.select().from(bankAccounts)
    .where(and(eq(bankAccounts.tenant_id, tenantId), eq(bankAccounts.company_id, companyId)));
}

/** Conta padrão de uma empresa; sem companyId, resolve a empresa padrão do tenant primeiro. */
export async function getDefaultBankAccount(
  tenantId: string, companyId?: string, db: DrizzleDB = _db,
): Promise<BankAccount | null> {
  let resolvedCompanyId = companyId;
  if (!resolvedCompanyId) {
    const company = await getDefaultCompany(tenantId, db);
    if (!company) return null;
    resolvedCompanyId = company.id;
  }
  const [row] = await db.select().from(bankAccounts)
    .where(and(eq(bankAccounts.tenant_id, tenantId), eq(bankAccounts.company_id, resolvedCompanyId), eq(bankAccounts.is_default, true)));
  return row ?? null;
}

/**
 * Resolve qual conta bancária deve ser usada na emissão de boleto/PIX: com
 * bankAccountId explícito, valida posse do tenant + is_active; sem id, cai na
 * conta padrão da empresa padrão do tenant. Ponto único de resolução — nenhuma
 * rota deve consultar bankAccounts diretamente.
 */
export async function resolveBankAccount(
  tenantId: string, bankAccountId: string | null | undefined, db: DrizzleDB = _db,
): Promise<BankAccount> {
  if (!bankAccountId) {
    const def = await getDefaultBankAccount(tenantId, undefined, db);
    if (!def) throw new BankAccountDomainError('no_default_bank_account', { tenantId });
    return def;
  }

  const [row] = await db.select().from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.tenant_id, tenantId)));

  if (!row || !row.is_active) throw new BankAccountDomainError('bank_account_not_found', { bankAccountId });
  return row;
}

export async function createBankAccount(tenantId: string, input: BankAccountInput, db: DrizzleDB = _db): Promise<BankAccount> {
  if (!input.company_id) throw new BankAccountDomainError('company_id_required');
  const company = await resolveCompanyId(tenantId, input.company_id, db).catch(() => null);
  if (!company) throw new BankAccountDomainError('company_not_found', { companyId: input.company_id });

  assertValid(input);

  const existing = await listAllForCompany(tenantId, company.id, db);
  const [row] = await db.insert(bankAccounts).values({
    tenant_id: tenantId,
    company_id: company.id,
    is_default: existing.length === 0,
    is_active: true,
    ...toValues(input),
  }).returning();

  return row;
}

/**
 * Cria ou atualiza a conta padrão da empresa padrão do tenant — usado apenas
 * pelo caminho legado (PATCH /v1/tenant), que precisa continuar funcionando
 * exatamente como antes para clientes que ainda não sabem de multi-conta.
 */
export async function upsertDefaultBankAccount(
  tenantId: string, input: Partial<BankAccountInput>, db: DrizzleDB = _db,
): Promise<BankAccount> {
  const company = await getDefaultCompany(tenantId, db);
  if (!company) throw new BankAccountDomainError('no_default_company', { tenantId });

  const existingDefault = await getDefaultBankAccount(tenantId, company.id, db);

  if (!existingDefault) {
    // Sem conta ainda: precisa dos 4 campos bancários centrais para nascer.
    assertValid(input);
    const [row] = await db.insert(bankAccounts).values({
      tenant_id: tenantId, company_id: company.id, is_default: true, is_active: true,
      ...toValues(input as BankAccountInput),
    }).returning();
    return row;
  }

  // Já existe: atualização parcial (ex.: só trocar o client_secret do Itaú sem
  // reenviar agência/conta) — mescla com o que já está gravado, mesmo
  // comportamento que PATCH /v1/tenant sempre teve.
  const merged = { ...existingDefault, ...input } as BankAccountInput;
  assertValid(merged);
  const [row] = await db.update(bankAccounts).set({
    ...toValues(merged), updated_at: new Date(),
  }).where(eq(bankAccounts.id, existingDefault.id)).returning();

  return row;
}

export async function updateBankAccount(
  tenantId: string, bankAccountId: string, input: Partial<BankAccountInput>, db: DrizzleDB = _db,
): Promise<BankAccount> {
  const current = await resolveBankAccount(tenantId, bankAccountId, db);
  const merged = { ...current, ...input } as BankAccountInput;
  assertValid(merged);

  const [row] = await db.update(bankAccounts).set({
    ...toValues(merged), updated_at: new Date(),
  }).where(eq(bankAccounts.id, bankAccountId)).returning();

  return row;
}

export async function deactivateBankAccount(tenantId: string, bankAccountId: string, db: DrizzleDB = _db): Promise<void> {
  const target = await db.select().from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.tenant_id, tenantId)));
  if (!target[0]) throw new BankAccountDomainError('bank_account_not_found', { bankAccountId });

  const all = await listAllForCompany(tenantId, target[0].company_id, db);
  if (!canDeactivate(all as unknown as BankAccountLike[], bankAccountId)) {
    throw new BankAccountDomainError('cannot_deactivate_bank_account', { bankAccountId });
  }

  await db.update(bankAccounts).set({ is_active: false, updated_at: new Date() }).where(eq(bankAccounts.id, bankAccountId));
}

/** Troca a conta padrão da empresa — desliga a antiga, liga a nova, em transação. */
export async function setDefaultBankAccount(tenantId: string, bankAccountId: string, db: DrizzleDB = _db): Promise<BankAccount> {
  const target = await resolveBankAccount(tenantId, bankAccountId, db);
  if (target.is_default) return target;

  return db.transaction(async (tx: any) => {
    await tx.update(bankAccounts).set({ is_default: false, updated_at: new Date() })
      .where(and(eq(bankAccounts.company_id, target.company_id), ne(bankAccounts.id, bankAccountId)));
    const [row] = await tx.update(bankAccounts).set({ is_default: true, updated_at: new Date() })
      .where(eq(bankAccounts.id, bankAccountId)).returning();
    return row;
  });
}
