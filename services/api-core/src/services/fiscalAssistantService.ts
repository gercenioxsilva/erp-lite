// Assistente Fiscal IA — loop tool-use manual sobre a API Anthropic.
// Gates de segurança (plano §8):
//   (a) system prompt anti-cálculo: todo número vem de tool_result;
//   (b) tenantId/companyId SEMPRE de closure do JWT; tools read-only allowlist;
//   (c) fiscal_events guarda SÓ usage/metadata (tokens, tool names) — nunca
//       conteúdo de conversa (LGPD);
//   (d) cap diário de chamadas por tenant (contagem em fiscal_events).

import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { getAnthropic, assistantModel } from '../lib/anthropicClient';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { getProjecao } from './simuladorService';
import { listApuracoes } from './apuracaoService';
import { dasDueDate } from '../domain/fiscal/alertRulesDomain';
import { computeScore } from './fiscalScoreService';
import { listAlerts } from './fiscalAlertService';
import { revenueByCompetencia } from './fiscalRevenueService';
import { resolveCompanyId, CompanyDomainError } from './companyService';
import { lastEmissionDefaults } from './nfseCreateService';

export type DrizzleDB = typeof _db;

/** Rascunho de NFS-e proposto pela IA — a UI renderiza e o usuário confirma.
 *  O modelo NUNCA emite; só produz este objeto (via tool propose_nfse). */
export interface NfseDraft {
  client_id: string;
  client_name: string;
  company_id: string | null;
  amount: number;
  service_code: string;
  iss_rate: number;
  iss_retido: boolean;
  description: string;
  competencia: string;
  idempotency_key: string;
}

/** Ação estruturada que acompanha a resposta textual (card na UI). */
export type AssistantAction =
  | { type: 'nfse_proposal'; draft: NfseDraft }
  | { type: 'open_guia'; apuracaoId: string; competencia: string; dasTotal: number; vencimento: string };

const MAX_TOKENS = 1500;
const MAX_HISTORY_MESSAGES = 12;
const MAX_TOOL_ITERATIONS = 6;
const TOOL_OUTPUT_MAX_CHARS = 4000;
const DEFAULT_DAILY_CAP = 50;

export class AssistantError extends Error {
  constructor(
    public code: 'assistant_disabled' | 'assistant_daily_cap',
    public payload: Record<string, unknown> = {},
  ) { super(code); this.name = 'AssistantError'; }
}

