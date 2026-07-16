// Orquestração PGDAS-D via SERPRO Integra Contador. Camada de serviço: carrega
// os insumos do banco (apuração + cadastro + ledger + folha), monta o payload
// (domínio puro), e fala com a SERPRO (lib/serproClient). REUSA o que já existe
// — não recalcula DAS (o número persistido em simples_apuracao é a autoridade).
//
// Disciplina LEGAL (o que separa isto de uma emissão qualquer):
//   - CONFERÊNCIA (indicadorTransmissao=false) tem ZERO efeito jurídico.
//   - TRANSMISSÃO (=true) é ato irreversível: persiste o número ANTES de gerar o
//     DAS, e NUNCA faz blind-retry do Declarar (não tem idempotency key; um
//     timeout depois dos bytes saírem pode ter valido → status failed_unknown,
//     TERMINAL; reconciliar via CONSULTIMADECREC14).
//   - indicadorComparacao é sempre true (divergência de R$0,01 bloqueia).

import { and, eq } from 'drizzle-orm';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { db as _db } from '../db';
import { simplesApuracao, nfeConfigs, pgdasdTransmissions } from '../db/schema';
import { getOrCreateConfig } from './fiscalCompanyConfigService';
import { revenueByCompetencia, revenueForCompetenciaByAnexo } from './fiscalRevenueService';
import { folha12m } from './apuracaoService';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { getS3Client } from '../lib/s3Client';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import { toNumber } from '../lib/money';
import { windowCompetencias, SimplesDomainError } from '../domain/simples/simplesDomain';
import {
  SerproClient, SerproError, serproConfig, type Pessoa,
} from '../lib/serproClient';
import { resolveIdAtividade, TributoComparavel } from '../domain/pgdasd/atividadesDomain';
import {
  buildTransdeclaracaoDados, serializeDados, competenciaToPa, TransdeclaracaoDados,
} from '../domain/pgdasd/payloadDomain';
import { evaluateTransmissionReadiness, ReadinessResult } from '../domain/pgdasd/readinessDomain';
import {
  extractNumeroDeclaracao, extractPdfBase64, isPdfBase64, diffTributos, Divergencia,
} from '../domain/pgdasd/responseDomain';

export type DrizzleDB = typeof _db;

const ID_SISTEMA = 'PGDASD';
const VERSAO = '1.0';
const READ_URL_EXPIRES = 600; // 10 min

/** Erro que a rota mapeia em 503 (SERPRO não configurado neste ambiente). */
export class PgdasdDisabledError extends Error {
  constructor() { super('pgdasd_disabled'); this.name = 'PgdasdDisabledError'; }
}

function requireClient(transportOverride?: ConstructorParameters<typeof SerproClient>[1]): SerproClient {
  const cfg = serproConfig();
  if (!cfg) throw new PgdasdDisabledError();
  return new SerproClient(cfg, transportOverride);
}

export function isPgdasdEnabled(): boolean { return serproConfig() !== null; }

const onlyDigits = (s: string): string => s.replace(/\D/g, '');

interface PgdasdContext {
  apu: typeof simplesApuracao.$inferSelect;
  config: Awaited<ReturnType<typeof getOrCreateConfig>>;
  cnpj: string;
  inscricaoMunicipal: string | null;
  janela: string[];
  revMap: Record<string, number>;
  anexosNaCompetencia: number;
  folha: Awaited<ReturnType<typeof folha12m>>;
}

