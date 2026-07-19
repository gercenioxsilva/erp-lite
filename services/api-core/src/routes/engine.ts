// Fiscal Engine API v1 (/v1/engine/*) — cálculo do Simples Nacional para
// consumidores EXTERNOS, autenticado por API key (X-API-Key), 100% stateless:
// nada do request é persistido, só o contador de uso por chave (metering).
// Todo cálculo delega ao MESMO domínio puro da apuração interna (validado ao
// centavo contra DAS real) — este arquivo é só tradução request→domínio.
//
// Envelope: {success, data} | {success:false, error, ...detalhe}.
// SimplesDomainError/PgdasdPayloadError → 422; entrada malformada → 400.

import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db';
import { requireApiKey, AuthenticatedApiKey } from '../lib/apiKeyAuth';
import { recordUsage } from '../services/engineKeyService';
import { loadBrackets, loadReparticao } from '../services/apuracaoService';
import { apurarSimples } from '../domain/simples/apuracaoDomain';
import {
  computeRbt12, resolveAnexoByFatorR, SimplesDomainError,
} from '../domain/simples/simplesDomain';
import { projetarCompetencia, distanciaProximaFaixa } from '../domain/simples/simuladorDomain';
import { buildTransdeclaracaoDados, serializeDados } from '../domain/pgdasd/payloadDomain';

const ANEXOS = ['I', 'II', 'III', 'IV', 'V'] as const;
const COMPETENCIA_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function meter(request: FastifyRequest, endpoint: string): void {
  const key = (request as any).apiKey as AuthenticatedApiKey | undefined;
  if (key) recordUsage(key.id, endpoint).catch(() => { /* metering nunca quebra a request */ });
}

function badRequest(reply: FastifyReply, error: string, detail?: Record<string, unknown>) {
  return reply.code(400).send({ success: false, error, ...detail });
}

function domainError(reply: FastifyReply, err: unknown) {
  if (err instanceof SimplesDomainError) {
    return reply.code(422).send({ success: false, error: err.code, ...(err.payload ?? {}) });
  }
  throw err;
}

