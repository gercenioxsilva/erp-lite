import type { EmailTemplate, TemplateData } from '../types';

export function nfseRejectedTemplate(data: TemplateData): EmailTemplate {
  const number = data.nfse_number   ?? '';
  const reason = data.reject_reason ?? 'Motivo não especificado';

  const subject = `NFS-e nº ${number} — pendência de autorização`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:#dc2626;padding:28px 32px">
          <h1 style="margin:0;color:#fff;font-size:20px">❌ NFS-e com Pendência</h1>
        </td></tr>
        <tr><td style="padding:32px">
          <p style="margin:0 0 16px;color:#374151;font-size:15px">A NFS-e nº <strong>${number}</strong> não foi autorizada pela prefeitura. É necessário corrigir as informações e reemitir.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #fecaca;border-radius:6px;margin:0 0 24px;background:#fef2f2">
            <tr><td style="padding:12px 16px;color:#991b1b;font-size:13px;font-weight:600;border-bottom:1px solid #fecaca">MOTIVO DA PENDÊNCIA</td></tr>
            <tr><td style="padding:16px;color:#7f1d1d;font-size:14px;line-height:1.6">${reason}</td></tr>
          </table>
          <p style="margin:0;color:#6b7280;font-size:13px">Entre em contato com seu contador ou acesse o sistema para corrigir e reenviar a NFS-e.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e5e7eb;text-align:center">
          <p style="margin:0;color:#9ca3af;font-size:12px">Este é um e-mail automático. Por favor, não responda diretamente.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `NFS-e nº ${number} — PENDÊNCIA DE AUTORIZAÇÃO\n\nMotivo: ${reason}\n\nCorrija as informações e reenvie a NFS-e.`;

  return { subject, html, text };
}
