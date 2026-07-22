// Domínio de Carta de Correção Eletrônica — CC-e (migration 0089) — regras
// puras, sem I/O.
//
// CC-e só é válida pra nota AUTORIZADA (nunca cancelada/rejeitada/em
// processamento) e é aditiva/sequencial — SEFAZ permite múltiplas por nota,
// cada uma com sequência incremental, e o texto corrige só dados acessórios
// (endereço, informação complementar), NUNCA campo fiscalmente relevante
// (valor, imposto, quantidade, dados das partes) — isso exigiria cancelar e
// reemitir, não corrigir. Validação de "não é um campo fiscal" é de UX
// (texto livre, sem campo estruturado pra reescrever), não dá pra validar
// por regex aqui.

export class NfeCorrectionDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'NfeCorrectionDomainError';
  }
}

// Limites do layout SEFAZ para o texto da correção.
export const MIN_CORRECTION_TEXT_LENGTH = 15;
export const MAX_CORRECTION_TEXT_LENGTH = 1000;

export function validateCorrectionText(text: string | null | undefined): void {
  const trimmed = (text ?? '').trim();
  if (trimmed.length < MIN_CORRECTION_TEXT_LENGTH || trimmed.length > MAX_CORRECTION_TEXT_LENGTH) {
    throw new NfeCorrectionDomainError('nfe_correction_text_invalid', {
      min: MIN_CORRECTION_TEXT_LENGTH, max: MAX_CORRECTION_TEXT_LENGTH, length: trimmed.length,
    });
  }
}

/** Só nota autorizada admite CC-e — cancelada/rejeitada/em processamento não. */
export function canIssueCorrection(nfeStatus: string | null | undefined): boolean {
  return nfeStatus === 'authorized';
}

/** Próxima sequência — sempre a maior já usada + 1, nunca reaproveitada
 *  mesmo que uma CC-e anterior tenha sido rejeitada (SEFAZ não permite
 *  "furar fila" reaproveitando um número rejeitado). */
export function nextSequence(existingSequences: number[]): number {
  if (!existingSequences.length) return 1;
  return Math.max(...existingSequences) + 1;
}
