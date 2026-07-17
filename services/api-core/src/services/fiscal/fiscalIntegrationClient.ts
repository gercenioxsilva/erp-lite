// Cliente HTTP síncrono para gestão da empresa já registrada no emissor
// fiscal (upload de certificado digital A1, teste de conexão) — regra 70.
// Usa sempre o token mestre da plataforma (FOCUS_NFE_TOKEN), nunca o token
// por-empresa (esse é só pra emissão de documentos). Mesmo padrão de
// fetch()+Basic Auth já usado em services/fiscal/focusNfe.ts.

function focusAuth(): string {
  const token = process.env.FOCUS_NFE_TOKEN;
  if (!token) throw new Error('FOCUS_NFE_TOKEN not configured');
  return 'Basic ' + Buffer.from(token + ':').toString('base64');
}

function focusBaseUrlForAmbiente(ambiente: number): string {
  return ambiente === 1 ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br';
}

export interface CertificateUploadResult {
  ok: boolean;
  reason?: string;
  certificado_cnpj?:       string;
  certificado_valido_de?:  string;
  certificado_valido_ate?: string;
}

function describeEmpresaError(body: Record<string, unknown>, fallback: string): string {
  const erros = body.erros as Array<{ codigo?: string; mensagem?: string }> | undefined;
  if (erros?.length) return erros.map(e => [e.codigo, e.mensagem].filter(Boolean).join(': ')).join('; ');
  if (typeof body.mensagem === 'string') return body.mensagem;
  return fallback;
}

/** PUT /v2/empresas/{ref} com só os campos de certificado — não repisa o
 *  resto do cadastro, que já foi enviado no registro assíncrono. */
export async function uploadCertificado(
  fiscalIntegrationRef: string, ambiente: number,
  certificadoBase64: string, senhaCertificado: string,
): Promise<CertificateUploadResult> {
  const url = `${focusBaseUrlForAmbiente(ambiente)}/v2/empresas/${encodeURIComponent(fiscalIntegrationRef)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: focusAuth() },
      body: JSON.stringify({
        arquivo_certificado_base64: certificadoBase64,
        senha_certificado:          senhaCertificado,
      }),
    });
  } catch (err) {
    return { ok: false, reason: `Falha de comunicação ao enviar o certificado: ${String(err)}` };
  }

  let body: Record<string, unknown>;
  try {
    body = await res.json() as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'Resposta inválida ao enviar o certificado' };
  }

  if (!res.ok || body.erros) {
    return { ok: false, reason: describeEmpresaError(body, 'Falha ao enviar o certificado digital') };
  }

  return {
    ok: true,
    certificado_cnpj:       typeof body.certificado_cnpj       === 'string' ? body.certificado_cnpj       : undefined,
    certificado_valido_de:  typeof body.certificado_valido_de  === 'string' ? body.certificado_valido_de  : undefined,
    certificado_valido_ate: typeof body.certificado_valido_ate === 'string' ? body.certificado_valido_ate : undefined,
  };
}

export interface ConnectionTestResult {
  ok: boolean;
  reason?: string;
}

/** GET /v2/empresas/{ref} — só confirma que a empresa existe e responde no emissor. */
export async function testarConexaoFiscal(fiscalIntegrationRef: string, ambiente: number): Promise<ConnectionTestResult> {
  const url = `${focusBaseUrlForAmbiente(ambiente)}/v2/empresas/${encodeURIComponent(fiscalIntegrationRef)}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: focusAuth() } });
  } catch (err) {
    return { ok: false, reason: `Falha de comunicação com a integração fiscal: ${String(err)}` };
  }

  if (res.status === 404) {
    return { ok: false, reason: 'Empresa não encontrada na integração fiscal — refaça o registro' };
  }
  if (!res.ok) {
    return { ok: false, reason: `A integração fiscal retornou um erro (HTTP ${res.status})` };
  }
  return { ok: true };
}
