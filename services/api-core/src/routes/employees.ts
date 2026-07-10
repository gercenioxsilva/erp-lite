import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import {
  listEmployees, createEmployee, updateEmployee, deactivateEmployee, getEmployee,
  PayrollDomainError,
} from '../services/hr/employeeService';

export const employeesRoutes: FastifyPluginAsync = async (fastify) => {
  const view = {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requireModule('hr'), requirePermission('employees:view')],
  };
  const manage = {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requireModule('hr'), requirePermission('employees:manage')],
  };

  function handleDomainError(err: unknown, reply: any) {
    if (err instanceof PayrollDomainError) {
      if (err.code === 'employee_not_found') return reply.notFound(err.code);
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    throw err;
  }

  fastify.get('/employees', view, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { search, active_only } = request.query as { search?: string; active_only?: string };
    return { data: await listEmployees({ tenantId, search, activeOnly: active_only === 'true' }) };
  });

  fastify.get('/employees/:id', view, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    try {
      return await getEmployee(id, tenantId);
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.post('/employees', manage, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const b = request.body as any;
    try {
      const employee = await createEmployee({
        tenantId, companyId: b.company_id, name: b.name, cpf: b.cpf, email: b.email, phone: b.phone,
        roleTitle: b.role_title, regime: b.regime, baseSalary: Number(b.base_salary),
        costCenterId: b.cost_center_id, hireDate: b.hire_date,
      });
      return reply.code(201).send(employee);
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.patch('/employees/:id', manage, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    const b = request.body as any;
    try {
      return await updateEmployee(id, tenantId, {
        name: b.name, email: b.email, phone: b.phone, roleTitle: b.role_title, regime: b.regime,
        baseSalary: b.base_salary != null ? Number(b.base_salary) : undefined,
        costCenterId: b.cost_center_id, companyId: b.company_id,
        terminationDate: b.termination_date, isActive: b.is_active,
      });
    } catch (err) { return handleDomainError(err, reply); }
  });

  fastify.delete('/employees/:id', manage, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    try {
      await deactivateEmployee(id, tenantId);
      return reply.code(204).send();
    } catch (err) { return handleDomainError(err, reply); }
  });
};
