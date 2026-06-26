import type { TemplateData } from '../types';

export function proposalRejectedTemplate(data: TemplateData) {
  const proposalNumber  = String(data['proposal_number']  || '');
  const proposalTitle   = String(data['proposal_title']   || 'Proposta');
  const rejectedReason  = String(data['rejected_reason']  || 'Sem motivo informado');

  return {
    subject: `Proposta ${proposalNumber} — cliente solicitou alterações`,
    html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<style>body{margin:0;font-family:sans-serif;background:#F2F5FB}
.wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.hdr{background:linear-gradient(135deg,#f59e0b,#d97706);padding:32px;text-align:center;color:#fff}
.hdr h1{margin:0;font-size:22px;font-weight:700}
.body{padding:32px}.reason{background:#fff7ed;border-left:3px solid #f59e0b;padding:12px 16px;border-radius:4px;font-size:14px;margin:20px 0}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>Alterações Solicitadas</h1></div>
  <div class="body">
    <p>O cliente solicitou alterações na proposta <strong>${proposalTitle}</strong> (${proposalNumber}).</p>
    <div class="reason"><strong>Motivo:</strong><br>${rejectedReason}</div>
    <p style="font-size:13px;color:#6b7280">Revise a proposta, ajuste os valores e reenvie um novo link ao cliente.</p>
  </div>
</div>
</body></html>`,
    text: `Proposta ${proposalNumber} — cliente solicitou alterações.\n\nMotivo: ${rejectedReason}\n\nRevise e reenvie a proposta.`,
  };
}