async function loadContext(tenantId: string, apuracaoId: string, db: DrizzleDB): Promise<PgdasdContext> {
  const [apu] = await db.select().from(simplesApuracao)
    .where(and(eq(simplesApuracao.id, apuracaoId), eq(simplesApuracao.tenant_id, tenantId)));
  if (!apu) throw new SimplesDomainError('apuracao_not_found', { apuracaoId });

  const config = await getOrCreateConfig(tenantId, apu.company_id, db);
  const [nfe] = await db.select().from(nfeConfigs).where(eq(nfeConfigs.id, apu.company_id));
  const janela = windowCompetencias(apu.competencia);
  const revMap = await revenueByCompetencia(tenantId, apu.company_id, janela, db);
  const porAnexo = await revenueForCompetenciaByAnexo(tenantId, apu.company_id, apu.competencia, db);
  const folha = await folha12m(tenantId, apu.company_id, apu.competencia, db);

  return {
    apu, config,
    cnpj: onlyDigits(nfe?.cnpj ?? ''),
    inscricaoMunicipal: nfe?.inscricao_municipal ?? null,
    janela, revMap,
    anexosNaCompetencia: porAnexo.length,
    folha,
  };
}

function evaluate(ctx: PgdasdContext): ReadinessResult {
  return evaluateTransmissionReadiness({
    enquadramento: ctx.config.enquadramento,
    optanteSimples: ctx.config.optante_simples,
    issFixo: ctx.config.iss_fixo ?? false,
    issRetidoPadrao: ctx.config.iss_retido_padrao ?? false,
    inscricaoMunicipal: ctx.inscricaoMunicipal,
    rbt12Source: ctx.apu.rbt12_source === 'manual' ? 'manual' : 'ledger',
    receitaMes: toNumber(ctx.apu.receita_competencia),
    sublimiteExcedido: ctx.apu.sublimite_excedido ?? false,
    anexosNaCompetencia: ctx.anexosNaCompetencia,
    competencia: ctx.apu.competencia,
    dataAbertura: ctx.config.data_abertura,
    competenciasComReceita: Object.keys(ctx.revMap),
  }, ctx.janela);
}

/** Tributos persistidos na apuração → valoresParaComparacao (por código). */
function tributosDaApuracao(apu: PgdasdContext['apu']): Partial<Record<TributoComparavel, number>> {
  return {
    irpj: toNumber(apu.valor_irpj), csll: toNumber(apu.valor_csll),
    cofins: toNumber(apu.valor_cofins), pis: toNumber(apu.valor_pis),
    cpp: toNumber(apu.valor_cpp), icms: toNumber(apu.valor_icms), iss: toNumber(apu.valor_iss),
  };
}

function buildDados(ctx: PgdasdContext, opts: { indicadorTransmissao: boolean; tipoDeclaracao: 1 | 2 }): TransdeclaracaoDados {
  const idAtividade = resolveIdAtividade(ctx.config);
  return buildTransdeclaracaoDados({
    cnpjCompleto: ctx.cnpj,
    competencia: ctx.apu.competencia,
    regime: ctx.config.regime_apuracao === 'caixa' ? 'caixa' : 'competencia',
    receitaMes: toNumber(ctx.apu.receita_competencia),
    idAtividade,
    receitasBrutasAnteriores: ctx.janela
      .filter((c) => ctx.revMap[c] != null)
      .map((c) => ({ competencia: c, valor: ctx.revMap[c] })),
    folhasSalario: ctx.folha.porCompetencia,
    valoresParaComparacao: tributosDaApuracao(ctx.apu),
    indicadorTransmissao: opts.indicadorTransmissao,
    tipoDeclaracao: opts.tipoDeclaracao,
  });
}

// ── Fase 0 (sem rede): readiness + payload ────────────────────────────────

export async function getReadiness(tenantId: string, apuracaoId: string, db: DrizzleDB = _db): Promise<ReadinessResult & { enabled: boolean }> {
  const ctx = await loadContext(tenantId, apuracaoId, db);
  return { ...evaluate(ctx), enabled: isPgdasdEnabled() };
}

/** Mostra o `dados` EXATO que a RFB receberia — sem rede, sem custo. */
export async function getPayloadPreview(tenantId: string, apuracaoId: string, db: DrizzleDB = _db) {
  const ctx = await loadContext(tenantId, apuracaoId, db);
  const readiness = evaluate(ctx);
  if (!readiness.ready) {
    throw new SimplesDomainError('transmissao_nao_pronta', { reasons: readiness.reasons, mesesFaltantes: readiness.mesesFaltantes });
  }
  const dados = buildDados(ctx, { indicadorTransmissao: false, tipoDeclaracao: 1 });
  return { competencia: ctx.apu.competencia, cnpj: ctx.cnpj, dados, dadosSerializado: serializeDados(dados) };
}

