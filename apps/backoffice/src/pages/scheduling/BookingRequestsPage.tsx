import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useModal } from '../../contexts/ModalContext';
import { Can } from '../../rbac';
import { Badge } from '../../ds';
import { formatDateBR } from '../../lib/schedulingTime';
import { conflictMessage } from './SessionFormDrawer';
import type { SessionRow } from './SessionFormDrawer';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface AreaOpt {
  id:        string;
  name:      string;
  is_active: boolean;
}

// ── Componente ────────────────────────────────────────────────────────────────

export function BookingRequestsPage() {
  const modal = useModal();

  const [requests, setRequests] = useState<SessionRow[]>([]);
  const [areas,    setAreas]    = useState<AreaOpt[]>([]);
  const [loading,  setLoading]  = useState(true);

  // Fluxo de recusa inline (um card por vez)
  const [decliningId,   setDecliningId]   = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [declineError,  setDeclineError]  = useState('');
  const [actingId,      setActingId]      = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api.get<{ data: SessionRow[] }>('/v1/scheduling/sessions?status=pending&per_page=100');
      setRequests(resp.data);
    } catch { /**/ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    api.get<{ data: AreaOpt[] }>('/v1/scheduling/areas?include_inactive=true')
      .then(r => setAreas(r.data))
      .catch(() => setAreas([]));
  }, [load]);

  const areaName = useMemo(() => new Map(areas.map(a => [a.id, a.name])), [areas]);

  // ── Ações ────────────────────────────────────────────────────────────────

  async function approve(s: SessionRow) {
    setActingId(s.id);
    try {
      await api.post(`/v1/scheduling/sessions/${s.id}/approve`, {});
      void load();
    } catch (err: unknown) {
      const conflict = conflictMessage(err);
      if (conflict) modal.error(new Error(`Não foi possível aprovar. ${conflict}`));
      else modal.error(err);
    } finally { setActingId(null); }
  }

  function openDecline(s: SessionRow) {
    setDecliningId(s.id);
    setDeclineReason('');
    setDeclineError('');
  }

  async function decline(s: SessionRow) {
    if (!declineReason.trim()) {
      setDeclineError('Informe o motivo da recusa — o cliente verá esta mensagem.');
      return;
    }
    setActingId(s.id);
    try {
      await api.post(`/v1/scheduling/sessions/${s.id}/decline`, { reason: declineReason.trim() });
      setDecliningId(null);
      void load();
    } catch (err: unknown) { modal.error(err); } finally { setActingId(null); }
  }

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <h1>Solicitações</h1>
      </div>

      {loading ? (
        <div className="card">
          <div className="spinner" style={{ margin: '48px auto' }}>Carregando…</div>
        </div>
      ) : requests.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            Nenhuma solicitação pendente. Pedidos feitos pelos clientes no portal aparecem aqui para aprovação.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {requests.map(s => (
            <div key={s.id} className="card" style={{ padding: 16 }}>
              {/* Cabeçalho do card */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <strong style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.client_name}
                </strong>
                {s.requested_by === 'client' && <Badge variant="product">Portal</Badge>}
                <Badge variant="pending">Pendente</Badge>
              </div>

              <div style={{ fontSize: 13, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{formatDateBR(s.date)}</span>
                <span style={{ fontFamily: 'monospace', marginLeft: 8 }}>{s.start_time}–{s.end_time}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: s.notes ? 4 : 12 }}>
                {areaName.get(s.area_id) ?? 'Área não identificada'}
              </div>
              {s.notes && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, fontStyle: 'italic' }}>
                  “{s.notes}”
                </div>
              )}

              {/* Ações / fluxo de recusa */}
              <Can permission="scheduling:manage">
                {decliningId === s.id ? (
                  <div>
                    {declineError && (
                      <div className="alert alert-error" role="alert" style={{ marginBottom: 8 }}>
                        {declineError}
                      </div>
                    )}
                    <div className="field" style={{ marginBottom: 8 }}>
                      <label>Motivo da recusa *</label>
                      <textarea value={declineReason} rows={3} autoFocus
                        onChange={e => setDeclineReason(e.target.value)}
                        placeholder="Ex.: horário indisponível — sugerimos outro dia" />
                    </div>
                    <div className="flex-gap">
                      <button className="btn btn-secondary btn-sm" disabled={actingId === s.id}
                        onClick={() => setDecliningId(null)}>
                        Voltar
                      </button>
                      <button className="btn btn-danger btn-sm" disabled={actingId === s.id}
                        onClick={() => void decline(s)}>
                        {actingId === s.id ? 'Recusando…' : 'Confirmar recusa'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-gap">
                    <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                      disabled={actingId === s.id} onClick={() => void approve(s)}>
                      {actingId === s.id ? 'Aprovando…' : 'Aprovar'}
                    </button>
                    <button className="btn btn-danger btn-sm" disabled={actingId === s.id}
                      onClick={() => openDecline(s)}>
                      Recusar
                    </button>
                  </div>
                )}
              </Can>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
