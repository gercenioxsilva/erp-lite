import axios, { AxiosInstance } from 'axios';
import type { MarketplaceAdapter, SyncMaterialOutcome, FetchResourceOutcome } from './index';
import type {
  MarketplaceConnectionTokens, MarketplaceSyncRequestMessage, RefreshedTokens, MlOrder,
} from '../lib/types';

interface MlTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface MlOrderItemApi {
  item: { id: string; title?: string; variation_id?: number | string | null };
  quantity: number;
  unit_price: number;
}

interface MlOrderApi {
  id: number | string;
  order_items: MlOrderItemApi[];
}

const TOKEN_REFRESH_SAFETY_MS = 5 * 60_000; // renova se faltar menos de 5 min

export class MercadoLivreAdapter implements MarketplaceAdapter {
  private readonly http: AxiosInstance;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly baseUrl: string,
    private readonly tokenUrl: string,
  ) {
    if (!clientId || !clientSecret) {
      throw new Error(
        'Mercado Livre adapter: MERCADO_LIVRE_CLIENT_ID e MERCADO_LIVRE_CLIENT_SECRET são ' +
        'obrigatórios. Configure as credenciais do app cadastrado no ambiente da Lambda.'
      );
    }
    this.http = axios.create({ baseURL: baseUrl, timeout: 15_000 });
  }

  /**
   * O refresh_token do Mercado Livre é de uso único — a API invalida o
   * anterior ao emitir um novo. Por isso o par renovado é sempre devolvido
   * para quem chamou (nunca fica só em memória), para o worker persistir de
   * volta em marketplace_connections; usar o refresh_token antigo de novo
   * depois de uma renovação derruba a conexão.
   */
  private async ensureFreshToken(conn: MarketplaceConnectionTokens): Promise<{ accessToken: string; refreshed?: RefreshedTokens }> {
    if (!conn.access_token || !conn.refresh_token) {
      throw new Error('Conexão sem access_token/refresh_token — reconectar o Mercado Livre.');
    }

    const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
    if (expiresAt - Date.now() > TOKEN_REFRESH_SAFETY_MS) {
      return { accessToken: conn.access_token };
    }

    const resp = await axios.post<MlTokenResponse>(
      this.tokenUrl,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: conn.refresh_token,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, timeout: 10_000 },
    );

    const refreshed: RefreshedTokens = {
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token,
      token_expires_at: new Date(Date.now() + resp.data.expires_in * 1000).toISOString(),
    };
    return { accessToken: refreshed.access_token, refreshed };
  }

  /**
   * Atualiza preço/estoque do anúncio. Limitação de v1 documentada: quando
   * ml_variation_id está presente, o PUT ainda mira o item base — variações
   * ficam para uma iteração futura, não travam o MVP do sync manual.
   */
  async syncMaterial(msg: MarketplaceSyncRequestMessage): Promise<SyncMaterialOutcome> {
    if (!msg.ml_item_id) {
      return { status: 'error', error_reason: 'ml_item_id ausente no vínculo' };
    }

    try {
      const { accessToken, refreshed } = await this.ensureFreshToken(msg.connection);

      const body: Record<string, unknown> = {};
      if (msg.sync_price && msg.price != null) body.price = Number(msg.price);
      if (msg.sync_stock && msg.available_quantity != null) body.available_quantity = msg.available_quantity;

      if (Object.keys(body).length === 0) {
        return { status: 'active', refreshed_tokens: refreshed };
      }

      await this.http.put(`/items/${msg.ml_item_id}`, body, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });

      return { status: 'active', refreshed_tokens: refreshed };
    } catch (err) {
      return { status: 'error', error_reason: extractErrorMessage(err) };
    }
  }

  /**
   * Só processa tópicos de pedido (ex.: orders_v2) — outros tópicos de
   * webhook (perguntas, itens) são reconhecidos e ignorados nesta fase, sem
   * erro (retorna ml_order: null).
   */
  async fetchResource(msg: MarketplaceSyncRequestMessage): Promise<FetchResourceOutcome> {
    if (!msg.topic?.startsWith('orders') || !msg.resource) {
      return { ml_order: null };
    }

    const { accessToken, refreshed } = await this.ensureFreshToken(msg.connection);

    const resp = await this.http.get<MlOrderApi>(msg.resource, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const mlOrder: MlOrder = {
      id: String(resp.data.id),
      items: (resp.data.order_items ?? []).map((it) => ({
        ml_item_id: it.item.id,
        ml_variation_id: it.item.variation_id != null ? String(it.item.variation_id) : null,
        quantity: it.quantity,
        unit_price: it.unit_price,
        title: it.item.title,
      })),
    };

    return { ml_order: mlOrder, refreshed_tokens: refreshed };
  }
}

function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return `ML API ${err.response?.status ?? '?'}: ${JSON.stringify(err.response?.data ?? err.message)}`;
  }
  return err instanceof Error ? err.message : String(err);
}
