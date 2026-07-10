-- Correção de bug real: nota fiscal de venda autorizada pelo SEFAZ não gerava
-- conta a receber (nfeResultsWorker.ts nunca criava, só o caminho legado
-- POST /invoices/:id/issue criava — mas esse caminho nunca passa pelo SEFAZ
-- de verdade, é um "emitir localmente" que predata a integração fiscal
-- assíncrona). Corrigido no código (regra 60); esta migration só garante a
-- idempotência no banco.
--
-- UNIQUE parcial (só quando não nulo) — mesmo padrão exato já usado pra
-- Faturamento de Ordem de Serviço (migration 0052, service_order_id): no
-- máximo uma conta a receber por nota fiscal, nunca duas, mesmo que o worker
-- reprocesse a mesma mensagem SQS (at-least-once delivery) ou que os dois
-- caminhos de emissão (SEFAZ + o legado /issue) acabem coincidindo pra a
-- mesma nota.

CREATE UNIQUE INDEX IF NOT EXISTS uq_receivables_invoice
  ON receivables(invoice_id) WHERE invoice_id IS NOT NULL;
