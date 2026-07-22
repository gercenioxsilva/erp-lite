// Domínio de Transportadora (migration 0089) — regras puras, sem I/O.
// Catálogo core (nome, documento, endereço) usado no grupo transporta da
// NF-e/Simples Remessa. Reaproveita os validadores de CNPJ/CPF já existentes
// (nunca duplica o algoritmo) — cnpjDomain.ts pro CNPJ alfanumérico (IN RFB
// 2.229/2024), serviceVisitDomain.ts::isValidCPF pro autônomo (PF).

import { isValidCNPJ, normalizeCNPJ } from '../cnpj/cnpjDomain';
import { isValidCPF, digitsOnly } from '../serviceVisit/serviceVisitDomain';

export class TransportadoraDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'TransportadoraDomainError';
  }
}

export type TransportadoraPersonType = 'PJ' | 'PF';

export interface TransportadoraValidateInput {
  name:        string;
  person_type: TransportadoraPersonType;
  document?:   string | null;
}

/**
 * Nome sempre obrigatório. Documento é opcional no cadastro (mesmo padrão
 * nullable de sellers.document) — mas quando informado, precisa ser um
 * CNPJ (PJ) ou CPF (PF) válido; nunca aceita um documento do tipo errado
 * pro person_type declarado (ex.: CPF de 11 dígitos marcado como PJ).
 */
export function validateTransportadora(input: TransportadoraValidateInput): void {
  if (!input.name?.trim()) {
    throw new TransportadoraDomainError('transportadora_name_required');
  }
  if (input.person_type !== 'PJ' && input.person_type !== 'PF') {
    throw new TransportadoraDomainError('transportadora_person_type_invalid', { person_type: input.person_type });
  }
  if (!input.document?.trim()) return;

  if (input.person_type === 'PJ') {
    if (!isValidCNPJ(input.document)) {
      throw new TransportadoraDomainError('transportadora_document_invalid', { person_type: 'PJ' });
    }
  } else {
    if (!isValidCPF(input.document)) {
      throw new TransportadoraDomainError('transportadora_document_invalid', { person_type: 'PF' });
    }
  }
}

/** Normaliza pro formato salvo (só dígitos, exceto CNPJ alfanumérico que
 *  mantém letras — mesmo racional de normalizeCNPJ). */
export function normalizeDocument(document: string, personType: TransportadoraPersonType): string {
  return personType === 'PJ' ? normalizeCNPJ(document) : digitsOnly(document);
}
