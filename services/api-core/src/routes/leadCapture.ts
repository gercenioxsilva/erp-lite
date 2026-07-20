// Captação de Leads (/v1/public/leads) — consumida por landing pages
// EXTERNAS via API key (X-API-Key), nunca por JWT. tenant_id vem sempre da
// chave (nunca do body — mesma regra 4 de sempre, só que resolvida por
// chave em vez de JWT). Rota fina: toda regra vive em
// leadCaptureService.ts/leadCaptureDomain.ts.
//
// Envelope: {success, data} | {success:false, error, ...detalhe} — mesmo
// contrato já usado pelo Fiscal Engine (routes/engine.ts).

import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireApiKey, AuthenticatedApiKey } from '../lib/apiKeyAuth';
import { recordUsage } from '../services/engineKeyService';
import { findOrCreateLeadClient, LeadCaptureDomainError } from '../services/leadCaptureService';

function meter(request: FastifyRequest, endpoint: string): void {
  const key = (request as any).apiKey as AuthenticatedApiKey | undefined;
  if (key) recordUsage(key.id, endpoint).catch(() => { /* metering nunca quebra a request */ });
}

export const leadCaptureRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { preHandler: [requireApiKey('leads:create', 'lead_capture')] };

  /* ── POST /v1/public/leads ──────────────────────────────────────────── */
  fastify.post('/public/leads', auth, async (request, reply) => {
    const key = (request as any).apiKey as AuthenticatedApiKey;
    const b = (request.body ?? {}) as Record<string, unknown>;

    try {
      const result = await findOrCreateLeadClient(key.tenantId, {
        name:         typeof b.name === 'string' ? b.name : undefined,
        email:        typeof b.email === 'string' ? b.email : undefined,
        phone:        typeof b.phone === 'string' ? b.phone : undefined,
        company_name: typeof b.company_name === 'string' ? b.company_name : undefined,
        cnpj:         typeof b.cnpj === 'string' ? b.cnpj : undefined,
        message:      typeof b.message === 'string' ? b.message : undefined,
      });
      meter(request, 'public/leads');
      return reply.code(result.created ? 201 : 200).send({
        success: true,
        data: { id: result.client.id, created: result.created },
      });
    } catch (err) {
      if (err instanceof LeadCaptureDomainError) {
        return reply.code(422).send({ success: false, error: err.code });
      }
      throw err;
    }
  });
};
