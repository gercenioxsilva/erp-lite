import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

interface PosSession {
  id: string;
  status: string;
  terminal_code: string | null;
  terminal_name: string | null;
  opening_amount: string;
  opened_at: string;
  closed_at: string | null;
  closing_counted: string | null;
  closing_expected: string | null;
  difference: string | null;
  total_sales: number;
  total_revenue: string;
}

interface ListResp {
  data: PosSession[];
  total: number;
  page: number;
  per_page: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function parseDate(raw: string): Date {
  return new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
}

function fmtDate(raw: string | null): string {
  if (!raw) return '—';
  const d = parseDate(raw);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusBadge(status: string) {
  return status === 'open'
    ? <span className="badge badge-pending">Aberta</span>
    : <span className="badge badge-inactive">Fechada</span>;
}

// ── Component ──────────────────────────────────────────────────────────────

export function PosSessionsPage() {
  const [sessions, setSessions] = useState<PosSession[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<PosSession | null>(null);

  const perPage = 20;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const p = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      const r = await api.get<ListResp>(`/v1/pos/sessions?${p}`);
      setSessions(r.data ?? []);
      setTotal(r.total ?? 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar sessões.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [page, statusFilter]);

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1>Sessões de Caixa</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
            Histórico de todas as sessões de operadores no PDV
          </p>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          style={{ width: 180 }}
        >
          <option value="">Todos os status</option>
          <option value="open">Aberta</option>
          <option value="closed">Fechada</option>
        </select>
        {statusFilter && (
          <button
            className="btn btn-secondary btn-sm"
            style={{ width: 'auto' }}
            onClick={() => { setStatusFilter(''); setPage(1); }}
          >
            Limpar
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
        ) : sessions.length === 0 ? (
          <div className="empty-state">Nenhuma sessão encontrada.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Abertura</th>
                <th style={{ width: 150 }}>Fechamento</th>
                <th>Terminal</th>
                <th style={{ width: 90 }}>Status</th>
                <th className="text-right" style={{ width: 80 }}>Vendas</th>
                <th className="text-right" style={{ width: 120 }}>Faturamento</th>
                <th className="text-right" style={{ width: 120 }}>Diferença</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr
                  key={s.id}
                  onClick={() => setDetail(s)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDate(s.opened_at)}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDate(s.closed_at)}</td>
                  <td style={{ fontWeight: 500 }}>
                    {s.terminal_code
                      ? <><span style={{ fontFamily: 'monospace' }}>{s.terminal_code}</span> — {s.terminal_name}</>
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td>{statusBadge(s.status)}</td>
                  <td className="text-right">{s.total_sales}</td>
                  <td className="text-right">{BRL.format(Number(s.total_revenue))}</td>
                  <td className="text-right">
                    {s.difference != null ? (
                      <span style={{ color: Number(s.difference) < 0 ? 'var(--danger)' : 'inherit' }}>
                        {BRL.format(Number(s.difference))}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex-gap mt-16" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            Anterior
          </button>
          <span style={{ fontSize: 13, color: 'var(--muted)', alignSelf: 'center' }}>
            Página {page} de {totalPages}
          </span>
          <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            Próxima
          </button>
        </div>
      )}

      {/* ── Session Detail Modal ── */}
      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div
            className="modal-dialog"
            style={{ maxWidth: 480, textAlign: 'left' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>
                Sessão — {detail.terminal_code ?? '—'}
              </h3>
              <button
                className="btn btn-secondary btn-sm"
                style={{ width: 'auto' }}
                onClick={() => setDetail(null)}
              >
                Fechar
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', fontSize: 13 }}>
              <div>
                <span style={{ color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Status</span>
                {statusBadge(detail.status)}
              </div>
              <div>
                <span style={{ color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Terminal</span>
                <strong>{detail.terminal_name ?? '—'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Abertura</span>
                {fmtDate(detail.opened_at)}
              </div>
              <div>
                <span style={{ color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Fechamento</span>
                {fmtDate(detail.closed_at)}
              </div>
              <div>
                <span style={{ color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Fundo de caixa</span>
                {BRL.format(Number(detail.opening_amount))}
              </div>
              <div>
                <span style={{ color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Vendas finalizadas</span>
                {detail.total_sales}
              </div>
              <div>
                <span style={{ color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Faturamento</span>
                <strong>{BRL.format(Number(detail.total_revenue))}</strong>
              </div>
              {detail.closing_counted != null && (
                <div>
                  <span style={{ color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Contagem</span>
                  {BRL.format(Number(detail.closing_counted))}
                </div>
              )}
              {detail.closing_expected != null && (
                <div>
                  <span style={{ color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Esperado</span>
                  {BRL.format(Number(detail.closing_expected))}
                </div>
              )}
              {detail.difference != null && (
                <div style={{ gridColumn: '1/-1' }}>
                  <span style={{ color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Diferença</span>
                  <strong style={{ color: Number(detail.difference) < 0 ? 'var(--danger)' : 'inherit' }}>
                    {BRL.format(Number(detail.difference))}
                  </strong>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
