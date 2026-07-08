const BASE = import.meta.env.VITE_API_URL ?? '';

// Emitido quando um request autenticado recebe 401 (sessão expirada/revogada).
// O AuthProvider ouve e zera o estado → redireciona para /login.
export const AUTH_SIGNOUT_EVENT = 'auth:signout';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

// Shared by any page that surfaces a failed API call's message directly
// (BillingPage, RegisterPage's plan step, etc.) instead of a generic fallback.
export function actionErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem('token');
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        // Fastify's default JSON parser rejects a request that declares
        // application/json but sends no body (FST_ERR_CTP_EMPTY_JSON_BODY) —
        // only set this header when there's actually a body to parse.
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor', 0);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    // 401 com token presente = sessão expirada/revogada → auto-logout.
    // (Login inválido também retorna 401, mas ali não há token, então cai fora.)
    if (res.status === 401 && token) {
      localStorage.removeItem('token');
      window.dispatchEvent(new Event(AUTH_SIGNOUT_EVENT));
    }
    throw new ApiError(err.message || `HTTP ${res.status}`, res.status);
  }

  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export const api = {
  get:    <T>(path: string)               => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown) => request<T>('POST',   path, body),
  put:    <T>(path: string, body: unknown) => request<T>('PUT',    path, body),
  patch:  <T>(path: string, body: unknown) => request<T>('PATCH',  path, body),
  delete: <T>(path: string)               => request<T>('DELETE', path),
};
