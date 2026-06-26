import type { EmailTemplate, TemplateData } from '../types';

export function nfseAuthorizedTemplate(data: TemplateData): EmailTemplate {
  const number   = data.nfse_number ?? '';
  const valor    = data.valor       ?? '';
  const issValor = data.iss_valor   ?? '';
  const pdfUrl   = data.pdf_url      ?? '';

  const subject = `NFS-e nº ${number} autorizada`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:#1a56db;padding:28px 32px">
          <h1 style="margin:0;color:#fff;font-size:20px">✅ NFS-e Autorizada</h1>
        </td></tr>
        <tr><td style="padding:32px">
          <p style="margin:0 0 16px;color:#374151;font-size:15px">Sua Nota Fiscal de Serviços Eletrônica foi autorizada com sucesso pela prefeitura.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;margin:0 0 24px">
            <tr style="background:#f9fafb"><td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;border-bottom:1px solid #e5e7eb">NÚMERO DA NFS-e</td></tr>
            <tr><td style="padding:12px 16px;color:#111827;font-size:22px;font-weight:700;border-bottom:1px solid #e5e7eb">${number}</td></tr>
            <tr style="background:#f9fafb"><td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;border-bottom:1px solid #e5e7eb">VALOR DOS SERVIÇOS</td></tr>
            <tr><td style="padding:12px 16px;color:#374151;font-size:14px;border-bottom:1px solid #e5e7eb">R$ ${valor}</td></tr>
            <tr style="background:#f9fafb"><td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;border-bottom:1px solid #e5e7eb">VALOR DO ISS</td></tr>
            <tr><td style="padding:12px 16px;color:#374151;font-size:14px;border-bottom:1px solid #e5e7eb">R$ ${issValor}</td></tr>
          </table>
          ${pdfUrl ? `<p style="margin:0 0 24px;text-align:center"><a href="${pdfUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:600">📄 Visualizar NFS-e</a></p>` : ''}
          <p style="margin:0;color:#6b7280;font-size:13px">Você pode consultar a NFS-e no portal da prefeitura usando o número e o código de verificação.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e5e7eb;text-align:center">
          <p style="margin:0;color:#9ca3af;font-size:12px">Este é um e-mail automático. Por favor, não responda diretamente.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `NFS-e nº ${number} AUTORIZADA\n\nNúmero: ${number}\nValor dos serviços: R$ ${valor}\nValor do ISS: R$ ${issValor}${pdfUrl ? `\nNFS-e: ${pdfUrl}` : ''}`;

  return { subject, html, text };
}
