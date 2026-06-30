import { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, nfeConfigs, tenants } from '../db';
import { resolveAndCalculateTaxes } from '../lib/taxCalculationService';
import { getSimplesEffectiveRate, TaxRuleNotFoundError } from '../lib/taxRulesResolver';
import type { TaxRegime, TaxLine } from '../lib/taxEngine';

export const taxRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── POST /v1/tax/calculate ─────────────────────────────────────────────── */
  fastify.post('/tax/calculate', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['tax_regime', 'lines'],
        properties: {
          origin_state:      { type: 'string', minLength: 2, maxLength: 2 },
          destination_state: { type: 'string', minLength: 2, maxLength: 2 },
          icms_taxpayer:      { type: 'string' },
          consumer_type:      { type: 'string' },
          tax_regime: {
            type: 'string',
            enum: ['lucro_real', 'lucro_presumido', 'simples_nacional', 'mei'],
          },
          lines: {
            type: 'array',
            minItems: 1,
            maxItems: 500,
            items: {
              type: 'object',
              required: ['quantity', 'unit_price'],
              properties: {
                ncm_code:   { type: 'string' },
                quantity:   { type: 'number', minimum: 0.001 },
                unit_price: { type: 'number', minimum: 0 },
                ipi_rate:   { type: 'number', minimum: 0, maximum: 100, default: 0 },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const body = request.body as {
      origin_state?:      string;
      destination_state?: string;
      icms_taxpayer?:     string;
      consumer_type?:     string;
      tax_regime:         TaxRegime;
      lines:              TaxLine[];
    };

    // Origem padrão: UF cadastrada em Empresa → Fiscal (nfe_configs.uf). O chamador
    // ainda pode sobrescrever explicitamente (ex.: simulação), mas o default deixa
    // de ser 'SP' fixo — regra 33 do README.
    const [cfg] = await db
      .select({ uf: nfeConfigs.uf })
      .from(nfeConfigs)
      .where(eq(nfeConfigs.tenant_id, tenantId));

    const originState = (body.origin_state ?? cfg?.uf ?? 'SP').toUpperCase();
    const destState    = (body.destination_state ?? originState).toUpperCase();

    try {
      const result = await resolveAndCalculateTaxes({
        origin_state:      originState,
        destination_state: destState,
        tax_regime:         body.tax_regime,
        icms_taxpayer:      body.icms_taxpayer,
        consumer_type:      body.consumer_type,
        lines:              body.lines,
      }, db);
      return result;
    } catch (err) {
      if (err instanceof TaxRuleNotFoundError) {
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── GET /v1/tax/simples-effective-rate ─────────────────────────────────── */
  // Alíquota efetiva estimada do Simples Nacional (Anexo I) a partir do RBT12
  // cadastrado em Empresa → Fiscal. Informativo — não altera os valores de
  // ICMS/PIS/COFINS lançados na NF-e, que continuam zerados para o Simples
  // (regra 33 do README).
  fastify.get('/tax/simples-effective-rate', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;

    const [tenant] = await db
      .select({ simples_rbt12: tenants.simples_rbt12 })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    if (!tenant?.simples_rbt12) return { rbt12: null, effective_rate: null };

    const rbt12 = Number(tenant.simples_rbt12);
    try {
      const effective_rate = await getSimplesEffectiveRate(rbt12, db);
      return { rbt12, effective_rate };
    } catch (err) {
      if (err instanceof TaxRuleNotFoundError) {
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });
};
