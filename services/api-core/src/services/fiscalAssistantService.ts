// Assistente Fiscal IA — loop tool-use manual sobre a API Anthropic.
// Gates de segurança (plano §8):
//   (a) system prompt anti-cálculo: todo número vem de tool_result;
//   (b) tenantId/companyId SEMPRE de closure do JWT; tools read-only allowlist;
//   (c) fiscal_events guarda SÓ usage/metadata (tokens, tool names) — nunca
//       conteúdo de conversa (LGPD);
//   (d) cap diário de chamadas por tenant (contagem em fiscal_events).

import Anthropic from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { getAnthropic, assistantModel } from '../lib/anthropicClient';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { getProjecao } from './simuladorService';
import { listApuracoes } from './apuracaoService';
import { computeScore } from './fiscalScoreService';
import { listAlerts } from './fiscalAlertService';
import { revenueByCompetencia } from './fiscalRevenueService';
import { resolveCompanyId } from './companyService';

export type DrizzleDB = typeof _db;

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
4. Você é somente-leitura: não promete emitir, pagar, alterar ou cancelar nada.
5. Não dê aconselhamento jurídico; para decisões tributárias definitivas, recomende o contador.
6. Responda em português do Brasil, de forma curta e direta.`;

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

/** Executor read-only — tenantId/companyId vêm da closure (JWT), nunca do modelo. */
function buildToolExecutor(tenantId: string, companyId: string | null | undefined, db: DrizzleDB) {
  return async (name: string): Promise<unknown> => {
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
      default:
        throw new Error(`tool desconhecida: ${name}`);
    }
  };
}

async function assertDailyCap(tenantId: string, db: DrizzleDB): Promise<number> {
  const cap = Number(process.env.ASSISTANT_DAILY_CAP ?? DEFAULT_DAILY_CAP);
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

  const execTool = buildToolExecutor(args.tenantId, args.companyId, db);
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
          return { type: 'tool_result' as const, tool_use_id: tu.id, content: truncateToolOutput(await execTool(tu.name)) };
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
    },
  }, db).catch((err) => console.error(JSON.stringify({ level: 'error', msg: 'assistant_usage_log_failed', err: String(err) })));

  return {
    reply,
    tools_used: toolsUsed,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}
