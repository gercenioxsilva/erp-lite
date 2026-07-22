-- Migration 0093: visibilidade do disparo automático de WhatsApp.
--
-- Bug real em produção: um evento de negócio (NF-e autorizada, pagamento
-- confirmado etc.) sempre chama a automação correspondente, mas ela é
-- fire-and-forget e engole qualquer falha de elegibilidade (conta não
-- conectada, template não aprovado, cliente sem opt-in, telefone inválido,
-- fila não configurada) num único console.warn — nunca visível pro tenant
-- nem pro operador. Resultado: 0 invocações da Lambda, nenhum erro visível
-- em lugar nenhum, e ninguém sabia por quê.
--
-- Estas 3 colunas guardam o resultado da ÚLTIMA tentativa de disparo de
-- cada automação (só quando ela está habilitada e passa da checagem de
-- idempotência — "desabilitada" já é visível pelo próprio `enabled`, não
-- precisa de rastro extra). Atualizadas a cada chamada real de
-- sendTemplateMessage(), sucesso ou falha — dá pro tenant ver na tela
-- "última tentativa: enviada com sucesso" ou "pulada: conta não conectada".
ALTER TABLE whatsapp_automations ADD COLUMN IF NOT EXISTS last_attempt_at     TIMESTAMPTZ;
ALTER TABLE whatsapp_automations ADD COLUMN IF NOT EXISTS last_attempt_status VARCHAR(20); -- 'sent' | 'skipped'
ALTER TABLE whatsapp_automations ADD COLUMN IF NOT EXISTS last_skip_reason    VARCHAR(50); -- código do WhatsAppDomainError, null quando last_attempt_status='sent'
