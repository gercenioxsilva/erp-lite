import { describe, it, expect, vi, afterEach } from 'vitest';
import { testarConexaoTwilio, testarConexaoProvider } from '../services/whatsappConnectionClient';

describe('testarConexaoTwilio', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('ok quando o Twilio aceita a Basic Auth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await testarConexaoTwilio('AC123', 'tok123');
    expect(result).toEqual({ ok: true });
  });

  it('reason específico quando as credenciais são inválidas (401)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const result = await testarConexaoTwilio('AC123', 'tok-errado');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/inválidos/);
  });

  it('nunca lança — falha de rede vira {ok:false, reason}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const result = await testarConexaoTwilio('AC123', 'tok123');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Falha de comunicação/);
  });
});

describe('testarConexaoProvider', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('provedor não suportado devolve ok:false sem tentar rede', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await testarConexaoProvider('outro_provedor', { account_sid: 'x', auth_token: 'y' });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
