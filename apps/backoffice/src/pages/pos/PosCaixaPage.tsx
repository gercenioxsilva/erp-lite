import { useEffect, useState } from 'react';
import { useNavigate }         from 'react-router-dom';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';
import { Can }     from '../../rbac';

interface Terminal { id: string; code: string; name: string; nfce_series: number; is_active: boolean; }
interface CashMovement { id: string; type: string; amount: string; reason: string | null; created_at: string; }
interface SessionSummary {
  id: string; status: string; terminal_id: string; opened_at: string;
  opening_amount: string; closed_at: string | null;
  closing_counted: string | null; closing_expected: string | null; difference: string | null;
  total_sales: number; total_cash: string; total_revenue: string;
  movements: CashMovement[];
}

const MOVEMENT_LABELS: Record<string, string> = {
  opening:     'Abertura',
  suprimento:  'Suprimento',
  sangria:     'Sangria',
  sale_cash:   'Venda (dinheiro)',
  closing:     'Fechamento',
};

const MOVEMENT_BADGE: Record<string, string> = {
  opening:    'badge badge-active',
  suprimento: 'badge badge-paid',
  sangria:    'badge badge-cancelled',
  sale_cash:  'badge badge-issued',
  closing:    'badge badge-inactive',
};

function fmtBRL(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseDate(iso: string): Date {
  return new Date(iso.replace(' ', 'T'));
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = parseDate(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtTime(iso: string): string {
  if (!iso) return '—';
  const d = parseDate(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function PosCaixaPage() {
  const { tenantId } = useAuth();
  const { t }        = useI18n();
  const navigate     = useNavigate();

  const [terminals,  setTerminals]  = useState<Terminal[]>([]);
  const [summary,    setSummary]    = useState<SessionSummary | null>(null);
  const [movements,  setMovements]  = useState<CashMovement[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  // Open session modal
  const [openModal,    setOpenModal]    = useState(false);
  const [selTerminal,  setSelTerminal]  = useState('');
  const [openAmount,   setOpenAmount]   = useState('0');

  // Close session modal
  const [closeModal,   setCloseModal]   = useState(false);
  const [countedAmt,   setCountedAmt]   = useState('');

  // Cash movement modal
  const [moveModal,    setMoveModal]    = useState<'sangria' | 'suprimento' | null>(null);
  const [moveAmount,   setMoveAmount]   = useState('');
  const [moveReason,   setMoveReason]   = useState('');

  const sessionId = localStorage.getItem('pos_session_id');

  useEffect(() => {
    api.get<Terminal[]>('/v1/pos/terminals').then(ts => {
      setTerminals(ts.filter(t => t.is_active));
      if (ts.length) setSelTerminal(ts[0].id);
    }).catch(() => {});

    if (sessionId) loadSummary(sessionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function loadSummary(sid: string) {
    setLoading(true);
    try {
      const s = await api.get<SessionSummary>(`/v1/pos/sessions/${sid}`);
      setSummary(s);
      const mv = await api.get<CashMovement[]>(`/v1/pos/sessions/${sid}/cash-movements`);
      setMovements(mv);
    } catch {
      localStorage.removeItem('pos_session_id');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpen() {
    if (!selTerminal) return;
    setLoading(true); setError('');
    try {
      const res = await api.post<{ id: string }>('/v1/pos/sessions', {
        terminal_id: selTerminal, opening_amount: parseFloat(openAmount || '0'),
      });
      localStorage.setItem('pos_session_id', res.id);
      setOpenModal(false);
      await loadSummary(res.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir caixa');
    } finally {
      setLoading(false);
    }
  }

  async function handleClose() {
    if (!sessionId) return;
    setLoading(true); setError('');
    try {
      await api.post(`/v1/pos/sessions/${sessionId}/close`, {
        closing_counted: parseFloat(countedAmt || '0'),
      });
      localStorage.removeItem('pos_session_id');
      setSummary(null); setMovements([]);
      setCloseModal(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao fechar caixa');
    } finally {
      setLoading(false);
    }
  }

  async function handleMovement() {
    if (!sessionId || !moveModal) return;
    setLoading(true); setError('');
    try {
      await api.post(`/v1/pos/sessions/${sessionId}/cash-movements`, {
        type: moveModal, amount: parseFloat(moveAmount || '0'), reason: moveReason || undefined,
      });
      setMoveModal(null); setMoveAmount(''); setMoveReason('');
      await loadSummary(sessionId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao registrar movimentação');
    } finally {
      setLoading(false);
    }
  }

  const terminalCode = summary
    ? (terminals.find(t => t.id === summary.terminal_id)?.code ?? '')
    : '';

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1>{t('pos.caixa.title')}</h1>
          {summary && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span className="badge badge-active">{t('pos.caixa.statusOpen')}</span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                desde {fmtTime(summary.opened_at)}
                {terminalCode && ` · ${terminalCode}`}
              </span>
            </div>
          )}
        </div>
        {summary && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/pos')}>
              {t('pos.caixa.goToPdv')} →
            </button>
            <Can permission="pos:operate">
              <button className="btn btn-danger btn-sm" onClick={() => { setCloseModal(true); setCountedAmt(''); }}>
                {t('pos.caixa.close')}
              </button>
            </Can>
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div role="alert" className="alert alert-error">
          {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && !summary && (
        <div className="spinner">Carregando…</div>
      )}

      {/* ── Caixa FECHADO ── */}
      {!summary && !loading && (
        <div className="card" style={{ maxWidth: 480, margin: '48px auto', padding: '40px 32px', textAlign: 'center' }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--muted)' }} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            Caixa Fechado
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 28 }}>
            {t('pos.caixa.openToStart')}
          </p>
          <Can permission="pos:operate">
            <button
              className="btn btn-primary btn-cta"
              style={{ width: '100%', fontSize: 15, padding: '12px 0', justifyContent: 'center' }}
              onClick={() => setOpenModal(true)}
            >
              {t('pos.caixa.open')}
            </button>
          </Can>
        </div>
      )}

      {/* ── Caixa ABERTO ── */}
      {summary && (
        <>
          {/* Stat cards */}
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
            <div className="stat-card">
              <p className="stat-label">{t('pos.caixa.summaryOpening')}</p>
              <p className="stat-value" style={{ fontSize: 20 }}>{fmtBRL(summary.opening_amount)}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">{t('pos.caixa.summarySales')}</p>
              <p className="stat-value">{summary.total_sales ?? 0}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">{t('pos.caixa.summaryRevenue')}</p>
              <p className="stat-value" style={{ fontSize: 20 }}>{fmtBRL(summary.total_revenue)}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">{t('pos.caixa.summaryBalance')}</p>
              <p className="stat-value" style={{ fontSize: 20 }}>{fmtBRL(summary.total_cash)}</p>
            </div>
          </div>

          {/* Movements table */}
          <div className="card">
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px', borderBottom: '1px solid var(--border)',
            }}>
              <h2 style={{ fontWeight: 700, fontSize: 'var(--text-base)', color: 'var(--text)' }}>
                {t('pos.caixa.movements')}
              </h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <Can permission="pos:operate">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setMoveModal('sangria'); setMoveAmount(''); setMoveReason(''); }}
                  >
                    − {t('pos.caixa.sangria')}
                  </button>
                </Can>
                <Can permission="pos:operate">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setMoveModal('suprimento'); setMoveAmount(''); setMoveReason(''); }}
                  >
                    + {t('pos.caixa.suprimento')}
                  </button>
                </Can>
              </div>
            </div>

            {movements.length === 0 ? (
              <div className="empty-state">{t('pos.caixa.noMovements')}</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t('pos.caixa.movTime')}</th>
                    <th>{t('pos.caixa.movType')}</th>
                    <th>{t('pos.caixa.movReason')}</th>
                    <th style={{ textAlign: 'right' }}>{t('pos.caixa.movAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map(m => {
                    const isOut = m.type === 'sangria';
                    return (
                      <tr key={m.id}>
                        <td style={{ color: 'var(--muted)' }}>{fmtDate(m.created_at)}</td>
                        <td>
                          <span className={MOVEMENT_BADGE[m.type] ?? 'badge badge-inactive'}>
                            {MOVEMENT_LABELS[m.type] ?? m.type}
                          </span>
                        </td>
                        <td style={{ color: 'var(--muted)' }}>{m.reason ?? '—'}</td>
                        <td style={{
                          textAlign: 'right',
                          fontWeight: 600,
                          fontFamily: 'monospace',
                          color: isOut ? 'var(--danger)' : 'var(--success)',
                        }}>
                          {isOut ? '−' : '+'} {fmtBRL(m.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── Modal: Abrir Caixa ── */}
      {openModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-caixa-title"
          onClick={e => { if (e.target === e.currentTarget) setOpenModal(false); }}
        >
          <div className="modal-dialog" style={{ maxWidth: 420, textAlign: 'left' }}>
            <h2 id="open-caixa-title" style={{ fontWeight: 700, fontSize: 18, marginBottom: 20, textAlign: 'left' }}>
              {t('pos.caixa.openTitle')}
            </h2>

            {error && <div role="alert" className="alert alert-error">{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {terminals.length > 1 && (
                <div className="field">
                  <label htmlFor="sel-terminal">{t('pos.caixa.terminal')}</label>
                  <select
                    id="sel-terminal"
                    value={selTerminal}
                    onChange={e => setSelTerminal(e.target.value)}
                  >
                    {terminals.map(term => (
                      <option key={term.id} value={term.id}>{term.code} — {term.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="open-amount">{t('pos.caixa.openingAmount')}</label>
                <input
                  id="open-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={openAmount}
                  onChange={e => setOpenAmount(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <Can permission="pos:operate">
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => void handleOpen()}
                  disabled={!selTerminal || loading}
                >
                  {loading ? t('pos.saving') : t('pos.caixa.confirmOpen')}
                </button>
              </Can>
              <button className="btn btn-secondary" onClick={() => setOpenModal(false)} disabled={loading}>
                {t('pos.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Fechar Caixa ── */}
      {closeModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-caixa-title"
          onClick={e => { if (e.target === e.currentTarget) setCloseModal(false); }}
        >
          <div className="modal-dialog" style={{ maxWidth: 420, textAlign: 'left' }}>
            <h2 id="close-caixa-title" style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, textAlign: 'left' }}>
              {t('pos.caixa.closeTitle')}
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
              {t('pos.caixa.closeExpected')}: <strong style={{ color: 'var(--text)' }}>{fmtBRL(summary?.total_cash)}</strong>
            </p>

            {error && <div role="alert" className="alert alert-error">{error}</div>}

            <div className="field">
              <label htmlFor="counted-amt">{t('pos.caixa.closeCounted')}</label>
              <input
                id="counted-amt"
                type="number"
                min="0"
                step="0.01"
                value={countedAmt}
                onChange={e => setCountedAmt(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <Can permission="pos:operate">
                <button
                  className="btn btn-danger"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => void handleClose()}
                  disabled={loading}
                >
                  {loading ? t('pos.saving') : t('pos.caixa.confirmClose')}
                </button>
              </Can>
              <button className="btn btn-secondary" onClick={() => setCloseModal(false)} disabled={loading}>
                {t('pos.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Sangria / Suprimento ── */}
      {moveModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="move-caixa-title"
          onClick={e => { if (e.target === e.currentTarget) setMoveModal(null); }}
        >
          <div className="modal-dialog" style={{ maxWidth: 420, textAlign: 'left' }}>
            <h2 id="move-caixa-title" style={{ fontWeight: 700, fontSize: 18, marginBottom: 20, textAlign: 'left' }}>
              {moveModal === 'sangria' ? t('pos.caixa.sangriaTitle') : t('pos.caixa.suprimentoTitle')}
            </h2>

            {error && <div role="alert" className="alert alert-error">{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field">
                <label htmlFor="move-amount">{t('pos.caixa.movAmount')}</label>
                <input
                  id="move-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={moveAmount}
                  onChange={e => setMoveAmount(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="move-reason">{t('pos.caixa.movReason')}</label>
                <input
                  id="move-reason"
                  type="text"
                  value={moveReason}
                  onChange={e => setMoveReason(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <Can permission="pos:operate">
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => void handleMovement()}
                  disabled={!moveAmount || loading}
                >
                  {loading ? t('pos.saving') : t('pos.confirm')}
                </button>
              </Can>
              <button className="btn btn-secondary" onClick={() => setMoveModal(null)} disabled={loading}>
                {t('pos.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
