// Histórico de chamadas às integrações externas. Leitura exige
// tenant_modules:manage (mesma trava da mutação) — a página só monta este bloco
// para quem tem a permissão.

import { useEffect, useState } from 'react';
import './integrations.css';
import { DataTable, Drawer } from '../../ds';
import type { Column } from '../../ds';
import { api, actionErrorMessage } from '../../lib/api';
import type { IntegrationLogRow, IntegrationLogsPage } from './types';

const PAGE_SIZE = 20;

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v);

const asJson = (v: unknown) => JSON.stringify(v, null, 2);

/**
 * O `detail` do log é JSONB livre. Quando o gravador separa request/response
 * (é o caso do ping), mostramos cada um no seu bloco, como no padrão de
 * observabilidade de integração. Qualquer outro formato cai no bloco único —
 * assim um provider novo que grave outra forma ainda aparece legível.
 */
function renderDetailBlocks(detail: unknown) {
  if (detail === null || detail === undefined) {
    return <pre className="int-log-detail">Sem detalhe registrado.</pre>;
  }
  const obj = typeof detail === 'object' && !Array.isArray(detail)
    ? detail as Record<string, unknown>
    : null;
  const hasSplit = obj !== null && ('request' in obj || 'response' in obj);

  if (!hasSplit) return <pre className="int-log-detail">{asJson(detail)}</pre>;

  const rest = Object.fromEntries(
    Object.entries(obj).filter(([k]) => k !== 'request' && k !== 'response'),
  );
  return (
    <>
      {'request' in obj && (
        <>
          <h4 className="int-log-block-title">REQUEST</h4>
          <pre className="int-log-detail">{asJson(obj.request)}</pre>
        </>
      )}
      {'response' in obj && (
        <>
          <h4 className="int-log-block-title">RESPONSE</h4>
          <pre className="int-log-detail">{asJson(obj.response)}</pre>
        </>
      )}
      {Object.keys(rest).length > 0 && (
        <>
          <h4 className="int-log-block-title">OUTROS</h4>
          <pre className="int-log-detail">{asJson(rest)}</pre>
        </>
      )}
    </>
  );
}

interface IntegrationLogsTableProps {
  /** Opções do filtro — derivadas dos cards, não de uma lista fixa aqui. */
  providers: Array<{ key: string; label: string }>;
  /** Muda quando a página dispara algo que gera log (ping) — força recarga. */
  refreshKey: number;
}

