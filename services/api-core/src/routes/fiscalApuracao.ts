// Apuração PGDAS-D — /v1/fiscal/apuracao*. Apurar/reapurar competência,
// memória de cálculo, export/roteiro assistido (SEM transmissão — portal
// GOV.BR é manual), pagamento de DAS e estimado-vs-pago para o dashboard.

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { CompanyDomainError, resolveCompanyId } from '../services/companyService';
import { FiscalDomainError } from '../domain/fiscal/fiscalCompanyConfigDomain';
import { SimplesDomainError } from '../domain/simples/simplesDomain';
import { FiscalLockError } from '../services/fiscalPeriodLockGuard';
import { db } from '../db';
import {
  apurarCompetencia, exportApuracao, getGuia, listApuracoes, registerDasPayment, estimadoVsPago,
} from '../services/apuracaoService';
import {
  getReadiness, getPayloadPreview, conferir, transmitir, gerarDas, listTransmissions,
  isPgdasdEnabled, PgdasdDisabledError,
} from '../services/pgdasdService';

export const fiscalApuracaoRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const guard = (permission: string) => ({
    onRequest:  [authenticate],
    preHandler: [requireModule('fiscal'), requirePermission(permission)],
  });

  function handleError(err: unknown, reply: any) {
    if (err instanceof SimplesDomainError || err instanceof FiscalDomainError) {
      if (err.code.endsWith('_not_found')) return reply.notFound(err.code);
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    if (err instanceof CompanyDomainError) {
      if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    // Competência travada é recusa de negócio (reabrir → reapurar), não falha
    // do servidor — mesmo contrato de nfse/accounting/closing, que já traduzem.
    if (err instanceof FiscalLockError) {
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    // SERPRO não configurado neste ambiente → 503 (molde do assistente IA).
    if (err instanceof PgdasdDisabledError) {
      return reply.code(503).send({ error: 'pgdasd_disabled' });
    }
    throw err;
  }

  fastify.get('/fiscal/apuracao', guard('fiscal:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { company_id?: string };
    try {
      const companyId = q.company_id ? (await resolveCompanyId(tenantId, q.company_id, db)).id : null;
      return { data: await listApuracoes(tenantId, companyId) };
    } catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/apuracao', guard('fiscal:apurar'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as { company_id?: string; competencia?: string };
    if (!b?.competencia) return reply.badRequest('competencia é obrigatória (YYYY-MM)');
    try {
      return reply.code(201).send(await apurarCompetencia(tenantId, b.company_id ?? '', b.competencia, userId));
    } catch (err) { return handleError(err, reply); }
  });

  fastify.get('/fiscal/apuracao/:id/export', guard('fiscal:apurar'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return await exportApuracao(tenantId, id, userId); }
    catch (err) { return handleError(err, reply); }
  });

  // Guia de impostos (E8): read-only, SEM marcar exported — alimenta a tela
  // imprimível e o card do assistente.
  fastify.get('/fiscal/apuracao/:id/guia', guard('fiscal:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return await getGuia(tenantId, id); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/das-payments', guard('fiscal:apurar'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as { company_id?: string; competencia?: string; paid_at?: string; amount?: number; reference?: string };
    if (!b?.competencia || !b?.paid_at || !b?.amount) {
      return reply.badRequest('competencia, paid_at e amount são obrigatórios');
    }
    try {
      const company = await resolveCompanyId(tenantId, b.company_id, db);
      return reply.code(201).send(await registerDasPayment(tenantId, {
        companyId: company.id, competencia: b.competencia, paidAt: b.paid_at,
        amount: b.amount, reference: b.reference,
      }, userId));
    } catch (err) { return handleError(err, reply); }
  });

  fastify.get('/fiscal/das-summary', guard('fiscal:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { company_id?: string };
    try {
      // resolveCompanyId (não o param cru) preserva a checagem de posse do tenant.
      const companyId = q.company_id ? (await resolveCompanyId(tenantId, q.company_id, db)).id : null;
      return { data: await estimadoVsPago(tenantId, companyId) };
    } catch (err) { return handleError(err, reply); }
  });

  // ── PGDAS-D via SERPRO Integra Contador (0079) ──────────────────────────
  // Fase 0 (sem rede): readiness + payload preview. Fases 1-3 (rede): conferir
  // (R$0,40, ZERO efeito legal) → transmitir (ato irreversível, exige confirmar)
  // → gerar DAS (PDF oficial). SERPRO não configurado ⇒ 503.

  fastify.get('/fiscal/apuracao/:id/pgdasd/readiness', guard('fiscal:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return await getReadiness(tenantId, id, db); }
    catch (err) { return handleError(err, reply); }
  });

  // Mostra o `dados` EXATO que a RFB receberia — sem rede, sem custo.
  fastify.get('/fiscal/apuracao/:id/pgdasd/payload', guard('fiscal:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return await getPayloadPreview(tenantId, id, db); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.get('/fiscal/apuracao/:id/pgdasd/transmissions', guard('fiscal:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return { data: await listTransmissions(tenantId, id, db), enabled: isPgdasdEnabled() }; }
    catch (err) { return handleError(err, reply); }
  });

  // CONFERÊNCIA: a RFB calcula e devolve os números dela SEM transmitir. Zero
  // efeito jurídico. R$0,40. É a rede de segurança antes do botão de verdade.
  fastify.post('/fiscal/apuracao/:id/pgdasd/conferir', guard('fiscal:transmit'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return await conferir(tenantId, id, userId, db); }
    catch (err) { return handleError(err, reply); }
  });

  // TRANSMISSÃO: ato fiscal IRREVERSÍVEL. Exige confirmar:true no corpo — nunca
  // dispara por acidente. Sem blind-retry do Declarar (ver pgdasdService).
  fastify.post('/fiscal/apuracao/:id/pgdasd/transmitir', guard('fiscal:transmit'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as { confirmar?: boolean };
    if (body?.confirmar !== true) {
      return reply.code(422).send({ error: 'confirmacao_obrigatoria', hint: 'Envie { "confirmar": true } para transmitir a declaração à Receita Federal.' });
    }
    try { return reply.code(201).send(await transmitir(tenantId, id, userId, db)); }
    catch (err) { return handleError(err, reply); }
  });

  // GERAR DAS: PDF oficial (código de barras + PIX). Seguro de repetir.
  fastify.post('/fiscal/pgdasd/transmissions/:tid/das', guard('fiscal:transmit'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { tid } = request.params as { tid: string };
    try { return await gerarDas(tenantId, tid, userId, db); }
    catch (err) { return handleError(err, reply); }
  });
};
