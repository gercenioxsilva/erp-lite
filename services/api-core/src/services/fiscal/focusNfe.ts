// Focus NF-e HTTP client — NFC-e (modelo 65) only
// Auth: Basic with FOCUS_NFE_TOKEN as username, empty password

import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { nfeConfigs } from '../../db/schema';
import { getIcmsRate } from '../../lib/taxRulesResolver';

const PAYMENT_METHOD_MAP: Record<string, string> = {
  cash:         '01',
  credit:       '03',
  debit:        '04',
  pix:          '17',
  voucher:      '05',
  store_credit: '99',
};

function focusAuth(): string {
  const token = process.env.FOCUS_NFE_TOKEN;
  if (!token) throw new Error('FOCUS_NFE_TOKEN not configured');
  return 'Basic ' + Buffer.from(token + ':').toString('base64');
}

function focusBaseUrl(): string {
  return (process.env.FOCUS_NFE_BASE_URL ?? 'https://homologacao.focusnfe.com.br').replace(/\/$/, '');
}

function mapFiscalStatus(focusStatus: string): string {
  const map: Record<string, string> = {
    autorizado:       'autorizado',
    erro_autorizacao: 'erro_autorizacao',
    processando:      'processando',
    cancelado:        'cancelado',
    pendente:         'pendente',
  };
  return map[focusStatus] ?? 'pendente';
}

export interface FiscalResult {
  fiscal_status:    string;
  fiscal_chave:     string | null;
  fiscal_protocol:  string | null;
  fiscal_number:    number | null;
  fiscal_series:    number | null;
  fiscal_qrcode:    string | null;
  fiscal_url_danfe: string | null;
  fiscal_url_xml:   string | null;
  fiscal_message:   string | null;
}

function parseResponse(body: Record<string, unknown>): FiscalResult {
  const erros = body.erros as Array<{ mensagem?: string }> | undefined;
  const message =
    (erros && erros[0]?.mensagem) ??
    (typeof body.mensagem_sefaz === 'string' ? body.mensagem_sefaz : null);

  return {
    fiscal_status:    mapFiscalStatus(String(body.status ?? 'pendente')),
    fiscal_chave:     typeof body.chave_nfe     === 'string' ? body.chave_nfe     : null,
    fiscal_protocol:  typeof body.protocolo      === 'string' ? body.protocolo      : null,
    fiscal_number:    typeof body.numero         === 'number' ? body.numero         : null,
    fiscal_series:    typeof body.serie          === 'number' ? body.serie          : null,
    fiscal_qrcode:    typeof body.caminho_qrcode === 'string' ? body.caminho_qrcode : null,
    fiscal_url_danfe: typeof body.caminho_danfe  === 'string' ? body.caminho_danfe  : null,
    fiscal_url_xml:   typeof body.caminho_xml    === 'string' ? body.caminho_xml    : null,
    fiscal_message:   message,
  };
}

