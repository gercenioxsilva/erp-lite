// Cliente SERPRO Integra Contador (PGDAS-D) — mTLS via node:https, ZERO deps
// novas. Molde de gating do anthropicClient: sem credenciais no ambiente a rota
// devolve 503. As credenciais ficam em ENV (não em tabela): o e-CNPJ do mTLS
// TEM de ser o mesmo usado para contratar na loja SERPRO — acoplar ao cert da
// NFS-e faria rotacionar um quebrar o outro; e cifrar o secret aqui enquanto
// fiscal_certificates guarda .pfx em texto puro seria falsa sensação de
// segurança (KMS é uma fase separada, para os dois juntos).
//
// Armadilhas embutidas (verificadas na doc SERPRO):
//   - response.dados é uma STRING com JSON dentro (duplo parse) e a FORMA varia
//     por serviço: GERARDAS12 → ARRAY [{pdf}], outros podem ser OBJECT.
//   - expires_in NÃO é 3600 (o exemplo devolve 2008) — ler da resposta. Não há
//     refresh_token; access_token é UUID opaco.
//   - HTTP 403 É COBRADO (permissão mal configurada custa dinheiro).

import https from 'node:https';

export interface SerproConfig {
  env: 'producao' | 'trial';
  consumerKey: string;
  consumerSecret: string;
  pfxBase64: string;
  pfxPassword: string;
}

/** Lê a config do ENV; null = desabilitado (rota → 503). */
export function serproConfig(): SerproConfig | null {
  const key = process.env.SERPRO_CONSUMER_KEY;
  const secret = process.env.SERPRO_CONSUMER_SECRET;
  const pfx = process.env.SERPRO_MTLS_PFX_BASE64;
  const pass = process.env.SERPRO_MTLS_PFX_PASSWORD;
  if (!key || !secret || !pfx || !pass) return null;
  return {
    env: process.env.SERPRO_ENV === 'producao' ? 'producao' : 'trial',
    consumerKey: key, consumerSecret: secret, pfxBase64: pfx, pfxPassword: pass,
  };
}

export function isPgdasdEnabled(): boolean {
  return serproConfig() !== null;
}

const AUTH_URL = 'https://autenticacao.sapi.serpro.gov.br/authenticate';
const GATEWAY = {
  producao: 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1',
  trial:    'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1',
} as const;

/** 200/202/403 são COBRADOS pela SERPRO; o resto não. */
export function isBilled(httpStatus: number): boolean {
  return httpStatus === 200 || httpStatus === 202 || httpStatus === 403;
}

export class SerproError extends Error {
  constructor(public code: string, public httpStatus: number, public detail: unknown = null) {
    super(code);
    this.name = 'SerproError';
  }
}

/** `dados` da resposta: STRING JSON (duplo parse), normalizada para ARRAY. */
export function parseSerproDados(responseBody: string): { status: number | null; itens: any[]; mensagens: any[] } {
  let outer: any;
  try {
    outer = JSON.parse(responseBody);
  } catch {
    throw new SerproError('serpro_resposta_nao_json', 0, responseBody.slice(0, 200));
  }
  const mensagens = Array.isArray(outer?.mensagens) ? outer.mensagens : [];
  const status = typeof outer?.status === 'number' ? outer.status : null;
  if (outer?.dados == null) return { status, itens: [], mensagens };

  let dados: unknown = outer.dados;
  if (typeof dados === 'string') {
    try { dados = JSON.parse(dados); }
    catch { throw new SerproError('serpro_dados_nao_json', 0, String(outer.dados).slice(0, 200)); }
  }
  const itens = Array.isArray(dados) ? dados : [dados];
  return { status, itens, mensagens };
}

/** Transporte injetável — o default usa node:https (mTLS). Testes mockam. */
export type HttpTransport = (req: {
  method: 'POST'; url: string; headers: Record<string, string>; body: string;
  pfxBase64: string; pfxPassword: string;
}) => Promise<{ status: number; body: string }>;

const nodeHttpsTransport: HttpTransport = (req) => new Promise((resolve, reject) => {
  const u = new URL(req.url);
  const r = https.request({
    method: req.method, hostname: u.hostname, path: u.pathname + u.search,
    port: u.port || 443, headers: req.headers,
    pfx: Buffer.from(req.pfxBase64, 'base64'), passphrase: req.pfxPassword,
  }, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
  });
  r.on('error', reject);
  r.write(req.body);
  r.end();
});

interface CachedToken { accessToken: string; jwtToken: string | null; expiresAt: number; }

