// Helper canônico de detecção de violação de UNIQUE (Postgres 23505) — o
// padrão estabelecido de idempotência do projeto: INSERT e captura o 23505 em
// vez de SELECT-antes-de-inserir (que tem corrida) ou onConflictDoNothing
// (que engole erro real sem contar duplicados).
//
// Já existia copiado em receivableService/commissionService/costCenterStock/
// marketplaceWebhookService/servicePhotoStorageService; código novo importa
// daqui e as cópias migram gradualmente.

export function isUniqueConstraintViolation(err: unknown): boolean {
  if (err instanceof Error) {
    const pgErr = err as Error & { code?: string };
    if (pgErr.code === '23505') return true;
    if (err.message.includes('unique') || err.message.includes('duplicate') || err.message.includes('23505')) {
      return true;
    }
  }
  return false;
}
