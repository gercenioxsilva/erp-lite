import type { TemplateData, EmailTemplate } from '../types';

export function boletoGeneratedTemplate(data: TemplateData): EmailTemplate {
  const description = String(data.description ?? '');
  const amount      = String(data.amount      ?? '');
  const due_date    = String(data.due_date    ?? '');
  const boleto_url  = String(data.boleto_url  ?? '');
  const brcode      = String(data.brcode      ?? '');

  const subject = `Boleto disponível — ${description}`;

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Boleto</title>
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f4f4f4; }
  .container { max-width: 520px; margin: 32px auto; background: #fff;
    border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.1); }
  .header { background: #3B5CE4; color: #fff; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; }
  .body { padding: 24px 28px; }
  .info-row { display: flex; justify-content: space-between; margin-bottom: 12px;
    border-bottom: 1px solid #f0f0f0; padding-bottom: 12px; }
  .info-label { color: #666; font-size: 13px; }
  .info-value { font-weight: 600; font-size: 14px; }
  .amount { font-size: 28px; font-weight: 700; color: #3B5CE4; margin: 16px 0; }
  .btn { display: block; width: 100%; box-sizing: border-box;
    background: #3B5CE4; color: #fff; text-decoration: none;
    text-align: center; padding: 14px; border-radius: 6px;
    font-size: 15px; font-weight: 600; margin: 20px 0 10px; }
  .barcode { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px;
    padding: 12px; font-family: monospace; font-size: 11px; word-break: break-all;
    color: #444; margin-top: 12px; }
  .footer { background: #f8f8f8; padding: 16px 28px; font-size: 12px; color: #999;
    border-top: 1px solid #eee; }
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>Boleto disponível para pagamento</h1></div>
  <div class="body">
    <div class="amount">${amount}</div>

    <div class="info-row">
      <span class="info-label">Descrição</span>
      <span class="info-value">${description}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Vencimento</span>
      <span class="info-value">${due_date}</span>
    </div>

    ${boleto_url ? `<a class="btn" href="${boleto_url}">Pagar / Ver boleto</a>` : ''}

    ${brcode ? `
    <p style="font-size:13px;color:#555;margin-top:16px;">
      <strong>PIX copia e cola:</strong>
    </p>
    <div class="barcode">${brcode}</div>
    ` : ''}
  </div>
  <div class="footer">
    Este e-mail foi gerado automaticamente pelo Orquestra ERP.<br>
    Não responda a esta mensagem.
  </div>
</div>
</body>
</html>`;

  const text = [
    `Boleto disponível para pagamento`,
    ``,
    `Descrição: ${description}`,
    `Valor:     ${amount}`,
    `Vencimento: ${due_date}`,
    boleto_url ? `Link: ${boleto_url}` : '',
    brcode     ? `PIX copia e cola: ${brcode}` : '',
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}
