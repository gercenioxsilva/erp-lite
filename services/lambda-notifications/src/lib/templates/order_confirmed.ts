import type { EmailTemplate, TemplateData } from '../types';

export function orderConfirmedTemplate(data: TemplateData): EmailTemplate {
  const number     = data.order_number ?? '';
  const clientName = data.client_name  ?? '';
  const total      = data.total        ?? '';

  const subject = `Pedido nº ${number} confirmado`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:#059669;padding:28px 32px">
          <h1 style="margin:0;color:#fff;font-size:20px">✅ Pedido Confirmado</h1>
        </td></tr>
        <tr><td style="padding:32px">
          ${clientName ? `<p style="margin:0 0 16px;color:#374151;font-size:15px">Olá, <strong>${clientName}</strong>!</p>` : ''}
          <p style="margin:0 0 24px;color:#374151;font-size:15px">Seu pedido foi confirmado e está sendo processado.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;margin:0 0 24px">
            <tr style="background:#f9fafb"><td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;border-bottom:1px solid #e5e7eb">NÚMERO DO PEDIDO</td></tr>
            <tr><td style="padding:12px 16px;color:#111827;font-size:22px;font-weight:700;border-bottom:1px solid #e5e7eb">${number}</td></tr>
            ${total ? `
            <tr style="background:#f9fafb"><td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;border-bottom:1px solid #e5e7eb">VALOR TOTAL</td></tr>
            <tr><td style="padding:12px 16px;color:#059669;font-size:20px;font-weight:700">R$ ${total}</td></tr>` : ''}
          </table>
          <p style="margin:0;color:#6b7280;font-size:13px">Em caso de dúvidas, entre em contato com nossa equipe de atendimento.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e5e7eb;text-align:center">
          <p style="margin:0;color:#9ca3af;font-size:12px">Este é um e-mail automático. Por favor, não responda diretamente.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `PEDIDO nº ${number} CONFIRMADO\n${clientName ? `\nOlá, ${clientName}!` : ''}\n\nSeu pedido foi confirmado e está sendo processado.${total ? `\nValor Total: R$ ${total}` : ''}\n\nEm caso de dúvidas, entre em contato com nossa equipe.`;

  return { subject, html, text };
}
