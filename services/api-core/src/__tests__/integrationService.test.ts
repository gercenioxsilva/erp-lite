// Regras puras das integrações (0091/0092) — as que, se quebrarem, quebram
// silenciosamente em produção:
//   · mergeCredentials: "vazio mantém" é o que permite editar UMA chave sem
//     reenviar as outras (a API nunca devolve o valor para reenviar).
//   · serviceEnabledIn: NULL = TODOS. Errar isso desliga, no deploy da 0092,
//     toda integração já configurada.
//   · redact: nenhum segredo pode chegar em integration_logs.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { mergeCredentials, serviceEnabledIn } from '../services/integrations/integrationService';
import { redact } from '../services/integrations/integrationLogService';

describe('mergeCredentials', () => {
  it('campo ausente mantém o valor atual', () => {
    const out = mergeCredentials({ consumer_key: 'antiga', consumer_secret: 's' }, {}, 'serpro');
    expect(out).toEqual({ consumer_key: 'antiga', consumer_secret: 's' });
  });

  it('string vazia também mantém (input em branco não é ordem de apagar)', () => {
    const out = mergeCredentials({ consumer_key: 'antiga' }, { consumer_key: '' }, 'serpro');
    expect(out.consumer_key).toBe('antiga');
  });

  it('null explícito apaga', () => {
    const out = mergeCredentials({ consumer_key: 'antiga' }, { consumer_key: null }, 'serpro');
    expect(out.consumer_key).toBeUndefined();
  });

  it('valor novo substitui e vem trimado', () => {
    const out = mergeCredentials({ consumer_key: 'antiga' }, { consumer_key: '  nova  ' }, 'serpro');
    expect(out.consumer_key).toBe('nova');
  });

  it('chave fora do catálogo é ignorada', () => {
    const out = mergeCredentials({}, { hackeado: 'x', consumer_key: 'ok' }, 'serpro');
    expect(out).toEqual({ consumer_key: 'ok' });
  });
});

describe('serviceEnabledIn', () => {
  it('NULL = todos habilitados (linhas anteriores à 0092 não podem desligar)', () => {
    expect(serviceEnabledIn(null, 'transmitir_pgdasd')).toBe(true);
    expect(serviceEnabledIn(null, 'qualquer_coisa')).toBe(true);
  });

  it('array vazio = nenhum habilitado', () => {
    expect(serviceEnabledIn([], 'transmitir_pgdasd')).toBe(false);
  });

  it('array = exatamente os listados', () => {
    expect(serviceEnabledIn(['gerar_das'], 'gerar_das')).toBe(true);
    expect(serviceEnabledIn(['gerar_das'], 'transmitir_pgdasd')).toBe(false);
  });
});

describe('redact', () => {
  it('remove valores cujo NOME de chave parece segredo', () => {
    const out = redact({
      url: 'https://api.exemplo/auth',
      consumer_secret: 'super-secreto',
      pfx_base64: 'MIIK...',
      senha: '1234',
      Authorization: 'Basic abc',
      status: 200,
    }) as Record<string, unknown>;

    expect(out.consumer_secret).toBe('[redacted]');
    expect(out.pfx_base64).toBe('[redacted]');
    expect(out.senha).toBe('[redacted]');
    expect(out.Authorization).toBe('[redacted]');
    // O que não é segredo continua legível — senão o log não serve para nada.
    expect(out.url).toBe('https://api.exemplo/auth');
    expect(out.status).toBe(200);
  });

  it('alcança segredo aninhado', () => {
    const out = redact({ request: { body: { client_secret: 'x' } } }) as any;
    expect(out.request.body.client_secret).toBe('[redacted]');
  });

  it('trunca string gigante (PDF do DAS em base64 pesaria megabytes por log)', () => {
    const out = redact({ pdf: 'A'.repeat(5000) }) as Record<string, string>;
    expect(out.pdf.length).toBeLessThan(2100);
    expect(out.pdf.endsWith('…[truncado]')).toBe(true);
  });
});
