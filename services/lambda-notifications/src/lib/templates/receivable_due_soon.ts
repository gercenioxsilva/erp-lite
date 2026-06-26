import type { TemplateData } from '../types';

export function receivableDueSoonTemplate(data: TemplateData) {
  const clientName  = String(data['client_name']  || 'Cliente');
  const description = String(data['description']  || '');
  const amount      = String(data['amount']        || '0.00');
  const dueDate     = String(data['due_date']      || '');
  const daysAhead   = String(data['days_ahead']    || '3');

  const fmtDate = dueDate
    ? new Date(dueDate + 'T12:00:00Z').toLocaleDateString('pt-BR')
    : dueDate;
  const fmtAmount = `R$ ${Number(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  return {
    subject: `Lembrete: pagamento de ${fmtAmount} vence em ${daysAhead} dia(s)`,
    html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<style>body{margin:0;font-family:sans-serif;background:#F2F5FB}
.wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.hdr{background:linear-gradient(135deg,#3B5CE4,#00B4D8);padding:32px;text-align:center;color:#fff}
.hdr h1{margin:0;font-size:22px;font-weight:700}
.body{padding:32px}
.card{background:#F2F5FB;border-radius:8px;padding:16px 20px;margin:20px 0}
.card-row{display:flex;justify-content:space-between;padding:6px 0;font-size:15px}
.label{color:#6b7280}
.value{font-weight:600;color:#0D1B2A}
.due{color:#ef4444;font-weight:700;font-size:18px}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>Orquestra ERP</h1></div>
  <div class="body">
    <p>Olá, <strong>${clientName}</strong>!</p>
    <p>Este é um lembrete de que você tem um pagamento com vencimento em <strong>${daysAhead} dia(s)</strong>.</p>
    <div class="card">
      <div class="card-row"><span class="label">Descrição</span><span class="value">${description}</span></div>
      <div class="card-row"><span class="label">Valor</span><span class="value">${fmtAmount}</span></div>
      <div class="card-row"><span class="label">Vencimento</span><span class="due">${fmtDate}</span></div>
    </div>
    <p style="font-size:13px;color:#6b7280">Em caso de dúvidas, entre em contato com o emissor desta cobrança.</p>
  </div>
</div>
</body></html>`,
    text: `Olá, ${clientName}!\n\nLembrete de pagamento:\n- Descrição: ${description}\n- Valor: ${fmtAmount}\n- Vencimento: ${fmtDate}\n\nEste pagamento vence em ${daysAhead} dia(s).`,
  };
}
