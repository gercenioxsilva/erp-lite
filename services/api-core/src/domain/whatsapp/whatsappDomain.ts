// Domínio de WhatsApp — Cobranças e Notificações (migration 0067) — puro, sem
// I/O. Módulo opcional pago: mensagens de template disparadas por evento do
// ERP, via BSP (Twilio nesta fase). Credenciais são POR TENANT, nunca um app
// compartilhado da plataforma (mesmo padrão de bankAccountDomain.ts pro C6).

import { createHmac, timingSafeEqual } from 'crypto';

export class WhatsAppDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'WhatsAppDomainError';
  }
}

// Fixo pelo sistema — nunca editável pelo tenant (decisão deliberada do MVP,
// evita reprovação de template/uso indevido). Mesma lista usada nos CHECK
// constraints da migration 0067.
export const TEMPLATE_KEYS = [
  'invoice_due_soon',
  'invoice_overdue',
  'payment_confirmed',
  'fiscal_document_authorized',
  'proposal_sent',
] as const;
export type TemplateKey = typeof TEMPLATE_KEYS[number];

export function isTemplateKey(value: string): value is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(value);
}

// ── Normalização de telefone (E.164, Brasil) ────────────────────────────────
// Sem normalizador de telefone no backend ainda — clients.mobile/phone podem
// vir com ou sem DDI/pontuação. Aceita 10-11 dígitos locais (DDD + número) ou
// já com o 55 na frente; rejeita qualquer coisa fora desse formato em vez de
// adivinhar (mandar mensagem pro número errado é pior que não mandar).
export function toE164BR(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 12 || digits.length === 13) {
    if (digits.startsWith('55')) return `+${digits}`;
    return null;
  }
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return null;
}

// ── Interpolação segura de template ─────────────────────────────────────────
// Nunca eval/Function — só substituição textual de placeholders {{chave}}.
// Chave sem valor correspondente em `variables` vira string vazia (nunca
// quebra a interpolação, nunca deixa o placeholder cru vazar pro cliente).
export function interpolateTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => variables[key] ?? '');
}

// ── Opt-out ("SAIR") ─────────────────────────────────────────────────────────
// Resposta exata do cliente que revoga o consentimento — mesma palavra do
// texto padrão enviado em todo template ("Para não receber mais mensagens
// pelo WhatsApp, responda SAIR"). Case-insensitive, tolera espaço/pontuação
// ao redor, mas não interpreta frases livres (evita falso positivo).
export function isOptOutReply(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = text.trim().toUpperCase().replace(/[.!?]/g, '');
  return normalized === 'SAIR';
}

// ── Credenciais por provedor ─────────────────────────────────────────────────
export type WhatsAppCredentials = Record<string, string> | null | undefined;

/** Twilio: Account SID + Auth Token (Basic Auth na API de Messages). */
export function assertTwilioCredentials(credentials: WhatsAppCredentials): void {
  const missing = (['account_sid', 'auth_token'] as const).filter(k => !credentials?.[k]?.trim());
  if (missing.length > 0) {
    throw new WhatsAppDomainError('invalid_credentials', { provider: 'twilio', missing });
  }
}

/** Despacha pro validador certo — só 'twilio' implementado nesta fase. */
export function assertProviderCredentials(provider: string, credentials: WhatsAppCredentials): void {
  if (provider === 'twilio') return assertTwilioCredentials(credentials);
  throw new WhatsAppDomainError('unsupported_provider', { provider });
}

// ── Elegibilidade de envio ───────────────────────────────────────────────────
export interface SendEligibilityContext {
  accountStatus:   string | null;      // whatsapp_accounts.status
  templateStatus:  string | null;      // whatsapp_message_templates.status pra este template_key
  automationEnabled: boolean;          // whatsapp_automations.enabled pra este template_key
  clientOptIn:     boolean;            // clients.whatsapp_opt_in
  phone:           string | null;      // já normalizado (toE164BR) ou null se inválido/ausente
}

/**
 * Único ponto de decisão "pode mandar esta mensagem?" — checa todas as
 * condições de uma vez (conta conectada, template aprovado, automação
 * ligada, cliente consentiu, telefone válido) e lança com o código exato do
 * que falhou, nunca um genérico. Nenhuma rota/worker deve enviar sem passar
 * por aqui antes.
 */
export function assertCanSend(ctx: SendEligibilityContext): void {
  if (ctx.accountStatus !== 'connected') {
    throw new WhatsAppDomainError('account_not_connected', { accountStatus: ctx.accountStatus });
  }
  if (ctx.templateStatus !== 'approved') {
    throw new WhatsAppDomainError('template_not_approved', { templateStatus: ctx.templateStatus });
  }
  if (!ctx.automationEnabled) {
    throw new WhatsAppDomainError('automation_disabled');
  }
  if (!ctx.clientOptIn) {
    throw new WhatsAppDomainError('client_not_opted_in');
  }
  if (!ctx.phone) {
    throw new WhatsAppDomainError('invalid_phone');
  }
}

// ── Config de automação por template ────────────────────────────────────────
export interface DueSoonConfig { days_before: number; }
export interface OverdueConfig { days_after: number; }

/** `invoice_due_soon`/`invoice_overdue` exigem `config` com dias positivos;
 * os outros 3 templates disparam na hora do evento, sem config nenhuma. */
export function assertValidAutomationConfig(templateKey: TemplateKey, config: Record<string, unknown>): void {
  if (templateKey === 'invoice_due_soon') {
    const days = Number(config.days_before);
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      throw new WhatsAppDomainError('invalid_automation_config', { templateKey, field: 'days_before' });
    }
  }
  if (templateKey === 'invoice_overdue') {
    const days = Number(config.days_after);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new WhatsAppDomainError('invalid_automation_config', { templateKey, field: 'days_after' });
    }
  }
}

// ── Assinatura de webhook (Twilio) ───────────────────────────────────────────
// Implementação manual (sem SDK `twilio`, regra 5 — evitar dependência nova
// só por uma função) do algoritmo documentado: HMAC-SHA1 de
// `url + concatenação ordenada alfabeticamente de "chave" + "valor"` de todo
// campo do POST, base64, comparado ao header X-Twilio-Signature com
// timingSafeEqual (nunca ===, previne timing attack — mesmo cuidado já usado
// em marketplaceDomain.ts::verifyState). `url` é sempre montada a partir de
// APP_URL (nunca request.protocol/hostname) — trás um proxy (CloudFront/NLB),
// esses campos podem não bater com a URL que o Twilio realmente assinou.
export function verifyTwilioSignature(
  url: string, params: Record<string, string>, signatureHeader: string | undefined, authToken: string,
): boolean {
  if (!signatureHeader || !authToken) return false;

  const data = Object.keys(params).sort().reduce(
    (acc, key) => acc + key + params[key], url,
  );
  const expected = createHmac('sha1', authToken).update(data, 'utf8').digest('base64');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
