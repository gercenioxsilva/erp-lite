import { useEffect, useState } from 'react';
import { api, actionErrorMessage } from '../../lib/api';
import { usePermissions } from '../../rbac';

// Conexões bancárias Open Finance (Pluggy): o extrato entra sozinho (sync
// diário 23:59 + botão) e cai na fila de conciliação desta mesma página.
// Conectar/desconectar exige bank_accounts:manage (credencial bancária);
// sincronizar é fiscal:import. Modo simulado (PLUGGY_CLIENT_ID=local-*)
// registra um banco sintético — dev sem conta Pluggy.

interface ConnectionAccount {
  id: string; account_id: string; name: string | null;
  number_masked: string | null; subtype: string | null; sync_enabled: boolean;
  balance: string | null; balance_synced_at: string | null;
}
interface CashPosition {
  saldo_total: number;
  realizado_30d: { entradas: number; saidas: number };
  a_receber_30d: number;
  a_pagar_30d: number;
  projecao_30d: number;
}
interface Connection {
  id: string; institution: string | null; status: 'active' | 'error' | 'disconnected';
  last_synced_at: string | null; last_error: string | null; accounts: ConnectionAccount[];
}

declare global {
  interface Window { PluggyConnect?: new (opts: Record<string, unknown>) => { init: () => void }; }
}

const PLUGGY_WIDGET_SRC = 'https://cdn.pluggy.ai/pluggy-connect/v2/pluggy-connect.js';

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca';
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function loadPluggyScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.PluggyConnect) return resolve();
    const s = document.createElement('script');
    s.src = PLUGGY_WIDGET_SRC;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha ao carregar o widget Pluggy'));
    document.head.appendChild(s);
  });
}

