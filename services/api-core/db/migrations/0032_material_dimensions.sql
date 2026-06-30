-- Dimensões físicas do produto (cm) — úteis para embalagem e frete.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS length_cm NUMERIC(10,2);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS width_cm  NUMERIC(10,2);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS height_cm NUMERIC(10,2);