export interface SerproCallResult {
  httpStatus: number;
  billed: boolean;
  itens: any[];
  mensagens: any[];
  raw: string;
}

/** Pessoa (contratante/autor/contribuinte) do envelope Integra Contador. */
export interface Pessoa { numero: string; tipo: 1 | 2; } // tipo 2 = PJ (CNPJ)

export class SerproClient {
  private token: CachedToken | null = null;

  constructor(private cfg: SerproConfig, private transport: HttpTransport = nodeHttpsTransport) {}

  private gateway(): string { return GATEWAY[this.cfg.env]; }

  /** Autentica (mTLS + Basic) e cacheia o token com o expires_in DA RESPOSTA. */
  async authenticate(): Promise<CachedToken> {
    const basic = Buffer.from(`${this.cfg.consumerKey}:${this.cfg.consumerSecret}`).toString('base64');
    const { status, body } = await this.transport({
      method: 'POST', url: AUTH_URL,
      headers: {
        'Authorization': `Basic ${basic}`,
        'Role-Type': 'TERCEIROS',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      pfxBase64: this.cfg.pfxBase64, pfxPassword: this.cfg.pfxPassword,
    });
    if (status !== 200) throw new SerproError('serpro_auth_falhou', status, body.slice(0, 300));

    let parsed: any;
    try { parsed = JSON.parse(body); }
    catch { throw new SerproError('serpro_auth_resposta_invalida', status, body.slice(0, 200)); }
    if (!parsed?.access_token) throw new SerproError('serpro_auth_sem_token', status, null);

    // expires_in vem em segundos e NÃO é 3600 — margem de 60s para não usar um
    // token à beira de expirar. Data.now() não está disponível em domínio puro,
    // mas aqui (lib de I/O) é legítimo.
    const ttlMs = Math.max(0, (Number(parsed.expires_in) || 0) - 60) * 1000;
    this.token = {
      accessToken: parsed.access_token,
      jwtToken: parsed.jwt_token ?? null,
      expiresAt: Date.now() + ttlMs,
    };
    return this.token;
  }

  private async ensureToken(): Promise<CachedToken> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token;
    return this.authenticate();
  }

  /** Chama um serviço (/Declarar|/Emitir|/Consultar) e devolve os itens parseados. */
  async call(args: {
    endpoint: 'Declarar' | 'Emitir' | 'Consultar' | 'Apoiar' | 'Monitorar';
    idSistema: string; idServico: string; versaoSistema: string;
    dados: string;                 // já JSON-string (payloadDomain.serializeDados)
    contratante: Pessoa; autorPedidoDados: Pessoa; contribuinte: Pessoa;
  }): Promise<SerproCallResult> {
    const token = await this.ensureToken();
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
    };
    if (token.jwtToken) headers['jwt_token'] = token.jwtToken;

    const envelope = {
      contratante: args.contratante,
      autorPedidoDados: args.autorPedidoDados,
      contribuinte: args.contribuinte,
      pedidoDados: {
        idSistema: args.idSistema, idServico: args.idServico,
        versaoSistema: args.versaoSistema, dados: args.dados,
      },
    };

    let { status, body } = await this.transport({
      method: 'POST', url: `${this.gateway()}/${args.endpoint}`,
      headers, body: JSON.stringify(envelope),
      pfxBase64: this.cfg.pfxBase64, pfxPassword: this.cfg.pfxPassword,
    });

    // 401 = token expirado/inválido: reautentica UMA vez e repete.
    if (status === 401) {
      const fresh = await this.authenticate();
      const retryHeaders: Record<string, string> = {
        'Authorization': `Bearer ${fresh.accessToken}`, 'Content-Type': 'application/json',
      };
      if (fresh.jwtToken) retryHeaders['jwt_token'] = fresh.jwtToken;
      ({ status, body } = await this.transport({
        method: 'POST', url: `${this.gateway()}/${args.endpoint}`,
        headers: retryHeaders, body: JSON.stringify(envelope),
        pfxBase64: this.cfg.pfxBase64, pfxPassword: this.cfg.pfxPassword,
      }));
    }

    const billed = isBilled(status);
    if (status !== 200 && status !== 202) {
      const parsed = safeParse(body);
      throw new SerproError('serpro_chamada_falhou', status, { billed, body: parsed ?? body.slice(0, 300) });
    }
    const { itens, mensagens } = parseSerproDados(body);
    return { httpStatus: status, billed, itens, mensagens, raw: body };
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
