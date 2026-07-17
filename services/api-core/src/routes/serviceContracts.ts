import { FastifyPluginAsync } from 'fastify';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { eq, and, ilike, or, sql } from 'drizzle-orm';
import { db, serviceContracts, contractBillings, receivables, clients, materials, nfseInvoices, tenants } from '../db';
import { getSqsClient } from '../lib/sqsClient';
import { buildNfseEmitMessage } from '../lib/nfse';
import { resolveCompanyId, companyResolutionErrorMessage, CompanyDomainError } from '../services/companyService';
import { resolveBankAccount, BankAccountDomainError } from '../services/bankAccountService';
import { requirePermission } from '../lib/requirePermission';

const FREQUENCIES  = ['monthly', 'quarterly', 'semiannual', 'annual'] as const;
const STATUSES      = ['active', 'paused', 'cancelled', 'expired'] as const;
const CONTRACT_TYPES = ['service', 'rental'] as const;

const contractBody = {
  type: 'object',
  properties: {
    tenant_id:         { type: 'string', format: 'uuid' },
    client_id:         { type: 'string', format: 'uuid' },
    material_id:       { type: 'string', format: 'uuid' },
    // Qual empresa/CNPJ fatura este contrato (regra 40) — opcional, resolvido
    // para a empresa padrão do tenant quando omitido.
    company_id:        { type: 'string', format: 'uuid' },
    // 'service' (padrão) | 'rental' — só rental oferece a Nota de Locação
    // (sem valor fiscal) por cobrança — mesmo nome de campo/coluna que
    // materials.type/service_orders.type (nunca "contract_type").
    type:              { type: 'string', enum: CONTRACT_TYPES },
    contact_name:      { type: 'string', maxLength: 255 },
    description:       { type: 'string', minLength: 1 },
    start_date:        { type: 'string', format: 'date' },
    end_date:          { type: 'string', format: 'date' },
    billing_frequency: { type: 'string', enum: FREQUENCIES },
    billing_day:       { type: 'integer', minimum: 1, maximum: 28 },
    amount:            { type: 'number', minimum: 0.01 },
    status:            { type: 'string', enum: STATUSES },
    notes:             { type: 'string' },
    nfse_enabled:      { type: 'boolean' },
    codigo_servico:    { type: 'string' },
    aliquota_iss:      { type: 'number', minimum: 0 },
  },
  additionalProperties: false,
};

const patchBody = { ...contractBody, required: [] as string[] };