// ── Fase 1: identidade do envelope + tipoDeclaração via RFB ────────────────

function pessoa(cnpj: string): Pessoa { return { numero: cnpj, tipo: 2 }; }

/**
 * Já existe declaração para a PA? Consulta a RFB (CONSULTIMADECREC14) — a nossa
 * tabela não sabe (o usuário declarava na mão). v1 BLOQUEIA retificadora: se já
 * há declaração, recusa com transmissao_ja_realizada em vez de gerar tipo=2.
 */
async function assertOriginalOuBloqueia(client: SerproClient, ctx: PgdasdContext): Promise<1> {
  try {
    const res = await client.call({
      endpoint: 'Consultar', idSistema: ID_SISTEMA, idServico: 'CONSULTIMADECREC14', versaoSistema: VERSAO,
      dados: JSON.stringify({ periodoApuracao: String(competenciaToPa(ctx.apu.competencia)) }),
      contratante: pessoa(ctx.cnpj), autorPedidoDados: pessoa(ctx.cnpj), contribuinte: pessoa(ctx.cnpj),
    });
    if (extractNumeroDeclaracao(res.itens)) {
      throw new SimplesDomainError('transmissao_ja_realizada', { competencia: ctx.apu.competencia });
    }
  } catch (err) {
    if (err instanceof SimplesDomainError) throw err;
    // Consulta indisponível: não presume nada — segue como original (a trava de
    // in-flight ainda impede duplo-clique concorrente).
  }
  return 1;
}

// ── Fase 2: CONFERÊNCIA (indicadorTransmissao=false — zero efeito legal) ────

export interface ConferenciaResult {
  billed: boolean;
  nossoDas: number;
  valoresRfb: any[];
  divergencias: Divergencia[];
}

export async function conferir(
  tenantId: string, apuracaoId: string, actorUserId: string | null,
  db: DrizzleDB = _db, transport?: ConstructorParameters<typeof SerproClient>[1],
): Promise<ConferenciaResult> {
  const client = requireClient(transport);
  const ctx = await loadContext(tenantId, apuracaoId, db);
  const readiness = evaluate(ctx);
  if (!readiness.ready) {
    throw new SimplesDomainError('transmissao_nao_pronta', { reasons: readiness.reasons, mesesFaltantes: readiness.mesesFaltantes });
  }
  const dados = buildDados(ctx, { indicadorTransmissao: false, tipoDeclaracao: 1 });

  const res = await client.call({
    endpoint: 'Declarar', idSistema: ID_SISTEMA, idServico: 'TRANSDECLARACAO11', versaoSistema: VERSAO,
    dados: serializeDados(dados),
    contratante: pessoa(ctx.cnpj), autorPedidoDados: pessoa(ctx.cnpj), contribuinte: pessoa(ctx.cnpj),
  });

  const nosso = tributosDaApuracao(ctx.apu);
  const divergencias = diffTributos(nosso, res.itens);

  await db.insert(pgdasdTransmissions).values({
    tenant_id: tenantId, company_id: ctx.apu.company_id, apuracao_id: apuracaoId,
    competencia: ctx.apu.competencia, indicador_transmissao: false,
    status: 'confirmed', payload_dados: dados, valores_rfb: res.itens, created_by: actorUserId,
  });
  await recordFiscalEvent({
    tenantId, companyId: ctx.apu.company_id, aggregateType: 'pgdasd', aggregateId: apuracaoId,
    eventType: 'pgdasd_conferido', actorUserId,
    requestPayload: { competencia: ctx.apu.competencia, billed: res.billed, divergencias: divergencias.length },
  }, db);

  return { billed: res.billed, nossoDas: toNumber(ctx.apu.das_total), valoresRfb: res.itens, divergencias };
}

