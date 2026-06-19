import { FastifyPluginAsync } from 'fastify';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { pool } from '../db/pool';
import { getSqsClient } from '../lib/sqsClient';

export const nfeRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/nfe-config ─────────────────────────────────────────────── */
  fastify.get('/nfe-config', async (request, reply) => {
    const { tenant_id } = request.query as { tenant_id: string };
    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const { rows: [cfg] } = await pool.query(
      'SELECT * FROM nfe_configs WHERE tenant_id = $1',
      [tenant_id],
    );
    if (!cfg) return reply.notFound('Configuração NF-e não encontrada');
    return cfg;
  });

  /* ── PUT /v1/nfe-config ─────────────────────────────────────────────── */
  fastify.put('/nfe-config', async (request, reply) => {
    const body = request.body as any;
    const { tenant_id, cnpj, razao_social, nome_fantasia, regime_tributario,
            logradouro, numero, complemento, bairro, municipio, uf, cep,
            telefone, email, cfop_padrao, cfop_interestadual,
            natureza_operacao, focus_ambiente } = body;

    if (!tenant_id || !cnpj || !razao_social || !logradouro || !numero || !bairro || !cep) {
      return reply.badRequest('Campos obrigatórios: tenant_id, cnpj, razao_social, logradouro, numero, bairro, cep');
    }

    const { rows: [cfg] } = await pool.query(
      `INSERT INTO nfe_configs
         (tenant_id, cnpj, razao_social, nome_fantasia, regime_tributario,
          logradouro, numero, complemento, bairro, municipio, uf, cep,
          telefone, email, cfop_padrao, cfop_interestadual, natureza_operacao, focus_ambiente)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (tenant_id) DO UPDATE SET
         cnpj               = EXCLUDED.cnpj,
         razao_social       = EXCLUDED.razao_social,
         nome_fantasia      = EXCLUDED.nome_fantasia,
         regime_tributario  = EXCLUDED.regime_tributario,
         logradouro         = EXCLUDED.logradouro,
         numero             = EXCLUDED.numero,
         complemento        = EXCLUDED.complemento,
         bairro             = EXCLUDED.bairro,
         municipio          = EXCLUDED.municipio,
         uf                 = EXCLUDED.uf,
         cep                = EXCLUDED.cep,
         telefone           = EXCLUDED.telefone,
         email              = EXCLUDED.email,
         cfop_padrao        = EXCLUDED.cfop_padrao,
         cfop_interestadual = EXCLUDED.cfop_interestadual,
         natureza_operacao  = EXCLUDED.natureza_operacao,
         focus_ambiente     = EXCLUDED.focus_ambiente,
         updated_at         = NOW()
       RETURNING *`,
      [tenant_id, cnpj.replace(/\D/g, ''), razao_social, nome_fantasia || null,
       regime_tributario ?? 1, logradouro, numero, complemento || null, bairro,
       municipio ?? 'SAO PAULO', uf ?? 'SP', cep.replace(/\D/g, ''),
       telefone || null, email || null,
       cfop_padrao ?? '5102', cfop_interestadual ?? '6102',
       natureza_operacao ?? 'Venda de mercadoria', focus_ambiente ?? 2],
    );
    return cfg;
  });

  /* ── POST /v1/invoices/:id/emit ─────────────────────────────────────── */
  fastify.post('/invoices/:id/emit', async (request, reply) => {
    const { id }        = request.params as { id: string };
    const { tenant_id } = request.query as { tenant_id: string };

    const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
    if (!queueUrl) {
      return reply.badRequest('Emissão de NF-e não configurada neste ambiente');
    }

    // Load invoice + items + client + nfe_config in parallel
    const [{ rows: [invoice] }, { rows: items }, { rows: [cfg] }] = await Promise.all([
      pool.query(
        `SELECT i.*,
                c.person_type,
                c.company_name, c.full_name,
                c.cnpj AS client_cnpj, c.cpf AS client_cpf,
                c.icms_taxpayer,
                c.zip_code, c.street, c.street_number, c.complement,
                c.neighborhood, c.city, c.state AS client_state,
                c.phone, c.email AS client_email
         FROM invoices i
         JOIN clients c ON c.id = i.client_id
         WHERE i.id = $1 AND i.tenant_id = $2`,
        [id, tenant_id],
      ),
      pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY created_at', [id]),
      pool.query('SELECT * FROM nfe_configs WHERE tenant_id = $1', [tenant_id]),
    ]);

    if (!invoice)  return reply.notFound('Nota fiscal não encontrada');
    if (!cfg)      return reply.badRequest('Configure os dados fiscais em Configurações → NF-e antes de emitir');
    if (invoice.status !== 'draft') {
      return reply.badRequest(`Só rascunhos podem ser enviados ao SEFAZ (status atual: ${invoice.status})`);
    }
    if (invoice.nfe_status === 'pending' || invoice.nfe_status === 'processing') {
      return reply.badRequest('Esta NF-e já está sendo processada. Aguarde o resultado.');
    }
    if (!items.length) {
      return reply.badRequest('A nota não possui itens');
    }

    const noNcm = items.filter((it: any) => !it.ncm_code);
    if (noNcm.length) {
      return reply.badRequest(`Itens sem NCM (obrigatório para NF-e): ${noNcm.map((it: any) => it.name).join(', ')}`);
    }

    const cfop = (it: any) =>
      cfg.uf === (invoice.client_state ?? cfg.uf)
        ? cfg.cfop_padrao
        : cfg.cfop_interestadual;

    const message = {
      invoice_id:  invoice.id,
      tenant_id,
      focus_ref:   invoice.id,  // UUID is URL-safe and unique for Focus NF-e ref
      ambiente:    cfg.focus_ambiente as 1 | 2,

      emitente: {
        cnpj:              cfg.cnpj,
        razao_social:      cfg.razao_social,
        nome_fantasia:     cfg.nome_fantasia,
        logradouro:        cfg.logradouro,
        numero:            cfg.numero,
        complemento:       cfg.complemento,
        bairro:            cfg.bairro,
        municipio:         cfg.municipio,
        uf:                cfg.uf,
        cep:               cfg.cep,
        telefone:          cfg.telefone,
        email:             cfg.email,
        regime_tributario: cfg.regime_tributario as 1 | 2 | 3,
      },

      destinatario: {
        cnpj:          invoice.person_type === 'PJ' ? invoice.client_cnpj : undefined,
        cpf:           invoice.person_type === 'PF' ? invoice.client_cpf  : undefined,
        nome:          invoice.person_type === 'PJ' ? invoice.company_name : invoice.full_name,
        indicador_ie:  Number(invoice.icms_taxpayer) as 1 | 2 | 9,
        logradouro:    invoice.street,
        numero:        invoice.street_number,
        complemento:   invoice.complement,
        bairro:        invoice.neighborhood,
        municipio:     invoice.city,
        uf:            invoice.client_state,
        cep:           invoice.zip_code,
        telefone:      invoice.phone,
        email:         invoice.client_email,
      },

      natureza_operacao: cfg.natureza_operacao,
      data_emissao:      new Date().toISOString(),

      itens: items.map((it: any, idx: number) => ({
        numero_item:              idx + 1,
        codigo_produto:           it.material_id ?? `ITEM${idx + 1}`,
        descricao:                it.name,
        ncm:                      it.ncm_code,
        cfop:                     cfop(it),
        unidade_comercial:        'UN',
        quantidade_comercial:     Number(it.quantity),
        valor_unitario_comercial: Number(it.unit_price),
        valor_bruto:              Number(it.total),
        icms_cst:                 it.icms_cst   || undefined,
        icms_csosn:               it.icms_csosn || undefined,  // set if Simples Nacional
        icms_base_calculo:        Number(it.icms_base)  || undefined,
        icms_aliquota:            Number(it.icms_rate)  || undefined,
        icms_valor:               Number(it.icms_value) || undefined,
        pis_cst:                  it.pis_cst             || undefined,
        pis_base_calculo:         Number(it.pis_base)   || undefined,
        pis_aliquota_percentual:  Number(it.pis_rate)   || undefined,
        pis_valor:                Number(it.pis_value)  || undefined,
        cofins_cst:               it.cofins_cst               || undefined,
        cofins_base_calculo:      Number(it.cofins_base)       || undefined,
        cofins_aliquota_percentual: Number(it.cofins_rate)     || undefined,
        cofins_valor:             Number(it.cofins_value)      || undefined,
        ipi_aliquota:             Number(it.ipi_rate)  || undefined,
        ipi_valor:                Number(it.ipi_value) || undefined,
      })),

      pagamentos: [{
        forma_pagamento: '99',  // others — refined when payment module is added
        valor_pagamento: Number(invoice.total),
      }],
    };

    // Guard against double-submit: mark as pending before enqueuing
    await pool.query(
      "UPDATE invoices SET nfe_status = 'pending', nfe_attempts = nfe_attempts + 1 WHERE id = $1",
      [id],
    );

    try {
      await getSqsClient().send(new SendMessageCommand({
        QueueUrl:    queueUrl,
        MessageBody: JSON.stringify(message),
      }));
    } catch (err) {
      // Rollback pending status so the user can retry
      await pool.query("UPDATE invoices SET nfe_status = NULL WHERE id = $1", [id]);
      throw err;
    }

    // Update to 'processing' once the message is confirmed in SQS
    // Lambda will update to 'authorized' or 'rejected' via nfe-results queue
    await pool.query(
      "UPDATE invoices SET nfe_status = 'processing' WHERE id = $1",
      [id],
    );

    return reply.code(202).send({
      ok: true,
      nfe_status: 'processing',
      message:    'NF-e enviada para processamento. Acompanhe o status em tempo real.',
    });
  });

  /* ── GET /v1/invoices/:id/nfe ───────────────────────────────────────── */
  fastify.get('/invoices/:id/nfe', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows: [row] } = await pool.query(
      `SELECT id, number, nfe_status, nfe_chave, nfe_protocol,
              nfe_auth_date, nfe_reject_reason, nfe_attempts,
              nfe_danfe_url, nfe_xml_s3_key
       FROM invoices WHERE id = $1`,
      [id],
    );
    if (!row) return reply.notFound('Nota fiscal não encontrada');
    return row;
  });

  /* ── GET /v1/invoices/:id/nfe-events ────────────────────────────────── */
  fastify.get('/invoices/:id/nfe-events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(
      `SELECT event_type, status_code, protocol, payload, created_at
       FROM nfe_events WHERE invoice_id = $1 ORDER BY created_at DESC`,
      [id],
    );
    return rows;
  });
};
