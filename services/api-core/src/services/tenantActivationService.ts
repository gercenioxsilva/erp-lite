// Application Service — Ativação de Conta por E-mail. Orquestra I/O: gera o
// token de verificação (no registro e no reenvio), confirma o e-mail
// (ativa o tenant), e monta o payload de notificação (com cópia opcional
// pro dono do sistema via SYSTEM_OWNER_EMAIL).

import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { tenants, users } from '../db/schema';
import { sendSystemNotification } from '../lib/notificationsClient';
import { assertTokenValid, assertCanResendVerification, TenantActivationDomainError } from '../domain/tenantActivation/tenantActivationDomain';

export type DrizzleDB = typeof _db;
export { TenantActivationDomainError };

const VERIFICATION_EXPIRES_HOURS = 48;

function ownerCcList(): string[] | undefined {
  const email = process.env.SYSTEM_OWNER_EMAIL;
  return email ? [email] : undefined;
}

/** Gera um novo token de verificação (48h) e persiste na linha do usuário —
 * mesmo mecanismo de crypto.randomUUID() já usado pelo reset de senha e
 * pelo convite de técnico, em colunas dedicadas (nunca password_reset_*). */
export async function issueVerificationToken(userId: string, db: DrizzleDB = _db) {
  const token   = crypto.randomUUID().replace(/-/g, '');
  const expires = new Date(Date.now() + VERIFICATION_EXPIRES_HOURS * 60 * 60 * 1000);

  await db.update(users).set({
    email_verification_token:   token,
    email_verification_expires: expires,
  }).where(eq(users.id, userId));

  return { token, expires };
}

export interface SendVerificationEmailArgs {
  tenantId: string; userName: string; userEmail: string; token: string;
}

/** Fire-and-forget — falha de e-mail nunca derruba o registro/reenvio
 * (mesmo padrão já usado em toda a base). Cópia opcional pro dono do
 * sistema via SYSTEM_OWNER_EMAIL, nunca hardcoded no template. */
export async function sendVerificationEmail(args: SendVerificationEmailArgs): Promise<void> {
  const appUrl = process.env.APP_URL || 'https://orquestraerp.com.br';
  const verifyLink = `${appUrl}/verify-email?token=${args.token}`;

  await sendSystemNotification({
    tenant_id: args.tenantId,
    type:      'tenant_email_verification',
    recipient: { email: args.userEmail, name: args.userName },
    cc:        ownerCcList(),
    data: {
      name:          args.userName,
      verify_link:   verifyLink,
      expires_hours: String(VERIFICATION_EXPIRES_HOURS),
    },
  });
}

/** Confirma o e-mail: marca o usuário como verificado e ativa o tenant
 * (dois fatos distintos — pessoa vs. conta), limpa o token (single-use).
 * Erro específico e claro se o token for inválido/expirado, nunca 500. */
export async function verifyEmail(token: string, db: DrizzleDB = _db) {
  const [user] = await db.select().from(users).where(eq(users.email_verification_token, token));
  if (!user) throw new TenantActivationDomainError('verification_token_invalid_or_expired');

  assertTokenValid(user.email_verification_expires, new Date());

  return db.transaction(async (tx) => {
    await tx.update(users).set({
      email_verified_at:          new Date(),
      email_verification_token:   null,
      email_verification_expires: null,
    }).where(eq(users.id, user.id));

    const [tenant] = await tx.update(tenants).set({
      activated_at: new Date(), updated_at: new Date(),
    }).where(eq(tenants.id, user.tenant_id)).returning();

    return tenant;
  });
}

/** Reenvia o e-mail de verificação — mesmo mecanismo de
 * resendTechnicianInvite(), sob demanda. Cooldown derivado da janela de
 * expiração já persistida (expires - 48h = quando foi enviado por último),
 * sem precisar de uma coluna extra só pra isso. */
export async function resendVerification(userId: string, tenantId: string, db: DrizzleDB = _db) {
  const [user] = await db.select().from(users)
    .where(and(eq(users.id, userId), eq(users.tenant_id, tenantId)));
  if (!user) throw new TenantActivationDomainError('user_not_found');

  const lastSentAt = user.email_verification_expires
    ? new Date(user.email_verification_expires.getTime() - VERIFICATION_EXPIRES_HOURS * 60 * 60 * 1000)
    : null;
  assertCanResendVerification(lastSentAt, new Date());

  const { token } = await issueVerificationToken(userId, db);
  await sendVerificationEmail({ tenantId, userName: user.name ?? user.email, userEmail: user.email, token })
    .catch(() => { /* falha de e-mail nunca derruba a operação */ });
}
