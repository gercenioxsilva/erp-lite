import type { SQSRecord } from 'aws-lambda';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { FastifyInstance } from 'fastify';
import { FocusEmpresaClient } from '../lib/focusEmpresa';
import type { FocusEmpresaResponse } from '../lib/focusEmpresa';
import type { CompanyRegistrationEmitMessage, CompanyRegistrationResultMessage } from '../lib/types';

/** Motivo de erro legível a partir da resposta do Focus (mesma lógica de nfeService.ts). */
function describeRegistrationError(result: FocusEmpresaResponse): string {
  if (result.erros?.length) {
    return result.erros.map(e => `[${e.codigo}] ${e.mensagem}`).join('; ');
  }
  if (result.codigo || result.mensagem) {
    return [result.codigo, result.mensagem].filter(Boolean).join(': ');
  }
  return 'Falha ao registrar a empresa no emissor fiscal (sem detalhes no retorno)';
}

/**
 * Registro assíncrono da empresa no emissor fiscal (regra 70). Diferente de
 * nfe/nfse/remessa, aqui não existe token por empresa ainda — usa sempre o
 * token mestre da plataforma (app.config.focusToken), nunca msg.focus_token.
 */
export async function processCompanyRegistrationRecord(app: FastifyInstance, record: SQSRecord): Promise<void> {
  const msg: CompanyRegistrationEmitMessage = JSON.parse(record.body);
  const { registration_id, tenant_id, focus_ref, ambiente, empresa } = msg;

  app.log.info({ event: 'company_registration_start', registration_id, tenant_id, focus_ref, ambiente });

  const token = app.config.focusToken;
  if (!token) throw new Error('No platform Focus token configured — set FOCUS_NFE_TOKEN');

  const focus = new FocusEmpresaClient(token, ambiente);

  const payload: Record<string, unknown> = {
    nome:                  empresa.razao_social,
    nome_fantasia:         empresa.nome_fantasia,
    cnpj:                  empresa.cnpj,
    inscricao_estadual:    empresa.inscricao_estadual,
    inscricao_municipal:   empresa.inscricao_municipal,
    regime_tributario:     empresa.regime_tributario,
    logradouro:            empresa.logradouro,
    numero:                empresa.numero,
    complemento:           empresa.complemento,
    bairro:                empresa.bairro,
    municipio:             empresa.municipio,
    codigo_municipio:      empresa.codigo_municipio_ibge,
    uf:                    empresa.uf,
    cep:                   empresa.cep,
    telefone_fixo:         empresa.telefone,
    email:                 empresa.email,
    habilita_nfe:          empresa.habilita_nfe,
    habilita_nfse:         empresa.habilita_nfse,
  };

  const result = await focus.criar(payload);
  app.log.info({ event: 'company_registration_submitted', registration_id, focus_id: result.id });

  let resultMsg: CompanyRegistrationResultMessage;

  if (result.erros?.length || result.codigo || result.mensagem) {
    const reason = describeRegistrationError(result);
    resultMsg = { type: 'company_registration', registration_id, tenant_id, registration_status: 'error', registration_error: reason };
    app.log.warn({ event: 'company_registration_rejected', registration_id, reason });
  } else {
    resultMsg = {
      type:                    'company_registration',
      registration_id,
      tenant_id,
      registration_status:     'registered',
      fiscal_integration_ref:  result.id !== undefined ? String(result.id) : undefined,
      token_producao:          result.token_producao,
      token_homologacao:       result.token_homologacao,
    };
    app.log.info({ event: 'company_registration_registered', registration_id, focus_id: result.id });
  }

  await app.sqs.send(new SendMessageCommand({
    QueueUrl:    app.config.nfeResultsQueueUrl,
    MessageBody: JSON.stringify(resultMsg),
  }));
}
