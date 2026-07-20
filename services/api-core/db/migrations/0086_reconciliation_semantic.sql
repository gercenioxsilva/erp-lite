-- Migration 0086: conciliação — similaridade semântica de descrição.
--
-- Estende as regras (0072) com dois parâmetros por tenant/empresa:
--  · description_weight  → peso do componente de similaridade de descrição no
--    score (0..1). O motor soma description_weight × similaridade(0..1); com 0
--    o comportamento é idêntico ao de hoje.
--  · use_ai_matching      → liga a similaridade via IA (Claude). DESLIGADO por
--    padrão: sem a flag (ou sem ANTHROPIC_API_KEY) vale só a similaridade
--    lexical local, determinística e gratuita.
-- matched_keys (JSONB em reconciliation_matches) recebe 'description_semantic'
-- sem mudança de schema.

ALTER TABLE reconciliation_rules
  ADD COLUMN IF NOT EXISTS description_weight NUMERIC(5,4) NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS use_ai_matching    BOOLEAN      NOT NULL DEFAULT false;