export const serviceContractsRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /v1/service-contracts
  fastify.get('/service-contracts', {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requirePermission('contracts:view')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const {
      client_id, status, search,
      page = '1', per_page = '20',
    } = request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const conditions: any[] = [eq(serviceContracts.tenant_id, tenantId)];
    if (client_id) conditions.push(eq(serviceContracts.client_id, client_id));
    if (status)    conditions.push(eq(serviceContracts.status, status));
    if (search) conditions.push(or(
      ilike(serviceContracts.description,     `%${search}%`),
      ilike(serviceContracts.contract_number, `%${search}%`),
    ));
    const where = and(...conditions as [any, ...any[]]);

    const [[{ total }], rows] = await Promise.all([
      db.select({ total: sql<number>`COUNT(*)::int` }).from(serviceContracts).where(where),
      db.execute<any>(sql`
        SELECT sc.*,
               COALESCE(c.company_name, c.full_name) AS client_name,
               m.name AS material_name
        FROM service_contracts sc
        JOIN clients  c ON c.id = sc.client_id
        LEFT JOIN materials m ON m.id = sc.material_id
        WHERE sc.tenant_id = ${tenantId}
          ${client_id ? sql`AND sc.client_id = ${client_id}::uuid` : sql``}
          ${status    ? sql`AND sc.status = ${status}`             : sql``}
          ${search    ? sql`AND (sc.description ILIKE ${'%' + search + '%'} OR sc.contract_number ILIKE ${'%' + search + '%'})` : sql``}
        ORDER BY sc.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
    ]);

    return { data: rows.rows, total, page: Number(page), per_page: limit };
  });

  // POST /v1/service-contracts
  fastify.post('/service-contracts', {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requirePermission('contracts:create')],
    schema: {
      body: {
        ...contractBody,
        required: ['tenant_id', 'client_id', 'description', 'start_date', 'billing_frequency', 'billing_day', 'amount'],
      },
    },
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const b = request.body as Record<string, unknown>;

    // Verify client belongs to tenant
    const [c] = await db.select({ id: clients.id }).from(clients)
      .where(and(eq(clients.id, b.client_id as string), eq(clients.tenant_id, tenantId)));
    if (!c) return reply.notFound('Client not found');

    // Generate sequential contract number
    const { rows: [seq] } = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM service_contracts WHERE tenant_id = ${tenantId}
    `);
    const contractNumber = String(seq.count + 1).padStart(5, '0');

    const [contract] = await db.insert(serviceContracts).values({
      tenant_id:         tenantId,
      client_id:         b.client_id         as string,
      material_id:       (b.material_id      ?? null) as string | null,
      company_id:        (b.company_id       ?? null) as string | null,
      contract_number:   contractNumber,
      type:              ((b.type as string) || 'service'),
      contact_name:      (b.contact_name      ?? null) as string | null,
      description:       b.description       as string,
      start_date:        b.start_date        as string,
      end_date:          (b.end_date         ?? null) as string | null,
      billing_frequency: (b.billing_frequency ?? 'monthly') as string,
      billing_day:       Number(b.billing_day ?? 1),
      amount:            String(b.amount),
      status:            'active',
      notes:             (b.notes            ?? null) as string | null,
      nfse_enabled:      Boolean(b.nfse_enabled ?? false),
      codigo_servico:    (b.codigo_servico   ?? null) as string | null,
      aliquota_iss:      b.aliquota_iss != null ? String(b.aliquota_iss) : null,
      created_by:        (b.created_by       ?? null) as string | null,
    }).returning();

    return reply.code(201).send(contract);
  });

  // GET /v1/service-contracts/:id
  fastify.get<{ Params: { id: string } }>('/service-contracts/:id', {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requirePermission('contracts:view')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params;
    const { rows } = await db.execute<any>(sql`
      SELECT sc.*,
             COALESCE(c.company_name, c.full_name) AS client_name,
             m.name AS material_name
      FROM service_contracts sc
      JOIN clients  c ON c.id = sc.client_id
      LEFT JOIN materials m ON m.id = sc.material_id
      WHERE sc.id = ${id} AND sc.tenant_id = ${tenantId}
    `);
    if (!rows[0]) return reply.notFound('Contract not found');

    const billings = await db.execute<any>(sql`
      SELECT cb.*,
             r.status AS receivable_status,
             r.paid_amount,
             r.due_date AS receivable_due_date
      FROM contract_billings cb
      LEFT JOIN receivables r ON r.id = cb.receivable_id
      WHERE cb.contract_id = ${id}
      ORDER BY cb.period_start DESC
    `);

    return { ...rows[0], billings: billings.rows };
  });

  // PATCH /v1/service-contracts/:id
  fastify.patch<{ Params: { id: string } }>('/service-contracts/:id', {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requirePermission('contracts:edit')],
    schema: { body: patchBody },
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params;
    const b = request.body as Record<string, unknown>;

    const [existing] = await db.select({ id: serviceContracts.id })
      .from(serviceContracts)
      .where(and(eq(serviceContracts.id, id), eq(serviceContracts.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Contract not found');

    const allowed = ['description', 'client_id', 'material_id', 'company_id', 'type', 'contact_name',
                     'start_date', 'end_date', 'billing_frequency', 'billing_day', 'amount', 'status', 'notes',
                     'nfse_enabled', 'codigo_servico', 'aliquota_iss'];
    const updateData = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
    if ('aliquota_iss' in updateData && updateData.aliquota_iss != null)
      updateData.aliquota_iss = String(updateData.aliquota_iss);
    if (!Object.keys(updateData).length) return reply.badRequest('No fields to update');

    const [updated] = await db.update(serviceContracts)
      .set(updateData as any)
      .where(and(eq(serviceContracts.id, id), eq(serviceContracts.tenant_id, tenantId)))
      .returning();

    return updated;
  });

  // POST /v1/service-contracts/:id/billings — gera cobrança manualmente para o período atual
  fastify.post<{ Params: { id: string } }>('/service-contracts/:id/billings', {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requirePermission('contracts:edit')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id: contractId } = request.params;

    const { rows } = await db.execute<any>(sql`
      SELECT sc.*, COALESCE(c.company_name, c.full_name) AS client_name
      FROM service_contracts sc
      JOIN clients c ON c.id = sc.client_id
      WHERE sc.id = ${contractId} AND sc.tenant_id = ${tenantId}
    `);
    const contract = rows[0];
    if (!contract) return reply.notFound('Contract not found');
    if (contract.status !== 'active') return reply.badRequest('Contract is not active');

    const today = new Date();
    const year  = today.getFullYear();
    const month = today.getMonth() + 1;
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay     = new Date(year, month, 0).getDate();
    const periodEnd   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const dueDate     = today.toISOString().slice(0, 10);

    // Check if billing already exists for this period
    const { rows: [exists] } = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM contract_billings
      WHERE contract_id = ${contractId}
        AND period_start = ${periodStart}
        AND status != 'cancelled'
    `);
    if (exists.count > 0) return reply.conflict('Billing already generated for current period');

    const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const description = `${contract.description} — ${months[month - 1]}/${year}`;

    // NFS-e opt-in: validate config + service code before creating the document
    const wantsNfse = contract.nfse_enabled === true;
    let cfg: any = null;
    let clientRow: any = null;
    let serviceCode: string | null = null;
    let issRate = 0;

    if (wantsNfse) {
      const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
      if (!queueUrl) return reply.badRequest('Emissão de NFS-e não configurada neste ambiente');

      // Resolve qual empresa/CNPJ fatura este contrato (regra 40/53) —
      // contract.company_id quando definido, senão a empresa padrão do
      // tenant, restrito a empresas com emite_nfse=true.
      try {
        cfg = await resolveCompanyId(contract.tenant_id, contract.company_id, db, 'nfse');
      } catch (err) {
        const msg = err instanceof CompanyDomainError ? companyResolutionErrorMessage(err, 'NFS-e') : 'Configure os dados fiscais em Empresa → NF-e/NFS-e antes de emitir';
        return reply.badRequest(msg);
      }
      if (!cfg.inscricao_municipal)
        return reply.badRequest('Inscrição Municipal é obrigatória para emitir NFS-e (Empresa → NFS-e)');
      // Trava de segurança: produção exige o token do próprio tenant — sem
      // isso, a mensagem sai sem focus_token, o Lambda cai no token mestre da
      // plataforma (sem permissão pro CNPJ do tenant) e o Focus rejeita com
      // "permissao_negada: CNPJ do emitente não autorizado". Mesma trava de
      // routes/nfe.ts / routes/nfse.ts.
      if (cfg.focus_ambiente === 1 && !cfg.focus_token_producao)
        return reply.badRequest('Configure o token de Produção em Empresa → Fiscal antes de emitir em produção.');

      serviceCode = contract.codigo_servico || cfg.codigo_servico_padrao || null;
      if (!serviceCode)
        return reply.badRequest('Código de serviço (LC 116) é obrigatório para emitir NFS-e');

      issRate = Number(contract.aliquota_iss ?? cfg.aliquota_iss_padrao ?? 0);

      const { rows: cRows } = await db.execute<any>(sql`SELECT * FROM clients WHERE id = ${contract.client_id}`);
      clientRow = cRows[0];
      if (!clientRow) return reply.badRequest('Cliente do contrato não encontrado');
    }

    const issValue = wantsNfse ? Number((Number(contract.amount) * issRate / 100).toFixed(2)) : 0;

    let billing: any;
    let nfseId: string | null = null;
    await db.transaction(async (tx) => {
      const [rec] = await tx.insert(receivables).values({
        tenant_id:   contract.tenant_id,
        client_id:   contract.client_id,
        description,
        amount:      contract.amount,
        due_date:    dueDate,
        status:      'pending',
        notes:       'Gerado pelo contrato de manutenção',
      }).returning();

      // Numeração sequencial do recibo/fatura (regra 69) — gerada pra toda
      // cobrança (não só locação), mesmo padrão MAX+1 padStart já usado em
      // service_contracts.contract_number/proposals.number, aqui com 4
      // dígitos pra bater com o documento real de referência ("Nº 0448").
      const { rows: [docSeq] } = await tx.execute<{ n: string }>(sql`
        SELECT COALESCE(MAX(CASE WHEN document_number ~ '^[0-9]+$' THEN document_number::INT END), 0) + 1 AS n
        FROM contract_billings WHERE tenant_id = ${contract.tenant_id}
      `);
      const documentNumber = String(docSeq.n).padStart(4, '0');

      const [b] = await tx.insert(contractBillings).values({
        tenant_id:       contract.tenant_id,
        contract_id:     contractId,
        receivable_id:   rec.id,
        period_start:    periodStart,
        period_end:      periodEnd,
        amount:          contract.amount,
        due_date:        dueDate,
        status:          'billed',
        document_number: documentNumber,
      }).returning();
      billing = { ...b, receivable_id: rec.id };

      if (wantsNfse) {
        const [nfse] = await tx.insert(nfseInvoices).values({
          tenant_id:           contract.tenant_id,
          contract_billing_id: b.id,
          receivable_id:       rec.id,
          client_id:           contract.client_id,
          company_id:          cfg?.id ?? null,
          description,
          amount:              String(contract.amount),
          iss_rate:            String(issRate),
          iss_value:           String(issValue),
          service_code:        serviceCode!,
          period_start:        periodStart,
          period_end:          periodEnd,
          nfse_status:         null,
        }).returning();
        nfseId = nfse.id;

        await tx.update(contractBillings)
          .set({ nfse_id: nfse.id })
          .where(eq(contractBillings.id, b.id));
      }
    });

    let nfseStatus: string | null = null;
    if (wantsNfse && nfseId) {
      const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL!;
      await db.update(nfseInvoices).set({ nfse_status: 'pending', nfse_attempts: sql`nfse_attempts + 1` })
        .where(eq(nfseInvoices.id, nfseId));

      const message = buildNfseEmitMessage({
        nfse_id:      nfseId,
        tenant_id:    contract.tenant_id,
        description,
        amount:       Number(contract.amount),
        iss_rate:     issRate,
        iss_value:    issValue,
        service_code: serviceCode!,
        period_start: periodStart,
        period_end:   periodEnd,
        cfg,
        client:       clientRow,
      });

      try {
        await getSqsClient().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
        await db.update(nfseInvoices).set({ nfse_status: 'processing' }).where(eq(nfseInvoices.id, nfseId));
        nfseStatus = 'processing';
      } catch (err) {
        await db.update(nfseInvoices).set({ nfse_status: null }).where(eq(nfseInvoices.id, nfseId));
        nfseStatus = null;
        fastify.log.error({ err, nfseId }, 'Failed to enqueue NFS-e emit message');
      }
    }

    return reply.code(201).send({ ...billing, nfse_id: nfseId, nfse_status: nfseStatus });
  });

  // GET /v1/service-contracts/:id/billings
  fastify.get<{ Params: { id: string } }>('/service-contracts/:id/billings', {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requirePermission('contracts:view')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id: contractId } = request.params;

    const { rows } = await db.execute<any>(sql`
      SELECT cb.*,
             r.status AS receivable_status,
             r.paid_amount,
             r.amount AS receivable_amount
      FROM contract_billings cb
      LEFT JOIN receivables r ON r.id = cb.receivable_id
      WHERE cb.contract_id = ${contractId} AND cb.tenant_id = ${tenantId}
      ORDER BY cb.period_start DESC
    `);

    return { data: rows };
  });

  // GET /v1/service-contracts/:id/billings/:billingId/receipt — dados pra
  // impressão da Nota de Locação / Recibo / Fatura (regra 69). Documento
  // interno SEM valor fiscal (nunca passa pelo Focus NF-e/NFS-e) — só
  // disponível pra contratos type='rental'. Emissor sempre vem de `tenants`,
  // mesma fonte que a impressão de proposta já usa (regra 37), não de
  // nfe_configs — este documento não tem seletor de multi-empresa.
  fastify.get<{ Params: { id: string; billingId: string } }>('/service-contracts/:id/billings/:billingId/receipt', {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requirePermission('contracts:view')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id: contractId, billingId } = request.params;

    const { rows: [contract] } = await db.execute<any>(sql`
      SELECT sc.*, c.company_name AS client_company_name, c.full_name AS client_full_name,
             c.person_type AS client_person_type, c.cnpj AS client_cnpj, c.cpf AS client_cpf,
             c.state_reg AS client_state_reg, c.email AS client_email, c.phone AS client_phone, c.mobile AS client_mobile,
             c.zip_code AS client_zip, c.street AS client_street, c.street_number AS client_number,
             c.complement AS client_complement, c.neighborhood AS client_neighborhood,
             c.city AS client_city, c.state AS client_state
      FROM service_contracts sc
      JOIN clients c ON c.id = sc.client_id
      WHERE sc.id = ${contractId} AND sc.tenant_id = ${tenantId}
    `);
    if (!contract) return reply.notFound('Contract not found');
    if (contract.type !== 'rental')
      return reply.badRequest('Disponível apenas para contratos de locação');

    const { rows: [billing] } = await db.execute<any>(sql`
      SELECT * FROM contract_billings WHERE id = ${billingId} AND contract_id = ${contractId} AND tenant_id = ${tenantId}
    `);
    if (!billing) return reply.notFound('Billing not found');

    const [issuer] = await db.select({
      name: tenants.company_name, trade_name: tenants.trade_name,
      logo_url: tenants.logo_url, tax_id: tenants.tax_id, tax_id_type: tenants.tax_id_type,
      state_reg: tenants.state_reg,
      street: tenants.street, street_number: tenants.street_number, complement: tenants.complement,
      neighborhood: tenants.neighborhood, city: tenants.city, state: tenants.state, zip_code: tenants.postal_code,
    }).from(tenants).where(eq(tenants.id, tenantId));

    let bankAccount: { bank_code: string; agency: string; account: string; account_digit: string } | null = null;
    try {
      const acc = await resolveBankAccount(tenantId, undefined, db);
      bankAccount = { bank_code: acc.bank_code, agency: acc.agency, account: acc.account, account_digit: acc.account_digit };
    } catch (err) {
      if (!(err instanceof BankAccountDomainError)) throw err;
      // Sem conta bancária cadastrada — a seção "Dados para Pagamento" some
      // no documento, nunca bloqueia a emissão (mesmo espírito tolerante já
      // usado em toda integração fiscal/bancária deste projeto).
    }

    return {
      contract: {
        description:   contract.description,
        billing_day:   contract.billing_day,
        contact_name:  contract.contact_name,
      },
      client: {
        name:          contract.client_company_name || contract.client_full_name,
        document:      contract.client_person_type === 'PF' ? contract.client_cpf : contract.client_cnpj,
        document_type: contract.client_person_type === 'PF' ? 'CPF' : 'CNPJ',
        state_reg:     contract.client_state_reg,
        email:         contract.client_email,
        phone:         contract.client_phone || contract.client_mobile,
        street:        contract.client_street,
        street_number: contract.client_number,
        complement:    contract.client_complement,
        neighborhood:  contract.client_neighborhood,
        city:          contract.client_city,
        state:         contract.client_state,
        zip_code:      contract.client_zip,
      },
      billing: {
        document_number: billing.document_number,
        created_at:       billing.created_at,
        due_date:         billing.due_date,
        period_start:     billing.period_start,
        period_end:       billing.period_end,
        amount:           Number(billing.amount),
      },
      issuer: issuer ? {
        name:        issuer.trade_name || issuer.name,
        company:     issuer.name,
        logo_url:    issuer.logo_url,
        document:    issuer.tax_id,
        document_type: issuer.tax_id_type,
        state_reg:   issuer.state_reg,
        street:      issuer.street,
        street_number: issuer.street_number,
        complement:  issuer.complement,
        neighborhood: issuer.neighborhood,
        city:        issuer.city,
        state:       issuer.state,
        zip_code:    issuer.zip_code,
      } : null,
      bank_account: bankAccount,
    };
  });
};
