import type { TemplateData } from '../types';

export function serviceVisitAssignedTemplate(data: TemplateData) {
  const technicianName = String(data['technician_name'] || 'Técnico');
  const orderTitle     = String(data['order_title']     || 'Visita técnica');
  const scheduledAt    = String(data['scheduled_at']     || '');
  const link           = String(data['visit_link']       || '#');

  const fmtDate = scheduledAt
    ? new Date(scheduledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '';

  return {
    subject: `Nova visita técnica agendada — ${orderTitle}`,
    html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<style>body{margin:0;font-family:sans-serif;background:#F2F5FB}
.wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.hdr{background:linear-gradient(135deg,#3B5CE4,#00B4D8);padding:32px;text-align:center;color:#fff}
.hdr h1{margin:0;font-size:22px;font-weight:700}
.body{padding:32px}
.card{background:#F7F9FC;border-radius:8px;padding:16px 20px;margin:16px 0}
.card b{color:#0D1B2A}
.btn{display:inline-block;margin:24px 0;padding:14px 28px;background:#3B5CE4;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px}
.note{font-size:13px;color:#6b7280;margin-top:16px}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>Orquestra ERP</h1></div>
  <div class="body">
    <p>Olá, <strong>${technicianName}</strong>!</p>
    <p>Você tem uma nova visita técnica agendada:</p>
    <div class="card">
      <p><b>${orderTitle}</b></p>
      ${fmtDate ? `<p>Data/hora: <b>${fmtDate}</b></p>` : ''}
    </div>
    <div style="text-align:center"><a class="btn" href="${link}">Ver detalhes da visita</a></div>
    <p class="note">Faça login com sua conta de técnico para acessar os detalhes, iniciar o atendimento e registrar fotos e assinatura do cliente.</p>
  </div>
</div>
</body></html>`,
    text: `Olá, ${technicianName}!\n\nNova visita técnica agendada: ${orderTitle}${fmtDate ? `\nData/hora: ${fmtDate}` : ''}\n\nAcesse (login necessário):\n${link}`,
  };
}
