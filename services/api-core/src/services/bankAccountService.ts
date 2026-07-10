// Orquestração de I/O para o domínio de Conta Bancária (regra 41). Cada empresa
// (nfe_configs) pode ter N contas — este serviço é o único ponto de leitura/
// escrita, mesmo padrão de companyService.ts para empresas.

import { eq, and, ne } from 'drizzle-orm';
import { db as _db } from '../db';
import { bankAccounts } from '../db/schema';
import {
  canDeactivate, assertProviderCredentials, BankAccountDomainError, type BankAccountLike,
} from '../domain/bankAccount/bankAccountDomain';
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
  /** Genérico (migration 0064) — {client_id, client_secret} pro Itaú,
   *  {client_id, client_secret, cert, key} pro C6. Fonte de verdade daqui em
   *  diante para QUALQUER provedor. */
  credentials?: Record<string, string> | null;
  /** @deprecated aceitos por compatibilidade de payload (frontend/integrações
   *  antigas); dobrados em `credentials` no service, nunca mais gravados nas
   *  colunas originais (regra 41: deprecated-mas-presentes). */
  itau_client_id?: string | null;
  itau_client_secret?: string | null;
}

/** Resolve a credencial "bruta" desta chamada específica: `credentials`
 * explícito vence; sem ele, dobra os campos legados itau_client_id/secret
 * (compat); sem nenhum dos dois, `undefined`. Isto é só o que o CALLER
 * enviou agora — em update/upsert, precisa passar por `mergeCredentials`
 * antes de virar o valor final gravado (ver abaixo). */
function resolveCredentials(input: Partial<BankAccountInput>): Record<string, string> | null | undefined {
  if (input.credentials !== undefined) return input.credentials;
  if (input.itau_client_id || input.itau_client_secret) {
    return { client_id: input.itau_client_id ?? '', client_secret: input.itau_client_secret ?? '' };
  }
  return undefined;
}

/**
 * Mescla a credencial desta chamada com a já gravada — string vazia (ou a
 * ausência da chave) em `incoming` significa "não mudar essa chave
 * específica", NUNCA "apagar". Existe pra resolver um problema real: o
 * frontend nunca deveria reenviar o valor mascarado (`****xxxx`) que recebeu
 * na leitura como se fosse um valor novo (sobrescreveria o segredo real com
 * lixo) — em vez disso, deixa o campo em branco quando o usuário não quer
 * trocá-lo, e este merge preserva o que já estava lá. Também permite trocar
 * só o certificado sem reenviar o client_secret, por exemplo, sem exigir o
 * objeto `credentials` inteiro a cada PATCH.
 */
function mergeCredentials(
  current: Record<string, string> | null | undefined,
  incoming: Record<string, string> | null | undefined,
): Record<string, string> | null {
  // Nem `undefined` (nada enviado nesta chamada) nem `null` (chamador não
  // trouxe credencial nenhuma desta vez) apagam o que já está gravado — só
  // uma chave individual vazia dentro do objeto é ignorada, nunca o objeto
  // inteiro sendo null/ausente.
  if (!incoming) return current ?? null;
  const merged: Record<string, string> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(incoming)) {
    if (value) merged[key] = value;
  }
  return Object.keys(merged).length > 0 ? merged : null;
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
  // Credencial só é validada quando efetivamente fornecida nesta chamada —
  // conta bancária continua podendo ser cadastrada sem credencial ainda
  // (mesmo comportamento leniente de sempre; a credencial só é indispensável
  // na hora de emitir, não na hora de cadastrar a conta). Quando fornecida,
  // porém, precisa estar completa pro provedor escolhido — evita descobrir um
  // client_secret esquecido só quando o Lambda falhar na emissão.
  const credentials = resolveCredentials(input);
  if (credentials != null && input.billing_provider) {
    assertProviderCredentials(input.billing_provider, credentials);
  }
}

function toValues(input: BankAccountInput) {
  const credentials = resolveCredentials(input);
  return {
    label: input.label ?? null,
    bank_code: input.bank_code,
    agency: input.agency,
    account: input.account,
    account_digit: input.account_digit,
    billing_provider: input.billing_provider ?? 'brcode',
    billing_days_to_expire: input.billing_days_to_expire ?? 30,
    credentials: credentials ?? null,
    // itau_client_id/itau_client_secret: nunca mais escritas aqui (regra 41 —
    // deprecated-mas-presentes, congeladas no valor anterior à migration 0064).
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
  // comportamento que PATCH /v1/tenant sempre teve. Credencial passa pelo
  // mergeCredentials (não o spread ingênuo acima) — string vazia em `input`
  // nunca apaga o que já estava gravado (ver mergeCredentials).
  const mergedCredentials = mergeCredentials(
    existingDefault.credentials as Record<string, string> | null, resolveCredentials(input),
  );
  const merged = { ...existingDefault, ...input, credentials: mergedCredentials } as BankAccountInput;
  assertValid(merged);
  // tenant_id repetido explicitamente na cláusula, mesmo o id já ter sido
  // resolvido de forma tenant-scoped linhas acima (getDefaultBankAccount) —
  // isolamento por tenant nunca deve depender implicitamente da ordem de
  // chamadas dentro da função; blindagem contra um refator futuro que
  // reordene isso sem perceber.
  const [row] = await db.update(bankAccounts).set({
    ...toValues(merged), updated_at: new Date(),
  }).where(and(eq(bankAccounts.id, existingDefault.id), eq(bankAccounts.tenant_id, tenantId))).returning();

  return row;
}

export async function updateBankAccount(
  tenantId: string, bankAccountId: string, input: Partial<BankAccountInput>, db: DrizzleDB = _db,
): Promise<BankAccount> {
  const current = await resolveBankAccount(tenantId, bankAccountId, db);
  // Credencial passa por mergeCredentials, não pelo spread ingênuo — string
  // vazia em `input.credentials` (o formulário sempre manda os 4 campos,
  // mesmo os que o usuário não tocou) nunca apaga o que já estava gravado.
  const mergedCredentials = mergeCredentials(current.credentials as Record<string, string> | null, resolveCredentials(input));
  const merged = { ...current, ...input, credentials: mergedCredentials } as BankAccountInput;
  assertValid(merged);

  const [row] = await db.update(bankAccounts).set({
    ...toValues(merged), updated_at: new Date(),
  }).where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.tenant_id, tenantId))).returning();

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

  await db.update(bankAccounts).set({ is_active: false, updated_at: new Date() })
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.tenant_id, tenantId)));
}

/** Troca a conta padrão da empresa — desliga a antiga, liga a nova, em transação. */
export async function setDefaultBankAccount(tenantId: string, bankAccountId: string, db: DrizzleDB = _db): Promise<BankAccount> {
  const target = await resolveBankAccount(tenantId, bankAccountId, db);
  if (target.is_default) return target;

  return db.transaction(async (tx: any) => {
    await tx.update(bankAccounts).set({ is_default: false, updated_at: new Date() })
      .where(and(eq(bankAccounts.company_id, target.company_id), eq(bankAccounts.tenant_id, tenantId), ne(bankAccounts.id, bankAccountId)));
    const [row] = await tx.update(bankAccounts).set({ is_default: true, updated_at: new Date() })
      .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.tenant_id, tenantId))).returning();
    return row;
  });
}
