// Portal do técnico — TODAS as rotas aqui exigem JWT autenticado com
// role='technician' (technicianRoleGuard, em app.ts, também restringe esse
// papel a só este prefixo). O routing_token da URL nunca é usado para
// autorização aqui — só a query string /tecnico/entrar?redirect=... do
// frontend usa o token, e só para navegação, antes do login.

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import {
  getVisitForTechnician, listVisitsForTechnician, checkInVisit, completeVisit,
  assertTechnicianOwnsVisit, ServiceVisitDomainError,
} from '../services/serviceVisitService';
import {
  createPresignedPhotoUpload, confirmPhotoUpload,
  createPresignedSignatureUpload, confirmSignature,
  PhotoStorageError,
} from '../services/servicePhotoStorageService';
import { CustomFieldDomainError } from '../domain/customFields/customFieldDomain';
import { db } from '../db';

export const technicianPortalRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate], preHandler: [requireModule('service_orders')] };

  function currentTechnicianUserId(request: any): string {
    return request.user.userId;
  }

  function handleVisitError(err: unknown, reply: any) {
    if (err instanceof ServiceVisitDomainError) {
      if (err.code === 'visit_not_found') return reply.notFound('Visita não encontrada');
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    if (err instanceof PhotoStorageError) return reply.code(422).send({ error: err.code });
    // Campos personalizados do formulário técnico (migration 0088) — ex.:
    // 'field_value_required' quando um campo obrigatório fica sem resposta.
    if (err instanceof CustomFieldDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
    throw err;
  }

  // ── GET /v1/technician/visits ────────────────────────────────────────────
  fastify.get('/technician/visits', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const visits = await listVisitsForTechnician(currentTechnicianUserId(request), tenantId, db);
    return { data: visits };
  });

  // ── GET /v1/technician/visits/:id ────────────────────────────────────────
  fastify.get('/technician/visits/:id', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    try {
      const result = await getVisitForTechnician(id, currentTechnicianUserId(request), tenantId, db);
      return result;
    } catch (err) { return handleVisitError(err, reply); }
  });

  // ── POST /v1/technician/visits/:id/check-in ──────────────────────────────
  fastify.post('/technician/visits/:id/check-in', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    try {
      await checkInVisit(id, currentTechnicianUserId(request), tenantId, db);
      return { ok: true, status: 'in_progress' };
    } catch (err) { return handleVisitError(err, reply); }
  });

  // ── POST /v1/technician/visits/:id/complete ──────────────────────────────
  // custom_fields (migration 0088): respostas do formulário técnico
  // dinâmico — validadas contra o schema do tenant dentro de completeVisit()
  // ANTES do status virar 'completed' (campo obrigatório sem resposta
  // bloqueia a conclusão, nunca uma visita "meio completa").
  fastify.post('/technician/visits/:id/complete', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { report_notes, custom_fields } = request.body as {
      report_notes?: string; custom_fields?: { field_definition_id: string; value: string | null }[];
    };
    try {
      await completeVisit({
        visitId: id, technicianUserId: currentTechnicianUserId(request), tenantId,
        reportNotes: report_notes, customFields: custom_fields,
      }, db);
      return { ok: true, status: 'completed' };
    } catch (err) { return handleVisitError(err, reply); }
  });

  // ── POST /v1/technician/visits/:id/photos/presign ────────────────────────
  fastify.post('/technician/visits/:id/photos/presign', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { content_type } = request.body as { content_type: string };

    try {
      // Confirma posse da visita ANTES de gerar qualquer credencial de S3 —
      // é o fechamento de segurança central desta revisão: presign nunca é
      // público, sempre exige técnico logado dono da visita.
      await assertTechnicianOwnsVisit(id, currentTechnicianUserId(request), tenantId, db);
      const presigned = await createPresignedPhotoUpload({ tenantId, visitId: id, contentType: content_type });
      return presigned;
    } catch (err) { return handleVisitError(err, reply); }
  });

  // ── POST /v1/technician/visits/:id/photos/confirm ────────────────────────
  fastify.post('/technician/visits/:id/photos/confirm', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { s3_key, content_type, file_size_bytes, idempotency_key, caption } = request.body as {
      s3_key: string; content_type: string; file_size_bytes: number; idempotency_key: string; caption?: string;
    };

    try {
      await assertTechnicianOwnsVisit(id, currentTechnicianUserId(request), tenantId, db);
      const photo = await confirmPhotoUpload({
        tenantId, visitId: id, s3Key: s3_key, contentType: content_type,
        fileSizeBytes: file_size_bytes, idempotencyKey: idempotency_key, caption,
      }, db);
      return reply.code(201).send(photo);
    } catch (err) { return handleVisitError(err, reply); }
  });

  // ── POST /v1/technician/visits/:id/signature/presign ─────────────────────
  fastify.post('/technician/visits/:id/signature/presign', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    try {
      await assertTechnicianOwnsVisit(id, currentTechnicianUserId(request), tenantId, db);
      const presigned = await createPresignedSignatureUpload({ tenantId, visitId: id });
      return presigned;
    } catch (err) { return handleVisitError(err, reply); }
  });

  // ── POST /v1/technician/visits/:id/signature/confirm ─────────────────────
  fastify.post('/technician/visits/:id/signature/confirm', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { s3_key, signed_by_name } = request.body as { s3_key: string; signed_by_name: string };

    if (!signed_by_name?.trim()) return reply.badRequest('signed_by_name é obrigatório');

    try {
      await assertTechnicianOwnsVisit(id, currentTechnicianUserId(request), tenantId, db);
      await confirmSignature({ tenantId, visitId: id, s3Key: s3_key, signedByName: signed_by_name }, db);
      return { ok: true };
    } catch (err) { return handleVisitError(err, reply); }
  });
};
