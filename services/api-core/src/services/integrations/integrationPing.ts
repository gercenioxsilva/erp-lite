// Ping de integração — "esta credencial funciona AGORA?" (0091).
//
// Princípios:
//  · BARATO: nenhum ping pode custar dinheiro nem sujar dado. Na SERPRO só
//    autenticamos — a cobrança incide sobre chamadas ao gateway (200/202/403 em
//    /Declarar|/Emitir|/Consultar), não sobre /authenticate.
//  · IDEMPOTENTE: só leitura. Nada de emitir nota de teste.
//  · SEM EXCEÇÃO PARA CIMA: devolve PingResult mesmo em falha de rede; quem
//    chama traduz para UI e log. Ping que estoura vira 500 e é exatamente o que
//    esta feature existe para eliminar.

import { SerproClient, type SerproConfig } from '../../lib/serproClient';
import type { IntegrationEnvironment, ProviderKey } from './catalog';

export interface PingResult {
  ok: boolean;
  /** Mensagem genérica, pronta para a tela (sem nome de env, sem stack). */
  message: string;
  httpStatus: number | null;
  latencyMs: number;
  errorCode: string | null;
  /**
   * O que foi enviado / o que voltou — vira os blocos REQUEST e RESPONSE no
   * detalhe do log. NUNCA inclua credencial aqui: além de não colocarmos,
   * integrationLogService.redact() varre por nome de chave antes de persistir.
   */
  request?: unknown;
  response?: unknown;
}

interface PingMeta { request?: unknown; response?: unknown }

const TIMEOUT_MS = 15_000;

/** fetch com timeout — sem isso um provider fora do ar pendura a requisição. */
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function fail(
  message: string, errorCode: string, httpStatus: number | null, startedAt: number, meta: PingMeta = {},
): PingResult {
  return { ok: false, message, errorCode, httpStatus, latencyMs: Date.now() - startedAt, ...meta };
}

function pass(
  message: string, httpStatus: number | null, startedAt: number, meta: PingMeta = {},
): PingResult {
  return { ok: true, message, errorCode: null, httpStatus, latencyMs: Date.now() - startedAt, ...meta };
}

/** Falha de transporte (DNS, TLS, timeout) — mensagem única para todas. */
function transportFailure(err: unknown, startedAt: number, request?: unknown): PingResult {
  const aborted = err instanceof Error && err.name === 'AbortError';
  return fail(
    aborted ? 'O provedor não respondeu a tempo. Tente novamente em instantes.'
            : 'Não foi possível alcançar o provedor. Verifique a conexão e tente novamente.',
    aborted ? 'timeout' : 'network_error',
    null, startedAt,
    // A causa técnica vai só para o log (bloco RESPONSE), nunca para a tela.
    { request, response: { error: String((err as Error)?.message ?? err) } },
  );
}

// ── SERPRO ───────────────────────────────────────────────────────────────────

async function pingSerpro(v: Record<string, string>, env: IntegrationEnvironment): Promise<PingResult> {
  const startedAt = Date.now();
  const cfg: SerproConfig = {
    // O catálogo fala 'sandbox|production'; a SERPRO fala 'trial|producao'.
    env: env === 'production' ? 'producao' : 'trial',
    consumerKey: v.consumer_key, consumerSecret: v.consumer_secret,
    pfxBase64: v.pfx_base64, pfxPassword: v.pfx_password,
  };
  const request = {
    url: 'https://autenticacao.sapi.serpro.gov.br/authenticate',
    method: 'POST', ambiente: cfg.env, grant_type: 'client_credentials',
    mtls: 'certificado e-CNPJ A1',
  };
  try {
    await new SerproClient(cfg).authenticate();
    return pass('Autenticação realizada com sucesso.', 200, startedAt,
      { request, response: { authenticated: true } });
  } catch (err) {
    const status = (err as { httpStatus?: number })?.httpStatus ?? null;
    const detail = (err as { detail?: unknown })?.detail ?? null;
    if (status === 401 || status === 403) {
      return fail('Credenciais recusadas pelo provedor. Confira a chave e o certificado.', 'unauthorized', status, startedAt,
        { request, response: detail });
    }
    // Senha errada do .pfx estoura no TLS, não em HTTP — vira erro de transporte
    // sem status. Diferenciar ajuda o usuário a olhar o campo certo.
    const msg = String((err as Error)?.message ?? '');
    if (/mac verify|pkcs12|passphrase|wrong tag/i.test(msg)) {
      return fail('Não foi possível abrir o certificado. Verifique o arquivo e a senha.', 'bad_certificate', null, startedAt,
        { request, response: { error: msg } });
    }
    if (status) {
      return fail('O provedor recusou a chamada.', 'request_failed', status, startedAt,
        { request, response: detail });
    }
    return transportFailure(err, startedAt, request);
  }
}

