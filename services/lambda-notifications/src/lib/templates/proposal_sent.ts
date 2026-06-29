import type { TemplateData, EmailTemplate } from '../types';

export function proposalSentTemplate(data: TemplateData): EmailTemplate {
  const clientName     = String(data['client_name']     || 'Cliente');
  const issuerName     = String(data['issuer_name']     || 'Empresa');
  const issuerLogo     = String(data['issuer_logo']     || '');
  const proposalNumber = String(data['proposal_number'] || '');
  const proposalTitle  = String(data['proposal_title']  || 'Proposta');
  const proposalLink   = String(data['proposal_link']   || '#');
  const validUntil     = String(data['valid_until']     || '');
  const total          = String(data['total']           || '0.00');

  const fmtDate  = validUntil
    ? new Date(validUntil + 'T12:00:00Z').toLocaleDateString('pt-BR')
    : '';
  const fmtTotal = Number(total).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  const logoBlock = issuerLogo
    ? `<img src="${issuerLogo}" alt="${issuerName}" height="48"
         style="max-height:48px;max-width:220px;object-fit:contain;display:block;margin:0 auto;">`
    : `<span style="font-size:22px;font-weight:800;color:#0D1B2A;letter-spacing:-0.5px;">${issuerName}</span>`;

  const subject = `${issuerName} enviou uma proposta para você — ${proposalTitle}`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Proposta de ${issuerName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
      background: #F7F9FC;
      color: #0D1B2A;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper { padding: 40px 16px; }
    .card {
      max-width: 560px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 4px;
      overflow: hidden;
      box-shadow: 0 1px 6px rgba(0,0,0,.07);
    }

    /* ── Header ── */
    .hdr {
      padding: 40px 48px 36px;
      text-align: center;
      border-bottom: 3px solid #3B5CE4;
    }

    /* ── Body ── */
    .body { padding: 40px 48px; }
    .greeting {
      font-size: 18px;
      font-weight: 700;
      color: #0D1B2A;
      margin-bottom: 8px;
    }
    .intro {
      font-size: 14px;
      color: #6B7280;
      line-height: 1.75;
      margin-bottom: 32px;
    }

    /* ── Proposal section ── */
    .rule { border: none; border-top: 1px solid #E2E8F0; margin: 0 0 28px; }
    .meta {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #3B5CE4;
      margin-bottom: 8px;
    }
    .prop-title {
      font-size: 20px;
      font-weight: 700;
      color: #0D1B2A;
      line-height: 1.35;
      margin-bottom: 32px;
    }

    /* ── Total ── */
    .total-block {
      border-top: 1px solid #E2E8F0;
      border-bottom: 1px solid #E2E8F0;
      padding: 24px 0;
      margin-bottom: 28px;
    }
    .total-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #6B7280;
      margin-bottom: 8px;
    }
    .total-value {
      font-size: 48px;
      font-weight: 800;
      color: #0D1B2A;
      letter-spacing: -2px;
      line-height: 1;
    }
    .total-curr {
      font-size: 22px;
      font-weight: 700;
      color: #3B5CE4;
      vertical-align: super;
      letter-spacing: 0;
    }
    .valid-line {
      font-size: 13px;
      color: #6B7280;
      margin-top: 12px;
    }

    /* ── CTA ── */
    .btn-wrap { text-align: center; margin: 32px 0 28px; }
    .btn {
      display: inline-block;
      background: #3B5CE4;
      color: #ffffff;
      text-decoration: none;
      font-size: 15px;
      font-weight: 700;
      padding: 14px 44px;
      border-radius: 4px;
      letter-spacing: 0.2px;
    }

    /* ── Hint ── */
    .hint {
      font-size: 12px;
      color: #9CA3AF;
      text-align: center;
      line-height: 1.8;
    }

    /* ── Footer ── */
    .footer {
      background: #F7F9FC;
      border-top: 1px solid #E2E8F0;
      padding: 20px 48px;
      text-align: center;
      font-size: 11px;
      color: #9CA3AF;
      line-height: 1.7;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">

      <!-- Header: issuer identity -->
      <div class="hdr">
        ${logoBlock}
      </div>

      <!-- Body -->
      <div class="body">

        <p class="greeting">Olá, ${clientName}!</p>
        <p class="intro">
          <strong style="color:#0D1B2A;">${issuerName}</strong> compartilhou uma
          proposta comercial com você. Revise os detalhes abaixo e acesse o link
          para ver todos os termos e condições.
        </p>

        <hr class="rule">

        <p class="meta">Proposta${proposalNumber ? ` &middot; #${proposalNumber}` : ''}</p>
        <p class="prop-title">${proposalTitle}</p>

        <div class="total-block">
          <p class="total-label">Valor total</p>
          <p class="total-value">
            <span class="total-curr">R$&thinsp;</span>${fmtTotal}
          </p>
          ${fmtDate ? `<p class="valid-line">Válida até <strong style="color:#0D1B2A;">${fmtDate}</strong></p>` : ''}
        </div>

        <div class="btn-wrap">
          <a class="btn" href="${proposalLink}" target="_blank">Ver Proposta Completa</a>
        </div>

        <p class="hint">
          Você pode aceitar ou solicitar alterações diretamente pelo link acima.<br>
          Caso não reconheça este envio, ignore este e-mail.
        </p>

      </div>

      <!-- Footer -->
      <div class="footer">
        Enviado por <strong style="color:#6B7280;">${issuerName}</strong>
        via <strong style="color:#6B7280;">Orquestra ERP</strong><br>
        Este e-mail foi gerado automaticamente. Não responda a esta mensagem.
      </div>

    </div>
  </div>
</body>
</html>`;

  const text = [
    `Olá, ${clientName}!`,
    ``,
    `${issuerName} enviou uma proposta comercial para você:`,
    ``,
    `Proposta${proposalNumber ? ` #${proposalNumber}` : ''}: ${proposalTitle}`,
    `Valor total: R$ ${fmtTotal}`,
    ...(fmtDate ? [`Válida até: ${fmtDate}`] : []),
    ``,
    `Acesse a proposta completa em:`,
    proposalLink,
    ``,
    `Você pode aceitar ou solicitar alterações diretamente pelo link acima.`,
    ``,
    `---`,
    `Enviado por ${issuerName} via Orquestra ERP.`,
    `Este e-mail foi gerado automaticamente. Não responda a esta mensagem.`,
  ].join('\n');

  return { subject, html, text };
}
