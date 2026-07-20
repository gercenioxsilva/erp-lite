// Domínio de Captação de Leads (migration 0084) — puro, sem I/O. Governa a
// entrada anônima de um formulário de landing page: entrada mínima e solta
// (nome + pelo menos um contato), nunca os mesmos campos rígidos do cadastro
// completo de cliente (regime tributário, endereço fiscal etc. — isso o
// próprio tenant completa depois, no backoffice, se qualificar o lead).

export class LeadCaptureDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'LeadCaptureDomainError';
  }
}

export interface LeadCaptureInput {
  name?:         string;
  email?:        string;
  phone?:        string;
  company_name?: string;
  cnpj?:         string;
  message?:      string;
}

export interface NormalizedLead {
  person_type:   'PJ' | 'PF';
  full_name:     string | null;
  company_name:  string | null;
  email:         string | null;
  phone:         string | null;
  cnpj:          string | null;
  notes:         string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Valida e normaliza a entrada de um formulário de landing page. Nunca
 * aceita os campos completos de `clients` (regime tributário, IE, endereço
 * fiscal...) — só o suficiente pra identificar e contatar o lead. PJ é
 * inferido pela presença de company_name/cnpj (nunca perguntado
 * explicitamente — landing page não tem esse campo na maioria dos casos).
 */
export function validateAndNormalizeLead(input: LeadCaptureInput): NormalizedLead {
  const name = input.name?.trim();
  if (!name) throw new LeadCaptureDomainError('lead_name_required');

  const email = input.email?.trim() ? input.email.trim() : null;
  if (email && !EMAIL_RE.test(email)) throw new LeadCaptureDomainError('lead_email_invalid');

  const phone = input.phone?.trim() ? input.phone.trim() : null;
  if (!email && !phone) throw new LeadCaptureDomainError('lead_contact_required');

  const cnpj = input.cnpj?.trim() ? input.cnpj.trim() : null;
  const companyName = input.company_name?.trim() ? input.company_name.trim() : null;
  const isPJ = Boolean(cnpj || companyName);

  return {
    person_type:  isPJ ? 'PJ' : 'PF',
    full_name:    isPJ ? null : name,
    company_name: isPJ ? (companyName ?? name) : null,
    email:        email ? normalizeEmail(email) : null,
    phone,
    cnpj,
    notes:        input.message?.trim() ? input.message.trim() : null,
  };
}
