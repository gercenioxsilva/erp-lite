// Catálogo de integrações — FORMA em código, VALOR em banco (0091).
//
// Por que não em tabela: "quais campos o provider X tem" é estrutura, não dado
// do cliente. Em tabela, cada provider novo viraria migration + seed, e um seed
// errado quebraria a tela em produção sem erro de compilação. Aqui o TypeScript
// garante que provider e campo existem.
//
// REGRA DE ROTULAGEM: `label` e `help` são a linguagem do CLIENTE e aparecem na
// UI. NUNCA cite nome de variável de ambiente neles — a decisão de produto é
// mensagem sempre genérica (2026-07-22). O acoplamento com o ENV existe só em
// `envFallback`, que é interno e nunca é serializado pela API (ver
// toPublicProvider() em integrationService.ts).

import type { ModuleKey } from '../tenantModuleService';

export type IntegrationEnvironment = 'sandbox' | 'production';

export const ENVIRONMENTS: readonly IntegrationEnvironment[] = ['sandbox', 'production'] as const;

export type CredentialFieldType = 'text' | 'password' | 'file';

export interface CredentialField {
  /** Chave dentro do JSONB `credentials`. */
  key: string;
  /** Rótulo exibido na UI — linguagem de negócio, sem jargão de infra. */
  label: string;
  type: CredentialFieldType;
  required: boolean;
  help?: string;
  /**
   * ENV de plataforma equivalente, usada como fallback quando o tenant ainda
   * não configurou a própria credencial. INTERNO — nunca sai pela API.
   * Quando o valor depende do ambiente, use [sandbox, production].
   */
  envFallback?: string | { sandbox: string; production: string };
}

/**
 * Capacidade individual de um provider, ligável em separado (0092). A `key` é
 * o que o gate no código consulta (assertServiceEnabled); o `label` é o que a
 * tela mostra. Nunca renomeie uma `key` já usada em produção — ela está gravada
 * em integration_providers.enabled_services.
 */
export interface ProviderService {
  key: string;
  label: string;
  /** Explica o risco de manter ligado, quando há um. */
  help?: string;
}

export interface ProviderDefinition {
  key: ProviderKey;
  label: string;
  /** Módulo do tenant_modules que esta integração serve. */
  moduleKey: ModuleKey;
  /** Uma linha, mostrada abaixo do título do card. */
  description: string;
  /** Ambientes com card próprio. Google OAuth não tem sandbox real. */
  environments: readonly IntegrationEnvironment[];
  /** Capacidades ligáveis: chips no card, switches no drawer. */
  services: readonly ProviderService[];
  credentials: readonly CredentialField[];
}

// Focus NF-e ficou DE FORA por ora (decisão 2026-07-22): a emissão está
// funcionando em produção pelo token mestre e o risco de mexer não se paga
// agora. O código já suporta token por-empresa em nfe_configs — quando for a
// hora, é só acrescentar a entrada aqui e trocar a leitura do process.env em
// services/fiscal/fiscalIntegrationClient.ts.
export const PROVIDER_KEYS = ['serpro', 'pluggy', 'google_calendar'] as const;
export type ProviderKey = typeof PROVIDER_KEYS[number];

