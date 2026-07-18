// Fiscal Engine API — contrato HTTP + GOLDEN TEST contra o DAS real de
// 02/2026 (R$ 168,00 principal, PDF conferido ao centavo): o engine expõe o
// MESMO motor da apuração interna, então o mesmo input tem de reproduzir os
// mesmos 6 tributos. Auth por X-API-Key: 401/403/429 cobertos aqui.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { apiKeys } from '../db/schema';
import { hashApiKey } from '../lib/apiKeyAuth';
import { resetRateLimiter } from '../lib/rateLimiter';

const SECRET = 'ek_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const state: { keyRows: any[] } = { keyRows: [] };

function activeKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1', tenant_id: 'tenant-1', name: 'Teste',
    key_prefix: SECRET.slice(0, 12), key_hash: hashApiKey(SECRET),
    scopes: ['engine'], rate_limit_per_min: 60, status: 'active',
    ...overrides,
  };
}

// Tabelas oficiais do Anexo III (vigência 2018, LC 155/2016) — faixas 1 e 2.
const BRACKETS_III = [
  { faixa: 1, rbt12_min: '0.00', rbt12_max: '180000.00', aliquota_nominal: '6.00', parcela_deduzir: '0.00' },
  { faixa: 2, rbt12_min: '180000.01', rbt12_max: '360000.00', aliquota_nominal: '11.20', parcela_deduzir: '9360.00' },
];
const REPARTICAO_III = [
  { faixa: 1, irpj: '4.00', csll: '3.50', cofins: '12.82', pis: '2.78', cpp: '43.40', icms: '0', ipi: '0', iss: '33.50' },
  { faixa: 2, irpj: '4.00', csll: '3.50', cofins: '14.05', pis: '3.05', cpp: '43.40', icms: '0', ipi: '0', iss: '32.00' },
];

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return {
    ...actual,
    db: {
      execute: vi.fn(async (query: any) => {
        const text = JSON.stringify(query?.queryChunks ?? query ?? '');
        if (/tax_simples_nacional_brackets/.test(text)) return { rows: BRACKETS_III };
        if (/tax_simples_repartition/.test(text))       return { rows: REPARTICAO_III };
        if (/api_key_usage/.test(text))                 return { rows: [] };
        return { rows: [] };
      }),
      select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve(state.keyRows) }) })),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
      insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
      transaction: vi.fn(),
    },
  };
});

