-- Observações internas do material (regra de cadastro de materiais) — campo
-- livre distinto de `description` (descrição do produto, já buscável e
-- usada em propostas). notes é só nota interna do tenant, sem uso hoje em
-- nenhuma tela pública/comercial.
ALTER TABLE materials
  ADD COLUMN notes text;
