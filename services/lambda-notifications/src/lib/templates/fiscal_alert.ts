import type { TemplateData } from '../types';

// Alerta fiscal crítico (api-core: fiscalAlertService — só severity=critical
// gera e-mail, 1x por alerta, destinatário = owner do tenant).
// data: title, severity, rule.
export function fiscalAlertTemplate(data: TemplateData) {
  const title    = String(data['title'] || 'Alerta fiscal');
  const severity = String(data['severity'] || 'critical');
  const rule     = String(data['rule'] || '');

  return {
    subject: `[Fiscal] Alerta crítico: ${title}`,
    html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<style>body{margin:0;font-family:sans-serif;background:#F2F5FB}
.wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.hdr{background:linear-gradient(135deg,#B42318,#F04438);padding:32px;text-align:center;color:#fff}
.hdr h1{margin:0;font-size:22px;font-weight:700}
.body{padding:32px}
.card{background:#FEF3F2;border:1px solid #FDA29B;border-radius:8px;padding:16px 20px;margin:16px 0}
.card b{color:#B42318}
.note{font-size:13px;color:#6b7280;margin-top:16px}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>Orquestra ERP — Fiscal</h1></div>
  <div class="body">
    <p>Um alerta fiscal <strong>crítico</strong> foi detectado na sua empresa:</p>
    <div class="card">
      <p><b>${title}</b></p>
      <p>Severidade: <b>${severity}</b>${rule ? ` · Regra: <b>${rule}</b>` : ''}</p>
    </div>
    <p class="note">Acesse o módulo Fiscal para ver os detalhes e resolver a pendência. Este e-mail é enviado uma única vez por alerta.</p>
  </div>
</div>
</body></html>`,
    text: `Alerta fiscal crítico: ${title}\nSeveridade: ${severity}${rule ? `\nRegra: ${rule}` : ''}\n\nAcesse o módulo Fiscal para ver os detalhes e resolver a pendência.`,
  };
}
