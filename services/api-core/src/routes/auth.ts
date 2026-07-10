import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db, tenants, users } from '../db';
import { sendSystemNotification } from '../lib/notificationsClient';
import { getStripe } from '../lib/stripeClient';
import { getPermissionsList } from '../rbac/permissionService';
import { isValidSegmentKey } from '../lib/segments';
import {
  issueVerificationToken, sendVerificationEmail, verifyEmail, resendVerification,
  TenantActivationDomainError, type DrizzleDB,
} from '../services/tenantActivationService';

const registerBody = {
  type: 'object',
  required: ['company_name', 'tax_id', 'email', 'password'],
  properties: {
    company_name:  { type: 'string', minLength: 2, maxLength: 255 },
    trade_name:    { type: 'string', maxLength: 255 },
    tax_id:        { type: 'string', minLength: 5, maxLength: 50 },
    tax_id_type:   { type: 'string', enum: ['CNPJ', 'EIN', 'VAT', 'OTHER'] },
    name:          { type: 'string', maxLength: 255 },
    email:         { type: 'string', format: 'email' },
    password:      { type: 'string', minLength: 8 },
    // Segmento escolhido no onboarding — define o preset de branding do tenant.
    segment_key:   { type: 'string', maxLength: 40 },
  },
  additionalProperties: false,
};

