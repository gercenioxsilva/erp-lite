import axios, { AxiosInstance } from 'axios';
import type { BoletoAdapter, BoletoPayload } from './index';
import type { BoletoResult } from '../lib/types';

interface TokenCache {
  token:   string;
  expiresAt: number; // epoch ms
}

export class ItauAdapter implements BoletoAdapter {
  private tokenCache: TokenCache | null = null;
  private readonly http: AxiosInstance;

  constructor(
    private readonly clientId:     string,
    private readonly clientSecret: string,
    private readonly baseUrl:      string,
    private readonly authUrl:      string,
  ) {
    if (!clientId || !clientSecret) {
      throw new Error(
        'Itaú adapter: ITAU_CLIENT_ID e ITAU_CLIENT_SECRET são obrigatórios. ' +
        'Configure as credenciais da API Itaú Empresas no ambiente da Lambda.'
      );
    }
    this.http = axios.create({ baseURL: baseUrl, timeout: 30_000 });
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }

    const params = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     this.clientId,
      client_secret: this.clientSecret,
    });

    const resp = await axios.post<{ access_token: string; expires_in: number }>(
      this.authUrl,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 }
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

    // id_beneficiario = agency (4 digits) + account digits (without dash)
    const contaDigitos = banking.account.replace('-', '') + banking.account_digit;
    const idBeneficiario = `${banking.agency.padStart(4, '0')}${contaDigitos}`;

    const expires = new Date(due_date);
    expires.setDate(expires.getDate() + days_to_expire);
    const expiresStr = expires.toISOString().slice(0, 10);

    const body = {
      etapa_processo_boleto: 'efetivacao',
      beneficiario: { id_beneficiario: idBeneficiario },
      dado_boleto: {
        tipo_boleto: 'avulso',
        data_limite: expiresStr,
        sacado_avalista: {
          tipo_pessoa: { codigo_tipo_pessoa: 'J' },
          nome_completo: description.slice(0, 80),
        },
        dados_individuais_boleto: [{
          data_vencimento: due_date,
          valor_titulo:    amount,
          texto_seu_numero: description.slice(0, 40),
          texto_uso_banco:  description.slice(0, 40),
        }],
      },
    };

    const resp = await this.http.post<ItauBoletoResponse>(
      '/cobrancas/v2/boletos',
      body,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    const d = resp.data;
    const individual = d.data?.dado_boleto?.dados_individuais_boleto?.[0];
    const pixEmv = d.data?.dado_boleto?.pix?.emv ?? '';

    const nossoNumero = individual?.numero_nosso_numero
      ?? d.data?.dado_boleto?.dados_individuais_boleto?.[0]?.numero_nosso_numero
      ?? '';

    const boletoUrl = d.data?.link_download_boleto ?? d.data?.link_boleto_eletronico ?? '';

    return {
      external_id:  d.id ?? d.data?.id_boleto ?? '',
      nosso_numero: nossoNumero,
      brcode:       pixEmv,
      boleto_url:   boletoUrl,
      issued_at:    new Date().toISOString(),
      expires_at:   expiresStr,
    };
  }
}

// Minimal response shape from Itaú /cobrancas/v2/boletos
interface ItauBoletoResponse {
  id?: string;
  data?: {
    id_boleto?: string;
    link_download_boleto?: string;
    link_boleto_eletronico?: string;
    dado_boleto?: {
      pix?: { emv?: string };
      dados_individuais_boleto?: Array<{ numero_nosso_numero?: string }>;
    };
  };
}
