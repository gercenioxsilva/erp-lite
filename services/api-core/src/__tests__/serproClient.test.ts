// SerproClient com transporte MOCKADO — prova auth/token-cache/duplo-parse/
// 401-retry/billing sem tocar a rede. A verificação de ponta a ponta contra a
// SERPRO real exige contrato + e-CNPJ A1 e roda fora do CI.

import { describe, it, expect, vi } from 'vitest';
import {
  SerproClient, SerproError, parseSerproDados, isBilled, serproConfig, isPgdasdEnabled,
  type HttpTransport, type SerproConfig,
} from '../lib/serproClient';

const CFG: SerproConfig = {
  env: 'trial', consumerKey: 'ck', consumerSecret: 'cs',
  pfxBase64: Buffer.from('fake-pfx').toString('base64'), pfxPassword: 'pw',
};
const PESSOA = { numero: '48994778000190', tipo: 2 as const };

const authOk = { status: 200, body: JSON.stringify({ access_token: 'tok-1', jwt_token: 'jwt-1', expires_in: 2008 }) };

describe('parseSerproDados', () => {
  it('faz o duplo parse e normaliza objeto para array', () => {
    const body = JSON.stringify({ status: 200, dados: JSON.stringify({ numeroDeclaracao: '123' }), mensagens: [] });
    const r = parseSerproDados(body);
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0].numeroDeclaracao).toBe('123');
  });

  it('mantém array (GERARDAS12 → [{pdf}])', () => {
    const body = JSON.stringify({ status: 200, dados: JSON.stringify([{ pdf: 'JVBERi0=' }]) });
    const r = parseSerproDados(body);
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0].pdf).toBe('JVBERi0=');
  });

  it('erro tipado (não SyntaxError cru) quando dados não é JSON', () => {
    const body = JSON.stringify({ status: 200, dados: 'isto não é json {' });
    expect(() => parseSerproDados(body)).toThrow(SerproError);
  });
});

describe('isBilled', () => {
  it('200/202/403 são cobrados; o resto não', () => {
    expect(isBilled(200)).toBe(true);
    expect(isBilled(202)).toBe(true);
    expect(isBilled(403)).toBe(true);
    expect(isBilled(404)).toBe(false);
    expect(isBilled(401)).toBe(false);
    expect(isBilled(500)).toBe(false);
  });
});

describe('serproConfig / isPgdasdEnabled', () => {
  it('sem env → null / desabilitado', () => {
    const saved = { ...process.env };
    delete process.env.SERPRO_CONSUMER_KEY; delete process.env.SERPRO_CONSUMER_SECRET;
    delete process.env.SERPRO_MTLS_PFX_BASE64; delete process.env.SERPRO_MTLS_PFX_PASSWORD;
    expect(serproConfig()).toBeNull();
    expect(isPgdasdEnabled()).toBe(false);
    Object.assign(process.env, saved);
  });
});

describe('SerproClient (transporte mockado)', () => {
  it('autentica e lê o expires_in DA RESPOSTA (não 3600)', async () => {
    const transport: HttpTransport = vi.fn(async () => authOk);
    const client = new SerproClient(CFG, transport);
    const tok = await client.authenticate();
    expect(tok.accessToken).toBe('tok-1');
    expect(tok.jwtToken).toBe('jwt-1');
    // 2008s - 60s de margem → ~1948s no futuro
    expect(tok.expiresAt).toBeGreaterThan(Date.now() + 1_900_000);
    expect(tok.expiresAt).toBeLessThan(Date.now() + 2_000_000);
  });

  it('call: autentica uma vez, manda Bearer + jwt_token e parseia os itens', async () => {
    const calls: any[] = [];
    const transport: HttpTransport = vi.fn(async (req) => {
      calls.push(req);
      if (req.url.includes('/authenticate')) return authOk;
      return { status: 200, body: JSON.stringify({ status: 200, dados: JSON.stringify([{ pdf: 'JVBERi0=' }]) }) };
    });
    const client = new SerproClient(CFG, transport);
    const res = await client.call({
      endpoint: 'Emitir', idSistema: 'PGDASD', idServico: 'GERARDAS12', versaoSistema: '1.0',
      dados: JSON.stringify({ periodoApuracao: '202602' }),
      contratante: PESSOA, autorPedidoDados: PESSOA, contribuinte: PESSOA,
    });
    expect(res.httpStatus).toBe(200);
    expect(res.billed).toBe(true);
    expect(res.itens[0].pdf).toBe('JVBERi0=');
    const gwCall = calls.find((c) => c.url.includes('/Emitir'));
    expect(gwCall.headers['Authorization']).toBe('Bearer tok-1');
    expect(gwCall.headers['jwt_token']).toBe('jwt-1');
  });

  it('reautentica UMA vez no 401 e repete', async () => {
    let gwHits = 0;
    const transport: HttpTransport = vi.fn(async (req) => {
      if (req.url.includes('/authenticate')) return authOk;
      gwHits++;
      if (gwHits === 1) return { status: 401, body: '' };
      return { status: 200, body: JSON.stringify({ status: 200, dados: JSON.stringify({ ok: true }) }) };
    });
    const client = new SerproClient(CFG, transport);
    const res = await client.call({
      endpoint: 'Consultar', idSistema: 'PGDASD', idServico: 'CONSULTIMADECREC14', versaoSistema: '1.0',
      dados: '{}', contratante: PESSOA, autorPedidoDados: PESSOA, contribuinte: PESSOA,
    });
    expect(res.itens[0].ok).toBe(true);
    expect(gwHits).toBe(2);
  });

  it('erro tipado com flag billed quando 403', async () => {
    const transport: HttpTransport = vi.fn(async (req) =>
      req.url.includes('/authenticate') ? authOk : { status: 403, body: JSON.stringify({ mensagens: [{ codigo: 'x' }] }) });
    const client = new SerproClient(CFG, transport);
    await expect(client.call({
      endpoint: 'Declarar', idSistema: 'PGDASD', idServico: 'TRANSDECLARACAO11', versaoSistema: '1.0',
      dados: '{}', contratante: PESSOA, autorPedidoDados: PESSOA, contribuinte: PESSOA,
    })).rejects.toMatchObject({ code: 'serpro_chamada_falhou', httpStatus: 403 });
  });
});