// ── Pluggy ───────────────────────────────────────────────────────────────────

async function pingPluggy(v: Record<string, string>, _env: IntegrationEnvironment): Promise<PingResult> {
  const startedAt = Date.now();
  if (v.client_id.startsWith('local-')) {
    return pass('Modo de simulação ativo — nenhuma chamada externa realizada.', null, startedAt,
      { request: { simulado: true }, response: { simulado: true } });
  }
  const base = (process.env.PLUGGY_BASE_URL || 'https://api.pluggy.ai').replace(/\/$/, '');
  const request = { url: `${base}/auth`, method: 'POST', body: { clientId: v.client_id } };
  try {
    const res = await fetchWithTimeout(`${base}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: v.client_id, clientSecret: v.client_secret }),
    });
    if (res.status === 401 || res.status === 403) {
      return fail('Credenciais recusadas pelo provedor.', 'unauthorized', res.status, startedAt,
        { request, response: { status: res.status } });
    }
    if (!res.ok) {
      return fail('O provedor recusou a chamada.', 'request_failed', res.status, startedAt,
        { request, response: { status: res.status } });
    }
    const body = await res.json().catch(() => null) as { apiKey?: string } | null;
    if (!body?.apiKey) {
      return fail('Resposta inesperada do provedor.', 'unexpected_response', res.status, startedAt,
        { request, response: { status: res.status, reason: 'sem apiKey na resposta' } });
    }
    // A apiKey em si NÃO entra no log — só a confirmação de que veio.
    return pass('Conexão validada com sucesso.', res.status, startedAt,
      { request, response: { status: res.status, apiKeyRecebida: true } });
  } catch (err) {
    return transportFailure(err, startedAt, request);
  }
}

// ── Google Calendar ──────────────────────────────────────────────────────────
// Google não tem client_credentials para validar um par client_id/secret. O
// truque legítimo: trocar um authorization_code deliberadamente inválido.
//   · client_id/secret ERRADOS → erro 'invalid_client'
//   · client_id/secret CERTOS  → erro 'invalid_grant' (só o code é ruim)
// Ou seja, invalid_grant É o sucesso deste ping. Nenhum efeito colateral: um
// code inválido não cria sessão nem consome nada.

async function pingGoogle(v: Record<string, string>): Promise<PingResult> {
  const startedAt = Date.now();
  const tokenUrl = process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
  const request = {
    url: tokenUrl, method: 'POST',
    body: { client_id: v.client_id, grant_type: 'authorization_code', code: 'ping-validation-only' },
    nota: 'code inválido de propósito: invalid_grant confirma que o par client_id/secret é válido',
  };
  try {
    const res = await fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: v.client_id, client_secret: v.client_secret,
        grant_type: 'authorization_code',
        code: 'ping-validation-only', redirect_uri: 'http://localhost',
      }).toString(),
    });
    const body = await res.json().catch(() => null) as { error?: string } | null;
    const response = { status: res.status, ...(body ?? {}) };
    if (body?.error === 'invalid_grant') {
      return pass('Credenciais válidas. A autorização de cada agenda é feita pelo profissional.', res.status, startedAt,
        { request, response });
    }
    if (body?.error === 'invalid_client') {
      return fail('Credenciais recusadas pelo Google. Confira o identificador e a chave.', 'unauthorized', res.status, startedAt,
        { request, response });
    }
    if (res.ok) return pass('Conexão validada com sucesso.', res.status, startedAt, { request, response });
    return fail('O provedor recusou a chamada.', 'request_failed', res.status, startedAt, { request, response });
  } catch (err) {
    return transportFailure(err, startedAt, request);
  }
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

export async function ping(
  key: ProviderKey, values: Record<string, string>, environment: IntegrationEnvironment,
): Promise<PingResult> {
  switch (key) {
    case 'serpro':          return pingSerpro(values, environment);
    case 'pluggy':          return pingPluggy(values, environment);
    case 'google_calendar': return pingGoogle(values);
  }
}