async function buildNfcePayload(saleId: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const saleRows = await db.execute<{
    id: string; customer_doc: string | null; customer_name: string | null;
    terminal_id: string; total: string;
  }>(sql`
    SELECT id, customer_doc, customer_name, terminal_id, total
    FROM pos_sales WHERE id = ${saleId} AND tenant_id = ${tenantId} LIMIT 1
  `);
  if (!saleRows.rows.length) {
    console.warn(`[Focus NF-e] Sale ${saleId} not found`);
    return null;
  }
  const sale = saleRows.rows[0];

  const itemRows = await db.execute<{
    description: string; quantity: string; unit_price: string; total: string;
    ncm: string | null; cfop: string | null; cst_csosn: string | null; unit: string | null;
  }>(sql`
    SELECT description, quantity, unit_price, total, ncm, cfop, cst_csosn, unit
    FROM pos_sale_items WHERE sale_id = ${saleId} ORDER BY created_at
  `);

  const payRows = await db.execute<{ method: string; amount: string }>(sql`
    SELECT method, SUM(amount)::text AS amount
    FROM pos_sale_payments WHERE sale_id = ${saleId}
    GROUP BY method
  `);

  const [cfg] = await db.select().from(nfeConfigs).where(eq(nfeConfigs.tenant_id, tenantId));
  if (!cfg) {
    console.warn(`[Focus NF-e] No nfe_configs for tenant ${tenantId}`);
    return null;
  }

  const termRows = await db.execute<{ nfce_series: number }>(sql`
    SELECT nfce_series FROM pos_terminals WHERE id = ${sale.terminal_id} LIMIT 1
  `);
  const serie = termRows.rows[0]?.nfce_series ?? 1;

  const isSimples = cfg.regime_tributario === 1;

  // NFC-e é sempre venda presencial — origem e destino são a mesma UF do emitente.
  // Resolução de alíquota é fire-and-forget: nunca bloqueia a emissão (mesmo
  // padrão de tolerância a falha usado no resto deste arquivo).
  let icmsAliquota = 0;
  if (!isSimples) {
    try {
      icmsAliquota = await getIcmsRate(cfg.uf, cfg.uf, db);
    } catch (err) {
      console.warn(`[Focus NF-e] Falha ao resolver alíquota ICMS para UF ${cfg.uf}: ${String(err)}`);
    }
  }

  const payload: Record<string, unknown> = {
    natureza_operacao: 'Venda a consumidor',
    data_emissao:      new Date().toISOString(),
    forma_pagamento:   0,
    modal_nf:          65,
    tipo_documento:    1,
    serie:             String(serie),
    emitente: {
      cnpj:              cfg.cnpj,
      razao_social:      cfg.razao_social,
      nome_fantasia:     cfg.nome_fantasia ?? undefined,
      logradouro:        cfg.logradouro,
      numero:            cfg.numero,
      complemento:       cfg.complemento ?? undefined,
      bairro:            cfg.bairro,
      municipio:         cfg.municipio,
      uf:                cfg.uf,
      cep:               cfg.cep,
      telefone:          cfg.telefone ?? undefined,
      email:             cfg.email ?? undefined,
      regime_tributario: cfg.regime_tributario ?? 1,
    },
    itens: itemRows.rows.map((it, idx) => ({
      numero_item:              idx + 1,
      codigo_produto:           String(idx + 1),
      descricao:                it.description,
      ncm:                      it.ncm ?? '00000000',
      cfop:                     it.cfop ?? '5102',
      unidade_comercial:        it.unit ?? 'UN',
      quantidade_comercial:     Number(it.quantity),
      valor_unitario_comercial: Number(it.unit_price),
      valor_bruto:              Number(it.total),
      icms_modalidade:          isSimples ? undefined : 0,
      icms_csosn:               isSimples ? (it.cst_csosn ?? '102') : undefined,
      icms_cst:                 isSimples ? undefined : (it.cst_csosn ?? '00'),
      icms_aliquota:            isSimples ? undefined : icmsAliquota,
    })),
    pagamentos: payRows.rows.map((p) => ({
      forma_pagamento: PAYMENT_METHOD_MAP[p.method] ?? '99',
      valor_pagamento: Number(p.amount),
    })),
    valor_total: Number(sale.total),
  };

  if (sale.customer_doc) {
    const doc = sale.customer_doc.replace(/\D/g, '');
    payload.destinatario = {
      nome: sale.customer_name ?? 'Consumidor',
      ...(doc.length === 11 ? { cpf: doc } : { cnpj: doc }),
    };
  }

  return payload;
}

export async function emitirNFCe(saleId: string, tenantId: string): Promise<FiscalResult> {
  const token = process.env.FOCUS_NFE_TOKEN;
  if (!token) {
    console.warn('[Focus NF-e] FOCUS_NFE_TOKEN not set — skipping NFC-e emission');
    return {
      fiscal_status: 'pendente', fiscal_chave: null, fiscal_protocol: null,
      fiscal_number: null, fiscal_series: null, fiscal_qrcode: null,
      fiscal_url_danfe: null, fiscal_url_xml: null,
      fiscal_message: 'Token não configurado',
    };
  }

  const payload = await buildNfcePayload(saleId, tenantId);
  if (!payload) {
    return {
      fiscal_status: 'pendente', fiscal_chave: null, fiscal_protocol: null,
      fiscal_number: null, fiscal_series: null, fiscal_qrcode: null,
      fiscal_url_danfe: null, fiscal_url_xml: null,
      fiscal_message: 'Dados insuficientes para emissão',
    };
  }

  const url = `${focusBaseUrl()}/v2/nfce?ref=${encodeURIComponent(saleId)}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: focusAuth() },
    body:    JSON.stringify(payload),
  });
  const body = await res.json() as Record<string, unknown>;
  return parseResponse(body);
}

export async function consultarNFCe(ref: string): Promise<FiscalResult> {
  if (!process.env.FOCUS_NFE_TOKEN) {
    console.warn('[Focus NF-e] FOCUS_NFE_TOKEN not set — skipping consult');
    return {
      fiscal_status: 'pendente', fiscal_chave: null, fiscal_protocol: null,
      fiscal_number: null, fiscal_series: null, fiscal_qrcode: null,
      fiscal_url_danfe: null, fiscal_url_xml: null,
      fiscal_message: 'Token não configurado',
    };
  }
  const url = `${focusBaseUrl()}/v2/nfce/${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: { Authorization: focusAuth() } });
  const body = await res.json() as Record<string, unknown>;
  return parseResponse(body);
}

export async function cancelarNFCe(ref: string, justificativa: string): Promise<FiscalResult> {
  const just = justificativa.length < 15 ? justificativa.padEnd(15, ' ') : justificativa;
  const url = `${focusBaseUrl()}/v2/nfce/${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    method:  'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: focusAuth() },
    body:    JSON.stringify({ justificativa: just }),
  });
  const body = await res.json() as Record<string, unknown>;
  return parseResponse(body);
}
