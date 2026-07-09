import type { TemplateData } from '../types';

// Avatar hospedado como asset estático do backoffice (Vite serve tudo em
// apps/backoffice/public/ na raiz do site) — zero infraestrutura nova, e-mail
// só referencia a URL pública, nunca embute o arquivo.
const AVATAR_URL = 'https://orquestraerp.com.br/email/welcome-avatar.png';

export function tenantEmailVerificationTemplate(data: TemplateData) {
  const name  = String(data['name']          || 'Cliente Orquestra');
  const link  = String(data['verify_link']   || '#');
  const hours = String(data['expires_hours'] || '48');

  return {
    subject: 'Bem-vindo à Orquestra ERP! Confirme seu e-mail para ativar sua conta',
    html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<style>body{margin:0;font-family:sans-serif;background:#F2F5FB}
.wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.hdr{background:linear-gradient(135deg,#3B5CE4,#00B4D8);padding:32px;text-align:center;color:#fff}
.hdr img{width:96px;height:96px;display:block;margin:0 auto 12px}
.hdr h1{margin:0;font-size:22px;font-weight:700}
.body{padding:32px}
.btn{display:inline-block;margin:24px 0;padding:14px 28px;background:#3B5CE4;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px}
.note{font-size:13px;color:#6b7280;margin-top:16px}
</style></head><body>
<div class="wrap">
  <div class="hdr">
    <img src="${AVATAR_URL}" alt="Mascote Orquestra ERP" />
    <h1>Orquestra ERP</h1>
  </div>
  <div class="body">
    <p>Bem-vindo à Orquestra ERP! 🎉</p>
    <p>Estamos muito felizes em ter você com a gente, <strong>${name}</strong>. Confirme seu e-mail abaixo para ativar sua conta e começar a colocar a gestão da sua empresa em ordem.</p>
    <div style="text-align:center"><a class="btn" href="${link}">Confirmar meu e-mail</a></div>
    <p class="note">Este link é válido por ${hours} horas. Enquanto o e-mail não for confirmado, o acesso ao sistema fica limitado.</p>
    <p class="note">Se o botão não funcionar, copie e cole este link no navegador:<br><span style="color:#3B5CE4">${link}</span></p>
  </div>
</div>
</body></html>`,
    text: `Bem-vindo à Orquestra ERP!\n\nEstamos muito felizes em ter você com a gente, ${name}. Confirme seu e-mail para ativar sua conta (válido por ${hours}h):\n${link}\n\nEnquanto o e-mail não for confirmado, o acesso ao sistema fica limitado.`,
  };
}
