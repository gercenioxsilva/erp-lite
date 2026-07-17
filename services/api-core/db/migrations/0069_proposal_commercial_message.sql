-- Mensagem comercial da proposta — texto livre exibido como parágrafo de
-- abertura na impressão/portal público, distinto de notes (Observações) e
-- terms_text (Termos e condições), que ficam no rodapé do documento.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS commercial_message TEXT;
