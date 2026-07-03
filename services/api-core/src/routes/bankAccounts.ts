import { FastifyPluginAsync } from 'fastify';
import {
  listBankAccounts, createBankAccount, updateBankAccount, deactivateBankAccount, setDefaultBankAccount,
  BankAccountDomainError,
} from '../services/bankAccountService';

export const bankAccountsRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate] };

  const mask = (t: string | null | undefined) => (t ? '****' + t.slice(-4) : null);
  const maskSecret = (a: any) => ({ ...a, itau_client_secret: mask(a.itau_client_secret) });

  /* ── GET /v1/bank-accounts ──────────────────────────────────────────── */
  fastify.get('/bank-accounts', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { company_id } = request.query as { company_id?: string };
    const rows = await listBankAccounts(tenantId, company_id);
    return { data: rows.map(maskSecret) };
  });

  /* ── POST /v1/bank-accounts ─────────────────────────────────────────── */
  fastify.post('/bank-accounts', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const body = request.body as any;

    if (!body?.company_id || !body?.bank_code || !body?.agency || !body?.account || !body?.account_digit) {
      return reply.badRequest('Campos obrigatórios: company_id, bank_code, agency, account, account_digit');
    }

    try {
      const row = await createBankAccount(tenantId, body);
      return reply.code(201).send(maskSecret(row));
    } catch (err) {
      if (err instanceof BankAccountDomainError) {
        if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── PATCH /v1/bank-accounts/:id ────────────────────────────────────── */
  fastify.patch('/bank-accounts/:id', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };

    try {
      const row = await updateBankAccount(tenantId, id, request.body as any);
      return maskSecret(row);
    } catch (err) {
      if (err instanceof BankAccountDomainError) {
        if (err.code === 'bank_account_not_found') return reply.notFound('Conta bancária não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── DELETE /v1/bank-accounts/:id ───────────────────────────────────── */
  fastify.delete('/bank-accounts/:id', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };

    try {
      await deactivateBankAccount(tenantId, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof BankAccountDomainError) {
        if (err.code === 'bank_account_not_found') return reply.notFound('Conta bancária não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── PATCH /v1/bank-accounts/:id/set-default ────────────────────────── */
  fastify.patch('/bank-accounts/:id/set-default', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };

    try {
      const row = await setDefaultBankAccount(tenantId, id);
      return maskSecret(row);
    } catch (err) {
      if (err instanceof BankAccountDomainError) {
        if (err.code === 'bank_account_not_found') return reply.notFound('Conta bancária não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });
};
