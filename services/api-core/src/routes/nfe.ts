import { FastifyPluginAsync } from 'fastify';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { eq, sql } from 'drizzle-orm';
import { db, invoices, nfeEvents } from '../db';
import { getSqsClient } from '../lib/sqsClient';
import { getDefaultCompany, upsertDefaultCompany, resolveCompanyId, companyResolutionErrorMessage, CompanyDomainError } from '../services/companyService';

export const nfeRoutes: FastifyPluginAsync = async (fastify) => {

  const mask = (t: string | null | undefined) => (t ? '****' + t.slice(-4) : null);

  /* ── GET /v1/nfe-config ─────────────────────────────────────────────── */
  // Retrocompatível: sempre lê/edita a empresa PADRÃO do tenant (regra 40).
  // Multi-empresa de verdade é exposto em /v1/companies — esta rota continua
  // existindo para não quebrar clientes (web antigo, app mobile) que ainda
  // não sabem de multi-empresa.
  fastify.get('/nfe-config', async (request, reply) => {
    const { tenant_id } = request.query as { tenant_id: string };
    if (!tenant_id) return reply.badRequest('tenant_id is required');
    const cfg = await getDefaultCompany(tenant_id);
    if (!cfg) return reply.notFound('Configuração NF-e não encontrada');

    return {
      ...cfg,
      focus_token_homologacao: mask(cfg.focus_token_homologacao),
      focus_token_producao:    mask(cfg.focus_token_producao),
    };
  });

  /* ── PUT /v1/nfe-config ─────────────────────────────────────────────── */
  fastify.put('/nfe-config', async (request, reply) => {
    const body = request.body as any;
    const { tenant_id, cnpj, razao_social, logradouro, numero, bairro, cep } = body;

    if (!tenant_id || !cnpj || !razao_social || !logradouro || !numero || !bairro || !cep)
      return reply.badRequest('Campos obrigatórios: tenant_id, cnpj, razao_social, logradouro, numero, bairro, cep');

    // Tokens mascarados ('****...') nunca sobrescrevem o valor existente —
    // mesmo comportamento de antes, agora dentro de companyService.
    const clean = { ...body };
    if (typeof clean.focus_token_homologacao === 'string' && clean.focus_token_homologacao.startsWith('****')) delete clean.focus_token_homologacao;
    if (typeof clean.focus_token_producao === 'string' && clean.focus_token_producao.startsWith('****')) delete clean.focus_token_producao;

    const cfg = await upsertDefaultCompany(tenant_id, clean);

    return {
      ...cfg,
      focus_token_homologacao: mask(cfg.focus_token_homologacao),
      focus_token_producao:    mask(cfg.focus_token_producao),
    };
  });

  /* ── POST /v1/invoices/:id/emit ─────────────────────────────────────── */
  fastify.post('/invoices/:id/emit', async (request, reply) => {
    const { id }        = request.params as { id: string };
    const { tenant_id } = request.query as { tenant_id: string };

    const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
    if (!queueUrl) return reply.badRequest('Emissão de NF-e não configurada neste ambiente');

    const [{ rows: [invoice] }, { rows: items }] = await Promise.all([
      db.execute<any>(sql`
        SELECT i.*, c.person_type, c.company_name, c.full_name,
               c.cnpj AS client_cnpj, c.cpf AS client_cpf, c.icms_taxpayer,
               c.zip_code, c.street, c.street_number, c.complement,
               c.neighborhood, c.city, c.state AS client_state,
               c.phone, c.email AS client_email
        FROM invoices i JOIN clients c ON c.id = i.client_id
        WHERE i.id = ${id} AND i.tenant_id = ${tenant_id}
      `),
      db.execute<any>(sql`SELECT * FROM invoice_items WHERE invoice_id = ${id} ORDER BY created_at`),
    ]);

    if (!invoice) return reply.notFound('Nota fiscal não encontrada');

    // Resolve qual empresa/CNPJ emite esta nota (regra 40) — invoice.company_id
    // quando definido, senão a empresa padrão do tenant (mesmo comportamento
    // de antes para tenants que nunca usaram multi-empresa).
    let cfg;
    try {
      cfg = await resolveCompanyId(tenant_id, invoice.company_id, db, 'nfe');
    } catch (err) {
      const msg = err instanceof CompanyDomainError ? companyResolutionErrorMessage(err, 'NF-e') : 'Configure os dados fiscais em Empresa → Fiscal antes de emitir';
      return reply.badRequest(msg);
    }
    // Trava de segurança: produção exige o token do próprio tenant (não cair no fallback do env)
    if (cfg.focus_ambiente === 1 && !cfg.focus_token_producao)
      return reply.badRequest('Configure o token de Produção em Empresa → Fiscal antes de emitir em produção.');
    if (invoice.status !== 'draft')
      return reply.badRequest(`Só rascunhos podem ser enviados ao SEFAZ (status atual: ${invoice.status})`);
    if (invoice.nfe_status === 'pending' || invoice.nfe_status === 'processing')
      return reply.badRequest('Esta NF-e já está sendo processada. Aguarde o resultado.');
    if (!items.length) return reply.badRequest('A nota não possui itens');

    const noNcm = items.filter((it: any) => !it.ncm_code);
    if (noNcm.length)
      return reply.badRequest(`Itens sem NCM (obrigatório para NF-e): ${noNcm.map((it: any) => it.name).join(', ')}`);

    const cfop = () => cfg.uf === (invoice.client_state ?? cfg.uf) ? cfg.cfop_padrao : cfg.cfop_interestadual;

    // Simples Nacional (regime 1) usa CSOSN no ICMS; demais regimes usam CST.
    // O sistema guarda o código (CST ou CSOSN) no campo icms_cst — aqui roteamos
    // para o campo correto conforme o regime do emitente.
    const isSimples = cfg.regime_tributario === 1;

    // Select the tenant's own token for the configured environment; fallback to env var in Lambda
    const focusToken = cfg.focus_ambiente === 1
      ? (cfg.focus_token_producao    ?? undefined)
      : (cfg.focus_token_homologacao ?? undefined);

    const message = {
      invoice_id: invoice.id, tenant_id,
      focus_ref:  invoice.id,
      ambiente:   cfg.focus_ambiente as 1 | 2,
      focus_token: focusToken,
      emitente: {
        cnpj: cfg.cnpj, razao_social: cfg.razao_social, nome_fantasia: cfg.nome_fantasia,
        logradouro: cfg.logradouro, numero: cfg.numero, complemento: cfg.complemento,
        bairro: cfg.bairro, municipio: cfg.municipio, uf: cfg.uf, cep: cfg.cep,
        telefone: cfg.telefone, email: cfg.email,
        regime_tributario: cfg.regime_tributario as 1 | 2 | 3,
      },
      destinatario: {
        cnpj:         invoice.person_type === 'PJ' ? invoice.client_cnpj : undefined,
        cpf:          invoice.person_type === 'PF' ? invoice.client_cpf  : undefined,
        nome:         invoice.person_type === 'PJ' ? invoice.company_name : invoice.full_name,
        indicador_ie: Number(invoice.icms_taxpayer) as 1 | 2 | 9,
        logradouro:   invoice.street, numero: invoice.street_number, complemento: invoice.complement,
        bairro:       invoice.neighborhood, municipio: invoice.city, uf: invoice.client_state,
        cep:          invoice.zip_code, telefone: invoice.phone, email: invoice.client_email,
      },
      natureza_operacao: cfg.natureza_operacao,
      data_emissao:      new Date().toISOString(),
      itens: items.map((it: any, idx: number) => ({
        numero_item: idx + 1,
        codigo_produto: it.material_id ?? `ITEM${idx + 1}`,
        descricao: it.name, ncm: it.ncm_code, cfop: cfop(),
        unidade_comercial: 'UN',
        quantidade_comercial:     Number(it.quantity),
        valor_unitario_comercial: Number(it.unit_price),
        valor_bruto:              Number(it.total),
        icms_cst:   isSimples ? undefined : (it.icms_cst || undefined),
        icms_csosn: isSimples ? (it.icms_cst || '102') : undefined,
        icms_base_calculo: isSimples ? undefined : (Number(it.icms_base)  || undefined),
        icms_aliquota:     isSimples ? undefined : (Number(it.icms_rate)  || undefined),
        icms_valor:        isSimples ? undefined : (Number(it.icms_value) || undefined),
        pis_cst:   it.pis_cst   || undefined, pis_base_calculo: Number(it.pis_base)    || undefined,
        pis_aliquota_percentual: Number(it.pis_rate) || undefined, pis_valor: Number(it.pis_value) || undefined,
        cofins_cst: it.cofins_cst || undefined, cofins_base_calculo: Number(it.cofins_base) || undefined,
        cofins_aliquota_percentual: Number(it.cofins_rate) || undefined, cofins_valor: Number(it.cofins_value) || undefined,
        ipi_aliquota: Number(it.ipi_rate) || undefined, ipi_valor: Number(it.ipi_value) || undefined,
        // Reforma Tributária — IBS/CBS (regra 44); default '000001' quando o
        // item não tem override de class_trib (materials.class_trib).
        class_trib: it.class_trib || '000001',
        ibs_base_calculo: Number(it.ibs_base) || undefined, ibs_aliquota: Number(it.ibs_rate) || undefined, ibs_valor: Number(it.ibs_value) || undefined,
        cbs_base_calculo: Number(it.cbs_base) || undefined, cbs_aliquota: Number(it.cbs_rate) || undefined, cbs_valor: Number(it.cbs_value) || undefined,
      })),
      pagamentos: [{ forma_pagamento: '99', valor_pagamento: Number(invoice.total) }],
    };

    await db.update(invoices)
      .set({ nfe_status: 'pending', nfe_attempts: sql`nfe_attempts + 1` })
      .where(eq(invoices.id, id));

    try {
      await getSqsClient().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
    } catch (err) {
      await db.update(invoices).set({ nfe_status: null }).where(eq(invoices.id, id));
      throw err;
    }

    await db.update(invoices).set({ nfe_status: 'processing' }).where(eq(invoices.id, id));

    return reply.code(202).send({
      ok: true, nfe_status: 'processing',
      message: 'NF-e enviada para processamento. Acompanhe o status em tempo real.',
    });
  });

  /* ── GET /v1/invoices/:id/nfe ───────────────────────────────────────── */
  fastify.get('/invoices/:id/nfe', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db.select({
      id: invoices.id, number: invoices.number, nfe_status: invoices.nfe_status,
      nfe_chave: invoices.nfe_chave, nfe_protocol: invoices.nfe_protocol,
      nfe_auth_date: invoices.nfe_auth_date, nfe_reject_reason: invoices.nfe_reject_reason,
      nfe_attempts: invoices.nfe_attempts, nfe_danfe_url: invoices.nfe_danfe_url,
      nfe_xml_s3_key: invoices.nfe_xml_s3_key,
    }).from(invoices).where(eq(invoices.id, id));
    if (!row) return reply.notFound('Nota fiscal não encontrada');
    return row;
  });

  /* ── GET /v1/invoices/:id/nfe-events ────────────────────────────────── */
  fastify.get('/invoices/:id/nfe-events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await db.select({
      event_type: nfeEvents.event_type, status_code: nfeEvents.status_code,
      protocol: nfeEvents.protocol, payload: nfeEvents.payload, created_at: nfeEvents.created_at,
    }).from(nfeEvents).where(eq(nfeEvents.invoice_id, id))
      .orderBy(sql`${nfeEvents.created_at} DESC`);
    return rows;
  });
};
