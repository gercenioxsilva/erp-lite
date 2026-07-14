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
  // Presente quando o operador confirmou vincular um usuário JÁ EXISTENTE
  // (ver findLinkableUser) em vez de criar um login novo — evita a colisão
  // em UNIQUE(tenant_id, email) que hoje trava o cadastro sem saída (regra 67).
  linkExistingUserId?: string;
}

export interface LinkableUserCheck {
  linkable: boolean;
  reason?:  'not_found' | 'already_technician' | 'is_owner';
  user?:    { id: string; name: string | null; role: string };
}

/**
 * Verifica se um e-mail já pertence a um usuário do tenant e, se sim, se dá
 * pra vinculá-lo como técnico. Chamado tanto pelo frontend (checagem
 * proativa antes de enviar o form) quanto implicitamente pela regra de
 * negócio de createTechnician (regra 67).
 */
export async function findLinkableUser(
  tenantId: string, email: string, db: DrizzleDB = _db,
): Promise<LinkableUserCheck> {
  const normalizedEmail = email.toLowerCase().trim();

  const [existingUser] = await db.select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.tenant_id, tenantId), eq(users.email, normalizedEmail)));

  if (!existingUser) return { linkable: false, reason: 'not_found' };

  // Nunca converter o dono da conta — perderia acesso a tudo além do portal
  // de técnico (technicianRoleGuard restringe role='technician' a um
  // allowlist mínimo de rotas).
  if (existingUser.role === 'owner') return { linkable: false, reason: 'is_owner', user: existingUser };

  const [existingTechnician] = await db.select({ id: technicians.id })
    .from(technicians)
    .where(and(eq(technicians.tenant_id, tenantId), eq(technicians.user_id, existingUser.id)));
  if (existingTechnician) return { linkable: false, reason: 'already_technician', user: existingUser };

  return { linkable: true, user: existingUser };
}

export async function createTechnician(args: CreateTechnicianArgs, db: DrizzleDB = _db) {
  const cpf = digitsOnly(args.cpf);
  if (!isValidCPF(cpf)) throw new TechnicianServiceError('invalid_cpf');
  if (!args.name.trim()) throw new TechnicianServiceError('name_required');

  const email = args.email.toLowerCase().trim();

  if (args.linkExistingUserId) {
    const check = await findLinkableUser(args.tenantId, email, db);
    if (!check.linkable || check.user?.id !== args.linkExistingUserId) {
      throw new TechnicianServiceError('user_not_linkable');
    }

    let technician;
    try {
      technician = await db.transaction(async (tx) => {
        // access_profile_id some — technician nunca usa perfil RBAC, seu
        // acesso é 100% definido pelo role (mesma invariante documentada em
        // db/schema.ts na coluna access_profile_id).
        await tx.update(users)
          .set({ role: 'technician', access_profile_id: null, updated_at: new Date() })
          .where(eq(users.id, args.linkExistingUserId!));

        const [created] = await tx.insert(technicians).values({
          tenant_id: args.tenantId,
          user_id:   args.linkExistingUserId!,
          name:      args.name.trim(),
          email,
          phone:     args.phone || null,
          cpf,
          specialty: args.specialty || null,
        }).returning();

        return created;
      });
    } catch (err: any) {
      if (err.code === '23505') throw new TechnicianServiceError('email_already_registered');
      throw err;
    }

    // Sem e-mail de convite aqui — a conta já existe e já tem senha própria,
    // só o papel de acesso mudou.
    return technician;
  }

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

export interface UpdateTechnicianArgs {
  name?:      string;
  email?:     string;
  phone?:     string | null;
  cpf?:       string;
  specialty?: string | null;
}

/**
 * Edita os dados cadastrais do técnico — nunca a senha (essa segue exclusivamente
 * pelo fluxo de convite/reset, ver resendTechnicianInvite() abaixo). name/email
 * também são espelhados em users, já que technicians.user_id é o login real.
 */
export async function updateTechnician(
  id: string, tenantId: string, args: UpdateTechnicianArgs, db: DrizzleDB = _db,
) {
  const [technician] = await db.select().from(technicians)
    .where(and(eq(technicians.id, id), eq(technicians.tenant_id, tenantId)));
  if (!technician) throw new TechnicianServiceError('technician_not_found');

  const patch: Record<string, unknown> = {};
  if (args.name !== undefined) {
    if (!args.name.trim()) throw new TechnicianServiceError('name_required');
    patch.name = args.name.trim();
  }
  if (args.cpf !== undefined) {
    const cpf = digitsOnly(args.cpf);
    if (!isValidCPF(cpf)) throw new TechnicianServiceError('invalid_cpf');
    patch.cpf = cpf;
  }
  if (args.phone     !== undefined) patch.phone     = args.phone     || null;
  if (args.specialty !== undefined) patch.specialty = args.specialty || null;

  const email = args.email !== undefined ? args.email.toLowerCase().trim() : undefined;
  if (email !== undefined) patch.email = email;

  if (!Object.keys(patch).length) return technician;

  try {
    await db.transaction(async (tx) => {
      await tx.update(technicians).set({ ...patch, updated_at: new Date() }).where(eq(technicians.id, id));
      // users.email/name são o login real — mantidos em sincronia com o
      // cadastro do técnico, nunca divergentes.
      const userPatch: Record<string, unknown> = {};
      if (email !== undefined)      userPatch.email = email;
      if (patch.name !== undefined) userPatch.name  = patch.name;
      if (Object.keys(userPatch).length) {
        await tx.update(users).set(userPatch).where(eq(users.id, technician.user_id));
      }
    });
  } catch (err: any) {
    if (err.code === '23505') throw new TechnicianServiceError('email_already_registered');
    throw err;
  }

  const [updated] = await db.select().from(technicians).where(eq(technicians.id, id));
  return updated;
}

/**
 * Reenvia o convite de definição de senha — mesmo mecanismo de
 * password_reset_token usado na criação, só que sob demanda (ex.: tenant
 * digitou o e-mail errado na hora do cadastro e o técnico nunca recebeu o
 * link, ou o link expirou). Nunca expõe/define uma senha diretamente — o
 * técnico sempre define a própria senha pelo link.
 */
export async function resendTechnicianInvite(id: string, tenantId: string, db: DrizzleDB = _db) {
  const [technician] = await db.select().from(technicians)
    .where(and(eq(technicians.id, id), eq(technicians.tenant_id, tenantId)));
  if (!technician) throw new TechnicianServiceError('technician_not_found');

  const inviteToken   = crypto.randomUUID().replace(/-/g, '');
  const inviteExpires = new Date(Date.now() + INVITE_EXPIRES_HOURS * 60 * 60 * 1000);

  await db.update(users).set({
    password_reset_token:   inviteToken,
    password_reset_expires: inviteExpires,
  }).where(eq(users.id, technician.user_id));

  const appUrl = process.env.APP_URL || 'https://orquestraerp.com.br';
  sendSystemNotification({
    tenant_id: tenantId,
    type:      'technician_welcome', // mesmo template do convite inicial
    recipient: { email: technician.email, name: technician.name },
    data: {
      name:               technician.name,
      set_password_link:  `${appUrl}/reset-password?token=${inviteToken}`,
      expires_hours:       String(INVITE_EXPIRES_HOURS),
    },
  }).catch(() => { /* falha de e-mail nunca derruba a operação */ });
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
