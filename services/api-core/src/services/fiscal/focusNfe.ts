// Focus NF-e HTTP client — NFC-e (modelo 65) emission + consulta de NF-e
// recebida (MDe) por chave de acesso.
// Auth: Basic com o token como username, senha vazia.

import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { nfeConfigs } from '../../db/schema';
import { getIcmsRate, getIbsCbsRates } from '../../lib/taxRulesResolver';
import type { Company } from '../companyService';

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

// Exportado só para teste unitário direto (evita precisar mockar fetch() /
// rede pra testar a montagem do payload — mesmo racional já usado em
// marketplaceSyncResultsWorker.processResult).
export async function buildNfcePayload(saleId: string, tenantId: string): Promise<Record<string, unknown> | null> {
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
    class_trib: string | null;
  }>(sql`
    SELECT description, quantity, unit_price, total, ncm, cfop, cst_csosn, unit, class_trib
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

  // Reforma Tributária — IBS/CBS (regra 44). Mesmo padrão de tolerância a
  // falha do ICMS acima: nunca bloqueia a emissão da NFC-e. Informativo em
  // 2026 — não altera valor_bruto/valor_total.
  let ibsCbs = { ibsRate: 0.1, cbsRate: 0.9 };
  try {
    ibsCbs = await getIbsCbsRates(cfg.uf, db);
  } catch (err) {
    console.warn(`[Focus NF-e] Falha ao resolver alíquotas IBS/CBS para UF ${cfg.uf}: ${String(err)}`);
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
    itens: itemRows.rows.map((it, idx) => {
      const classTrib = it.class_trib ?? '000001';
      const itemTotal = Number(it.total);
      // Split UF/Município não publicado para a fase de teste 2026 — mesma
      // simplificação documentada do NF-e (lambda-fiscal/lib/focusNfe.ts).
      const ibsValor = Math.round(itemTotal * ibsCbs.ibsRate) / 100;
      const cbsValor = Math.round(itemTotal * ibsCbs.cbsRate) / 100;
      return {
        numero_item:              idx + 1,
        codigo_produto:           String(idx + 1),
        descricao:                it.description,
        ncm:                      it.ncm ?? '00000000',
        cfop:                     it.cfop ?? '5102',
        unidade_comercial:        it.unit ?? 'UN',
        quantidade_comercial:     Number(it.quantity),
        valor_unitario_comercial: Number(it.unit_price),
        valor_bruto:              itemTotal,
        icms_modalidade:          isSimples ? undefined : 0,
        icms_csosn:               isSimples ? (it.cst_csosn ?? '102') : undefined,
        icms_cst:                 isSimples ? undefined : (it.cst_csosn ?? '00'),
        icms_aliquota:            isSimples ? undefined : icmsAliquota,
        // Reforma Tributária — IBS/CBS (regra 44), informativo em 2026.
        ibs_cbs_situacao_tributaria:      classTrib.slice(0, 3),
        ibs_cbs_classificacao_tributaria: classTrib,
        ibs_cbs_base_calculo:             itemTotal,
        cbs_aliquota:    ibsCbs.cbsRate,
        cbs_valor:       cbsValor,
        ibs_uf_aliquota: ibsCbs.ibsRate,
        ibs_uf_valor:    ibsValor,
        ibs_mun_aliquota: 0,
        ibs_mun_valor:    0,
      };
    }),
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

// ──────────────────────────────────────────────────────────────────────────────
// NF-e de Entrada — autofill pela chave de acesso (produto MDe do Focus)
// ──────────────────────────────────────────────────────────────────────────────
// GET /v2/nfes_recebidas/{chave}.json devolve dados de uma nota onde o CNPJ da
// empresa consultante é o DESTINATÁRIO (distribuição SEFAZ NFeDistribuicaoDFe).
// Requer o produto "Manifestação do Destinatário" ativo na conta Focus da
// empresa — sem isso, ou se a nota ainda não foi distribuída, o Focus responde
// 404 e aqui isso é tratado como resultado válido (found: false), nunca como
// erro que bloqueia o cadastro manual da NF-e de entrada.

export interface NFeRecebidaEmitente {
  cnpj:         string;
  razao_social: string;
  logradouro?:  string;
  numero?:      string;
  bairro?:      string;
  municipio?:   string;
  uf?:          string;
  cep?:         string;
}

export interface NFeRecebidaItem {
  name:       string;
  ncm_code:   string | null;
  cfop:       string | null;
  unit:       string;
  quantity:   number;
  unit_price: number;
}

export interface NFeRecebidaResult {
  found:     boolean;
  reason?:   string;
  emitente?: NFeRecebidaEmitente;
  nfe?: {
    chave:        string;
    numero:       string;
    serie:        string;
    data_emissao: string | null;
    valor_total:  number;
  };
  items?: NFeRecebidaItem[];
}

function focusBaseUrlForAmbiente(ambiente: number): string {
  return ambiente === 1 ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br';
}

export async function consultarNFeRecebida(chave: string, cfg: Company): Promise<NFeRecebidaResult> {
  const token = cfg.focus_ambiente === 1 ? cfg.focus_token_producao : cfg.focus_token_homologacao;
  if (!token) {
    return { found: false, reason: 'Token Focus NF-e não configurado para esta empresa (Empresa → Fiscal)' };
  }

  const url  = `${focusBaseUrlForAmbiente(cfg.focus_ambiente)}/v2/nfes_recebidas/${encodeURIComponent(chave)}.json`;
  const auth = 'Basic ' + Buffer.from(token + ':').toString('base64');

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: auth } });
  } catch (err) {
    return { found: false, reason: `Falha ao consultar o Focus NF-e: ${String(err)}` };
  }

  if (res.status === 404) {
    return { found: false, reason: 'Nota não encontrada — pode ainda não ter sido distribuída pela SEFAZ ao destinatário, ou o produto Manifestação do Destinatário (MDe) não está ativo para esta empresa' };
  }
  if (!res.ok) {
    return { found: false, reason: `Focus NF-e retornou erro ao consultar a nota (HTTP ${res.status})` };
  }

  let body: Record<string, unknown>;
  try {
    body = await res.json() as Record<string, unknown>;
  } catch {
    return { found: false, reason: 'Resposta inválida do Focus NF-e' };
  }

  const emit = body.emitente as Record<string, unknown> | undefined;
  if (!emit || typeof emit.cnpj !== 'string') {
    return { found: false, reason: 'Nota encontrada, mas sem dados de emitente na resposta do Focus NF-e' };
  }

  const itensRaw = Array.isArray(body.itens) ? body.itens as Array<Record<string, unknown>> : [];

  return {
    found: true,
    emitente: {
      cnpj:         emit.cnpj,
      razao_social: String(emit.razao_social ?? emit.nome ?? ''),
      logradouro:   typeof emit.logradouro === 'string' ? emit.logradouro : undefined,
      numero:       typeof emit.numero     === 'string' ? emit.numero     : undefined,
      bairro:       typeof emit.bairro     === 'string' ? emit.bairro     : undefined,
      municipio:    typeof emit.municipio  === 'string' ? emit.municipio  : undefined,
      uf:           typeof emit.uf         === 'string' ? emit.uf         : undefined,
      cep:          typeof emit.cep        === 'string' ? emit.cep        : undefined,
    },
    nfe: {
      chave,
      numero:       String(body.numero ?? ''),
      serie:        String(body.serie  ?? '1'),
      data_emissao: typeof body.data_emissao === 'string' ? body.data_emissao : null,
      valor_total:  Number(body.valor_total ?? 0),
    },
    items: itensRaw.map((it) => ({
      name:       String(it.descricao ?? it.nome ?? 'Item'),
      ncm_code:   typeof it.ncm === 'string' ? it.ncm : null,
      cfop:       typeof it.cfop === 'string' ? it.cfop : null,
      unit:       typeof it.unidade_comercial === 'string' ? it.unidade_comercial : 'UN',
      quantity:   Number(it.quantidade_comercial ?? 0),
      unit_price: Number(it.valor_unitario_comercial ?? 0),
    })),
  };
}

// GET /v2/nfes_recebidas/{chave}.pdf|.xml — documento da nota de terceiro
// (mesma dependência de MDe do consultarNFeRecebida acima). Diferente do
// DANFE de uma NF-e/NFC-e emitida por NÓS (cujo caminho_danfe já vem público
// na resposta do Focus e pode ser linkado direto), este documento exige o
// MESMO token/Basic Auth da consulta — por isso é buscado pelo backend e
// devolvido em base64, nunca um link direto pro Focus.

export interface NFeRecebidaDocumentResult {
  found:         boolean;
  reason?:       string;
  content_type?: string;
  base64?:       string;
}

export async function fetchNFeRecebidaDocument(
  chave: string, cfg: Company, format: 'pdf' | 'xml',
): Promise<NFeRecebidaDocumentResult> {
  const token = cfg.focus_ambiente === 1 ? cfg.focus_token_producao : cfg.focus_token_homologacao;
  if (!token) {
    return { found: false, reason: 'Token Focus NF-e não configurado para esta empresa (Empresa → Fiscal)' };
  }

  const url  = `${focusBaseUrlForAmbiente(cfg.focus_ambiente)}/v2/nfes_recebidas/${encodeURIComponent(chave)}.${format}`;
  const auth = 'Basic ' + Buffer.from(token + ':').toString('base64');

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: auth } });
  } catch (err) {
    return { found: false, reason: `Falha ao consultar o Focus NF-e: ${String(err)}` };
  }

  if (res.status === 404) {
    return { found: false, reason: 'Documento não encontrado — a nota pode ainda não ter sido distribuída pela SEFAZ, ou o produto Manifestação do Destinatário (MDe) não está ativo para esta empresa' };
  }
  if (!res.ok) {
    return { found: false, reason: `Focus NF-e retornou erro ao buscar o documento (HTTP ${res.status})` };
  }

  try {
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      found:        true,
      content_type: format === 'pdf' ? 'application/pdf' : 'application/xml',
      base64:       buf.toString('base64'),
    };
  } catch {
    return { found: false, reason: 'Resposta inválida do Focus NF-e' };
  }
}