export function OpenFinanceCard({ onSynced }: { onSynced?: () => void }) {
  const { can } = usePermissions();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [cash, setCash] = useState<CashPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canManage = can('bank_accounts:manage');
  const canSync = can('fiscal:import');

  async function load() {
    try {
      const [conns, pos] = await Promise.all([
        api.get<{ data: Connection[] }>('/v1/fiscal/openfinance/connections'),
        api.get<{ data: CashPosition }>('/v1/fiscal/openfinance/cash-position').catch(() => null),
      ]);
      setConnections(conns.data ?? []);
      setCash(pos?.data ?? null);
    } catch { /* módulo desabilitado ou sem permissão — o card mostra vazio */ }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function handleConnect() {
    setBusy('connect'); setError(''); setNotice('');
    try {
      const { data } = await api.post<{ data: { token: string; simulated: boolean } }>(
        '/v1/fiscal/openfinance/connect-token', {});
      if (data.simulated) {
        // Ambiente local-: registra o banco sintético direto, sem widget.
        await api.post('/v1/fiscal/openfinance/connections', { item_id: `local-item-${Date.now()}` });
        setNotice('Banco simulado conectado (modo de desenvolvimento).');
        await load();
      } else {
        await loadPluggyScript();
        const PluggyConnect = window.PluggyConnect;
        if (!PluggyConnect) throw new Error('Widget Pluggy indisponível');
        new PluggyConnect({
          connectToken: data.token,
          onSuccess: async (itemData: { item?: { id?: string } }) => {
            const itemId = itemData?.item?.id;
            if (!itemId) { setError('Conexão sem item_id — tente novamente'); return; }
            try {
              await api.post('/v1/fiscal/openfinance/connections', { item_id: itemId });
              setNotice('Banco conectado! O primeiro sync busca os últimos 90 dias.');
              await load();
            } catch (err) { setError(actionErrorMessage(err, 'Falha ao registrar a conexão')); }
          },
          onError: () => setError('Conexão cancelada ou recusada no banco'),
        }).init();
      }
    } catch (err) {
      const e = err as { status?: number };
      setError(e?.status === 503
        ? 'Open Finance não configurado neste ambiente (PLUGGY_CLIENT_ID/SECRET).'
        : actionErrorMessage(err, 'Falha ao iniciar a conexão'));
    } finally { setBusy(null); }
  }

  async function handleSync(id: string) {
    setBusy(id); setError(''); setNotice('');
    try {
      const { data } = await api.post<{ data: { inserted: number; duplicate: number; reconciliation: { autoConfirmed: number } | null } }>(
        `/v1/fiscal/openfinance/connections/${id}/sync`, {});
      setNotice(`Sync: ${data.inserted} novas, ${data.duplicate} já existiam` +
        (data.reconciliation ? `, ${data.reconciliation.autoConfirmed} conciliadas automaticamente` : ''));
      await load();
      onSynced?.();
    } catch (err) { setError(actionErrorMessage(err, 'Falha ao sincronizar')); }
    finally { setBusy(null); }
  }

  async function handleDisconnect(id: string, name: string | null) {
    if (!window.confirm(`Desconectar ${name ?? 'este banco'}? O histórico já importado permanece; só o sync automático para.`)) return;
    setBusy(id); setError('');
    try { await api.delete(`/v1/fiscal/openfinance/connections/${id}`); await load(); }
    catch (err) { setError(actionErrorMessage(err, 'Falha ao desconectar')); }
    finally { setBusy(null); }
  }

  if (loading) return null;

  return (
    <div style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>🏦 Open Finance — extrato automático</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--muted, #64748b)', fontSize: 12 }}>
            O extrato do banco entra sozinho (sync às 23:59 + botão) e cai na fila de conciliação abaixo.
          </p>
        </div>
        {canManage && (
          <button className="btn" disabled={busy === 'connect'} onClick={() => void handleConnect()}>
            {busy === 'connect' ? 'Abrindo…' : '+ Conectar banco'}
          </button>
        )}
      </div>

      {error && <div role="alert" style={{ marginTop: 10, color: 'var(--danger, #b91c1c)', fontSize: 13 }}>{error}</div>}
      {notice && <div style={{ marginTop: 10, color: 'var(--success, #15803d)', fontSize: 13 }}>{notice}</div>}

      {/* Posição de caixa (Tesouraria 0082) — saldo real + previsto 30 dias */}
      {cash && (
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginTop: 14 }}>
          {[
            { label: 'Saldo em conta', value: cash.saldo_total, strong: true },
            { label: 'Entradas 30d', value: cash.realizado_30d.entradas },
            { label: 'Saídas 30d', value: -cash.realizado_30d.saidas },
            { label: 'A receber 30d', value: cash.a_receber_30d },
            { label: 'A pagar 30d', value: -cash.a_pagar_30d },
            { label: 'Projeção 30d', value: cash.projecao_30d, strong: true },
          ].map((m) => (
            <div key={m.label} style={{ background: 'var(--surface-2, #f8fafc)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>{m.label}</div>
              <div style={{ fontSize: 15, fontWeight: m.strong ? 800 : 600,
                color: m.value < 0 ? 'var(--danger, #b91c1c)' : undefined }}>
                {BRL.format(m.value)}
              </div>
            </div>
          ))}
        </div>
      )}

      {connections.length === 0 ? (
        <p style={{ color: 'var(--muted, #64748b)', fontSize: 13, marginTop: 12, marginBottom: 0 }}>
          Nenhum banco conectado — o extrato ainda depende de upload manual (OFX/CSV/XLSX).
        </p>
      ) : (
        <table style={{ width: '100%', marginTop: 12, fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {connections.map((c) => (
              <tr key={c.id} style={{ borderTop: '1px solid var(--border, #e2e8f0)' }}>
                <td style={{ padding: '8px 0', fontWeight: 600 }}>
                  {c.institution ?? 'Banco'}
                  <div style={{ fontWeight: 400, color: 'var(--muted, #64748b)', fontSize: 12 }}>
                    {c.accounts.filter(a => a.sync_enabled).map(a =>
                      `${a.name ?? a.subtype ?? 'conta'} ${a.number_masked ?? ''}${a.balance != null ? ` — ${BRL.format(Number(a.balance))}` : ''}`,
                    ).join(' · ') || 'sem contas'}
                  </div>
                </td>
                <td style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>último sync: {fmtDate(c.last_synced_at)}</td>
                <td>
                  {c.status === 'active' && <span style={{ color: 'var(--success, #15803d)' }}>ativa</span>}
                  {c.status === 'error' && <span title={c.last_error ?? ''} style={{ color: 'var(--danger, #b91c1c)' }}>erro</span>}
                  {c.status === 'disconnected' && <span style={{ color: 'var(--muted, #64748b)' }}>desconectada</span>}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {c.status !== 'disconnected' && canSync && (
                    <button className="btn" disabled={busy === c.id} onClick={() => void handleSync(c.id)}>
                      {busy === c.id ? 'Sincronizando…' : 'Sincronizar'}
                    </button>
                  )}
                  {c.status !== 'disconnected' && canManage && (
                    <button className="btn" style={{ marginLeft: 6 }} disabled={busy === c.id}
                      onClick={() => void handleDisconnect(c.id, c.institution)}>
                      Desconectar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
