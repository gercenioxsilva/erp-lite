import { FastifyPluginAsync } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { db, receivables, boletos, boletoEvents } from '../db';
import { getSqsClient } from '../lib/sqsClient';
import { BillingEmitMessage } from '../lib/billing-types';
import { resolveBankAccount, BankAccountDomainError } from '../services/bankAccountService';
import { requirePermission } from '../lib/requirePermission';

export const billingRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── POST /v1/receivables/:id/emit-boleto ───────────────────────────────── */
  fastify.post(
    '/receivables/:id/emit-boleto',
    { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('receivables:edit')] },
    async (request, reply) => {
      const tenantId = (request as any).user.tenantId;
      const { id } = request.params as { id: string };

      const [rec] = await db
        .select()
        .from(receivables)
        .where(and(eq(receivables.id, id), eq(receivables.tenant_id, tenantId)));

      if (!rec) return reply.notFound('Conta a receber não encontrada');
      if (rec.status === 'paid') return reply.badRequest('Conta já está paga');
      if (rec.status === 'cancelled') return reply.badRequest('Conta está cancelada');
      if (rec.boleto_id) return reply.badRequest('Boleto já foi gerado para esta conta');

      // Resolve qual conta bancária emite este boleto (regra 41) —
      // bank_account_id explícito no body, senão a conta padrão do tenant.
      const { bank_account_id } = (request.body as { bank_account_id?: string } | undefined) ?? {};
      let account;
      try {
        account = await resolveBankAccount(tenantId, bank_account_id);
      } catch (err) {
        if (err instanceof BankAccountDomainError) {
          return reply.badRequest(
            'Dados bancários incompletos. Configure banco, agência, conta e dígito em Minha Empresa > Dados Bancários'
          );
        }
        throw err;
      }

      const queueUrl = process.env.BILLING_REQUESTS_QUEUE_URL;
      if (!queueUrl) {
        fastify.log.error('BILLING_REQUESTS_QUEUE_URL not configured');
        return reply.internalServerError('Serviço de cobrança não disponível');
      }

      // Create draft boleto record for state tracking and idempotency
      const [boleto] = await db.insert(boletos).values({
        tenant_id:    tenantId,
        receivable_id: rec.id,
        bank_account_id: account.id,
        banco_code:   account.bank_code,
        agencia:      account.agency,
        conta:        account.account,
        digito:       account.account_digit,
        status:       'pending',
        expires_at:   new Date(Date.now() + (account.billing_days_to_expire || 30) * 86400_000)
                        .toISOString().slice(0, 10),
      }).returning();

      // Link boleto to receivable immediately so double-click is prevented
      await db.update(receivables)
        .set({ boleto_id: boleto.id })
        .where(eq(receivables.id, rec.id));

      const message: BillingEmitMessage = {
        boleto_id:     boleto.id,
        receivable_id: rec.id,
        tenant_id:     tenantId,
        amount:        rec.amount,
        due_date:      new Date(rec.due_date).toISOString().split('T')[0],
        description:   rec.description,
        days_to_expire: account.billing_days_to_expire || 30,
        banking: {
          bank_code:              account.bank_code,
          agency:                 account.agency,
          account:                account.account,
          account_digit:          account.account_digit,
          billing_provider:       account.billing_provider || 'itau',
          billing_days_to_expire: account.billing_days_to_expire || 30,
          // Genérico (migration 0064) — cada tenant usa a própria credencial,
          // nunca um app compartilhado da plataforma (decisão explícita da
          // integração C6; ver adapters/c6.ts no lambda-billing).
          credentials:            (account.credentials as Record<string, string> | null) ?? null,
        },
      };

      try {
        await getSqsClient().send(new SendMessageCommand({
          QueueUrl:    queueUrl,
          MessageBody: JSON.stringify(message),
        }));

        fastify.log.info({ event: 'boleto_emit_queued', boleto_id: boleto.id,
          receivable_id: rec.id, tenant_id: tenantId });
      } catch (err: any) {
        // Rollback: remove draft boleto and unlink from receivable
        await db.update(receivables).set({ boleto_id: null }).where(eq(receivables.id, rec.id));
        await db.delete(boletos).where(eq(boletos.id, boleto.id));
        fastify.log.error({ event: 'boleto_emit_sqs_error', error: err.message });
        return reply.internalServerError('Erro ao enfileirar solicitação de boleto');
      }

      return reply.code(202).send({ boleto_status: 'pending', boleto_id: boleto.id });
    }
  );

  /* ── GET /v1/receivables/:id/boleto ─────────────────────────────────────── */
  fastify.get(
    '/receivables/:id/boleto',
    { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('receivables:view')] },
    async (request, reply) => {
      const tenantId = (request as any).user.tenantId;
      const { id } = request.params as { id: string };

      const [rec] = await db
        .select()
        .from(receivables)
        .where(and(eq(receivables.id, id), eq(receivables.tenant_id, tenantId)));

      if (!rec) return reply.notFound('Conta a receber não encontrada');
      if (!rec.boleto_id) return { receivable_id: rec.id, boleto: null };

      // tenant_id repetido aqui mesmo o boleto_id já vir de um `rec`
      // tenant-scoped — isolamento nunca deve depender implicitamente de uma
      // consulta anterior na mesma função (achado de auditoria de segurança
      // da integração C6, regra 59).
      const [boleto] = await db
        .select()
        .from(boletos)
        .where(and(eq(boletos.id, rec.boleto_id), eq(boletos.tenant_id, tenantId)));

      if (!boleto) return { receivable_id: rec.id, boleto: null };

      return {
        receivable_id: rec.id,
        boleto: {
          id:           boleto.id,
          status:       boleto.status,
          nosso_numero: boleto.nosso_numero,
          brcode:       boleto.brcode,
          pix_qr_code:  boleto.pix_qr_code,
          boleto_url:   boleto.boleto_url,
          issued_at:    boleto.issued_at,
          expires_at:   boleto.expires_at,
          paid_at:      boleto.paid_at,
          banco_code:   boleto.banco_code,
          agencia:      boleto.agencia,
          conta:        boleto.conta,
        },
      };
    }
  );

  /* ── PUT /v1/receivables/:id/boleto/expire ──────────────────────────────── */
  fastify.put(
    '/receivables/:id/boleto/expire',
    { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('receivables:edit')] },
    async (request, reply) => {
      const tenantId = (request as any).user.tenantId;
      const { id } = request.params as { id: string };

      const [rec] = await db
        .select()
        .from(receivables)
        .where(and(eq(receivables.id, id), eq(receivables.tenant_id, tenantId)));

      if (!rec) return reply.notFound('Conta a receber não encontrada');
      if (!rec.boleto_id) return reply.notFound('Nenhum boleto vinculado a esta conta');

      await db.transaction(async (tx) => {
        await tx.update(boletos)
          .set({ status: 'expired' })
          .where(and(eq(boletos.id, rec.boleto_id!), eq(boletos.tenant_id, tenantId)));

        await tx.insert(boletoEvents).values({
          boleto_id:   rec.boleto_id!,
          tenant_id:   tenantId,
          event_type:  'cancelled',
          status_code: 'EXPIRED',
          response:    { reason: 'Manual expiration by tenant' },
        });
      });

      fastify.log.info({ event: 'boleto_expired', receivable_id: rec.id, tenant_id: tenantId });
      return { ok: true };
    }
  );

  /* ── GET /v1/receivables/:id/boleto-events ──────────────────────────────── */
  fastify.get(
    '/receivables/:id/boleto-events',
    { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('receivables:view')] },
    async (request, reply) => {
      const tenantId = (request as any).user.tenantId;
      const { id } = request.params as { id: string };

      const [rec] = await db
        .select()
        .from(receivables)
        .where(and(eq(receivables.id, id), eq(receivables.tenant_id, tenantId)));

      if (!rec) return reply.notFound('Conta a receber não encontrada');
      if (!rec.boleto_id) return { receivable_id: rec.id, events: [] };

      const events = await db
        .select()
        .from(boletoEvents)
        .where(and(eq(boletoEvents.boleto_id, rec.boleto_id), eq(boletoEvents.tenant_id, tenantId)));

      return {
        receivable_id: rec.id,
        boleto_id:     rec.boleto_id,
        events: events.map(e => ({
          id:          e.id,
          event_type:  e.event_type,
          status_code: e.status_code,
          response:    e.response,
          created_at:  e.created_at,
        })),
      };
    }
  );
};
