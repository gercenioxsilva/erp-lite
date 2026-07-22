// Campos Personalizados de Visita Técnica (migration 0088) — schema definido
// por tenant, gerenciado em Minha Empresa → Campos da Visita Técnica.
// Admin-only por desenho: requirePermission('service_visit_fields:*') nunca
// reaproveita service_orders:view/edit — só owner/admin têm essa permissão
// por padrão (roleMatrix.ts), manager/user (que despacham visitas no dia a
// dia) não. Rota fina: só HTTP, toda regra vive em
// serviceVisitFieldService.ts/domain/customFields/customFieldDomain.ts.

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import {
  listVisitFieldDefinitions, createVisitFieldDefinition, updateVisitFieldDefinition, deactivateVisitFieldDefinition,
  ServiceVisitFieldDomainError,
} from '../services/serviceVisitFieldService';

function fieldErrorMessage(code: string): string {
  switch (code) {
    case 'field_label_required':      return 'Informe um nome para o campo.';
    case 'field_type_invalid':        return 'Tipo de campo inválido.';
    case 'field_label_invalid':       return 'Não foi possível gerar uma chave válida a partir desse nome.';
    case 'field_key_duplicate':       return 'Já existe um campo com um nome equivalente.';
    case 'field_not_found':           return 'Campo não encontrado.';
    default:                          return 'Não foi possível concluir a operação.';
  }
}

export const serviceVisitFieldsRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requireModule('service_orders'), requirePermission('service_visit_fields:view')],
  };
  const authManage = {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requireModule('service_orders'), requirePermission('service_visit_fields:manage')],
  };

  /* ── GET /v1/service-visit-fields ──────────────────────────────────── */
  fastify.get('/service-visit-fields', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const rows = await listVisitFieldDefinitions(tenantId);
    return { data: rows };
  });

  /* ── POST /v1/service-visit-fields ─────────────────────────────────── */
  fastify.post('/service-visit-fields', authManage, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const b = request.body as any;

    try {
      const row = await createVisitFieldDefinition(tenantId, {
        label: b?.label, field_type: b?.field_type,
        required: b?.required, sort_order: b?.sort_order,
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (err instanceof ServiceVisitFieldDomainError) {
        return reply.code(422).send({ error: err.code, message: fieldErrorMessage(err.code), ...err.payload });
      }
      throw err;
    }
  });

  /* ── PATCH /v1/service-visit-fields/:id ────────────────────────────── */
  fastify.patch<{ Params: { id: string } }>('/service-visit-fields/:id', authManage, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params;
    const b = request.body as any;

    try {
      const row = await updateVisitFieldDefinition(tenantId, id, {
        label: b?.label, required: b?.required, sort_order: b?.sort_order,
      });
      return row;
    } catch (err) {
      if (err instanceof ServiceVisitFieldDomainError) {
        if (err.code === 'field_not_found') return reply.notFound(fieldErrorMessage(err.code));
        return reply.code(422).send({ error: err.code, message: fieldErrorMessage(err.code), ...err.payload });
      }
      throw err;
    }
  });

  /* ── DELETE /v1/service-visit-fields/:id ───────────────────────────── */
  fastify.delete<{ Params: { id: string } }>('/service-visit-fields/:id', authManage, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params;

    try {
      await deactivateVisitFieldDefinition(tenantId, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ServiceVisitFieldDomainError) {
        if (err.code === 'field_not_found') return reply.notFound(fieldErrorMessage(err.code));
        return reply.code(422).send({ error: err.code, message: fieldErrorMessage(err.code) });
      }
      throw err;
    }
  });
};
