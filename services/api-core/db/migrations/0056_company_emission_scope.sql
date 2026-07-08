-- Responsabilidade de emissão por empresa (regra 53): cada CNPJ do tenant
-- declara se emite NF-e de venda (mercadoria), NFS-e (serviço), ou ambos.
-- Default TRUE/TRUE preserva o comportamento de hoje pra todo tenant já
-- existente (1 empresa, faz tudo) — nada muda até alguém desmarcar uma
-- capacidade explicitamente na tela "Minha Empresa".
ALTER TABLE nfe_configs
  ADD COLUMN emite_nfe  boolean NOT NULL DEFAULT true,
  ADD COLUMN emite_nfse boolean NOT NULL DEFAULT true;
