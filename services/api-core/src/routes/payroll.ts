import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import {
  listPayrollRuns, getPayrollRun, createPayrollRun, updatePayrollEntryAdjustments,
  closePayrollRun, getPayslip, PayrollDomainError,
} from '../services/hr/payrollService';

export const payrollRoutes: FastifyPluginAsync = async (fastify) => {
  const view = {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requireModule('hr'), requirePermission('payroll', 'view')],
  };
  const manage = {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requireModule('hr'), requirePermission('payroll', 'manage')],
  };

  function handleDomainError(err: unknown, reply: any) {
    if (err instanceof PayrollDomainError) {
      if (err.code === 'payroll_run_not_found' || err.code === 'payroll_entry_not_found') return reply.notFound(err.code);
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    throw err;
  }

  fastify.get('/payroll', view, async (request) => {
    const tenantId = (request as any).user.tenantId;
    return { data: await listPayrollRuns(tenantId) };
  });

  fastify.get('/payroll/:id', view, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    try {
      return await getPayrollRun(id, tenantId);
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.post('/payroll', manage, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { company_id, reference_month } = request.body as { company_id?: string; reference_month: string };
    if (!reference_month) return reply.badRequest('reference_month é obrigatório');
    try {
      return reply.code(201).send(await createPayrollRun({ tenantId, companyId: company_id, referenceMonth: reference_month }));
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.patch('/payroll/entries/:id', manage, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    const { extra_earnings, extra_deductions } = request.body as {
      extra_earnings?: Array<{ description: string; amount: number }>;
      extra_deductions?: Array<{ description: string; amount: number }>;
    };
    try {
      return await updatePayrollEntryAdjustments(id, tenantId, { extraEarnings: extra_earnings, extraDeductions: extra_deductions });
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.get('/payroll/entries/:id/print', view, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    try {
      return await getPayslip(id, tenantId);
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.post('/payroll/:id/close', manage, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params as { id: string };
    try {
      return await closePayrollRun(id, tenantId, userId);
    } catch (err) { return handleDomainError(err, reply); }
  });
};