describe('Fiscal Engine API (/v1/engine/*)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.keyRows = [activeKeyRow()];
    resetRateLimiter();
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  const post = (url: string, payload: unknown, key: string | null = SECRET) =>
    app.inject({
      method: 'POST', url, payload: payload as any,
      headers: key ? { 'x-api-key': key } : {},
    });

  describe('autenticação por X-API-Key', () => {
    it('401 sem chave', async () => {
      const res = await post('/v1/engine/simples/fator-r', { folha_12m: 1, receita_12m: 1 }, null);
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('api_key_missing');
    });

    it('401 com prefixo válido mas segredo errado (hash não bate)', async () => {
      const res = await post('/v1/engine/simples/fator-r',
        { folha_12m: 1, receita_12m: 1 }, SECRET.slice(0, -1) + 'b');
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('api_key_invalid');
    });

    it('401 com chave revogada', async () => {
      state.keyRows = [activeKeyRow({ status: 'revoked' })];
      const res = await post('/v1/engine/simples/fator-r', { folha_12m: 1, receita_12m: 1 });
      expect(res.statusCode).toBe(401);
    });

    it('403 quando a chave não tem o escopo engine', async () => {
      state.keyRows = [activeKeyRow({ scopes: ['outro'] })];
      const res = await post('/v1/engine/simples/fator-r', { folha_12m: 1, receita_12m: 1 });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('api_key_scope_denied');
    });

    it('429 acima do rate limit da chave (e Retry-After presente)', async () => {
      state.keyRows = [activeKeyRow({ rate_limit_per_min: 2 })];
      await post('/v1/engine/simples/fator-r', { folha_12m: 2800, receita_12m: 10000 });
      await post('/v1/engine/simples/fator-r', { folha_12m: 2800, receita_12m: 10000 });
      const res = await post('/v1/engine/simples/fator-r', { folha_12m: 2800, receita_12m: 10000 });
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toBe('rate_limit_exceeded');
      expect(res.headers['retry-after']).toBe('60');
    });
  });

  describe('POST /v1/engine/simples/apurar — GOLDEN 02/2026', () => {
    it('reproduz o DAS real ao centavo (Anexo III faixa 1, R$ 2.800 → R$ 168,00)', async () => {
      const res = await post('/v1/engine/simples/apurar', {
        competencia: '2026-02', rbt12: 33600,
        anexos: [{ anexo: 'III', receita: 2800 }],
      });
      expect(res.statusCode).toBe(200);
      const { data } = res.json();
      expect(data.dasTotal).toBe(168);
      // Composição exata do PDF oficial (PGDASD-DAS 48994778000190, 02/2026).
      expect(data.tributos).toMatchObject({
        irpj: 6.72, csll: 5.88, cofins: 21.54, pis: 4.67, cpp: 72.91, iss: 56.28,
        icms: 0, ipi: 0,
      });
      expect(data.memoria.porAnexo[0].aliquotaEfetiva).toBe(6);
      expect(data.memoria.porAnexo[0].faixa).toBe(1);
    });

    it('422 tipado quando o domínio recusa (sem receita)', async () => {
      const res = await post('/v1/engine/simples/apurar', {
        competencia: '2026-02', rbt12: 33600, anexos: [{ anexo: 'III', receita: 0 }],
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('sem_receita_na_competencia');
    });

    it('400 em anexo desconhecido, antes de tocar o banco de tabelas', async () => {
      const res = await post('/v1/engine/simples/apurar', {
        competencia: '2026-02', rbt12: 33600, anexos: [{ anexo: 'IX', receita: 100 }],
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('anexo_invalido');
    });
  });

  describe('POST /v1/engine/simples/rbt12', () => {
    it('soma a janela dos 12 meses anteriores (a própria competência fica fora)', async () => {
      const receitas: Record<string, number> = { '2026-02': 99999 };
      for (let m = 0; m < 12; m++) {
        const d = new Date(Date.UTC(2025, 1 + m, 1));
        receitas[d.toISOString().slice(0, 7)] = 1000;
      }
      const res = await post('/v1/engine/simples/rbt12', {
        competencia: '2026-02', receitas_por_competencia: receitas,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.rbt12).toBe(12000);
    });
  });

  describe('POST /v1/engine/simples/fator-r', () => {
    it('>= 0,28 → Anexo III; < 0,28 → Anexo V', async () => {
      const iii = await post('/v1/engine/simples/fator-r', { folha_12m: 2800, receita_12m: 10000 });
      expect(iii.json().data).toEqual({ fator_r: 0.28, anexo: 'III' });
      const v = await post('/v1/engine/simples/fator-r', { folha_12m: 2799, receita_12m: 10000 });
      expect(v.json().data.anexo).toBe('V');
    });

    it('422 folha_12m_incompleta com menos de 12 meses de folha', async () => {
      const res = await post('/v1/engine/simples/fator-r',
        { folha_12m: 2800, receita_12m: 10000, meses_com_folha: 7 });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('folha_12m_incompleta');
    });
  });

  describe('POST /v1/engine/simples/projecao', () => {
    it('projeta o DAS do mês e informa a distância até a próxima faixa', async () => {
      const res = await post('/v1/engine/simples/projecao', {
        competencia: '2026-02', rbt12: 33600, anexo: 'III', receita_mes: 2800,
      });
      expect(res.statusCode).toBe(200);
      const { data } = res.json();
      expect(data.projecao.dasProjetado).toBe(168);
      expect(data.projecao.faixa).toBe(1);
      // Faixa 1 vai até 180.000 — faltam 146.400 de RBT12.
      expect(data.distancia_proxima_faixa.faltaParaProximaFaixa).toBeCloseTo(146400, 2);
      expect(data.distancia_proxima_faixa.faixaAtual).toBe(1);
    });
  });

  describe('GET /v1/engine/tabelas/:anexo', () => {
    it('devolve faixas + repartição da vigência', async () => {
      const res = await app.inject({
        method: 'GET', url: '/v1/engine/tabelas/III?vigencia=2026',
        headers: { 'x-api-key': SECRET },
      });
      expect(res.statusCode).toBe(200);
      const { data } = res.json();
      expect(data.faixas).toHaveLength(2);
      expect(data.reparticao[0].iss).toBe(33.5);
    });
  });

  describe('POST /v1/engine/pgdasd/payload', () => {
    it('gera o dados do TRANSDECLARACAO11 com indicadorTransmissao=false por default', async () => {
      const anteriores = [];
      for (let m = 0; m < 12; m++) {
        const d = new Date(Date.UTC(2025, 1 + m, 1));
        anteriores.push({ competencia: d.toISOString().slice(0, 7), valor: 2800 });
      }
      const res = await post('/v1/engine/pgdasd/payload', {
        cnpj: '48994778000190', competencia: '2026-02', regime: 'competencia',
        receita_mes: 2800, id_atividade: 11,
        receitas_brutas_anteriores: anteriores,
        folhas_salario: anteriores,
        valores_para_comparacao: { iss: 56.28, cpp: 72.91 },
      });
      expect(res.statusCode).toBe(200);
      const { data } = res.json();
      expect(data.dados.pa).toBe(202602);
      expect(data.dados.indicadorTransmissao).toBe(false);
      expect(data.dados.declaracao.estabelecimentos[0].atividades[0].idAtividade).toBe(11);
      expect(typeof data.dados_serializado).toBe('string');
      expect(JSON.parse(data.dados_serializado).cnpjCompleto).toBe('48994778000190');
    });

    it('400 com hint pedagógico quando id_atividade está fora de 1..43', async () => {
      const res = await post('/v1/engine/pgdasd/payload', {
        cnpj: '48994778000190', competencia: '2026-02', regime: 'competencia',
        receita_mes: 2800, id_atividade: 1401, receitas_brutas_anteriores: [],
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('id_atividade_invalido');
      expect(res.json().hint).toMatch(/LC116/);
    });
  });
});
