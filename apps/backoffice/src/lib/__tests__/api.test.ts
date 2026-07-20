import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { api, ApiError } from '../api';

function mockFetchOnce(status: number, body: string, ok = status >= 200 && status < 300): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
  }));
}

describe('api.get', () => {
  beforeEach(() => {
    // jsdom nesta config não expõe localStorage por padrão (Node experimental
    // global vence) — api.ts lê localStorage.getItem('token') incondicionalmente.
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retorna os dados quando a resposta 2xx tem corpo JSON válido', async () => {
    mockFetchOnce(200, JSON.stringify({ data: [] }));

    const result = await api.get<{ data: unknown[] }>('/v1/clients');

    expect(result).toEqual({ data: [] });
  });

  it('lança ApiError com mensagem tratável quando uma resposta 2xx traz corpo não-JSON (HTML)', async () => {
    mockFetchOnce(200, '<!doctype html><html><body>index</body></html>');

    await expect(api.get('/v1/technicians')).rejects.toMatchObject({
      name: 'ApiError',
      message: expect.not.stringContaining('Unexpected token'),
    });
  });

  it('a ApiError lançada é uma instância de ApiError (não SyntaxError crua)', async () => {
    mockFetchOnce(200, '<!doctype html><html><body>index</body></html>');

    await expect(api.get('/v1/technicians')).rejects.toBeInstanceOf(ApiError);
  });
});
