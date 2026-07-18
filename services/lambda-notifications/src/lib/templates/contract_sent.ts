import type { TemplateData, EmailTemplate } from '../types';

/**
 * E-mail de contrato — auto-contido (o resumo do contrato vai no próprio
 * corpo do e-mail, nunca um link pra um portal público — contratos não têm
 * portal do cliente, diferente de propostas que têm /p/:token). Campos
 * personalizados do tenant (migration 0072) já chegam pré-formatados em HTML/
 * texto puro pela rota (custom_fields_html/custom_fields_text), a Lambda
 * nunca acessa banco.
 */
export function contractSentTemplate(data: TemplateData): EmailTemplate {
  const clientName      = String(data['client_name']      || 'Cliente');
  const issuerName      = String(data['issuer_name']      || 'Empresa');
  const issuerLogo      = String(data['issuer_logo']      || '');
  const contractNumber  = String(data['contract_number']  || '');
  const description     = String(data['description']      || 'Contrato de prestação de serviço');
  const startDate       = String(data['start_date']        || '');
  const billingFreq     = String(data['billing_frequency'] || '');
  const amount          = String(data['amount']             || '0.00');
  const customFieldsHtml = String(data['custom_fields_html'] || '');
  const customFieldsText = String(data['custom_fields_text'] || '');

  const fmtAmount = Number(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  const logoBlock = issuerLogo
    ? `<img src="${issuerLogo}" alt="${issuerName}" height="48"
         style="max-height:48px;max-width:220px;object-fit:contain;display:block;margin:0 auto;">`
    : `<span style="font-size:22px;font-weight:800;color:#0D1B2A;letter-spacing:-0.5px;">${issuerName}</span>`;

  const subject = `${issuerName} enviou um contrato para você${contractNumber ? ` — #${contractNumber}` : ''}`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Contrato de ${issuerName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; background: #F7F9FC; color: #0D1B2A; -webkit-font-smoothing: antialiased; }
    .wrapper { padding: 40px 16px; }
    .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 4px; overflow: hidden; box-shadow: 0 1px 6px rgba(0,0,0,.07); }
    .hdr { padding: 40px 48px 36px; text-align: center; border-bottom: 3px solid #3B5CE4; }
    .body { padding: 40px 48px; }
    .greeting { font-size: 18px; font-weight: 700; color: #0D1B2A; margin-bottom: 8px; }
    .intro { font-size: 14px; color: #6B7280; line-height: 1.75; margin-bottom: 32px; }
    .rule { border: none; border-top: 1px solid #E2E8F0; margin: 0 0 28px; }
    .meta { font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #3B5CE4; margin-bottom: 8px; }
    .contract-title { font-size: 20px; font-weight: 700; color: #0D1B2A; line-height: 1.35; margin-bottom: 28px; }
    .info-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 28px; }
    .info-table td { padding: 6px 0; border-bottom: 1px solid #F1F5F9; }
    .info-table td:first-child { color: #6B7280; width: 45%; }
    .info-table td:last-child { text-align: right; font-weight: 600; }
    .total-block { border-top: 1px solid #E2E8F0; border-bottom: 1px solid #E2E8F0; padding: 24px 0; margin-bottom: 28px; }
    .total-label { font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #6B7280; margin-bottom: 8px; }
    .total-value { font-size: 40px; font-weight: 800; color: #0D1B2A; letter-spacing: -2px; line-height: 1; }
    .total-curr { font-size: 20px; font-weight: 700; color: #3B5CE4; vertical-align: super; letter-spacing: 0; }
    .hint { font-size: 12px; color: #9CA3AF; text-align: center; line-height: 1.8; }
    .footer { background: #F7F9FC; border-top: 1px solid #E2E8F0; padding: 20px 48px; text-align: center; font-size: 11px; color: #9CA3AF; line-height: 1.7; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="hdr">${logoBlock}</div>
      <div class="body">
        <p class="greeting">Olá, ${clientName}!</p>
        <p class="intro">
          <strong style="color:#0D1B2A;">${issuerName}</strong> enviou os detalhes do
          seu contrato de prestação de serviço. Confira o resumo abaixo.
        </p>

        <hr class="rule">

        <p class="meta">Contrato${contractNumber ? ` &middot; #${contractNumber}` : ''}</p>
        <p class="contract-title">${description}</p>

        <table class="info-table">
          ${startDate ? `<tr><td>Início</td><td>${startDate}</td></tr>` : ''}
          ${billingFreq ? `<tr><td>Cobrança</td><td>${billingFreq}</td></tr>` : ''}
          ${customFieldsHtml}
        </table>

        <div class="total-block">
          <p class="total-label">Valor</p>
          <p class="total-value"><span class="total-curr">R$&thinsp;</span>${fmtAmount}</p>
        </div>

        <p class="hint">
          Em caso de dúvidas sobre este contrato, entre em contato diretamente com ${issuerName}.<br>
          Caso não reconheça este envio, ignore este e-mail.
        </p>
      </div>
      <div class="footer">
        Enviado por <strong style="color:#6B7280;">${issuerName}</strong> via <strong style="color:#6B7280;">Orquestra ERP</strong><br>
        Este e-mail foi gerado automaticamente. Não responda a esta mensagem.
      </div>
    </div>
  </div>
</body>
</html>`;

  const text = [
    `Olá, ${clientName}!`,
    ``,
    `${issuerName} enviou os detalhes do seu contrato de prestação de serviço:`,
    ``,
    `Contrato${contractNumber ? ` #${contractNumber}` : ''}: ${description}`,
    ...(startDate ? [`Início: ${startDate}`] : []),
    ...(billingFreq ? [`Cobrança: ${billingFreq}`] : []),
    ...(customFieldsText ? [customFieldsText] : []),
    `Valor: R$ ${fmtAmount}`,
    ``,
    `Em caso de dúvidas, entre em contato diretamente com ${issuerName}.`,
    ``,
    `---`,
    `Enviado por ${issuerName} via Orquestra ERP.`,
    `Este e-mail foi gerado automaticamente. Não responda a esta mensagem.`,
  ].join('\n');

  return { subject, html, text };
}
