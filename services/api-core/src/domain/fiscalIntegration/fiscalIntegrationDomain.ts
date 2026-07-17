// Domínio de Integração Fiscal (regra 70) — puro, sem I/O. Governa o registro
// automatizado de uma empresa (nfe_configs) no emissor fiscal e o upload do
// certificado digital A1. Nunca menciona "Focus" — pro tenant isso é só "a
// integração de emissão de notas fiscais"; o nome do provedor é um detalhe
// de infraestrutura interno (services/*/lib/focusNfe.ts, focusEmpresa.ts).

export class FiscalIntegrationDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'FiscalIntegrationDomainError';
  }
}

export type FiscalRegistrationStatus = 'pending' | 'processing' | 'registered' | 'error' | null;

/** Um novo registro não pode ser disparado enquanto o anterior ainda está em voo. */
export function assertCanRegister(status: FiscalRegistrationStatus): void {
  if (status === 'pending' || status === 'processing') {
    throw new FiscalIntegrationDomainError('registration_in_progress', { status });
  }
}

/** Upload de certificado e teste de conexão exigem a empresa já registrada. */
export function assertCanUploadCertificate(fiscalIntegrationRef: string | null | undefined): void {
  if (!fiscalIntegrationRef) {
    throw new FiscalIntegrationDomainError('registration_required');
  }
}

export function assertCanTestConnection(fiscalIntegrationRef: string | null | undefined): void {
  if (!fiscalIntegrationRef) {
    throw new FiscalIntegrationDomainError('registration_required');
  }
}

export interface CertificateUploadInput {
  certificado_base64: string;
  senha_certificado:  string;
}

// PFX/P12 é binário — não dá pra validar o conteúdo sem uma lib de
// criptografia; validamos só o que é seguro validar aqui (presença + um teto
// de tamanho sensato pra pegar upload errado cedo, antes de gastar uma
// chamada de rede).
const MAX_CERTIFICATE_BASE64_LENGTH = 15_000_000; // ~11MB decodificado, folgado pra um A1 (tipicamente <10KB-a-poucos-MB)

export function validateCertificateUpload(input: CertificateUploadInput): void {
  if (!input.certificado_base64?.trim()) {
    throw new FiscalIntegrationDomainError('certificate_file_required');
  }
  if (!input.senha_certificado?.trim()) {
    throw new FiscalIntegrationDomainError('certificate_password_required');
  }
  if (input.certificado_base64.length > MAX_CERTIFICATE_BASE64_LENGTH) {
    throw new FiscalIntegrationDomainError('certificate_file_too_large');
  }
}

export type FiscalIntegrationDisplayStatus =
  | 'not_registered'
  | 'pending'
  | 'registered_no_certificate'
  | 'active'
  | 'certificate_expiring_soon'
  | 'certificate_expired'
  | 'error';

export interface FiscalIntegrationStateLike {
  fiscal_integration_ref:     string | null;
  fiscal_registration_status: FiscalRegistrationStatus;
  certificado_valido_ate:     string | null; // 'YYYY-MM-DD'
}

const CERTIFICATE_EXPIRING_SOON_DAYS = 30;

/**
 * Deriva o status exibido na tela a partir do estado bruto persistido — nunca
 * o inverso (a UI nunca infere status por conta própria). `now` é
 * injetável só pra teste (mesmo padrão de outros domínios que dependem de data).
 */
export function deriveFiscalIntegrationStatus(
  state: FiscalIntegrationStateLike, now: Date = new Date(),
): FiscalIntegrationDisplayStatus {
  if (state.fiscal_registration_status === 'error') return 'error';
  if (state.fiscal_registration_status === 'pending' || state.fiscal_registration_status === 'processing') return 'pending';
  if (!state.fiscal_integration_ref) return 'not_registered';
  if (!state.certificado_valido_ate) return 'registered_no_certificate';

  const validUntil = new Date(state.certificado_valido_ate + 'T23:59:59');
  if (validUntil.getTime() < now.getTime()) return 'certificate_expired';

  const daysLeft = (validUntil.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (daysLeft <= CERTIFICATE_EXPIRING_SOON_DAYS) return 'certificate_expiring_soon';

  return 'active';
}