// ── Fase 3: TRANSMISSÃO (ato irreversível) + GERAR DAS ─────────────────────

export interface TransmissaoResult {
  transmissionId: string;
  numeroDeclaracao: string | null;
  status: string;
  billed: boolean;
}

export async function transmitir(
  tenantId: string, apuracaoId: string, actorUserId: string | null,
  db: DrizzleDB = _db, transport?: ConstructorParameters<typeof SerproClient>[1],
): Promise<TransmissaoResult> {
  const client = requireClient(transport);
  const ctx = await loadContext(tenantId, apuracaoId, db);
  const readiness = evaluate(ctx);
  if (!readiness.ready) {
    throw new SimplesDomainError('transmissao_nao_pronta', { reasons: readiness.reasons, mesesFaltantes: readiness.mesesFaltantes });
  }

  // Bloqueia retificadora em v1 (fato "já declarado" vem da RFB, não da nossa tabela).
  await assertOriginalOuBloqueia(client, ctx);

  const dados = buildDados(ctx, { indicadorTransmissao: true, tipoDeclaracao: 1 });

  // 1) Reivindica a linha em-voo — o UNIQUE parcial impede duplo-clique concorrente.
  let row;
  try {
    [row] = await db.insert(pgdasdTransmissions).values({
      tenant_id: tenantId, company_id: ctx.apu.company_id, apuracao_id: apuracaoId,
      competencia: ctx.apu.competencia, indicador_transmissao: true,
      status: 'building', payload_dados: dados, created_by: actorUserId,
    }).returning();
  } catch (err) {
    if (isUniqueConstraintViolation(err)) throw new SimplesDomainError('transmissao_em_andamento', { competencia: ctx.apu.competencia });
    throw err;
  }
  await db.update(pgdasdTransmissions).set({ status: 'sent', updated_at: new Date() }).where(eq(pgdasdTransmissions.id, row.id));

  // 2) Declarar — SEM blind-retry. Timeout ⇒ os bytes PODEM ter valido.
  let res;
  try {
    res = await client.call({
      endpoint: 'Declarar', idSistema: ID_SISTEMA, idServico: 'TRANSDECLARACAO11', versaoSistema: VERSAO,
      dados: serializeDados(dados),
      contratante: pessoa(ctx.cnpj), autorPedidoDados: pessoa(ctx.cnpj), contribuinte: pessoa(ctx.cnpj),
    });
  } catch (err) {
    const httpStatus = err instanceof SerproError ? err.httpStatus : 0;
    // httpStatus 0 = erro de rede/timeout ANTES de uma resposta determinística:
    // TERMINAL (failed_unknown), reconciliar via CONSULTIMADECREC14, nunca retry.
    const terminalUnknown = httpStatus === 0;
    await db.update(pgdasdTransmissions).set({
      status: terminalUnknown ? 'failed_unknown' : 'failed',
      erro_codigo: err instanceof SerproError ? err.code : 'erro_rede',
      erro_mensagem: String((err as any)?.message ?? err).slice(0, 500),
      updated_at: new Date(),
    }).where(eq(pgdasdTransmissions.id, row.id));
    await recordFiscalEvent({
      tenantId, companyId: ctx.apu.company_id, aggregateType: 'pgdasd', aggregateId: apuracaoId,
      eventType: terminalUnknown ? 'pgdasd_falha_indeterminada' : 'pgdasd_falha', actorUserId,
      requestPayload: { competencia: ctx.apu.competencia, httpStatus },
    }, db);
    throw err;
  }

  // 3) Persiste o número ANTES de qualquer coisa (Emitir depende disto).
  const numero = extractNumeroDeclaracao(res.itens);
  await db.update(pgdasdTransmissions).set({
    status: 'confirmed', numero_declaracao: numero, valores_rfb: res.itens, updated_at: new Date(),
  }).where(eq(pgdasdTransmissions.id, row.id));
  await recordFiscalEvent({
    tenantId, companyId: ctx.apu.company_id, aggregateType: 'pgdasd', aggregateId: apuracaoId,
    eventType: 'pgdasd_transmitido', actorUserId,
    requestPayload: { competencia: ctx.apu.competencia, numeroDeclaracao: numero, billed: res.billed },
  }, db);

  return { transmissionId: row.id, numeroDeclaracao: numero, status: 'confirmed', billed: res.billed };
}

