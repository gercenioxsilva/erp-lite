// Motor contábil — /v1/accounting/*. Módulo opcional 'contabil'.
// Disclaimer permanente: não substitui ECD/SPED Contábil.

import { FastifyPluginAsync } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { db, chartOfAccounts } from '../db';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { AccountingDomainError } from '../domain/accounting/accountingDomain';
import { FiscalLockError } from '../services/fiscalPeriodLockGuard';
import { postManualEntry, reverseEntry } from '../services/accountingService';
import { balancete, balanco, livroDiario, razao, livroCaixa, dreContabil } from '../services/accountingReportsService';

export const accountingRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const guard = (permission: string) => ({
    onRequest:  [authenticate],
    preHandler: [requireModule('contabil'), requirePermission(permission)],
  });

  function handleError(err: unknown, reply: any) {
    if (err instanceof AccountingDomainError || err instanceof FiscalLockError) {
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    throw err;
  }

  const period = (request: any, reply: any): { from: string; to: string } | null => {
    const q = request.query as { from?: string; to?: string };
    if (!q.from || !q.to) { reply.badRequest('from e to são obrigatórios (YYYY-MM-DD)'); return null; }
    return { from: q.from, to: q.to };
  };

  fastify.get('/accounting/accounts', guard('contabil:view'), async (request) => {
    const { tenantId } = (request as any).user;
    const rows = await db.select().from(chartOfAccounts)
      .where(and(eq(chartOfAccounts.is_active, true),
        sql`(${chartOfAccounts.tenant_id} = ${tenantId} OR ${chartOfAccounts.tenant_id} IS NULL)`))
      .orderBy(chartOfAccounts.code);
    return { data: rows };
  });

  fastify.post('/accounting/entries', guard('contabil:post'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as any;
    if (!b?.entry_date || !b?.competencia || !b?.description || !Array.isArray(b?.lines)) {
      return reply.badRequest('entry_date, competencia, description e lines são obrigatórios');
    }
    try {
      return reply.code(201).send(await postManualEntry(tenantId, {
        companyId: b.company_id ?? null, entryDate: b.entry_date, competencia: b.competencia,
        description: b.description, opening: !!b.opening,
        lines: b.lines.map((l: any) => ({ accountKey: l.account_key, side: l.side, amount: Number(l.amount) })),
      }, userId));
    } catch (err) { return handleError(err, reply); }
  });

  fastify.post('/accounting/entries/reverse', guard('contabil:post'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as { source_type?: string; source_id?: string; reason?: string };
    if (!b?.source_type || !b?.source_id || !b?.reason) {
      return reply.badRequest('source_type, source_id e reason são obrigatórios');
    }
    try { return await reverseEntry(tenantId, { sourceType: b.source_type, sourceId: b.source_id, reason: b.reason }, userId); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.get('/accounting/reports/diario', guard('contabil:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const p = period(request, reply); if (!p) return;
    return livroDiario(tenantId, p.from, p.to);
  });

  fastify.get('/accounting/reports/razao', guard('contabil:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { account_id?: string };
    const p = period(request, reply); if (!p) return;
    if (!q.account_id) return reply.badRequest('account_id é obrigatório');
    return razao(tenantId, q.account_id, p.from, p.to);
  });

  fastify.get('/accounting/reports/balancete', guard('contabil:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const p = period(request, reply); if (!p) return;
    return balancete(tenantId, p.from, p.to);
  });

  fastify.get('/accounting/reports/livro-caixa', guard('contabil:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const p = period(request, reply); if (!p) return;
    return livroCaixa(tenantId, p.from, p.to);
  });

  fastify.get('/accounting/reports/dre', guard('contabil:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const p = period(request, reply); if (!p) return;
    return dreContabil(tenantId, p.from, p.to);
  });

  fastify.get('/accounting/reports/balanco', guard('contabil:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { date?: string };
    if (!q.date) return reply.badRequest('date é obrigatória (YYYY-MM-DD)');
    return balanco(tenantId, q.date);
  });
};
