// Cliente Pluggy (Open Finance) — transporte fino, molde serproClient/
// anthropicClient: gated por env (ausente ⇒ rotas 503), auth com cache de
// TTL lido da prática (apiKey vale ~2h; renovamos com margem), e modo de
// SIMULAÇÃO `local-` (mesma convenção do token Focus/município local-):
// PLUGGY_CLIENT_ID começando com 'local-' devolve dados sintéticos
// determinísticos — dev/E2E sem conta Pluggy.

import { PluggyTransaction } from '../domain/import/openFinanceDomain';

const BASE_URL = () => process.env.PLUGGY_BASE_URL || 'https://api.pluggy.ai';

export function isOpenFinanceEnabled(): boolean {
  return Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
}

export function isSimulated(): boolean {
  return (process.env.PLUGGY_CLIENT_ID ?? '').startsWith('local-');
}

export class PluggyError extends Error {
  constructor(public code: 'pluggy_auth_failed' | 'pluggy_request_failed', public detail?: unknown) {
    super(code); this.name = 'PluggyError';
  }
}

export interface PluggyItem {
  id: string;
  connector: { name: string } | null;
  status: string;
}

export interface PluggyAccount {
  id: string;
  type: string | null;      // BANK | CREDIT
  subtype: string | null;   // CHECKING_ACCOUNT | ...
  name: string | null;
  number: string | null;    // já mascarado pela Pluggy
  currencyCode: string | null;
}

// apiKey da Pluggy vale ~2h — cache em módulo com margem de 5 min.
let cachedApiKey: { key: string; expiresAt: number } | null = null;

async function apiKey(): Promise<string> {
  if (cachedApiKey && Date.now() < cachedApiKey.expiresAt) return cachedApiKey.key;
  const res = await fetch(`${BASE_URL()}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new PluggyError('pluggy_auth_failed', { status: res.status });
  const body = await res.json() as { apiKey?: string };
  if (!body.apiKey) throw new PluggyError('pluggy_auth_failed', { reason: 'sem apiKey na resposta' });
  cachedApiKey = { key: body.apiKey, expiresAt: Date.now() + (2 * 60 - 5) * 60_000 };
  return body.apiKey;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL()}${path}`, { headers: { 'X-API-KEY': await apiKey() } });
  if (!res.ok) throw new PluggyError('pluggy_request_failed', { status: res.status, path });
  return res.json() as Promise<T>;
}

/** Token de sessão do widget Pluggy Connect (frontend). */
export async function createConnectToken(): Promise<string> {
  if (isSimulated()) return 'local-connect-token';
  const res = await fetch(`${BASE_URL()}/connect_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': await apiKey() },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new PluggyError('pluggy_request_failed', { status: res.status, path: '/connect_token' });
  const body = await res.json() as { accessToken?: string };
  if (!body.accessToken) throw new PluggyError('pluggy_request_failed', { reason: 'sem accessToken' });
  return body.accessToken;
}

export async function getItem(itemId: string): Promise<PluggyItem> {
  if (isSimulated()) return { id: itemId, connector: { name: 'Banco Simulado' }, status: 'UPDATED' };
  return get<PluggyItem>(`/items/${itemId}`);
}

export async function getAccounts(itemId: string): Promise<PluggyAccount[]> {
  if (isSimulated()) {
    return [{
      id: `${itemId}-acc-1`, type: 'BANK', subtype: 'CHECKING_ACCOUNT',
      name: 'Conta Corrente Simulada', number: '****1234', currencyCode: 'BRL',
    }];
  }
  const body = await get<{ results: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`);
  return body.results ?? [];
}

/** Todas as páginas de transações da conta na janela [from, to]. */
export async function getTransactions(accountId: string, fromISO: string, toISO: string): Promise<PluggyTransaction[]> {
  if (isSimulated()) return simulatedTransactions(accountId);
  const out: PluggyTransaction[] = [];
  let page = 1;
  for (;;) {
    const body = await get<{ results: PluggyTransaction[]; page: number; totalPages: number }>(
      `/transactions?accountId=${encodeURIComponent(accountId)}&from=${fromISO}&to=${toISO}&pageSize=500&page=${page}`,
    );
    out.push(...(body.results ?? []));
    if (!body.totalPages || page >= body.totalPages) break;
    page++;
  }
  return out;
}

// Determinístico de propósito: re-sync no modo local prova o dedup (2ª
// passada = tudo duplicate), e o PIX com pagador nomeado exercita o caminho
// customer_name/document → score de conciliação.
function simulatedTransactions(accountId: string): PluggyTransaction[] {
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  return [
    {
      id: 'local-tx-pix-1', accountId, date: day(2),
      description: 'PIX RECEBIDO CLIENTE DEMO', amount: 350.0, type: 'CREDIT', status: 'POSTED',
      paymentData: { paymentMethod: 'PIX', payer: { name: 'Cliente Demo LTDA', documentNumber: { value: '11.222.333/0001-44' } } },
    },
    {
      id: 'local-tx-ted-1', accountId, date: day(5),
      description: 'TED RECEBIDA', amount: 1200.5, type: 'CREDIT', status: 'POSTED',
      paymentData: { paymentMethod: 'TED', payer: { name: 'Fornecedor XPTO', documentNumber: { value: '99.888.777/0001-66' } } },
    },
    {
      id: 'local-tx-tarifa-1', accountId, date: day(3),
      description: 'TARIFA PACOTE SERVIÇOS', amount: -39.9, type: 'DEBIT', status: 'POSTED',
      paymentData: null,
    },
    {
      id: 'local-tx-pending-1', accountId, date: day(1),
      description: 'PIX AGENDADO (NÃO ENTRA)', amount: 10, type: 'CREDIT', status: 'PENDING',
      paymentData: { paymentMethod: 'PIX' },
    },
  ];
}
