import https from 'https';
import axios, { AxiosInstance } from 'axios';
import type { BoletoAdapter, BoletoPayload } from './index';
import type { BoletoResult } from '../lib/types';

// ── C6 Bank — Boleto API ─────────────────────────────────────────────────────
// Diferente do Itaú (OAuth2 client_credentials puro), o C6 exige mTLS: um par
// de certificado (.crt) e chave privada (.key), autogerado pelo próprio
// tenant no PJ Internet Banking dele (Soluções para sua empresa > Nova
// Integração), validade de 12 meses, sem exigir ICP-Brasil. O mTLS se aplica
// na sessão HTTPS inteira (inclusive na troca de token), não só num endpoint.
//
// Credenciais são POR TENANT (client_id/client_secret/cert/key de cada tenant
// no próprio C6), nunca um app compartilhado da plataforma — diferente do
// ItauAdapter hoje, que usa um único app Itaú via env var da Lambda para
// todos os tenants. Por isso este adapter é construído por REQUEST, a partir
// de `payload.banking.credentials` (ver plugins/banks.ts), não a partir de
// `app.config`.
//
// ATENÇÃO — pendente de confirmação: o portal developers.c6bank.com.br exige
// cadastro/homologação da empresa para liberar a especificação técnica
// completa (URL exata de sandbox/produção, schema de request/response do
// endpoint de registro de boleto). O fluxo de autenticação (OAuth2
// client_credentials + mTLS) é confirmado pela pesquisa pública; o payload de
// `emit()` abaixo segue a convenção mais comum entre APIs de boleto
// registrado no Brasil (mesmo vocabulário do ItauAdapter: beneficiário,
// pagador, dados do título) mas PRECISA ser validado contra o OpenAPI real do
// C6 antes de qualquer uso em produção — não tratar como contrato confirmado.

export interface C6Credentials {
  client_id: string;
  client_secret: string;
  cert: string;
  key: string;
}

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

export class C6Adapter implements BoletoAdapter {
  private tokenCache: TokenCache | null = null;
  private readonly http: AxiosInstance;

  constructor(
    private readonly credentials: C6Credentials,
    private readonly baseUrl: string,
    private readonly authUrl: string,
  ) {
    const missing = (['client_id', 'client_secret', 'cert', 'key'] as const)
      .filter(k => !credentials[k]?.trim());
    if (missing.length > 0) {
      throw new Error(
        `C6 adapter: credenciais incompletas (faltando: ${missing.join(', ')}). ` +
        'Cada tenant precisa cadastrar seu client_id/client_secret/certificado C6 ' +
        '(gerados no PJ Internet Banking do próprio tenant) em Minha Empresa > Dados Bancários.'
      );
    }
    if (!baseUrl || !authUrl) {
      throw new Error(
        'C6 adapter: URLs de API não configuradas (C6_BASE_URL/C6_AUTH_URL). ' +
        'Essas URLs ainda não foram confirmadas no ambiente desta Lambda — ' +
        'requer acesso ao portal developers.c6bank.com.br (cadastro + homologação).'
      );
    }

    // mTLS na sessão inteira — inclusive na troca de token (getToken usa
    // this.http, não axios global, diferente do ItauAdapter que não precisa
    // de certificado nenhum).
    const httpsAgent = new https.Agent({
      cert: credentials.cert,
      key:  credentials.key,
    });
    this.http = axios.create({ baseURL: baseUrl, timeout: 30_000, httpsAgent });
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }

    const params = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     this.credentials.client_id,
      client_secret: this.credentials.client_secret,
    });

    // authUrl pode ser um host diferente do baseUrl — usa o mesmo httpsAgent
    // (mTLS) da instância axios configurada no construtor.
    const resp = await this.http.post<{ access_token: string; expires_in: number }>(
      this.authUrl,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
    );

    this.tokenCache = {
      token:     resp.data.access_token,
      expiresAt: now + resp.data.expires_in * 1_000,
    };
    return this.tokenCache.token;
  }

  async emit(payload: BoletoPayload): Promise<BoletoResult> {
    const token = await this.getToken();
    const { banking, amount, due_date, description, days_to_expire } = payload;

    const expires = new Date(due_date);
    expires.setDate(expires.getDate() + days_to_expire);
    const expiresStr = expires.toISOString().slice(0, 10);

    // PENDENTE DE CONFIRMAÇÃO — ver aviso no topo do arquivo. Endpoint e
    // shape do body seguem a convenção mais comum de boleto registrado
    // (mesmo vocabulário do ItauAdapter), não o contrato oficial do C6.
    const body = {
      conta_corrente: { agencia: banking.agency, numero: banking.account, digito: banking.account_digit },
      pagador: { nome: description.slice(0, 80) },
      titulo: {
        data_vencimento: due_date,
        data_limite_pagamento: expiresStr,
        valor: amount,
        seu_numero: description.slice(0, 40),
      },
    };

    const resp = await this.http.post<C6BoletoResponse>(
      '/v1/boletos',
      body,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );

    const d = resp.data;

    return {
      external_id:  d.id ?? '',
      nosso_numero: d.nosso_numero ?? '',
      brcode:       d.pix?.emv ?? '',
      boleto_url:   d.link_boleto ?? '',
      issued_at:    new Date().toISOString(),
      expires_at:   expiresStr,
    };
  }
}

// Shape de resposta ainda não confirmado contra o OpenAPI real do C6 — ver
// aviso no topo do arquivo.
interface C6BoletoResponse {
  id?: string;
  nosso_numero?: string;
  link_boleto?: string;
  pix?: { emv?: string };
}
