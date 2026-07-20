// Cadastro fiscal por empresa — /v1/companies/:companyId/fiscal-config/*.
// Gating em camadas: authenticate → requireModule('fiscal') → requirePermission.
// Leitura = fiscal:view; escrita = fiscal:config; certificado A1 =
// fiscal:manage_certificate (fora do Gestor, mesma trava de bank_accounts:manage).

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { CompanyDomainError } from '../services/companyService';
import { FiscalDomainError } from '../domain/fiscal/fiscalCompanyConfigDomain';
import {
  getOrCreateConfig, upsertConfig,
  listCnaes, addCnae, removeCnae,
  listServiceCodes, upsertServiceCode, removeServiceCode,
  recordPayrollMonth, listPayrollMonths,
  uploadA1Certificate, getCertificateStatus, removeCertificate,
  getEmissionReadiness,
} from '../services/fiscalCompanyConfigService';

export const fiscalCompanyConfigRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const guard = (permission: string) => ({
    onRequest:  [authenticate],
    preHandler: [requireModule('fiscal'), requirePermission(permission)],
  });

  function handleError(err: unknown, reply: any) {
    if (err instanceof CompanyDomainError) {
      if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    if (err instanceof FiscalDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
    throw err;
  }

  const params = (request: any) => ({
    tenantId:  request.user.tenantId as string,
    userId:    request.user.userId as string,
    companyId: (request.params as { companyId: string }).companyId,
  });

  /* ── Config 1:1 ─────────────────────────────────────────────────────── */

  fastify.get('/companies/:companyId/fiscal-config', guard('fiscal:view'), async (request, reply) => {
    const { tenantId, companyId } = params(request);
    try { return await getOrCreateConfig(tenantId, companyId); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.put('/companies/:companyId/fiscal-config', guard('fiscal:config'), async (request, reply) => {
    const { tenantId, companyId, userId } = params(request);
    try { return await upsertConfig(tenantId, companyId, request.body as Record<string, unknown>, userId); }
    catch (err) { return handleError(err, reply); }
  });

  /* ── CNAEs ──────────────────────────────────────────────────────────── */

  fastify.get('/companies/:companyId/fiscal-config/cnaes', guard('fiscal:view'), async (request, reply) => {
    const { tenantId, companyId } = params(request);
    try { return { data: await listCnaes(tenantId, companyId) }; }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/companies/:companyId/fiscal-config/cnaes', guard('fiscal:config'), async (request, reply) => {
    const { tenantId, companyId, userId } = params(request);
    const body = request.body as { codigo?: string; descricao?: string; is_principal?: boolean };
    if (!body?.codigo) return reply.badRequest('codigo é obrigatório');
    try { return reply.code(201).send(await addCnae(tenantId, companyId, { codigo: body.codigo, descricao: body.descricao, is_principal: body.is_principal }, userId)); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.delete('/companies/:companyId/fiscal-config/cnaes/:id', guard('fiscal:config'), async (request, reply) => {
    const { tenantId, companyId, userId } = params(request);
    const { id } = request.params as { id: string };
    try { await removeCnae(tenantId, companyId, id, userId); return reply.code(204).send(); }
    catch (err) { return handleError(err, reply); }
  });

  /* ── Códigos de serviço (LC 116) ────────────────────────────────────── */

  fastify.get('/companies/:companyId/fiscal-config/service-codes', guard('fiscal:view'), async (request, reply) => {
    const { tenantId, companyId } = params(request);
    try { return { data: await listServiceCodes(tenantId, companyId) }; }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/companies/:companyId/fiscal-config/service-codes', guard('fiscal:config'), async (request, reply) => {
    const { tenantId, companyId, userId } = params(request);
    const body = request.body as any;
    if (!body?.codigo_lc116) return reply.badRequest('codigo_lc116 é obrigatório');
    try { return reply.code(201).send(await upsertServiceCode(tenantId, companyId, body, userId)); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.delete('/companies/:companyId/fiscal-config/service-codes/:id', guard('fiscal:config'), async (request, reply) => {
    const { tenantId, companyId, userId } = params(request);
    const { id } = request.params as { id: string };
    try { await removeServiceCode(tenantId, companyId, id, userId); return reply.code(204).send(); }
    catch (err) { return handleError(err, reply); }
  });

  /* ── Folha 12m (Fator R) ────────────────────────────────────────────── */

  fastify.get('/companies/:companyId/fiscal-config/payroll', guard('fiscal:view'), async (request, reply) => {
    const { tenantId, companyId } = params(request);
    try { return { data: await listPayrollMonths(tenantId, companyId) }; }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/companies/:companyId/fiscal-config/payroll', guard('fiscal:config'), async (request, reply) => {
    const { tenantId, companyId, userId } = params(request);
    const body = request.body as { competencia?: string; folha_amount?: number | string; pro_labore_amount?: number | string };
    if (!body?.competencia || body.folha_amount === undefined) {
      return reply.badRequest('competencia e folha_amount são obrigatórios');
    }
    try { return reply.code(201).send(await recordPayrollMonth(tenantId, companyId, body as any, userId)); }
    catch (err) { return handleError(err, reply); }
  });

  /* ── Certificado A1 (permissão dedicada) ────────────────────────────── */

  fastify.get('/companies/:companyId/fiscal-config/certificate/status', guard('fiscal:view'), async (request, reply) => {
    const { tenantId, companyId } = params(request);
    try { return await getCertificateStatus(tenantId, companyId); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/companies/:companyId/fiscal-config/certificate', guard('fiscal:manage_certificate'), async (request, reply) => {
    const { tenantId, companyId, userId } = params(request);
    const body = request.body as { pfx_base64?: string; senha?: string };
    if (!body?.pfx_base64 || body.senha === undefined) {
      return reply.badRequest('pfx_base64 e senha são obrigatórios');
    }
    try { return reply.code(201).send(await uploadA1Certificate(tenantId, companyId, body.pfx_base64, body.senha, userId)); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.delete('/companies/:companyId/fiscal-config/certificate', guard('fiscal:manage_certificate'), async (request, reply) => {
    const { tenantId, companyId, userId } = params(request);
    try { await removeCertificate(tenantId, companyId, userId); return reply.code(204).send(); }
    catch (err) { return handleError(err, reply); }
  });

  /* ── Readiness (gate VALIDAR da emissão) ────────────────────────────── */

  fastify.get('/companies/:companyId/fiscal-config/emission-readiness', guard('fiscal:view'), async (request, reply) => {
    const { tenantId, companyId } = params(request);
    try { return await getEmissionReadiness(tenantId, companyId); }
    catch (err) { return handleError(err, reply); }
  });
};