const loginBody = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email:    { type: 'string', format: 'email' },
    password: { type: 'string' },
  },
  additionalProperties: false,
};

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/auth/register — creates tenant + owner user in one transaction
  fastify.post('/auth/register', { schema: { body: registerBody } }, async (request, reply) => {
    const {
      company_name,
      trade_name,
      tax_id,
      tax_id_type = 'CNPJ',
      name,
      password,
    } = request.body as any;

    const email        = ((request.body as any).email as string).toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 12);
    const displayName  = name || email.split('@')[0];
    // Segmento inválido/ausente cai no 'generic' — nunca bloqueia o cadastro.
    const rawSegment   = (request.body as any).segment_key as string | undefined;
    const segmentKey   = rawSegment && isValidSegmentKey(rawSegment) ? rawSegment : 'generic';

    try {
      const result = await db.transaction(async (tx) => {
        const [tenant] = await tx.insert(tenants).values({
          company_name,
          trade_name: trade_name || company_name,
          tax_id,
          tax_id_type,
          status:      'trial',
          plan:        'starter',
          segment_key: segmentKey,
        }).returning({ id: tenants.id });

        const [user] = await tx.insert(users).values({
          tenant_id:     tenant.id,
          email,
          name:          displayName,
          password_hash: passwordHash,
          role:   'owner',
          status: 'active',
        }).returning({ id: users.id, email: users.email, name: users.name, role: users.role });

        // Ativação de conta por e-mail: token dedicado (48h) gerado na MESMA
        // transação do tenant/usuário — atômico, nunca existe um tenant sem
        // token pendente. tenants.activated_at nasce NULL (default da
        // coluna), bloqueado por tenantActivationGuard.ts até o owner
        // confirmar o e-mail.
        const { token: verificationToken } = await issueVerificationToken(user.id, tx as unknown as DrizzleDB);

        return { tenant, user, verificationToken };
      });

      const token = fastify.jwt.sign(
        { tenantId: result.tenant.id, userId: result.user.id, role: result.user.role },
        { expiresIn: '24h' },
      );

      // Fire-and-forget — login (acima) já funciona normalmente; o que fica
      // bloqueado é o USO, então uma falha de e-mail aqui nunca deve
      // impedir o registro de completar. Cópia opcional pro dono do
      // sistema via SYSTEM_OWNER_EMAIL, nunca hardcoded no template.
      sendVerificationEmail({
        tenantId: result.tenant.id, userName: result.user.name ?? result.user.email,
        userEmail: result.user.email, token: result.verificationToken,
      }).catch((err: unknown) => {
        fastify.log.warn({ event: 'verification_email_warn', error: String(err) });
      });

      // Non-blocking: create Stripe customer + set trial_ends_at (14 days)
      const stripe = getStripe();
      if (stripe) {
        const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        stripe.customers.create({
          email:    email,
          name:     company_name,
          metadata: { tenant_id: result.tenant.id },
        }).then(async (customer: { id: string }) => {
          await db.execute(sql`
            UPDATE tenants
            SET stripe_customer_id = ${customer.id}, trial_ends_at = ${trialEnds.toISOString()}
            WHERE id = ${result.tenant.id}
          `);
        }).catch((err: unknown) => {
          fastify.log.warn({ event: 'stripe_customer_create_warn', error: String(err) });
        });
      }

      const permissions = await getPermissionsList(result.tenant.id, result.user.role);
      return reply.code(201).send({
        token,
        user:     { id: result.user.id, email: result.user.email, name: result.user.name, role: result.user.role },
        tenantId: result.tenant.id,
        permissions,
      });
    } catch (err: any) {
      if (err.code === '23505') return reply.conflict('Email or tax ID already registered');
      throw err;
    }
  });

  // POST /v1/auth/login
  fastify.post('/auth/login', { schema: { body: loginBody } }, async (request, reply) => {
    const { password } = request.body as any;
    const email = ((request.body as any).email as string).toLowerCase().trim();

    const rows = await db.select().from(users).where(sql`LOWER(TRIM(${users.email})) = ${email}`);

    if (!rows.length) return reply.unauthorized('Invalid credentials');

    const user = rows[0];
    if (user.status !== 'active') return reply.unauthorized('Account disabled');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return reply.unauthorized('Invalid credentials');

    const token = fastify.jwt.sign(
      { tenantId: user.tenant_id, userId: user.id, role: user.role },
      { expiresIn: '24h' },
    );

    const permissions = await getPermissionsList(user.tenant_id, user.role);
    return {
      token,
      user:     { id: user.id, email: user.email, name: user.name, role: user.role },
      tenantId: user.tenant_id,
      permissions,
    };
  });

  // GET /v1/auth/me — inclui tenant_activated_at (ativação de conta por
  // e-mail): o frontend usa isso, uma vez no boot, pra decidir se mostra o
  // app normal ou a tela de "verifique seu e-mail" — nunca é o controle de
  // acesso de verdade, isso é sempre tenantActivationGuard.ts no backend.
  fastify.get('/auth/me', {
    preHandler: [(fastify as any).authenticate],
  }, async (request) => {
    const { userId } = (request as any).user;
    const [row] = await db.select({
      id: users.id, email: users.email, name: users.name,
      role: users.role, tenant_id: users.tenant_id, status: users.status,
      tenant_activated_at: tenants.activated_at,
      // Branding do tenant entregue no boot (strings pequenas) — o BrandingProvider
      // do frontend aplica cores/labels sem "flash". Logo (base64 grande) fica de
      // fora daqui: a sidebar o busca via GET /v1/tenant sob demanda.
      segment_key:   tenants.segment_key,
      brand_primary: tenants.brand_primary,
      brand_accent:  tenants.brand_accent,
    }).from(users).innerJoin(tenants, eq(users.tenant_id, tenants.id)).where(eq(users.id, userId));
    if (!row) return null;

    const permissions = await getPermissionsList(row.tenant_id, row.role);
    return { ...row, permissions };
  });

  // POST /v1/auth/forgot-password (sem autenticação)
  fastify.post('/auth/forgot-password', async (request, reply) => {
    const { email } = request.body as { email: string };
    if (!email) return reply.badRequest('email é obrigatório');

    // Buscar user pelo email (case-insensitive)
    const { rows: [user] } = await db.execute<any>(sql`
      SELECT u.id, u.name, u.email, t.id as tenant_id
      FROM users u
      JOIN tenants t ON t.id = u.tenant_id
      WHERE LOWER(u.email) = LOWER(${email.trim()}) AND u.status = 'active'
      LIMIT 1
    `);

    // Sempre retorna 200 mesmo se não encontrar (evita enumeração de e-mails)
    if (!user) return reply.send({ ok: true });

    const token   = crypto.randomUUID().replace(/-/g, '');
    const expires = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h

    await db.execute(sql`
      UPDATE users SET password_reset_token = ${token}, password_reset_expires = ${expires.toISOString()}
      WHERE id = ${user.id}
    `);

    const appUrl = process.env.APP_URL || 'https://orquestraerp.com.br';
    const resetLink = `${appUrl}/reset-password?token=${token}`;

    // Fire-and-forget — nunca bloquear resposta por falha de e-mail
    sendSystemNotification({
      tenant_id: user.tenant_id,
      type: 'password_reset',
      recipient: { email: user.email, name: user.name },
      data: { name: user.name, reset_link: resetLink, expires_hours: '2' },
    }).catch(err => fastify.log.warn({ event: 'password_reset_email_warn', error: String(err) }));

    return reply.send({ ok: true });
  });

  // POST /v1/auth/reset-password (sem autenticação)
  fastify.post('/auth/reset-password', async (request, reply) => {
    const { token, password } = request.body as { token: string; password: string };
    if (!token || !password) return reply.badRequest('token e password são obrigatórios');
    if (password.length < 6) return reply.badRequest('password deve ter pelo menos 6 caracteres');

    const { rows: [user] } = await db.execute<any>(sql`
      SELECT id FROM users
      WHERE password_reset_token = ${token}
        AND password_reset_expires > NOW()
        AND status = 'active'
      LIMIT 1
    `);
    if (!user) return reply.badRequest('Token inválido ou expirado');

    const bcryptLib = await import('bcryptjs');
    const password_hash = await bcryptLib.hash(password, 12);

    await db.execute(sql`
      UPDATE users
      SET password_hash = ${password_hash},
          password_reset_token = NULL,
          password_reset_expires = NULL
      WHERE id = ${user.id}
    `);

    return reply.send({ ok: true });
  });

  // POST /v1/auth/verify-email (sem autenticação — mesma lógica de token de
  // reset-password, mas em colunas dedicadas). Ativa o tenant inteiro, não
  // só o usuário.
  fastify.post('/auth/verify-email', async (request, reply) => {
    const { token } = request.body as { token?: string };
    if (!token) return reply.badRequest('token é obrigatório');

    try {
      await verifyEmail(token);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof TenantActivationDomainError) {
        return reply.badRequest('Link inválido ou expirado. Solicite um novo e-mail de verificação.');
      }
      throw err;
    }
  });

  // POST /v1/auth/resend-verification (autenticado — o próprio usuário
  // bloqueado pede reenvio pro PRÓPRIO e-mail; evita endpoint público de
  // reenvio, que abriria brecha de spam/enumeração).
  fastify.post('/auth/resend-verification', {
    preHandler: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const { userId, tenantId } = (request as any).user;
    try {
      await resendVerification(userId, tenantId);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof TenantActivationDomainError) {
        if (err.code === 'user_not_found') return reply.notFound(err.code);
        return reply.code(429).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });
};
