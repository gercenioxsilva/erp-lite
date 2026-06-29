import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

interface PosSale {
  id: string;
  created_at: string;
  session_id: string | null;
  customer_name: string | null;
  total: string;
  payments: Array<{ method: string; amount: string }> | null;
  status: string;
  fiscal_status: string;
  fiscal_chave: string | null;
  fiscal_url_danfe: string | null;
}

interface ListResp {
  data: PosSale[];
  total: number;
  page: number;
  per_page: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const FISCAL_BADGE: Record<string, string> = {
  none:            'badge-inactive',
  processando:     'badge-pending',
  autorizado:      'badge-paid',
  erro_autorizacao:'badge-cancelled',
  cancelado:       'badge-inactive',
  pendente:        'badge-issued',
};

const FISCAL_LABEL: Record<string, string> = {
  none: '—',
  processando: 'Processando',
  autorizado: 'Autorizado',
  erro_autorizacao: 'Erro',
  cancelado: 'Cancelado',
  pendente: 'Pendente',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Dinheiro',
  pix: 'PIX',
  debit: 'Débito',
  credit: 'Crédito',
  voucher: 'Voucher',
  store_credit: 'Crédito Loja',
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function saleBadgeClass(status: string): string {
  if (status === 'finalized') return 'badge badge-paid';
  if (status === 'cancelled') return 'badge badge-cancelled';
  if (status === 'open')      return 'badge badge-pending';
  return 'badge badge-inactive';
}

function saleBadgeLabel(status: string): string {
  if (status === 'finalized') return 'Finalizado';
  if (status === 'cancelled') return 'Cancelado';
  if (status === 'open') return 'Aberto';
  return status;
}

function fiscalKey(chave: string | null): string {
  if (!chave) return '—';
  return '…' + chave.slice(-8);
}

// ── Component ──────────────────────────────────────────────────────────────

export function PosHistoryPage() {
  const [sales, setSales] = useState<PosSale[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sessionFilter, setSessionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [reissuing, setReissuing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<PosSale | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const perPage = 20;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const p = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        ...(sessionFilter ? { session_id: sessionFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      const r = await api.get<ListResp>(`/v1/pos/sales?${p}`);
      setSales(r.data ?? []);
      setTotal(r.total ?? 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar histórico.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [page, sessionFilter, statusFilter]);

  async function handleReissue(id: string) {
    setReissuing(id);
    try {
      await api.post(`/v1/pos/sales/${id}/reissue-fiscal`, {});
      void load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao reemitir fiscal.');
    } finally {
      setReissuing(null);
    }
  }

  async function handleCancelConfirm() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.post(`/v1/pos/sales/${cancelTarget.id}/cancel`, {
        reason: cancelReason.trim() || 'Cancelamento pelo operador',
      });
      setCancelTarget(null);
      setCancelReason('');
      void load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar venda.');
      setCancelTarget(null);
    } finally {
      setCancelling(false);
    }
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1>Histórico de Vendas PDV</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
            Consulte e gerencie todas as vendas realizadas no PDV
          </p>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          placeholder="Buscar por sessão (ID)…"
          value={sessionFilter}
          onChange={e => { setSessionFilter(e.target.value); setPage(1); }}
          style={{ flex: 1, minWidth: 180 }}
        />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          style={{ width: 180 }}
        >
          <option value="">Todos os status</option>
          <option value="open">Aberta</option>
          <option value="finalized">Finalizada</option>
          <option value="cancelled">Cancelada</option>
        </select>
        {(sessionFilter || statusFilter) && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { setSessionFilter(''); setStatusFilter(''); setPage(1); }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div role="alert" className="alert alert-error" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="card">
        {loading ? (
          <div className="spinner">Carregando…</div>
        ) : sales.length === 0 ? (
          <div className="empty-state">Nenhuma venda encontrada.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Data</th>
                <th style={{ width: 160 }}>Sessão</th>
                <th>Cliente</th>
                <th className="text-right" style={{ width: 110 }}>Total</th>
                <th style={{ width: 160 }}>Pagamentos</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 110 }}>Fiscal</th>
                <th style={{ width: 110 }}>NF-e Chave</th>
                <th style={{ width: 120 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {sales.map(sale => (
                <tr key={sale.id}>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {new Date(sale.created_at).toLocaleString('pt-BR')}
                  </td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--muted)' }}>
                    {sale.session_id ? sale.session_id.slice(0, 12) + '…' : '—'}
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    {sale.customer_name ?? <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td className="text-right">
                    {BRL.format(Number(sale.total))}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {sale.payments && sale.payments.length > 0
                      ? sale.payments
                          .map(p => PAYMENT_LABELS[p.method] ?? p.method)
                          .join(', ')
                      : '—'}
                  </td>
                  <td>
                    <span className={saleBadgeClass(sale.status)}>
                      {saleBadgeLabel(sale.status)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${FISCAL_BADGE[sale.fiscal_status] ?? FISCAL_BADGE['none']}`}>
                      {FISCAL_LABEL[sale.fiscal_status] ?? sale.fiscal_status}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)' }}>
                    {fiscalKey(sale.fiscal_chave)}
                  </td>
                  <td>
                    <div className="flex-gap">
                      {sale.fiscal_status === 'autorizado' && sale.fiscal_url_danfe && (
                        <a
                          href={sale.fiscal_url_danfe}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary btn-sm"
                          style={{ width: 'auto' }}
                        >
                          DANFE
                        </a>
                      )}
                      {sale.fiscal_status === 'erro_autorizacao' && (
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ width: 'auto' }}
                          disabled={reissuing === sale.id}
                          onClick={() => void handleReissue(sale.id)}
                        >
                          {reissuing === sale.id ? 'Enviando…' : 'Reemitir'}
                        </button>
                      )}
                      {sale.status !== 'cancelled' && (
                        <button
                          className="btn btn-danger btn-sm"
                          style={{ width: 'auto' }}
                          onClick={() => { setCancelTarget(sale); setCancelReason(''); }}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Cancel Modal ── */}
      {cancelTarget && (
        <div className="modal-backdrop">
          <div className="modal-dialog" style={{ maxWidth: 420 }}>
            <h3 style={{ marginBottom: 4 }}>Cancelar venda</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
              {cancelTarget.status === 'finalized'
                ? 'Esta venda já foi finalizada. O cancelamento reverterá o estoque e, se a NFC-e estiver autorizada, ela também será cancelada junto à SEFAZ.'
                : 'Esta venda em aberto será cancelada.'}
            </p>
            <p style={{ fontSize: 13, marginBottom: 8, fontWeight: 500 }}>
              Total: {BRL.format(Number(cancelTarget.total))}
            </p>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
              Motivo (opcional)
            </label>
            <input
              autoFocus
              placeholder="Cancelamento pelo operador"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              style={{ marginBottom: 20 }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                style={{ width: 'auto' }}
                disabled={cancelling}
                onClick={() => { setCancelTarget(null); setCancelReason(''); }}
              >
                Voltar
              </button>
              <button
                className="btn btn-danger"
                style={{ width: 'auto' }}
                disabled={cancelling}
                onClick={() => void handleCancelConfirm()}
              >
                {cancelling ? 'Cancelando…' : 'Confirmar cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex-gap mt-16" style={{ justifyContent: 'flex-end' }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            Anterior
          </button>
          <span className="text-muted" style={{ fontSize: 13 }}>
            Página {page} de {totalPages}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
