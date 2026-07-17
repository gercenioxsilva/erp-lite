import { describe, it, expect, vi } from 'vitest';
import type { SQSRecord } from 'aws-lambda';
import type { FastifyInstance } from 'fastify';
import { processCompanyRegistrationRecord } from '../services/companyRegistrationService';
import type { CompanyRegistrationEmitMessage } from '../lib/types';

function makeApp(focusToken: string): { app: FastifyInstance; sent: any[] } {
  const sent: any[] = [];
  const app = {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: { focusToken, nfeResultsQueueUrl: 'results-queue' },
    sqs: { send: vi.fn((cmd: any) => { sent.push(JSON.parse(cmd.input.MessageBody)); return Promise.resolve({}); }) },
  } as unknown as FastifyInstance;
  return { app, sent };
}

function makeRecord(msg: Partial<CompanyRegistrationEmitMessage> = {}): SQSRecord {
  const body: CompanyRegistrationEmitMessage = {
    type: 'company_registration',
    registration_id: 'company-1',
    tenant_id: 'tenant-1',
    focus_ref: 'company-1',
    ambiente: 2,
    empresa: {
      cnpj: '12345678000190', razao_social: 'Empresa LTDA', regime_tributario: 1,
      logradouro: 'Rua A', numero: '100', bairro: 'Centro', municipio: 'SAO PAULO',
      uf: 'SP', cep: '01001000', habilita_nfe: true, habilita_nfse: true,
    },
    ...msg,
  };
  return { messageId: 'msg-1', body: JSON.stringify(body) } as SQSRecord;
}

describe('processCompanyRegistrationRecord', () => {
  it('publishes a registered result with tokens on success (simulation mode)', async () => {
    const { app, sent } = makeApp('local-test');
    await processCompanyRegistrationRecord(app, makeRecord());

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'company_registration', registration_id: 'company-1', tenant_id: 'tenant-1',
      registration_status: 'registered',
    });
    expect(sent[0].token_producao).toContain('local-prod-');
    expect(sent[0].token_homologacao).toContain('local-homolog-');
  });

  it('publishes an error result when the emissor rejects the registration', async () => {
    const { app, sent } = makeApp('local-reject');
    await processCompanyRegistrationRecord(app, makeRecord());

    expect(sent).toHaveLength(1);
    expect(sent[0].registration_status).toBe('error');
    expect(sent[0].registration_error).toBeTruthy();
  });

  it('throws when no platform token is configured', async () => {
    const { app } = makeApp('');
    await expect(processCompanyRegistrationRecord(app, makeRecord())).rejects.toThrow(/No platform Focus token/);
  });
});