export function IntegrationLogsTable({ providers, refreshKey }: IntegrationLogsTableProps) {
  const [provider, setProvider] = useState('');
  const [status, setStatus]     = useState('');
  const [page, setPage]         = useState(1);
  const [data, setData]         = useState<IntegrationLogsPage | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [selected, setSelected] = useState<IntegrationLogRow | null>(null);

  useEffect(() => {
    // Guarda contra resposta fora de ordem: trocar o filtro rápido pode fazer a
    // resposta antiga chegar depois da nova e sobrescrever a tabela.
    let cancelled = false;
    setLoading(true); setError('');

    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (provider) qs.set('provider', provider);
    if (status)   qs.set('status', status);

    api.get<{ data: IntegrationLogsPage }>(`/v1/tenant/integrations/logs?${qs.toString()}`)
      .then(resp => { if (!cancelled) setData(resp.data); })
      .catch(err => { if (!cancelled) setError(actionErrorMessage(err, 'Falha ao carregar os logs')); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [provider, status, page, refreshKey]);

  function changeFilter(next: () => void) {
    next();
    setPage(1); // filtro novo com página 3 devolveria uma lista vazia enganosa
  }

  const logs       = data?.logs ?? [];
  const total      = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const columns: Array<Column<IntegrationLogRow>> = [
    { key: 'created_at', header: 'DATA', render: row => fmtDateTime(row.created_at) },
    {
      key: 'provider', header: 'PROVIDER',
      render: row => (
        <>
          <code style={{ fontSize: 12 }}>{row.provider_key}</code>
          {row.environment && (
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{row.environment}</div>
          )}
        </>
      ),
    },
    { key: 'service', header: 'SERVICE', render: row => row.service },
    {
      key: 'status', header: 'STATUS',
      render: row => (
        <span className={`int-log-status int-log-status--${row.status}`}>
          {row.status === 'success' ? 'SUCESSO' : 'ERRO'}
        </span>
      ),
    },
    { key: 'http', header: 'HTTP', align: 'right', render: row => dash(row.http_status) },
    {
      key: 'latency', header: 'LATÊNCIA', align: 'right',
      render: row => (row.latency_ms === null ? '—' : `${row.latency_ms} ms`),
    },
    { key: 'error', header: 'ERRO', render: row => dash(row.error_code) },
    {
      key: 'actions', header: '', align: 'right',
      render: row => (
        // A linha inteira já abre o detalhe (onRowClick). O botão fica como
        // afordância visível — stopPropagation evita disparar os dois handlers.
        <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
          onClick={e => { e.stopPropagation(); setSelected(row); }}>
          Ver
        </button>
      ),
    },
  ];

  return (
    <section>
      <div className="int-section__head">
        <div>
          <h2>Logs de integração</h2>
          <p>Histórico de chamadas às integrações externas.</p>
        </div>
      </div>

      <div className="int-section__head">
        <div className="int-filters">
          <select aria-label="Filtrar por provider" value={provider}
            onChange={e => changeFilter(() => setProvider(e.target.value))}>
            <option value="">Todos providers</option>
            {providers.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <select aria-label="Filtrar por status" value={status}
            onChange={e => changeFilter(() => setStatus(e.target.value))}>
            <option value="">Todos status</option>
            <option value="success">Sucesso</option>
            <option value="error">Erro</option>
          </select>
        </div>
        <span className="int-logs-count">
          {total} log(s) — página {data?.page ?? page}/{totalPages}
        </span>
      </div>

      {error && <div role="alert" className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="table-scroll">
          <DataTable
            columns={columns}
            rows={logs}
            onRowClick={setSelected}
            loading={loading}
            emptyState="Nenhuma chamada registrada ainda."
          />
        </div>
      </div>

      {totalPages > 1 && (
        <div className="int-pagination">
          <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
            disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>
            Anterior
          </button>
          <span>Página {page} de {totalPages}</span>
          <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
            disabled={page >= totalPages || loading} onClick={() => setPage(p => p + 1)}>
            Próxima
          </button>
        </div>
      )}

      {selected && (
        <Drawer open onClose={() => setSelected(null)} title="Detalhe da chamada"
          subTitle={`${selected.provider_key} · ${selected.service}`}>
          <Drawer.Body>
            <dl className="int-log-meta">
              <dt>ID</dt><dd className="int-log-mono">{selected.id}</dd>
              <dt>Data</dt><dd>{fmtDateTime(selected.created_at)}</dd>
              <dt>Provider</dt><dd className="int-log-mono">{selected.provider_key}</dd>
              <dt>Service</dt><dd className="int-log-mono">{selected.service}</dd>
              <dt>Ambiente</dt><dd>{dash(selected.environment)}</dd>
              <dt>Status</dt>
              <dd>
                <span className={`int-log-status int-log-status--${selected.status}`}>
                  {selected.status === 'success' ? 'SUCESSO' : 'ERRO'}
                </span>
              </dd>
              <dt>HTTP</dt><dd>{dash(selected.http_status)}</dd>
              <dt>Latência</dt><dd>{selected.latency_ms === null ? '—' : `${selected.latency_ms} ms`}</dd>
              <dt>Erro</dt><dd>{dash(selected.error_code)}</dd>
            </dl>
            {renderDetailBlocks(selected.detail)}
          </Drawer.Body>
          <Drawer.Footer>
            <button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>
              Fechar
            </button>
          </Drawer.Footer>
        </Drawer>
      )}
    </section>
  );
}