const SYSTEM_PROMPT = `Você é o Assistente Fiscal de um ERP para empresas do Simples Nacional (Brasil).

REGRAS INEGOCIÁVEIS:
1. NUNCA calcule DAS, alíquota efetiva, RBT12, Fator R ou qualquer valor tributário por conta própria. Todo número da sua resposta DEVE vir de um tool_result desta conversa.
2. Ao citar um número, informe a competência e a fonte (qual ferramenta o forneceu).
3. Se as ferramentas não retornarem o dado pedido, diga claramente que não tem essa informação — não estime, não extrapole.
4. Você NÃO executa nada. Pode PROPOR a emissão de uma NFS-e chamando a ferramenta propose_nfse (o rascunho vira um card que o usuário aceita ou cancela na tela) e pode indicar a guia de impostos com get_guia_impostos — mas a emissão/geração só acontece se o usuário confirmar. Nunca afirme que emitiu, pagou, alterou ou cancelou algo.
5. Para propor uma nota "como da última vez", use find_client para achar o cliente e get_client_emission_defaults para reaproveitar código de serviço/ISS da última emissão; só então chame propose_nfse.
6. Não dê aconselhamento jurídico; para decisões tributárias definitivas, recomende o contador.
7. Responda em português do Brasil, de forma curta e direta.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_simulator',
    description: 'Projeção do DAS da competência atual: DAS projetado, alíquota efetiva, RBT12, anexo, Fator R, distância para a próxima faixa e cenários rápidos (+5k/+10k/+15k). Use para perguntas do tipo "quanto vou pagar de DAS?".',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_apuracao',
    description: 'Últimas apurações oficiais do Simples (competência, status, DAS calculado, alíquota efetiva, RBT12). Use para "por que o DAS aumentou?" comparando competências.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_score',
    description: 'Score Fiscal (0-100) com breakdown e lista de inconsistências detectadas (pagamento sem nota, nota sem pagamento, receita divergente da maquininha etc.).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_alerts',
    description: 'Alertas fiscais abertos/reconhecidos (vencimento do DAS, mudança de faixa, perda do Fator R, certificado expirando, inconsistências).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_revenue_by_month',
    description: 'Receita fiscal reconhecida por competência nos últimos 12 meses (YYYY-MM → valor).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_top_clients',
    description: 'Top 5 clientes por faturamento em notas autorizadas nos últimos 12 meses (nome, total, quantidade de notas). Campos mínimos — sem documento/contato.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_client',
    description: 'Busca clientes do tenant por nome/CNPJ/CPF (top 5). Use para localizar o cliente antes de propor uma NFS-e. Retorna id e nome.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'nome, CNPJ ou CPF do cliente' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'get_client_emission_defaults',
    description: 'Padrões da última NFS-e autorizada do cliente (código de serviço, alíquota ISS, ISS retido, descrição, último valor) — a base do "como fiz da última vez".',
    input_schema: { type: 'object', properties: { client_id: { type: 'string' } }, required: ['client_id'], additionalProperties: false },
  },
  {
    name: 'propose_nfse',
    description: 'Monta um RASCUNHO de NFS-e para o usuário revisar e confirmar na tela (NÃO emite). Passe client_id (obtido via find_client) e amount; service_code/iss_rate/iss_retido/description são opcionais e, se omitidos, herdam da última emissão ou do cadastro. Retorne ao usuário confirmando que o rascunho está pronto para aceitar.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        amount: { type: 'number' },
        service_code: { type: 'string' },
        iss_rate: { type: 'number' },
        iss_retido: { type: 'boolean' },
        description: { type: 'string' },
      },
      required: ['client_id', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_guia_impostos',
    description: 'Busca a apuração de uma competência (YYYY-MM) e prepara o documento imprimível para pagar os impostos do mês (DAS, vencimento, passos do portal). Se a competência ainda não foi apurada, avise o usuário para apurar primeiro na tela de Apuração.',
    input_schema: { type: 'object', properties: { competencia: { type: 'string', description: 'competência YYYY-MM' } }, required: ['competencia'], additionalProperties: false },
  },
];

/** Últimos 12 meses (inclui o atual), formato YYYY-MM. */
function last12Competencias(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function truncateToolOutput(value: unknown): string {
  const text = JSON.stringify(value);
  if (text.length <= TOOL_OUTPUT_MAX_CHARS) return text;
  return `${text.slice(0, TOOL_OUTPUT_MAX_CHARS)}…[truncado]`;
}

/** Estado mutável do loop capturado pelo executor (proposta/ação). */
interface ToolState { action: AssistantAction | null }

/** Executor — tenantId/companyId vêm da closure (JWT), nunca do modelo.
 *  As leituras são puras; propose_nfse/get_guia_impostos apenas STASHAM uma
 *  ação em `state` (a execução real fica na UI + endpoint determinístico). */
function buildToolExecutor(tenantId: string, companyId: string | null | undefined, db: DrizzleDB, state: ToolState) {
  return async (name: string, input: Record<string, unknown>): Promise<unknown> => {
    switch (name) {
      case 'get_simulator':
        return getProjecao(tenantId, companyId, db);
      case 'get_apuracao': {
        const rows = await listApuracoes(tenantId, companyId ?? null, db);
        // memoria jsonb é grande e desnecessária para o chat.
        return rows.slice(0, 6).map(({ memoria: _m, ...rest }: any) => rest);
      }
      case 'get_score':
        return computeScore(tenantId, companyId, db);
      case 'get_alerts':
        return (await listAlerts(tenantId, { status: 'open,acknowledged', limit: 20 }, db))
          .map((a: any) => ({
            rule_key: a.rule_key, severity: a.severity, status: a.status,
            title: a.title, message: a.message, last_detected_at: a.last_detected_at,
          }));
      case 'get_revenue_by_month': {
        const company = await resolveCompanyId(tenantId, companyId, db);
        const meses = last12Competencias();
        return revenueByCompetencia(tenantId, company.id, meses, db);
      }
      case 'get_top_clients': {
        const { rows } = await db.execute<any>(sql`
          SELECT COALESCE(c.company_name, c.trade_name, c.full_name, 'Sem cadastro') AS nome,
                 SUM(t.amount)::numeric(15,2) AS total,
                 COUNT(*) AS notas
          FROM (
            SELECT client_id, amount::numeric AS amount, created_at
            FROM nfse_invoices WHERE tenant_id = ${tenantId} AND nfse_status = 'authorized'
            UNION ALL
            SELECT client_id, total::numeric AS amount, created_at
            FROM invoices WHERE tenant_id = ${tenantId} AND nfe_status = 'authorized'
          ) t
          LEFT JOIN clients c ON c.id = t.client_id
          WHERE t.created_at >= now() - interval '12 months'
          GROUP BY 1 ORDER BY 2 DESC LIMIT 5`);
        return rows;
      }
      case 'find_client': {
        const q = String(input.query ?? '').trim();
        if (!q) return [];
        const like = `%${q}%`;
        const { rows } = await db.execute<any>(sql`
          SELECT id, COALESCE(company_name, trade_name, full_name, 'Sem nome') AS nome
          FROM clients
          WHERE tenant_id = ${tenantId}
            AND (company_name ILIKE ${like} OR trade_name ILIKE ${like} OR full_name ILIKE ${like}
                 OR cnpj = ${q} OR cpf = ${q})
          ORDER BY COALESCE(company_name, full_name) LIMIT 5`);
        return rows;
      }
      case 'get_client_emission_defaults': {
        const clientId = String(input.client_id ?? '');
        await assertClientInTenant(tenantId, clientId, db);
        return (await lastEmissionDefaults(tenantId, clientId, db)) ?? { note: 'sem emissão anterior para este cliente' };
      }
      case 'propose_nfse': {
        state.action = { type: 'nfse_proposal', draft: await buildNfseDraft(tenantId, companyId, input, db) };
        return { ok: true, note: 'Rascunho pronto. Peça ao usuário para revisar e confirmar na tela.' };
      }
      case 'get_guia_impostos': {
        const competencia = String(input.competencia ?? '');
        const rows = await listApuracoes(tenantId, companyId ?? null, db);
        const row = rows.find((r: any) => r.competencia === competencia);
        if (!row) return { exists: false, note: `Competência ${competencia} ainda não foi apurada. Peça ao usuário para apurar na tela de Apuração antes de gerar a guia.` };
        const vencimento = dasDueDate(competencia).toISOString().slice(0, 10);
        state.action = {
          type: 'open_guia', apuracaoId: (row as any).id, competencia,
          dasTotal: Number((row as any).das_total ?? 0), vencimento,
        };
        return { exists: true, das_total: (row as any).das_total, vencimento };
      }
      default:
        throw new Error(`tool desconhecida: ${name}`);
    }
  };
}

async function assertClientInTenant(tenantId: string, clientId: string, db: DrizzleDB): Promise<Record<string, unknown>> {
  const { rows } = await db.execute<any>(sql`
    SELECT id, COALESCE(company_name, trade_name, full_name, 'Sem nome') AS nome
    FROM clients WHERE id = ${clientId} AND tenant_id = ${tenantId}`);
  if (!rows[0]) throw new Error('cliente não encontrado neste tenant');
  return rows[0];
}

/** Normaliza o rascunho: valida cliente ∈ tenant e preenche defaults faltantes
 *  server-side (o modelo não precisa saber código de serviço/alíquota). */
async function buildNfseDraft(
  tenantId: string, companyId: string | null | undefined, input: Record<string, unknown>, db: DrizzleDB,
): Promise<NfseDraft> {
  const clientId = String(input.client_id ?? '');
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new Error('valor inválido para a nota');
  const client = await assertClientInTenant(tenantId, clientId, db);

  const defaults = await lastEmissionDefaults(tenantId, clientId, db);
  let companyResolvedId: string | null = null;
  let aliquotaPadrao = 0;
  let codigoPadrao: string | null = null;
  try {
    const cfg = await resolveCompanyId(tenantId, companyId ?? null, db, 'nfse');
    companyResolvedId = cfg.id;
    aliquotaPadrao = Number(cfg.aliquota_iss_padrao ?? 0);
    codigoPadrao = cfg.codigo_servico_padrao ?? null;
  } catch (err) {
    // company_selection_required etc. — o endpoint de execução resolve/valida
    // de novo; o rascunho segue com company_id null.
    if (!(err instanceof CompanyDomainError)) throw err;
  }

  const serviceCode = (input.service_code as string) || defaults?.service_code || codigoPadrao || '';
  const issRate = input.iss_rate != null ? Number(input.iss_rate) : (defaults?.iss_rate ?? aliquotaPadrao);
  const issRetido = input.iss_retido != null ? Boolean(input.iss_retido) : (defaults?.iss_retido ?? false);
  const description = (input.description as string) || defaults?.description || 'Serviços prestados';

  return {
    client_id: clientId, client_name: String(client.nome), company_id: companyResolvedId,
    amount, service_code: serviceCode, iss_rate: issRate, iss_retido: issRetido,
    description, competencia: new Date().toISOString().slice(0, 7), idempotency_key: randomUUID(),
  };
}

/**
 * Cap diário de mensagens por tenant. `||` e não `??`: compose/ECS declaram env
 * com `${VAR:-}`, que entrega string VAZIA — e `Number('')` é 0, o que travaria
 * todo request em 429. Valor inválido também cai no default pelo mesmo motivo.
 */
export function dailyCap(): number {
  const raw = Number(process.env.ASSISTANT_DAILY_CAP || DEFAULT_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_CAP;
}

async function assertDailyCap(tenantId: string, db: DrizzleDB): Promise<number> {
  const cap = dailyCap();
  const { rows } = await db.execute<any>(sql`
    SELECT COUNT(*) AS n FROM fiscal_events
    WHERE tenant_id = ${tenantId}
      AND aggregate_type = 'assistant' AND event_type = 'assistant_message'
      AND created_at >= date_trunc('day', now())`);
  const used = Number(rows[0]?.n ?? 0);
  if (used >= cap) throw new AssistantError('assistant_daily_cap', { cap, used });
  return used;
}

export interface AssistantHistoryMessage { role: 'user' | 'assistant'; content: string }

/** Histórico: só strings user/assistant não-vazias, cortado a 12 msgs, sem assistant na frente. */
export function sanitizeHistory(history: AssistantHistoryMessage[] | undefined): AssistantHistoryMessage[] {
  const clean = (history ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim() !== '')
    .slice(-MAX_HISTORY_MESSAGES);
  while (clean.length > 0 && clean[0].role === 'assistant') clean.shift();
  return clean;
}

export interface RunAssistantArgs {
  tenantId: string;
  companyId?: string | null;
  userId: string;
  message: string;
  history?: AssistantHistoryMessage[];
}

export async function runAssistant(args: RunAssistantArgs, db: DrizzleDB = _db) {
  const client = getAnthropic();
  if (!client) throw new AssistantError('assistant_disabled');
  await assertDailyCap(args.tenantId, db);

  const history = sanitizeHistory(args.history);
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: args.message },
  ];

  const state: ToolState = { action: null };
  const execTool = buildToolExecutor(args.tenantId, args.companyId, db, state);
  const toolsUsed: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let iterations = 0;
  let response: Anthropic.Message | null = null;

  // Loop tool-use manual, máx 6 iterações (gate §8).
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    iterations = i + 1;
    response = await client.messages.create({
      model: assistantModel(),
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason !== 'tool_use') break;

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (tu) => {
        toolsUsed.push(tu.name);
        try {
          return { type: 'tool_result' as const, tool_use_id: tu.id, content: truncateToolOutput(await execTool(tu.name, (tu.input ?? {}) as Record<string, unknown>)) };
        } catch (err) {
          return {
            type: 'tool_result' as const, tool_use_id: tu.id, is_error: true,
            content: 'Falha ao consultar os dados. Informe ao usuário que a consulta não está disponível no momento.',
          };
        }
      }),
    );
    // Todos os tool_results num ÚNICO user message (contrato da API).
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: results });
  }

  const reply = response?.stop_reason === 'refusal'
    ? 'Não consigo responder a essa pergunta. Reformule focando nos seus dados fiscais.'
    : (response?.content ?? [])
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text).join('\n').trim()
      || 'Não consegui montar uma resposta agora. Tente novamente.';

  // Gate §8(c): SÓ usage/metadata — nunca o conteúdo da conversa.
  void recordFiscalEvent({
    tenantId: args.tenantId,
    companyId: args.companyId ?? null,
    aggregateType: 'assistant',
    eventType: 'assistant_message',
    actorUserId: args.userId,
    responsePayload: {
      model: assistantModel(), iterations, tools_used: toolsUsed,
      input_tokens: inputTokens, output_tokens: outputTokens,
      stop_reason: response?.stop_reason ?? null,
      // §8(c): só o TIPO da ação — nunca dados do cliente/valores.
      action_type: state.action?.type ?? null,
    },
  }, db).catch((err) => console.error(JSON.stringify({ level: 'error', msg: 'assistant_usage_log_failed', err: String(err) })));

  return {
    reply,
    tools_used: toolsUsed,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    action: state.action ?? undefined,
  };
}
