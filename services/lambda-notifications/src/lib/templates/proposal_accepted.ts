import type { TemplateData } from '../types';

export function proposalAcceptedTemplate(data: TemplateData) {
  const acceptedByName  = String(data['accepted_by_name']  || 'Cliente');
  const acceptedByEmail = String(data['accepted_by_email'] || '');
  const proposalNumber  = String(data['proposal_number']   || '');
  const proposalTitle   = String(data['proposal_title']    || 'Proposta');
  const total           = String(data['total']             || '0.00');
  const acceptedNotes   = String(data['accepted_notes']    || '');

  const fmtTotal = `R$ ${Number(total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  return {
    subject: `Proposta ${proposalNumber} aceita por ${acceptedByName}!`,
    html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<style>body{margin:0;font-family:sans-serif;background:#F2F5FB}
.wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.hdr{background:linear-gradient(135deg,#22c55e,#16a34a);padding:32px;text-align:center;color:#fff}
.hdr h1{margin:0;font-size:22px;font-weight:700}
.body{padding:32px}.card{background:#F2F5FB;border-radius:8px;padding:16px 20px;margin:16px 0}
.row{display:flex;justify-content:space-between;padding:6px 0;font-size:14px;border-bottom:1px solid #e5e7eb}
.label{color:#6b7280}.value{font-weight:600;color:#0D1B2A}
.total{font-size:22px;font-weight:700;color:#22c55e}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>Proposta Aceita!</h1></div>
  <div class="body">
    <p>Boa notícia! A proposta <strong>${proposalTitle}</strong> foi aceita.</p>
    <div class="card">
      <div class="row"><span class="label">Proposta</span><span class="value">${proposalNumber}</span></div>
      <div class="row"><span class="label">Aceita por</span><span class="value">${acceptedByName}</span></div>
      ${acceptedByEmail ? `<div class="row"><span class="label">E-mail</span><span class="value">${acceptedByEmail}</span></div>` : ''}
      <div class="row" style="border:none;padding-top:12px"><span class="label">Valor</span><span class="total">${fmtTotal}</span></div>
    </div>
    ${acceptedNotes ? `<p style="background:#fefce8;border-left:3px solid #fbbf24;padding:12px 16px;border-radius:4px;font-size:14px"><strong>Observações do cliente:</strong><br>${acceptedNotes}</p>` : ''}
    <p style="font-size:13px;color:#6b7280;margin-top:24px">Acesse o sistema para converter em pedido de venda.</p>
  </div>
</div>
</body></html>`,
    text: `Proposta ${proposalNumber} aceita!\n\nAceita por: ${acceptedByName}${acceptedByEmail ? ` (${acceptedByEmail})` : ''}\nValor: ${fmtTotal}${acceptedNotes ? `\nObservações: ${acceptedNotes}` : ''}\n\nAcesse o sistema para converter em pedido.`,
  };
}
