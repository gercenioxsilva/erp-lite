import type { EmailTemplate, TemplateData } from '../types';

export function nfeAuthorizedTemplate(data: TemplateData): EmailTemplate {
  const number   = data.invoice_number ?? '';
  const chave    = data.nfe_chave      ?? '';
  const danfeUrl = data.danfe_url      ?? '';

  const subject = `NF-e nº ${number} autorizada pela SEFAZ`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:#1a56db;padding:28px 32px">
          <h1 style="margin:0;color:#fff;font-size:20px">✅ NF-e Autorizada</h1>
        </td></tr>
        <tr><td style="padding:32px">
          <p style="margin:0 0 16px;color:#374151;font-size:15px">Sua Nota Fiscal Eletrônica foi autorizada com sucesso pela SEFAZ.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;margin:0 0 24px">
            <tr style="background:#f9fafb"><td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;border-bottom:1px solid #e5e7eb">NÚMERO DA NF-e</td></tr>
            <tr><td style="padding:12px 16px;color:#111827;font-size:22px;font-weight:700;border-bottom:1px solid #e5e7eb">${number}</td></tr>
            <tr style="background:#f9fafb"><td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;border-bottom:1px solid #e5e7eb">CHAVE DE ACESSO</td></tr>
            <tr><td style="padding:12px 16px;color:#374151;font-size:12px;word-break:break-all;border-bottom:1px solid #e5e7eb">${chave}</td></tr>
          </table>
          ${danfeUrl ? `<p style="margin:0 0 24px;text-align:center"><a href="${danfeUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:600">📄 Visualizar DANFE</a></p>` : ''}
          <p style="margin:0;color:#6b7280;font-size:13px">Você também pode consultar o documento em <a href="https://www.nfe.fazenda.gov.br" style="color:#1a56db">Portal Nacional da NF-e</a> usando a chave de acesso acima.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e5e7eb;text-align:center">
          <p style="margin:0;color:#9ca3af;font-size:12px">Este é um e-mail automático. Por favor, não responda diretamente.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `NF-e nº ${number} AUTORIZADA PELA SEFAZ\n\nNúmero: ${number}\nChave de Acesso: ${chave}${danfeUrl ? `\nDANFE: ${danfeUrl}` : ''}\n\nConsulte em: https://www.nfe.fazenda.gov.br`;

  return { subject, html, text };
}
