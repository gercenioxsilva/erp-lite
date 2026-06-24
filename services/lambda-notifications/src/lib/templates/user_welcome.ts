import type { TemplateData, EmailTemplate } from '../types';

export function userWelcomeTemplate(data: TemplateData): EmailTemplate {
  const name      = String(data.name      ?? '');
  const email     = String(data.email     ?? '');
  const password  = String(data.password  ?? '');
  const login_url = String(data.login_url ?? 'https://orquestraerp.com.br');

  const subject = `Bem-vindo ao Orquestra ERP — suas credenciais de acesso`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bem-vindo ao Orquestra ERP</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      background: #F2F5FB;
      color: #0D1B2A;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper { padding: 32px 16px; }
    .container {
      max-width: 560px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(59, 92, 228, 0.10);
    }

    /* ── Header ── */
    .header {
      background: linear-gradient(135deg, #3B5CE4 0%, #00B4D8 100%);
      padding: 36px 40px 32px;
      text-align: center;
    }
    .logo-arc {
      display: inline-block;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: rgba(255,255,255,0.15);
      border: 3px solid rgba(255,255,255,0.40);
      line-height: 58px;
      font-size: 28px;
      color: #fff;
      margin-bottom: 16px;
    }
    .header-brand {
      font-size: 22px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.5px;
    }
    .header-brand span {
      color: rgba(255,255,255,0.75);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 4px;
      text-transform: uppercase;
      display: block;
      margin-top: 2px;
    }
    .header-tagline {
      margin-top: 20px;
      font-size: 15px;
      color: rgba(255,255,255,0.90);
      line-height: 1.5;
    }

    /* ── Body ── */
    .body { padding: 36px 40px; }
    .greeting {
      font-size: 20px;
      font-weight: 700;
      color: #0D1B2A;
      margin-bottom: 12px;
    }
    .intro {
      font-size: 14px;
      color: #4A5568;
      line-height: 1.7;
      margin-bottom: 28px;
    }

    /* ── Credentials card ── */
    .cred-card {
      background: #F2F5FB;
      border: 1.5px solid #D6DFF7;
      border-radius: 10px;
      padding: 24px 28px;
      margin-bottom: 28px;
    }
    .cred-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #3B5CE4;
      margin-bottom: 16px;
    }
    .cred-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 14px;
    }
    .cred-row:last-child { margin-bottom: 0; }
    .cred-icon {
      width: 36px;
      height: 36px;
      background: #3B5CE4;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 16px;
      line-height: 36px;
      text-align: center;
      color: #fff;
    }
    .cred-content { flex: 1; }
    .cred-label {
      font-size: 11px;
      color: #718096;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 3px;
    }
    .cred-value {
      font-size: 15px;
      font-weight: 600;
      color: #0D1B2A;
      font-family: 'Courier New', Courier, monospace;
      background: #ffffff;
      border: 1px solid #D6DFF7;
      border-radius: 6px;
      padding: 7px 12px;
      word-break: break-all;
    }

    /* ── CTA Button ── */
    .btn-wrap { text-align: center; margin-bottom: 28px; }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #3B5CE4 0%, #00B4D8 100%);
      color: #ffffff !important;
      text-decoration: none;
      font-size: 15px;
      font-weight: 700;
      padding: 14px 40px;
      border-radius: 8px;
      letter-spacing: 0.3px;
      box-shadow: 0 4px 14px rgba(59, 92, 228, 0.35);
    }

    /* ── Security tip ── */
    .security-tip {
      background: #FFF8E6;
      border-left: 3px solid #F6AD55;
      border-radius: 0 8px 8px 0;
      padding: 14px 18px;
      font-size: 13px;
      color: #744210;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .security-tip strong { color: #92400E; }

    /* ── Divider ── */
    .divider {
      border: none;
      border-top: 1px solid #E8EDFA;
      margin: 24px 0;
    }

    .help-text {
      font-size: 13px;
      color: #718096;
      line-height: 1.7;
      text-align: center;
    }
    .help-text a { color: #3B5CE4; text-decoration: none; }

    /* ── Footer ── */
    .footer {
      background: #F2F5FB;
      border-top: 1px solid #E8EDFA;
      padding: 20px 40px;
      text-align: center;
      font-size: 11px;
      color: #A0AEC0;
      line-height: 1.6;
    }
    .footer strong { color: #718096; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">

      <!-- Header -->
      <div class="header">
        <div class="logo-arc">&#9835;</div>
        <div class="header-brand">
          Orquestra
          <span>ERP</span>
        </div>
        <div class="header-tagline">
          Seu acesso ao sistema está pronto!
        </div>
      </div>

      <!-- Body -->
      <div class="body">
        <div class="greeting">Olá, ${name || 'usuário'}!</div>
        <div class="intro">
          Sua conta no <strong>Orquestra ERP</strong> foi criada com sucesso.
          Use as credenciais abaixo para acessar o sistema pela primeira vez.
        </div>

        <!-- Credentials -->
        <div class="cred-card">
          <div class="cred-title">&#128273; Suas credenciais de acesso</div>

          <div class="cred-row">
            <div class="cred-icon">@</div>
            <div class="cred-content">
              <div class="cred-label">E-mail de login</div>
              <div class="cred-value">${email}</div>
            </div>
          </div>

          <div class="cred-row">
            <div class="cred-icon">&#128274;</div>
            <div class="cred-content">
              <div class="cred-label">Senha temporária</div>
              <div class="cred-value">${password}</div>
            </div>
          </div>
        </div>

        <!-- CTA -->
        <div class="btn-wrap">
          <a class="btn" href="${login_url}" target="_blank">
            &#9654;&nbsp; Acessar o Orquestra ERP
          </a>
        </div>

        <!-- Security tip -->
        <div class="security-tip">
          <strong>&#9888; Importante:</strong> Por segurança, recomendamos que você altere sua senha
          assim que acessar o sistema pela primeira vez. Nunca compartilhe suas credenciais com terceiros.
        </div>

        <hr class="divider">

        <div class="help-text">
          Caso tenha dúvidas ou não reconheça este cadastro, entre em contato
          com o administrador do sistema.<br><br>
          <strong>URL de acesso:</strong>&nbsp;
          <a href="${login_url}">${login_url}</a>
        </div>
      </div>

      <!-- Footer -->
      <div class="footer">
        <strong>Orquestra ERP</strong> &mdash; Sistema de Gestão Empresarial<br>
        Este e-mail foi gerado automaticamente. Não responda a esta mensagem.<br>
        &copy; ${new Date().getFullYear()} Orquestra ERP. Todos os direitos reservados.
      </div>

    </div>
  </div>
</body>
</html>`;

  const text = [
    `Bem-vindo ao Orquestra ERP!`,
    ``,
    `Olá, ${name || 'usuário'}!`,
    ``,
    `Sua conta foi criada com sucesso. Use as credenciais abaixo para acessar o sistema:`,
    ``,
    `  E-mail de login: ${email}`,
    `  Senha temporária: ${password}`,
    ``,
    `Acesse o sistema em: ${login_url}`,
    ``,
    `IMPORTANTE: Por segurança, altere sua senha assim que acessar o sistema pela primeira vez.`,
    `Nunca compartilhe suas credenciais com terceiros.`,
    ``,
    `---`,
    `Orquestra ERP — Sistema de Gestão Empresarial`,
    `Este e-mail foi gerado automaticamente. Não responda a esta mensagem.`,
  ].join('\n');

  return { subject, html, text };
}
