import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import {
  listCompanies, createCompany, updateCompany, deactivateCompany, setDefaultCompany,
  CompanyDomainError,
} from '../services/companyService';

export const companiesRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate] };
  // Só a criação de uma 2ª+ empresa exige o módulo habilitado (regra 40) —
  // listar/editar a empresa já existente não é a capacidade nova.
  const authWithModule = { onRequest: [(fastify as any).authenticate], preHandler: [requireModule('multi_empresa')] };

  const mask = (t: string | null | undefined) => (t ? '****' + t.slice(-4) : null);
  const maskTokens = (c: any) => ({
    ...c,
    focus_token_homologacao: mask(c.focus_token_homologacao),
    focus_token_producao:    mask(c.focus_token_producao),
  });

  /* ── GET /v1/companies ──────────────────────────────────────────────── */
  fastify.get('/companies', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const rows = await listCompanies(tenantId);
    return { data: rows.map(maskTokens) };
  });

  /* ── POST /v1/companies ─────────────────────────────────────────────── */
  fastify.post('/companies', authWithModule, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const body = request.body as any;

    if (!body?.cnpj || !body?.razao_social || !body?.logradouro || !body?.numero || !body?.bairro || !body?.cep) {
      return reply.badRequest('Campos obrigatórios: cnpj, razao_social, logradouro, numero, bairro, cep');
    }

    try {
      const row = await createCompany(tenantId, body);
      return reply.code(201).send(maskTokens(row));
    } catch (err) {
      if (err instanceof CompanyDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }
  });

  /* ── PATCH /v1/companies/:id ────────────────────────────────────────── */
  fastify.patch('/companies/:id', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    const body = request.body as any;

    try {
      const row = await updateCompany(tenantId, id, body);
      return maskTokens(row);
    } catch (err) {
      if (err instanceof CompanyDomainError) {
        if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── DELETE /v1/companies/:id ───────────────────────────────────────── */
  fastify.delete('/companies/:id', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };

    try {
      await deactivateCompany(tenantId, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof CompanyDomainError) {
        if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── PATCH /v1/companies/:id/set-default ────────────────────────────── */
  fastify.patch('/companies/:id/set-default', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };

    try {
      const row = await setDefaultCompany(tenantId, id);
      return maskTokens(row);
    } catch (err) {
      if (err instanceof CompanyDomainError) {
        if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });
};
