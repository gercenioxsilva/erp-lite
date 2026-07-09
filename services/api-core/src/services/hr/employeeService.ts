// Application Service — cadastro de Funcionários (RH Simplificado).
// CRUD com soft-delete via is_active — mesmo padrão de sellers/technicians.

import { eq, and, or, ilike, sql } from 'drizzle-orm';
import { db as _db } from '../../db';
import { employees } from '../../db/schema';
import { validateEmployeeCpf, validateBaseSalary, PayrollDomainError } from '../../domain/hr/payrollDomain';

export type DrizzleDB = typeof _db;
export { PayrollDomainError };

export interface ListEmployeesArgs { tenantId: string; search?: string; activeOnly?: boolean; }

export async function listEmployees(args: ListEmployeesArgs, db: DrizzleDB = _db) {
  const conditions = [eq(employees.tenant_id, args.tenantId)];
  if (args.activeOnly) conditions.push(eq(employees.is_active, true));
  if (args.search) {
    conditions.push(
      or(ilike(employees.name, `%${args.search}%`), ilike(employees.cpf, `%${args.search}%`))!,
    );
  }
  return db.select().from(employees).where(and(...conditions)).orderBy(sql`${employees.name} ASC`);
}

async function getEmployeeOrThrow(id: string, tenantId: string, db: DrizzleDB) {
  const [row] = await db.select().from(employees)
    .where(and(eq(employees.id, id), eq(employees.tenant_id, tenantId)));
  if (!row) throw new PayrollDomainError('employee_not_found', { id });
  return row;
}

export interface CreateEmployeeArgs {
  tenantId:     string;
  companyId?:   string | null;
  name:         string;
  cpf:          string;
  email?:       string | null;
  phone?:       string | null;
  roleTitle?:   string | null;
  regime:       'clt' | 'pro_labore';
  baseSalary:   number;
  costCenterId?: string | null;
  hireDate:     string;
}

export async function createEmployee(args: CreateEmployeeArgs, db: DrizzleDB = _db) {
  validateEmployeeCpf(args.cpf);
  validateBaseSalary(args.baseSalary);

  const cpfDigits = args.cpf.replace(/\D/g, '');

  try {
    const [employee] = await db.insert(employees).values({
      tenant_id:   args.tenantId,
      company_id:  args.companyId || null,
      name:        args.name.trim(),
      cpf:         cpfDigits,
      email:       args.email || null,
      phone:       args.phone || null,
      role_title:  args.roleTitle || null,
      regime:      args.regime,
      base_salary: String(args.baseSalary),
      cost_center_id: args.costCenterId || null,
      hire_date:   args.hireDate,
    }).returning();
    return employee;
  } catch (err: any) {
    if (err.code === '23505') throw new PayrollDomainError('employee_cpf_duplicate', { cpf: cpfDigits });
    throw err;
  }
}

export interface UpdateEmployeeArgs {
  name?: string; email?: string | null; phone?: string | null; roleTitle?: string | null;
  regime?: 'clt' | 'pro_labore'; baseSalary?: number; costCenterId?: string | null;
  companyId?: string | null; terminationDate?: string | null; isActive?: boolean;
}

export async function updateEmployee(id: string, tenantId: string, args: UpdateEmployeeArgs, db: DrizzleDB = _db) {
  await getEmployeeOrThrow(id, tenantId, db);
  if (args.baseSalary !== undefined) validateBaseSalary(args.baseSalary);

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (args.name            !== undefined) patch.name              = args.name.trim();
  if (args.email           !== undefined) patch.email             = args.email || null;
  if (args.phone           !== undefined) patch.phone             = args.phone || null;
  if (args.roleTitle       !== undefined) patch.role_title        = args.roleTitle || null;
  if (args.regime          !== undefined) patch.regime            = args.regime;
  if (args.baseSalary      !== undefined) patch.base_salary       = String(args.baseSalary);
  if (args.costCenterId    !== undefined) patch.cost_center_id    = args.costCenterId || null;
  if (args.companyId       !== undefined) patch.company_id        = args.companyId || null;
  if (args.terminationDate !== undefined) patch.termination_date  = args.terminationDate || null;
  if (args.isActive        !== undefined) patch.is_active         = args.isActive;

  const [updated] = await db.update(employees).set(patch)
    .where(and(eq(employees.id, id), eq(employees.tenant_id, tenantId))).returning();
  return updated;
}

export async function deactivateEmployee(id: string, tenantId: string, db: DrizzleDB = _db) {
  await getEmployeeOrThrow(id, tenantId, db);
  const [updated] = await db.update(employees)
    .set({ is_active: false, updated_at: new Date() })
    .where(and(eq(employees.id, id), eq(employees.tenant_id, tenantId))).returning();
  return updated;
}

export async function getEmployee(id: string, tenantId: string, db: DrizzleDB = _db) {
  return getEmployeeOrThrow(id, tenantId, db);
}
