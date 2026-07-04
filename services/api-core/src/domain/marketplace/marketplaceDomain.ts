// Domínio de Integração com Marketplace (Mercado Livre, regra 42) — puro, sem I/O.
//
// signState/verifyState protegem o callback OAuth contra CSRF sem precisar de
// tabela nova: o state carrega a própria empresa (company_id) assinada com
// HMAC-SHA256 + timestamp, e expira sozinho — mesmo raciocínio de minimalismo
// já usado no resto do projeto (nunca criar infra que uma função pura resolve).

import { createHmac, timingSafeEqual } from 'crypto';

export class MarketplaceDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'MarketplaceDomainError';
  }
}

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutos — tempo de sobra para o usuário autorizar no ML

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Assina company_id + timestamp — vira o parâmetro `state` da URL de autorização. */
export function signState(companyId: string, secret: string): string {
  const payload = `${companyId}.${Date.now()}`;
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payload, secret)}`;
}

export interface VerifyStateResult {
  valid: boolean;
  companyId?: string;
  reason?: 'malformed' | 'tampered' | 'expired';
}

/** Verifica o state recebido no callback OAuth — nunca confia no valor sem reassinar. */
export function verifyState(token: string, secret: string, now: number = Date.now()): VerifyStateResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };

  const [payloadB64, receivedSig] = parts;
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  const [companyId, timestampStr] = payload.split('.');
  const timestamp = Number(timestampStr);
  if (!companyId || !Number.isFinite(timestamp)) return { valid: false, reason: 'malformed' };

  const expectedSig = sign(payload, secret);
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  const receivedBuf = Buffer.from(receivedSig ?? '', 'hex');
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    return { valid: false, reason: 'tampered' };
  }

  if (now - timestamp > STATE_MAX_AGE_MS) return { valid: false, reason: 'expired' };

  return { valid: true, companyId };
}

export interface BuildAuthorizationUrlArgs {
  authUrl: string; // ex.: https://auth.mercadolivre.com.br/authorization
  clientId: string;
  redirectUri: string;
  state: string;
}

/** Monta a URL de autorização OAuth2 do Mercado Livre — nunca hardcoded fora daqui. */
export function buildAuthorizationUrl(args: BuildAuthorizationUrlArgs): string {
  const url = new URL(args.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('state', args.state);
  return url.toString();
}

// ── Mapeamento de pedido do Mercado Livre → shape de orders/order_items ──────

export interface MlOrderItem {
  ml_item_id: string;
  ml_variation_id?: string | null;
  quantity: number;
  unit_price: number;
  title?: string;
}

export interface MlOrder {
  id: string;
  items: MlOrderItem[];
}

export interface MaterialLinkLike {
  material_id: string;
  ml_item_id: string;
  ml_variation_id: string | null;
}

export interface MappedOrderItem {
  material_id: string;
  quantity: number;
  unit_price: number;
  name?: string;
}

export interface MapMlOrderResult {
  marketplace_order_id: string;
  items: MappedOrderItem[];
}

/**
 * Mapeia um pedido normalizado do Mercado Livre para o shape que orders/
 * order_items espera. Nunca cria order_item órfão: se algum item vendido não
 * tem material_marketplace_links correspondente, lança erro explícito em vez
 * de silenciosamente ignorar ou criar uma linha sem material_id.
 */
export function mapMlOrderToErpOrder(mlOrder: MlOrder, links: MaterialLinkLike[]): MapMlOrderResult {
  const items: MappedOrderItem[] = mlOrder.items.map(item => {
    const link = links.find(l =>
      l.ml_item_id === item.ml_item_id &&
      (item.ml_variation_id ? l.ml_variation_id === item.ml_variation_id : true),
    );
    if (!link) {
      throw new MarketplaceDomainError('unmatched_marketplace_item', {
        ml_item_id: item.ml_item_id, ml_variation_id: item.ml_variation_id ?? null,
      });
    }
    return {
      material_id: link.material_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      name: item.title,
    };
  });

  return { marketplace_order_id: mlOrder.id, items };
}