export const CATALOG: Readonly<Record<ProviderKey, ProviderDefinition>> = {
  // ── SERPRO Integra Contador ────────────────────────────────────────────────
  // Por tenant por decisão de contratação (2026-07-22): cada empresa contrata a
  // própria na loja SERPRO. Isso torna o envelope atual CORRETO — contratante =
  // autorPedidoDados = contribuinte = CNPJ da própria empresa (auto-declaração,
  // sem procuração e-CAC).
  serpro: {
    key: 'serpro',
    label: 'SERPRO Integra Contador',
    moduleKey: 'fiscal',
    description: 'Transmissão do PGDAS-D e emissão do DAS direto na Receita Federal.',
    environments: ENVIRONMENTS,
    services: [
      {
        key: 'transmitir_pgdasd', label: 'Transmissão PGDAS-D',
        help: 'Ato IRREVERSÍVEL perante a Receita. Desligue para usar só conferência e DAS.',
      },
      { key: 'gerar_das', label: 'Geração de DAS' },
      { key: 'consultar_declaracoes', label: 'Consulta de declarações' },
    ],
    credentials: [
      {
        key: 'consumer_key', label: 'Consumer Key', type: 'text', required: true,
        help: 'Fornecida na loja SERPRO ao contratar o Integra Contador.',
        envFallback: 'SERPRO_CONSUMER_KEY',
      },
      {
        key: 'consumer_secret', label: 'Consumer Secret', type: 'password', required: true,
        envFallback: 'SERPRO_CONSUMER_SECRET',
      },
      {
        key: 'pfx_base64', label: 'Certificado e-CNPJ A1 (.pfx)', type: 'file', required: true,
        help: 'Precisa ser o certificado do MESMO CNPJ que contratou na loja SERPRO.',
        envFallback: 'SERPRO_MTLS_PFX_BASE64',
      },
      {
        key: 'pfx_password', label: 'Senha do certificado', type: 'password', required: true,
        envFallback: 'SERPRO_MTLS_PFX_PASSWORD',
      },
    ],
  },

  // ── Pluggy (Open Finance) ──────────────────────────────────────────────────
  pluggy: {
    key: 'pluggy',
    label: 'Pluggy (Open Finance)',
    moduleKey: 'fiscal',
    description: 'Conexão bancária automática para extrato, saldo e conciliação.',
    environments: ENVIRONMENTS,
    services: [
      { key: 'conexao_bancaria', label: 'Conexão bancária' },
      { key: 'sincronizacao_extrato', label: 'Sincronização de extrato' },
      {
        key: 'conciliacao_automatica', label: 'Conciliação automática',
        help: 'Desligado, o extrato é importado mas a baixa fica manual.',
      },
    ],
    credentials: [
      {
        key: 'client_id', label: 'Client ID', type: 'text', required: true,
        help: 'Obtido no painel da Pluggy.',
        envFallback: 'PLUGGY_CLIENT_ID',
      },
      {
        key: 'client_secret', label: 'Client Secret', type: 'password', required: true,
        envFallback: 'PLUGGY_CLIENT_SECRET',
      },
    ],
  },

  // ── Google Calendar ────────────────────────────────────────────────────────
  // Só 'production': o escopo calendar.events é sensível e exige app VERIFICADO
  // no Google Cloud — não existe sandbox equivalente, apenas a lista de test
  // users do modo de teste, que não é um ambiente separado.
  google_calendar: {
    key: 'google_calendar',
    label: 'Google Calendar',
    moduleKey: 'scheduling',
    description: 'Espelha os agendamentos na agenda Google de cada profissional.',
    environments: ['production'],
    services: [
      { key: 'sincronizacao_agenda', label: 'Sincronização de agenda' },
      { key: 'criacao_eventos', label: 'Criação de eventos' },
    ],
    credentials: [
      {
        key: 'client_id', label: 'Client ID do OAuth', type: 'text', required: true,
        help: 'Credencial OAuth 2.0 do tipo Aplicativo Web, criada no Google Cloud Console.',
        envFallback: 'GOOGLE_CLIENT_ID',
      },
      {
        key: 'client_secret', label: 'Client Secret do OAuth', type: 'password', required: true,
        envFallback: 'GOOGLE_CLIENT_SECRET',
      },
    ],
  },
};

export function isProviderKey(value: string): value is ProviderKey {
  return (PROVIDER_KEYS as readonly string[]).includes(value);
}

export function isEnvironment(value: string): value is IntegrationEnvironment {
  return (ENVIRONMENTS as readonly string[]).includes(value);
}

/** Ambiente é válido PARA ESTE provider (Google não tem sandbox). */
export function supportsEnvironment(key: ProviderKey, env: IntegrationEnvironment): boolean {
  return CATALOG[key].environments.includes(env);
}

export function requiredFields(key: ProviderKey): readonly CredentialField[] {
  return CATALOG[key].credentials.filter(f => f.required);
}

export function isServiceKey(key: ProviderKey, serviceKey: string): boolean {
  return CATALOG[key].services.some(s => s.key === serviceKey);
}
