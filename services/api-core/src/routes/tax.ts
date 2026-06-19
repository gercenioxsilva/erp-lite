import { FastifyPluginAsync } from 'fastify';
import { calculateTaxes, type TaxRegime, type TaxLine } from '../lib/taxEngine';

export const taxRoutes: FastifyPluginAsync = async (fastify) => {

  /* POST /v1/tax/calculate ───────────────────────────────────────────────── */
  fastify.post('/tax/calculate', {
    schema: {
      body: {
        type: 'object',
        required: ['tax_regime', 'lines'],
        properties: {
          origin_state:      { type: 'string', minLength: 2, maxLength: 2, default: 'SP' },
          destination_state: { type: 'string', minLength: 2, maxLength: 2, default: 'SP' },
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
  }, async (request) => {
    const body = request.body as {
      origin_state?:      string;
      destination_state?: string;
      tax_regime:         TaxRegime;
      lines:              TaxLine[];
    };
    return calculateTaxes({
      origin_state:      (body.origin_state      ?? 'SP').toUpperCase(),
      destination_state: (body.destination_state ?? 'SP').toUpperCase(),
      tax_regime:        body.tax_regime,
      lines:             body.lines,
    });
  });
};
