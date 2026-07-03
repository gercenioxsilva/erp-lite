import type { TemplateData } from '../types';

export function technicianWelcomeTemplate(data: TemplateData) {
  const name    = String(data['name']               || 'Técnico');
  const link    = String(data['set_password_link']  || '#');
  const hours   = String(data['expires_hours']       || '48');

  return {
    subject: 'Bem-vindo ao Orquestra ERP — defina sua senha de acesso',
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
    <p>Você foi cadastrado como técnico no Orquestra ERP. Antes de acessar suas visitas técnicas, defina sua senha de acesso:</p>
    <div style="text-align:center"><a class="btn" href="${link}">Definir minha senha</a></div>
    <p class="note">Este link é válido por ${hours} horas. Depois de definir a senha, você poderá acessar suas visitas técnicas fazendo login normalmente.</p>
    <p class="note">Se o botão não funcionar, copie e cole este link no navegador:<br><span style="color:#3B5CE4">${link}</span></p>
  </div>
</div>
</body></html>`,
    text: `Olá, ${name}!\n\nVocê foi cadastrado como técnico no Orquestra ERP.\n\nDefina sua senha de acesso (válido por ${hours}h):\n${link}\n\nDepois de definir a senha, você poderá acessar suas visitas técnicas fazendo login normalmente.`,
  };
}
