// Conteúdo de referência dos 5 templates fixos do MVP (regra correspondente
// no README) — nunca editável pelo tenant. É o texto que precisa ser
// submetido pro provedor (Twilio Content API) pra aprovação; o Content SID
// resultante fica em whatsapp_message_templates.provider_template_id por
// tenant. Serve também de preview na tela de automações.
//
// Placeholders {{chave}} batem com as `variables` que cada gatilho monta —
// ver whatsappAutomationService.ts.

import type { TemplateKey } from '../domain/whatsapp/whatsappDomain';

export interface WhatsAppTemplateDefinition {
  key: TemplateKey;
  variables: string[];
  body: string; // referência/preview — o texto aprovado de verdade vive no Twilio
}

export const WHATSAPP_TEMPLATES: Record<TemplateKey, WhatsAppTemplateDefinition> = {
  invoice_due_soon: {
    key: 'invoice_due_soon',
    variables: ['client_name', 'invoice_number', 'amount', 'due_date'],
    body: 'Olá, {{client_name}}. A fatura nº {{invoice_number}}, no valor de {{amount}}, vence em {{due_date}}.\n\nPara não receber mais mensagens pelo WhatsApp, responda SAIR.',
  },
  invoice_overdue: {
    key: 'invoice_overdue',
    variables: ['client_name', 'invoice_number', 'amount', 'due_date'],
    body: 'Olá, {{client_name}}. Identificamos que a cobrança nº {{invoice_number}}, no valor de {{amount}}, venceu em {{due_date}}. Caso o pagamento já tenha sido realizado, desconsidere esta mensagem.\n\nPara não receber mais mensagens pelo WhatsApp, responda SAIR.',
  },
  payment_confirmed: {
    key: 'payment_confirmed',
    variables: ['invoice_number', 'amount'],
    body: 'Pagamento confirmado ✅\n\nRecebemos o pagamento da cobrança nº {{invoice_number}}, no valor de {{amount}}. Obrigado!',
  },
  fiscal_document_authorized: {
    key: 'fiscal_document_authorized',
    variables: ['invoice_number', 'amount'],
    body: 'Sua nota fiscal foi emitida com sucesso.\n\nNúmero: {{invoice_number}}\nValor: {{amount}}',
  },
  proposal_sent: {
    key: 'proposal_sent',
    variables: ['proposal_number'],
    body: 'Seu orçamento nº {{proposal_number}} está disponível para visualização.',
  },
};
