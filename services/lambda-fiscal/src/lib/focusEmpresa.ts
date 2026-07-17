import axios, { AxiosInstance, AxiosError } from 'axios';

// Cliente para o cadastro de empresa no emissor fiscal (POST /v2/empresas) —
// distinto de FocusNfeClient/FocusNfseClient (lib/focusNfe.ts), que emitem
// documentos fiscais. Este endpoint é síncrono do lado do Focus (responde
// criado/erro na hora, sem 'processando'); o async fica só do nosso lado
// (fila SQS), regra 70.

export interface FocusEmpresaResponse {
  id?:                     number | string;
  cnpj?:                   string;
  token_producao?:         string;
  token_homologacao?:      string;
  certificado_valido_de?:  string;
  certificado_valido_ate?: string;
  certificado_cnpj?:       string;
  erros?: Array<{ codigo?: string; mensagem: string }>;
  codigo?:   string;
  mensagem?: string;
}

// Mesmo prefixo de simulação local usado em lib/focusNfe.ts.
const SIMULATE_PREFIX = 'local-';

export class FocusEmpresaClient {
  private http: AxiosInstance;
  private simulate: boolean;
  private simulateReject: boolean;

  constructor(token: string, ambiente: 1 | 2) {
    this.simulate       = token.toLowerCase().startsWith(SIMULATE_PREFIX);
    this.simulateReject = /reject/i.test(token);

    const baseURL = ambiente === 1
      ? 'https://api.focusnfe.com.br'
      : 'https://homologacao.focusnfe.com.br';

    this.http = axios.create({
      baseURL,
      auth:    { username: token, password: '' },
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private simulatedCreated(payload: { cnpj?: string }): FocusEmpresaResponse {
    return {
      id:                'demo-' + (payload.cnpj ?? '00000000000000'),
      cnpj:              payload.cnpj,
      token_producao:    'local-prod-' + (payload.cnpj ?? 'token'),
      token_homologacao: 'local-homolog-' + (payload.cnpj ?? 'token'),
    };
  }

  async criar(payload: Record<string, unknown>): Promise<FocusEmpresaResponse> {
    if (this.simulate) {
      if (this.simulateReject) {
        return { erros: [{ codigo: '400', mensagem: 'Cadastro simulado (homologação local): CNPJ inválido' }] };
      }
      return this.simulatedCreated(payload as { cnpj?: string });
    }

    try {
      const res = await this.http.post('/v2/empresas', payload);
      return res.data as FocusEmpresaResponse;
    } catch (err) {
      const e = err as AxiosError<FocusEmpresaResponse>;
      if (e.response?.data) return e.response.data;
      throw err;
    }
  }
}
