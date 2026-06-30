-- Permite o novo tipo de material 'kit' (combo / lista técnica).
ALTER TABLE materials DROP CONSTRAINT IF EXISTS materials_type_check;
ALTER TABLE materials ADD CONSTRAINT materials_type_check
  CHECK (type IN ('product', 'service', 'raw_material', 'asset', 'kit'));
