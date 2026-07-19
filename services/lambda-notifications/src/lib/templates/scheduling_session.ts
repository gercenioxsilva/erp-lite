import type { TemplateData } from '../types';

// Ciclo de vida de sessão do Agendamento (api-core: schedulingNotificationService).
// data: client_name, date (já em dd/mm/aaaa), start_time, end_time, decline_reason?.
// Destinatário varia por evento: requested/client_canceled → profissional;
// demais → cliente. O texto de cada template já assume o destinatário certo.

interface SessionCopy {
  subject: string;
  headline: string;
  intro: string;
  note: string;
}

function sessionEmail(data: TemplateData, copy: SessionCopy) {
  const clientName = String(data['client_name'] || 'Cliente');
  const date       = String(data['date'] || '');
  const startTime  = String(data['start_time'] || '');
  const endTime    = String(data['end_time'] || '');
  const reason     = String(data['decline_reason'] || '');

  const when = `${date} · ${startTime}–${endTime}`;

  return {
    subject: copy.subject,
    html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<style>body{margin:0;font-family:sans-serif;background:#F2F5FB}
.wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.hdr{background:linear-gradient(135deg,#3B5CE4,#00B4D8);padding:32px;text-align:center;color:#fff}
.hdr h1{margin:0;font-size:22px;font-weight:700}
.body{padding:32px}
.card{background:#F7F9FC;border-radius:8px;padding:16px 20px;margin:16px 0}
.card b{color:#0D1B2A}
.note{font-size:13px;color:#6b7280;margin-top:16px}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>Orquestra ERP</h1></div>
  <div class="body">
    <p>${copy.headline}</p>
    <p>${copy.intro}</p>
    <div class="card">
      <p>Cliente: <b>${clientName}</b></p>
      <p>Quando: <b>${when}</b></p>
      ${reason ? `<p>Motivo: <b>${reason}</b></p>` : ''}
    </div>
    <p class="note">${copy.note}</p>
  </div>
</div>
</body></html>`,
    text: `${copy.headline}\n\n${copy.intro}\nCliente: ${clientName}\nQuando: ${when}${reason ? `\nMotivo: ${reason}` : ''}\n\n${copy.note}`,
  };
}

export function schedulingSessionRequestedTemplate(data: TemplateData) {
  return sessionEmail(data, {
    subject: `Nova solicitação de sessão — ${String(data['date'] || '')}`,
    headline: 'Você recebeu uma nova solicitação de sessão.',
    intro: 'Um cliente pediu um horário na sua agenda e aguarda sua decisão:',
    note: 'Acesse o módulo de Agendamento para aprovar ou recusar a solicitação.',
  });
}

export function schedulingSessionApprovedTemplate(data: TemplateData) {
  return sessionEmail(data, {
    subject: `Sessão confirmada — ${String(data['date'] || '')}`,
    headline: `Olá, ${String(data['client_name'] || 'Cliente')}!`,
    intro: 'Sua sessão foi confirmada:',
    note: 'Se precisar remarcar ou cancelar, acesse o portal do cliente.',
  });
}

export function schedulingSessionDeclinedTemplate(data: TemplateData) {
  return sessionEmail(data, {
    subject: `Sessão não confirmada — ${String(data['date'] || '')}`,
    headline: `Olá, ${String(data['client_name'] || 'Cliente')}!`,
    intro: 'Infelizmente sua solicitação de sessão não pôde ser confirmada:',
    note: 'Você pode solicitar um novo horário pelo portal do cliente.',
  });
}

export function schedulingSessionCanceledTemplate(data: TemplateData) {
  return sessionEmail(data, {
    subject: `Sessão cancelada — ${String(data['date'] || '')}`,
    headline: `Olá, ${String(data['client_name'] || 'Cliente')}!`,
    intro: 'Sua sessão foi cancelada:',
    note: 'Se precisar de um novo horário, acesse o portal do cliente.',
  });
}

export function schedulingSessionReminderTemplate(data: TemplateData) {
  return sessionEmail(data, {
    subject: `Lembrete: sua sessão é amanhã — ${String(data['date'] || '')}`,
    headline: `Olá, ${String(data['client_name'] || 'Cliente')}!`,
    intro: 'Passando para lembrar da sua sessão de amanhã:',
    note: 'Se não puder comparecer, cancele pelo portal do cliente com antecedência.',
  });
}

export function schedulingSessionClientCanceledTemplate(data: TemplateData) {
  return sessionEmail(data, {
    subject: `Cliente cancelou a sessão — ${String(data['date'] || '')}`,
    headline: 'Um cliente cancelou uma sessão da sua agenda.',
    intro: 'O horário abaixo foi liberado:',
    note: 'Nenhuma ação é necessária — o horário já está livre na sua agenda.',
  });
}
