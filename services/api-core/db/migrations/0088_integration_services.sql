-- Migration 0088: serviços habilitados por integração.
--
-- Até aqui os serviços de um provider ("Transmissão PGDAS-D", "Geração de DAS",
-- "Consulta de declarações") eram só rótulos do catálogo — informativos, sem
-- efeito. Passam a ser LIGÁVEIS individualmente: dá para deixar a SERPRO ativa
-- só para gerar DAS e manter a transmissão desligada, que é o ato irreversível.
--
-- Semântica de NULL vs array (a decisão que importa aqui):
--   NULL  → TODOS os serviços do catálogo habilitados.
--   []    → NENHUM habilitado (provider ligado, mas inerte).
--   [...] → exatamente os listados.
-- NULL como "todos" e não [] como "todos" porque esta coluna nasce em linhas
-- que já existem: um DEFAULT '[]' desligaria, no deploy, toda integração já
-- configurada em produção. NULL preserva o comportamento atual.
--
-- Sem CHECK contra uma lista de chaves: o catálogo vive em código
-- (services/integrations/catalog.ts) e serviço novo não pode exigir migration.
-- Chave desconhecida no array é IGNORADA na leitura, nunca aceita na escrita
-- (a rota valida contra o catálogo antes de gravar).

ALTER TABLE integration_providers
  ADD COLUMN IF NOT EXISTS enabled_services JSONB;

COMMENT ON COLUMN integration_providers.enabled_services IS
  'Chaves dos serviços habilitados. NULL = todos; [] = nenhum; [...] = os listados.';
