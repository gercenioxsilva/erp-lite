import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import {
  listCompanies, createCompany, updateCompany, deactivateCompany, setDefaultCompany,
  CompanyDomainError,
} from '../services/companyService';
import {
  registerCompanyFiscalIntegration, uploadCompanyCertificate, testCompanyFiscalConnection,
  FiscalIntegrationDomainError,
} from '../services/fiscalIntegrationService';

// Mensagens em pt-BR pra cada código de domínio — nunca menciona o provedor
// (Focus) por trás da integração, só o que o tenant precisa saber (regra 70).
function fiscalIntegrationErrorMessage(code: string): string {
  switch (code) {
    case 'registration_in_progress': return 'O registro já está em andamento — aguarde a conclusão antes de tentar novamente.';
    case 'registration_not_configured': return 'A integração de emissão de notas fiscais não está disponível no momento.';
    case 'registration_required': return 'Registre a empresa antes de continuar.';
    case 'certificate_file_required': return 'Selecione o arquivo do certificado digital (.pfx/.p12).';
    case 'certificate_password_required': return 'Informe a senha do certificado digital.';
    case 'certificate_file_too_large': return 'Arquivo de certificado digital inválido ou grande demais.';
    default: return 'Não foi possível concluir a operação.';
  }
}

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

  /* ── POST /v1/companies/:id/fiscal-integration/register ──────────────
   * Dispara o registro ASSÍNCRONO da empresa na integração de emissão de
   * notas fiscais (regra 70) — devolve 202 com o status 'processing'; o
   * resultado final chega via o worker que já consome nfe-results. */
  fastify.post('/companies/:id/fiscal-integration/register', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };

    try {
      const state = await registerCompanyFiscalIntegration(tenantId, id);
      return reply.code(202).send(state);
    } catch (err) {
      if (err instanceof CompanyDomainError) {
        if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      if (err instanceof FiscalIntegrationDomainError) {
        const status = err.code === 'registration_in_progress' ? 409 : 422;
        return reply.code(status).send({ error: err.code, message: fiscalIntegrationErrorMessage(err.code) });
      }
      throw err;
    }
  });

  /* ── POST /v1/companies/:id/fiscal-integration/certificate ───────────
   * Upload SÍNCRONO do certificado digital A1 — exige a empresa já
   * registrada (fiscal_integration_ref presente). */
  fastify.post('/companies/:id/fiscal-integration/certificate', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    const body = request.body as any;

    try {
      const state = await uploadCompanyCertificate(tenantId, id, {
        certificado_base64: body?.certificado_base64,
        senha_certificado:  body?.senha_certificado,
      });
      return state;
    } catch (err) {
      if (err instanceof CompanyDomainError) {
        if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      if (err instanceof FiscalIntegrationDomainError) {
        const message = err.code === 'certificate_upload_failed'
          ? String(err.payload?.reason ?? fiscalIntegrationErrorMessage(err.code))
          : fiscalIntegrationErrorMessage(err.code);
        return reply.code(422).send({ error: err.code, message });
      }
      throw err;
    }
  });

  /* ── POST /v1/companies/:id/fiscal-integration/test ──────────────────
   * Teste SÍNCRONO de conexão — confirma que a empresa está acessível na
   * integração de emissão de notas fiscais. */
  fastify.post('/companies/:id/fiscal-integration/test', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };

    try {
      const result = await testCompanyFiscalConnection(tenantId, id);
      return result;
    } catch (err) {
      if (err instanceof CompanyDomainError) {
        if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      if (err instanceof FiscalIntegrationDomainError) {
        return reply.code(422).send({ error: err.code, message: fiscalIntegrationErrorMessage(err.code) });
      }
      throw err;
    }
  });
};
