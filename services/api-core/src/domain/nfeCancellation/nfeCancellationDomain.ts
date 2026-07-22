// Domínio de Cancelamento de NF-e junto à SEFAZ (migration 0089) — regras
// puras, sem I/O. Cancelamento local (invoices.status='cancelled', reversão
// de estoque/comissão) já existe e continua imediato/síncrono
// (routes/invoices.ts) — este domínio cobre só a formalização fiscal
// assíncrona junto ao Focus/SEFAZ, que só se aplica quando a nota já estava
// 'authorized'.

export class NfeCancellationDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'NfeCancellationDomainError';
  }
}

// SEFAZ exige justificativa com no mínimo 15 caracteres (mesma regra já
// aplicada em cancelarNFCe(), services/fiscal/focusNfe.ts) — centralizada
// aqui em vez de duplicada em cada fluxo de cancelamento (NF-e/NFC-e/CC-e
// usam a mesma trava de tamanho).
export const MIN_JUSTIFICATIVA_LENGTH = 15;
export const MAX_JUSTIFICATIVA_LENGTH = 255;

export function validateJustificativa(text: string | null | undefined): void {
  const trimmed = (text ?? '').trim();
  if (trimmed.length < MIN_JUSTIFICATIVA_LENGTH || trimmed.length > MAX_JUSTIFICATIVA_LENGTH) {
    throw new NfeCancellationDomainError('nfe_cancel_justificativa_invalid', {
      min: MIN_JUSTIFICATIVA_LENGTH, max: MAX_JUSTIFICATIVA_LENGTH, length: trimmed.length,
    });
  }
}

/**
 * Só nota AUTORIZADA precisa (e pode) ser cancelada junto à SEFAZ — uma nota
 * que nunca chegou a 'authorized' (draft, rejeitada, ainda processando) não
 * tem o que cancelar no emissor fiscal; o cancelamento local (status da
 * invoice) resolve sozinho esses casos, sem tocar em nfe_status.
 */
export function requiresFiscalCancellation(nfeStatus: string | null | undefined): boolean {
  return nfeStatus === 'authorized';
}
