// Cadastro de técnicos — cria users(role='technician') + technicians numa
// transação. Diferente de sellers (user_id opcional), aqui o login é
// obrigatório: CPF só tem valor probatório amarrado a uma conta autenticada.
//
// Nunca envia senha por e-mail (diferente do fluxo de POST /v1/users hoje) —
// a senha inicial é um valor aleatório que ninguém conhece; o técnico define a
// própria senha através do mesmo mecanismo de password_reset_token que o
// "esqueci minha senha" já usa, só que com uma janela maior (convite inicial).

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { eq, and, ilike, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { users, technicians } from '../db/schema';
import { isValidCPF, digitsOnly } from '../domain/serviceVisit/serviceVisitDomain';
import { sendSystemNotification } from '../lib/notificationsClient';

export type DrizzleDB = typeof _db;

const INVITE_EXPIRES_HOURS = 48;

export class TechnicianServiceError extends Error {
  constructor(public code: string) { super(code); this.name = 'TechnicianServiceError'; }
}

export interface CreateTechnicianArgs {
  tenantId:  string;
  name:      string;
  email:     string;
  phone?:    string | null;
  cpf:       string;
  specialty?: string | null;
}

export async function createTechnician(args: CreateTechnicianArgs, db: DrizzleDB = _db) {
  const cpf = digitsOnly(args.cpf);
  if (!isValidCPF(cpf)) throw new TechnicianServiceError('invalid_cpf');
  if (!args.name.trim()) throw new TechnicianServiceError('name_required');

  const email = args.email.toLowerCase().trim();
  const randomPassword = crypto.randomBytes(24).toString('hex'); // nunca exposto — só placeholder até o convite ser aceito
  const passwordHash = await bcrypt.hash(randomPassword, 12);
  const inviteToken = crypto.randomUUID().replace(/-/g, '');
  const inviteExpires = new Date(Date.now() + INVITE_EXPIRES_HOURS * 60 * 60 * 1000);

  let result;
  try {
    result = await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        tenant_id:     args.tenantId,
        email,
        name:          args.name.trim(),
        password_hash: passwordHash,
        role:          'technician',
        status:        'active',
        password_reset_token:   inviteToken,
        password_reset_expires: inviteExpires,
      }).returning({ id: users.id, email: users.email, name: users.name });

      const [technician] = await tx.insert(technicians).values({
        tenant_id: args.tenantId,
        user_id:   user.id,
        name:      args.name.trim(),
        email,
        phone:     args.phone || null,
        cpf,
        specialty: args.specialty || null,
      }).returning();

      return { user, technician };
    });
  } catch (err: any) {
    if (err.code === '23505') throw new TechnicianServiceError('email_already_registered');
    throw err;
  }

  const appUrl = process.env.APP_URL || 'https://orquestraerp.com.br';
  sendSystemNotification({
    tenant_id: args.tenantId,
    type:      'technician_welcome',
    recipient: { email, name: args.name.trim() },
    data: {
      name:          args.name.trim(),
      // Reaproveita a tela de reset de senha que já existe (o backend não
      // discrimina por role) — evita duplicar uma tela só para o convite do técnico.
      set_password_link: `${appUrl}/reset-password?token=${inviteToken}`,
      expires_hours: String(INVITE_EXPIRES_HOURS),
    },
  }).catch(() => { /* falha de e-mail nunca derruba a criação do técnico */ });

  return result.technician;
}

export interface ListTechniciansArgs {
  tenantId: string;
  search?:  string;
  page?:    number;
  perPage?: number;
}

export async function listTechnicians(args: ListTechniciansArgs, db: DrizzleDB = _db) {
  const limit  = Math.min(args.perPage ?? 20, 100);
  const offset = (Math.max(args.page ?? 1, 1) - 1) * limit;

  const baseWhere = eq(technicians.tenant_id, args.tenantId);
  const where = args.search
    ? and(baseWhere, ilike(technicians.name, `%${args.search}%`))
    : baseWhere;

  const [rows, [cnt]] = await Promise.all([
    db.select().from(technicians).where(where)
      .orderBy(sql`${technicians.name} ASC`)
      .limit(limit).offset(offset),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(technicians).where(where),
  ]);

  return { data: rows, total: cnt.count, page: args.page ?? 1, per_page: limit };
}

export async function setTechnicianActive(id: string, tenantId: string, isActive: boolean, db: DrizzleDB = _db) {
  const [technician] = await db.select().from(technicians)
    .where(and(eq(technicians.id, id), eq(technicians.tenant_id, tenantId)));
  if (!technician) throw new TechnicianServiceError('technician_not_found');

  // Desativar o técnico também bloqueia o login — não faz sentido manter uma
  // conta ativa para um técnico que não presta mais serviço para o tenant.
  await db.transaction(async (tx) => {
    await tx.update(technicians).set({ is_active: isActive }).where(eq(technicians.id, id));
    await tx.update(users).set({ status: isActive ? 'active' : 'disabled' }).where(eq(users.id, technician.user_id));
  });
}
