// Domínio puro do cadastro fiscal por empresa — validações e parsing sem I/O
// (molde de domain/company/companyDomain.ts). Erros tipados com code para a
// rota mapear em 422 {error: code}.

import forge from 'node-forge';

export class FiscalDomainError extends Error {
  constructor(public code: string, public payload: Record<string, unknown> = {}) {
    super(code);
    this.name = 'FiscalDomainError';
  }
}

export const ENQUADRAMENTOS = ['MEI', 'ME', 'EPP'] as const;
export type Enquadramento = typeof ENQUADRAMENTOS[number];

export const NFSE_PROVIDERS = ['focus', 'abrasf', 'nacional', 'saopaulo'] as const;
export type NfseProvider = typeof NFSE_PROVIDERS[number];

/** CNAE: aceita '9602-5/01' ou '9602501'; normaliza para 7 dígitos. */
export function normalizeCnae(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length !== 7) throw new FiscalDomainError('invalid_cnae', { cnae: raw });
  return digits;
}

/** Item da LC 116/2003: '14.01', '7.02', '14.1' → normaliza 'NN.NN'. */
export function normalizeLc116(raw: string): string {
  const m = String(raw ?? '').trim().match(/^(\d{1,2})\.?(\d{1,2})$/);
  if (!m) throw new FiscalDomainError('invalid_lc116', { codigo: raw });
  return `${Number(m[1])}.${m[2].padStart(2, '0')}`;
}

/** Competência 'YYYY-MM' (mês 01-12). */
export function validateCompetencia(raw: string): string {
  const m = String(raw ?? '').match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!m) throw new FiscalDomainError('invalid_competencia', { competencia: raw });
  return raw;
}

export interface ParsedCertificate {
  cn:         string | null;
  notBefore:  Date;
  notAfter:   Date;
  thumbprint: string; // SHA-1 hex do DER do certificado (convenção ICP-Brasil)
}

/**
 * Abre um .pfx/.p12 (base64) com a senha e extrai os metadados do certificado.
 * Falha com code tipado: senha errada/arquivo corrompido nunca viram 500 cru.
 */
export function parseA1Certificate(pfxBase64: string, senha: string): ParsedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = forge.util.decode64(pfxBase64);
    const asn1 = forge.asn1.fromDer(der);
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);
  } catch {
    throw new FiscalDomainError('invalid_certificate_or_password');
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const cert = certBags.map((b) => b.cert).find((c): c is forge.pki.Certificate => !!c);
  if (!cert) throw new FiscalDomainError('certificate_not_found_in_pfx');

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  if (!keyBags.some((b) => b.key)) throw new FiscalDomainError('private_key_not_found_in_pfx');

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const thumbprint = forge.md.sha1.create().update(der).digest().toHex();
  const cn = cert.subject.getField('CN')?.value ?? null;

  return { cn, notBefore: cert.validity.notBefore, notAfter: cert.validity.notAfter, thumbprint };
}

export interface ReadinessInput {
  docType:          'nfse';
  optanteSimples:   boolean;
  enquadramento:    string;
  nfseProvider:     string;
  hasServiceCode:   boolean;
  inscricaoMunicipal: string | null;
  certificate:      { notAfter: Date | null } | null;
  now:              Date;
}

/**
 * Gate "VALIDAR" de emissão (consumido pela consolidação antes de enfileirar):
 * lista TODAS as pendências de uma vez em vez de falhar na primeira.
 * Provider 'focus' não exige certificado próprio (o agregador assina).
 */
export function evaluateEmissionReadiness(input: ReadinessInput): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.inscricaoMunicipal) reasons.push('inscricao_municipal_missing');
  if (!input.hasServiceCode) reasons.push('service_code_missing');
  if (input.nfseProvider !== 'focus') {
    if (!input.certificate) reasons.push('certificate_missing');
    else if (!input.certificate.notAfter || input.certificate.notAfter <= input.now) reasons.push('certificate_expired');
  }
  return { ready: reasons.length === 0, reasons };
}
