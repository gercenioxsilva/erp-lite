-- 0045_pos_module.sql
-- Torna o PDV (Ponto de Venda) um módulo opcional gated por tenant_modules,
-- exatamente como service_orders (0044). As rotas /v1/pos/* passam a exigir
-- requireModule('pos') no backend.
--
-- Backfill: os tenants existentes já usavam o PDV como recurso central, então
-- habilitamos 'pos' para todos eles aqui (evita regressão — ninguém perde acesso).
-- Tenants NOVOS não recebem linha nesta migration → o módulo nasce desabilitado
-- (opt-in pela aba "Minha Empresa → Módulos"), mesmo comportamento de service_orders.
-- Depende de tenant_modules (criada em 0044); esta migration roda depois.

INSERT INTO tenant_modules (tenant_id, module_key, enabled, enabled_at)
SELECT id, 'pos', TRUE, NOW() FROM tenants
ON CONFLICT (tenant_id, module_key) DO NOTHING;