export const engineRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { preHandler: [requireApiKey('engine')] };

  /* ── POST /v1/engine/simples/apurar ─────────────────────────────────── */
  // DAS por tributo + memória de cálculo completa, dado RBT12 + receita por anexo.
  fastify.post('/engine/simples/apurar', auth, async (request, reply) => {
    const b = request.body as {
      competencia?: string; rbt12?: number;
      anexos?: Array<{ anexo?: string; receita?: number; receita_com_retencao?: number }>;
    };
    if (!b?.competencia || !COMPETENCIA_RE.test(b.competencia)) return badRequest(reply, 'competencia_invalida');
    if (!(Number(b.rbt12) > 0)) return badRequest(reply, 'rbt12_obrigatorio');
    if (!Array.isArray(b.anexos) || b.anexos.length === 0) return badRequest(reply, 'anexos_obrigatorio');
    for (const a of b.anexos) {
      if (!ANEXOS.includes(a.anexo as any)) return badRequest(reply, 'anexo_invalido', { anexo: a.anexo });
      if (!(Number(a.receita) >= 0)) return badRequest(reply, 'receita_invalida', { anexo: a.anexo });
    }

    const ano = Number(b.competencia.slice(0, 4));
    try {
      const anexos = [];
      for (const a of b.anexos) {
        anexos.push({
          anexo: a.anexo!, receita: Number(a.receita),
          receitaComRetencao: Number(a.receita_com_retencao) || 0,
          brackets: await loadBrackets(a.anexo!, ano, db),
          reparticao: await loadReparticao(a.anexo!, ano, db),
        });
      }
      const result = apurarSimples({ competencia: b.competencia, rbt12: Number(b.rbt12), anexos });
      meter(request, 'simples/apurar');
      return { success: true, data: result };
    } catch (err) { return domainError(reply, err); }
  });

  /* ── POST /v1/engine/simples/rbt12 ──────────────────────────────────── */
  // RBT12 da competência com proporcionalização de início de atividade.
  fastify.post('/engine/simples/rbt12', auth, async (request, reply) => {
    const b = request.body as {
      competencia?: string; data_abertura?: string | null;
      receitas_por_competencia?: Record<string, number>;
    };
    if (!b?.competencia || !COMPETENCIA_RE.test(b.competencia)) return badRequest(reply, 'competencia_invalida');
    const receitas = b.receitas_por_competencia;
    if (!receitas || typeof receitas !== 'object' || Array.isArray(receitas)) {
      return badRequest(reply, 'receitas_por_competencia_obrigatorio');
    }
    for (const [comp, valor] of Object.entries(receitas)) {
      if (!COMPETENCIA_RE.test(comp) || !(Number(valor) >= 0)) {
        return badRequest(reply, 'receita_competencia_invalida', { competencia: comp });
      }
    }

    try {
      const rbt12 = computeRbt12({
        receitasPorCompetencia: receitas,
        competencia: b.competencia,
        dataAbertura: b.data_abertura ?? null,
      });
      meter(request, 'simples/rbt12');
      return { success: true, data: { competencia: b.competencia, rbt12 } };
    } catch (err) { return domainError(reply, err); }
  });

  /* ── POST /v1/engine/simples/fator-r ────────────────────────────────── */
  fastify.post('/engine/simples/fator-r', auth, async (request, reply) => {
    const b = request.body as { folha_12m?: number; receita_12m?: number; meses_com_folha?: number };
    if (b?.folha_12m == null || !(Number(b.folha_12m) >= 0)) return badRequest(reply, 'folha_12m_obrigatorio');
    if (!(Number(b.receita_12m) > 0)) return badRequest(reply, 'receita_12m_obrigatorio');

    try {
      const result = resolveAnexoByFatorR({
        folha12m: Number(b.folha_12m),
        receita12m: Number(b.receita_12m),
        mesesComFolha: b.meses_com_folha == null ? 12 : Number(b.meses_com_folha),
      });
      meter(request, 'simples/fator-r');
      return { success: true, data: { fator_r: result.fatorR, anexo: result.anexo } };
    } catch (err) { return domainError(reply, err); }
  });

  /* ── POST /v1/engine/simples/projecao ───────────────────────────────── */
  // DAS projetado do mês + distância até a próxima faixa.
  fastify.post('/engine/simples/projecao', auth, async (request, reply) => {
    const b = request.body as {
      competencia?: string; rbt12?: number; anexo?: string;
      receita_mes?: number; receita_pipeline?: number;
    };
    if (!b?.competencia || !COMPETENCIA_RE.test(b.competencia)) return badRequest(reply, 'competencia_invalida');
    if (!(Number(b.rbt12) > 0)) return badRequest(reply, 'rbt12_obrigatorio');
    if (!ANEXOS.includes(b.anexo as any)) return badRequest(reply, 'anexo_invalido', { anexo: b.anexo });
    if (!(Number(b.receita_mes) >= 0)) return badRequest(reply, 'receita_mes_obrigatorio');

    const ano = Number(b.competencia.slice(0, 4));
    try {
      const brackets = await loadBrackets(b.anexo!, ano, db);
      const base = {
        competencia: b.competencia, rbt12: Number(b.rbt12),
        receitaMesLedger: Number(b.receita_mes),
        receitaPipeline: Number(b.receita_pipeline) || 0,
        anexo: b.anexo!, brackets,
        reparticao: await loadReparticao(b.anexo!, ano, db),
      };
      const projecao = projetarCompetencia(base);
      const distancia = distanciaProximaFaixa(brackets, base.rbt12);
      meter(request, 'simples/projecao');
      return { success: true, data: { projecao, distancia_proxima_faixa: distancia } };
    } catch (err) { return domainError(reply, err); }
  });

  /* ── GET /v1/engine/tabelas/:anexo ──────────────────────────────────── */
  // Tabelas oficiais da vigência — transparência do cálculo p/ o consumidor.
  fastify.get('/engine/tabelas/:anexo', auth, async (request, reply) => {
    const { anexo } = request.params as { anexo: string };
    const { vigencia } = request.query as { vigencia?: string };
    if (!ANEXOS.includes(anexo as any)) return badRequest(reply, 'anexo_invalido', { anexo });
    const ano = vigencia ? Number(vigencia) : new Date().getFullYear();
    if (!Number.isInteger(ano) || ano < 2018 || ano > 2100) return badRequest(reply, 'vigencia_invalida');

    try {
      const [brackets, reparticao] = [await loadBrackets(anexo, ano, db), await loadReparticao(anexo, ano, db)];
      meter(request, 'tabelas');
      return { success: true, data: { anexo, vigencia_consultada: ano, faixas: brackets, reparticao } };
    } catch (err) { return domainError(reply, err); }
  });

  /* ── POST /v1/engine/pgdasd/payload ─────────────────────────────────── */
  // Gera o objeto `dados` do TRANSDECLARACAO11 (SERPRO Integra Contador) —
  // NÃO transmite nada; o consumidor usa com o contrato SERPRO dele.
  fastify.post('/engine/pgdasd/payload', auth, async (request, reply) => {
    const b = request.body as {
      cnpj?: string; competencia?: string; regime?: string;
      receita_mes?: number; id_atividade?: number;
      receitas_brutas_anteriores?: Array<{ competencia?: string; valor?: number }>;
      folhas_salario?: Array<{ competencia?: string; valor?: number }>;
      valores_para_comparacao?: Record<string, number>;
      indicador_transmissao?: boolean;
      tipo_declaracao?: number;
    };
    if (!/^\d{14}$/.test(b?.cnpj ?? '')) return badRequest(reply, 'cnpj_invalido');
    if (!b?.competencia || !COMPETENCIA_RE.test(b.competencia)) return badRequest(reply, 'competencia_invalida');
    if (b.regime !== 'competencia' && b.regime !== 'caixa') return badRequest(reply, 'regime_invalido');
    if (!(Number(b.receita_mes) >= 0)) return badRequest(reply, 'receita_mes_obrigatorio');
    const idAtividade = Number(b.id_atividade);
    if (!Number.isInteger(idAtividade) || idAtividade < 1 || idAtividade > 43) {
      return badRequest(reply, 'id_atividade_invalido', {
        hint: 'idAtividade é o enum 1..43 do PGDAS-D (não é o código LC116 nem o CNAE).',
      });
    }
    const parseMensal = (arr: unknown, campo: string): Array<{ competencia: string; valor: number }> | null => {
      if (!Array.isArray(arr)) return null;
      const out: Array<{ competencia: string; valor: number }> = [];
      for (const r of arr as Array<{ competencia?: string; valor?: number }>) {
        if (!r?.competencia || !COMPETENCIA_RE.test(r.competencia) || !(Number(r.valor) >= 0)) return null;
        out.push({ competencia: r.competencia, valor: Number(r.valor) });
      }
      return out;
    };
    const anteriores = parseMensal(b.receitas_brutas_anteriores, 'receitas_brutas_anteriores');
    const folhas = parseMensal(b.folhas_salario ?? [], 'folhas_salario');
    if (!anteriores) return badRequest(reply, 'receitas_brutas_anteriores_invalido');
    if (!folhas) return badRequest(reply, 'folhas_salario_invalido');

    try {
      const dados = buildTransdeclaracaoDados({
        cnpjCompleto: b.cnpj!,
        competencia: b.competencia,
        regime: b.regime,
        receitaMes: Number(b.receita_mes),
        idAtividade,
        receitasBrutasAnteriores: anteriores,
        folhasSalario: folhas,
        valoresParaComparacao: (b.valores_para_comparacao ?? {}) as any,
        // Default false: gerar payload de CONFERÊNCIA — transmitir de verdade
        // é decisão explícita do consumidor no contrato SERPRO dele.
        indicadorTransmissao: b.indicador_transmissao === true,
        tipoDeclaracao: b.tipo_declaracao === 2 ? 2 : 1,
      });
      meter(request, 'pgdasd/payload');
      return { success: true, data: { dados, dados_serializado: serializeDados(dados) } };
    } catch (err) { return domainError(reply, err); }
  });
};
