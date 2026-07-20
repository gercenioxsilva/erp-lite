// Importação multi-fonte — /v1/fiscal/imports* e /v1/fiscal/import-templates*.
// Upload via multipart (@fastify/multipart registrado no app.ts); o arquivo
// original vai ao S3 e o parse acontece no BACKEND (auditoria/reprocesso) —
// nunca mais parse de planilha no navegador para dados fiscais.

import { FastifyPluginAsync } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db, importSourceTemplates } from '../db';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { CompanyDomainError } from '../services/companyService';
import { ImportDomainError } from '../domain/import';
import { ingestUpload, processBatch, listBatches, getBatch } from '../services/saleImportService';

export const fiscalImportsRoutes: FastifyPluginAsync = async (fastify) => {
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
    if (err instanceof ImportDomainError) {
      if (err.code === 'duplicate_file') return reply.code(409).send({ error: err.code, ...err.payload });
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    throw err;
  }

  /* ── Upload (multipart) ─────────────────────────────────────────────── */

  fastify.post('/fiscal/imports', guard('fiscal:import'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const file = await (request as any).file();
    if (!file) return reply.badRequest('Arquivo é obrigatório (multipart field "file")');

    const buffer: Buffer = await file.toBuffer();
    const fields = file.fields ?? {};
    const fieldValue = (name: string): string | null => {
      const f = fields[name] as { value?: string } | undefined;
      return f?.value ?? null;
    };

    try {
      const batch = await ingestUpload(tenantId, fieldValue('company_id'), {
        filename: file.filename ?? 'upload.bin',
        buffer,
        contentType: file.mimetype ?? null,
        templateId: fieldValue('template_id'),
      }, userId);
      return reply.code(201).send(batch);
    } catch (err) { return handleError(err, reply); }
  });

  fastify.get('/fiscal/imports', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    return { data: await listBatches(tenantId) };
  });

  fastify.get('/fiscal/imports/:id', guard('fiscal:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return await getBatch(tenantId, id); }
    catch (err) { return handleError(err, reply); }
  });

  // Reprocesso a partir do original no S3 (mapper corrigido/template novo).
  fastify.post('/fiscal/imports/:id/reprocess', guard('fiscal:import'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      await getBatch(tenantId, id); // valida posse antes de tocar o batch
      return await processBatch(id, null);
    } catch (err) { return handleError(err, reply); }
  });

  /* ── Templates de mapeamento ────────────────────────────────────────── */

  fastify.get('/fiscal/import-templates', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    const rows = await db.select().from(importSourceTemplates)
      .where(eq(importSourceTemplates.tenant_id, tenantId));
    return { data: rows };
  });

  fastify.post('/fiscal/import-templates', guard('fiscal:import'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const b = request.body as any;
    if (!b?.name || !b?.column_map || typeof b.column_map !== 'object') {
      return reply.badRequest('name e column_map são obrigatórios');
    }
    const [row] = await db.insert(importSourceTemplates).values({
      tenant_id: tenantId, company_id: b.company_id ?? null, name: b.name,
      source_kind: b.source_kind === 'xlsx' ? 'xlsx' : 'csv',
      provider_hint: b.provider_hint ?? null, column_map: b.column_map,
      delimiter: b.delimiter ?? null,
      encoding: b.encoding === 'win1252' ? 'win1252' : 'utf8',
      date_format: b.date_format ?? 'DD/MM/YYYY',
      decimal_separator: b.decimal_separator ?? ',',
      has_header: b.has_header ?? true, skip_rows: b.skip_rows ?? 0,
      dedup_strategy: ['nsu', 'line_hash'].includes(b.dedup_strategy) ? b.dedup_strategy : 'auto',
    }).returning();
    return reply.code(201).send(row);
  });

  fastify.delete('/fiscal/import-templates/:id', guard('fiscal:import'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const [row] = await db.update(importSourceTemplates).set({ is_active: false })
      .where(and(eq(importSourceTemplates.id, id), eq(importSourceTemplates.tenant_id, tenantId)))
      .returning();
    if (!row) return reply.notFound('Template não encontrado');
    return reply.code(204).send();
  });
};