/** GERARDAS12 — seguro de repetir (idempotente do lado da RFB). Devolve o PDF. */
export async function gerarDas(
  tenantId: string, transmissionId: string, actorUserId: string | null,
  db: DrizzleDB = _db, transport?: ConstructorParameters<typeof SerproClient>[1],
): Promise<{ pdfBase64: string; url: string | null; s3Key: string | null }> {
  const client = requireClient(transport);
  const [row] = await db.select().from(pgdasdTransmissions)
    .where(and(eq(pgdasdTransmissions.id, transmissionId), eq(pgdasdTransmissions.tenant_id, tenantId)));
  if (!row) throw new SimplesDomainError('transmissao_not_found', { transmissionId });
  if (row.status !== 'confirmed' || !row.indicador_transmissao) {
    throw new SimplesDomainError('transmissao_nao_confirmada', { status: row.status });
  }

  const [nfe] = await db.select().from(nfeConfigs).where(eq(nfeConfigs.id, row.company_id));
  const cnpj = onlyDigits(nfe?.cnpj ?? '');

  const res = await client.call({
    endpoint: 'Emitir', idSistema: ID_SISTEMA, idServico: 'GERARDAS12', versaoSistema: VERSAO,
    dados: JSON.stringify({ periodoApuracao: String(competenciaToPa(row.competencia)) }),
    contratante: pessoa(cnpj), autorPedidoDados: pessoa(cnpj), contribuinte: pessoa(cnpj),
  });
  // GERARDAS12 → ARRAY [{pdf: base64}] (parseSerproDados já normaliza para array).
  const pdfBase64 = extractPdfBase64(res.itens);
  if (!isPdfBase64(pdfBase64)) {
    throw new SerproError('serpro_das_sem_pdf', res.httpStatus, null);
  }

  // Guarda no S3 quando há bucket; senão devolve inline (tolerância de dev).
  const bucket = process.env.FISCAL_DOCS_BUCKET ?? process.env.FISCAL_IMPORTS_BUCKET;
  let s3Key: string | null = null;
  let url: string | null = null;
  if (bucket) {
    s3Key = `pgdasd/${tenantId}/${row.company_id}/${row.competencia}/das-${transmissionId}.pdf`;
    await getS3Client().send(new PutObjectCommand({
      Bucket: bucket, Key: s3Key, Body: Buffer.from(String(pdfBase64), 'base64'),
      ContentType: 'application/pdf', ServerSideEncryption: 'AES256',
    }));
    url = await getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: bucket, Key: s3Key }), { expiresIn: READ_URL_EXPIRES });
    await db.update(pgdasdTransmissions).set({ das_pdf_s3_key: s3Key, updated_at: new Date() }).where(eq(pgdasdTransmissions.id, transmissionId));
  }
  await recordFiscalEvent({
    tenantId, companyId: row.company_id, aggregateType: 'pgdasd', aggregateId: row.apuracao_id,
    eventType: 'pgdasd_das_gerado', actorUserId, pdfS3Key: s3Key,
    requestPayload: { competencia: row.competencia },
  }, db);

  return { pdfBase64: String(pdfBase64), url, s3Key };
}

/** Fila de transmissões de uma apuração (para a UI cruzar por LEFT JOIN). */
export async function listTransmissions(tenantId: string, apuracaoId: string, db: DrizzleDB = _db) {
  return db.select().from(pgdasdTransmissions)
    .where(and(eq(pgdasdTransmissions.tenant_id, tenantId), eq(pgdasdTransmissions.apuracao_id, apuracaoId)));
}
