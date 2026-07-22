// Contrato de /v1/tenant/integrations/* (backend 0091).
//
// A API NUNCA devolve o valor de uma credencial — só `filled: boolean` e um
// rabicho mascarado (`••••a1b2`). Por isso a tela nunca tem estado "valor
// atual"; ver CredentialsDrawer.

export type IntegrationEnvironment = 'sandbox' | 'production';

/** Providers do catálogo de hoje. O `string & {}` mantém o autocomplete sem
 *  fechar o tipo: a tela é genérica sobre o catálogo do backend, então um
 *  provider novo aparece sozinho — sem release do frontend. */
export type ProviderKey =
  | 'serpro' | 'focus_nfe' | 'pluggy' | 'google_calendar'
  | (string & {});

export type CredentialFieldType = 'text' | 'password' | 'file';

export interface PublicCredentialField {
  key: string;
  label: string;
  type: CredentialFieldType;
  required: boolean;
  help?: string;
  /** Preenchida na configuração DESTE tenant (fallback de plataforma não conta). */
  filled: boolean;
  /** `••••a1b2` — últimos 4 caracteres do valor salvo. null para arquivos. */
  maskedHint: string | null;
}

/** Capacidade individual do provider, ligável em separado (backend 0092). */
export interface PublicProviderService {
  key: string;
  label: string;
  help?: string;
  enabled: boolean;
}

export interface LastPing {
  at: string;
  ok: boolean;
  message: string | null;
}

export interface PublicProviderCard {
  key: ProviderKey;
  label: string;
  description: string;
  moduleKey: string;
  environment: IntegrationEnvironment;
  services: PublicProviderService[];
  enabled: boolean;
  fields: PublicCredentialField[];
  requiredTotal: number;
  requiredFilled: number;
  /** Operacional: dá para chamar a integração. */
  configured: boolean;
  /** Funcionando pela configuração padrão do sistema, não pela do cliente. */
  usingPlatformFallback: boolean;
  lastPing: LastPing | null;
}

/** Resposta do ping — chega sempre em HTTP 200; `ok` é o resultado do teste. */
export interface PingResult {
  ok: boolean;
  message: string;
  httpStatus: number | null;
  latencyMs: number;
  errorCode: string | null;
}

export interface IntegrationLogRow {
  id: string;
  provider_key: string;
  environment: string | null;
  service: string;
  status: 'success' | 'error';
  http_status: number | null;
  latency_ms: number | null;
  error_code: string | null;
  detail: unknown;
  created_at: string;
}

export interface IntegrationLogsPage {
  logs: IntegrationLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Identidade de um card: o par (provider, ambiente) é a chave de rota da API. */
export const cardId = (c: Pick<PublicProviderCard, 'key' | 'environment'>): string =>
  `${c.key}:${c.environment}`;
