// Campos Personalizados de Contrato (migration 0072) — schema definido por
// tenant, gerenciado em Contratos → Campos Personalizados. Rota fina: só
// HTTP, toda regra vive em contractFieldService.ts/contractFieldDomain.ts.

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import {
  listFieldDefinitions, createFieldDefinition, updateFieldDefinition, deactivateFieldDefinition,
  ContractFieldDomainError,
} from '../services/contractFieldService';

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

export const contractFieldsRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requireModule('service_contracts'), requirePermission('contracts:view')],
  };
  const authEdit = {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requireModule('service_contracts'), requirePermission('contracts:edit')],
  };

  /* ── GET /v1/contract-fields ───────────────────────────────────────── */
  fastify.get('/contract-fields', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const rows = await listFieldDefinitions(tenantId);
    return { data: rows };
  });

  /* ── POST /v1/contract-fields ──────────────────────────────────────── */
  fastify.post('/contract-fields', authEdit, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const b = request.body as any;

    try {
      const row = await createFieldDefinition(tenantId, {
        label: b?.label, field_type: b?.field_type,
        required: b?.required, sort_order: b?.sort_order,
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (err instanceof ContractFieldDomainError) {
        return reply.code(422).send({ error: err.code, message: fieldErrorMessage(err.code), ...err.payload });
      }
      throw err;
    }
  });

  /* ── PATCH /v1/contract-fields/:id ─────────────────────────────────── */
  fastify.patch<{ Params: { id: string } }>('/contract-fields/:id', authEdit, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params;
    const b = request.body as any;

    try {
      const row = await updateFieldDefinition(tenantId, id, {
        label: b?.label, required: b?.required, sort_order: b?.sort_order,
      });
      return row;
    } catch (err) {
      if (err instanceof ContractFieldDomainError) {
        if (err.code === 'field_not_found') return reply.notFound(fieldErrorMessage(err.code));
        return reply.code(422).send({ error: err.code, message: fieldErrorMessage(err.code), ...err.payload });
      }
      throw err;
    }
  });

  /* ── DELETE /v1/contract-fields/:id ────────────────────────────────── */
  fastify.delete<{ Params: { id: string } }>('/contract-fields/:id', authEdit, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params;

    try {
      await deactivateFieldDefinition(tenantId, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ContractFieldDomainError) {
        if (err.code === 'field_not_found') return reply.notFound(fieldErrorMessage(err.code));
        return reply.code(422).send({ error: err.code, message: fieldErrorMessage(err.code) });
      }
      throw err;
    }
  });
};
