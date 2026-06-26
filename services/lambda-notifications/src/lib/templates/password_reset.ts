import type { TemplateData } from '../types';

export function passwordResetTemplate(data: TemplateData) {
  const name      = String(data['name']        || 'Usuário');
  const resetLink = String(data['reset_link']  || '#');
  const hours     = String(data['expires_hours'] || '2');

  return {
    subject: 'Redefinição de senha — Orquestra ERP',
    html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<style>body{margin:0;font-family:sans-serif;background:#F2F5FB}
.wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.hdr{background:linear-gradient(135deg,#3B5CE4,#00B4D8);padding:32px;text-align:center;color:#fff}
.hdr h1{margin:0;font-size:22px;font-weight:700}
.body{padding:32px}
.btn{display:inline-block;margin:24px 0;padding:14px 28px;background:#3B5CE4;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px}
.note{font-size:13px;color:#6b7280;margin-top:16px}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>Orquestra ERP</h1></div>
  <div class="body">
    <p>Olá, <strong>${name}</strong>!</p>
    <p>Recebemos uma solicitação de redefinição de senha para sua conta. Clique no botão abaixo para criar uma nova senha:</p>
    <div style="text-align:center"><a class="btn" href="${resetLink}">Redefinir minha senha</a></div>
    <p class="note">Este link é válido por ${hours} horas. Se você não solicitou a redefinição, ignore este e-mail — sua senha permanece inalterada.</p>
    <p class="note">Se o botão não funcionar, copie e cole este link no navegador:<br><span style="color:#3B5CE4">${resetLink}</span></p>
  </div>
</div>
</body></html>`,
    text: `Olá, ${name}!\n\nRedefinição de senha — Orquestra ERP\n\nClique no link abaixo para criar nova senha (válido por ${hours}h):\n${resetLink}\n\nSe não solicitou, ignore este e-mail.`,
  };
}
