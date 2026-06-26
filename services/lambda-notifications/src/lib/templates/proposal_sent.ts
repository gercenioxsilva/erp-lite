import type { TemplateData } from '../types';

export function proposalSentTemplate(data: TemplateData) {
  const clientName      = String(data['client_name']      || 'Cliente');
  const issuerName      = String(data['issuer_name']       || 'Empresa');
  const proposalNumber  = String(data['proposal_number']   || '');
  const proposalTitle   = String(data['proposal_title']    || 'Proposta');
  const proposalLink    = String(data['proposal_link']     || '#');
  const validUntil      = String(data['valid_until']       || '');
  const total           = String(data['total']             || '0.00');

  const fmtDate = validUntil
    ? new Date(validUntil + 'T12:00:00Z').toLocaleDateString('pt-BR')
    : '';
  const fmtTotal = `R$ ${Number(total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const validLine = validUntil ? `<p style="color:#6b7280;font-size:13px">Válida até: <strong>${fmtDate}</strong></p>` : '';

  return {
    subject: `${issuerName} enviou uma proposta para você — ${proposalTitle}`,
    html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<style>body{margin:0;font-family:sans-serif;background:#F2F5FB}
.wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.hdr{background:linear-gradient(135deg,#3B5CE4,#00B4D8);padding:32px;text-align:center;color:#fff}
.hdr h1{margin:0;font-size:22px;font-weight:700}
.body{padding:32px}
.card{background:#F2F5FB;border-radius:8px;padding:16px 20px;margin:20px 0}
.total{font-size:22px;font-weight:700;color:#3B5CE4}
.btn{display:inline-block;margin:24px 0;padding:14px 36px;background:#3B5CE4;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>${issuerName}</h1></div>
  <div class="body">
    <p>Olá, <strong>${clientName}</strong>!</p>
    <p><strong>${issuerName}</strong> enviou uma proposta comercial para você:</p>
    <div class="card">
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280">Proposta ${proposalNumber}</p>
      <p style="margin:0 0 12px;font-size:17px;font-weight:600;color:#0D1B2A">${proposalTitle}</p>
      <div class="total">${fmtTotal}</div>
      ${validLine}
    </div>
    <div style="text-align:center"><a class="btn" href="${proposalLink}">Ver Proposta Completa</a></div>
    <p style="font-size:12px;color:#9ca3af;margin-top:16px">
      Você pode aceitar ou solicitar alterações diretamente pelo link acima.
    </p>
  </div>
</div>
</body></html>`,
    text: `Olá, ${clientName}!\n\n${issuerName} enviou uma proposta: "${proposalTitle}" (${proposalNumber})\nValor: ${fmtTotal}${fmtDate ? `\nVálida até: ${fmtDate}` : ''}\n\nAcesse: ${proposalLink}`,
  };
}
