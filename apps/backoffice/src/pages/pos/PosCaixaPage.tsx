import { useEffect, useState } from 'react';
import { useNavigate }         from 'react-router-dom';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';

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

function fmtBRL(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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

  const terminalName = summary
    ? (terminals.find(t => t.id === summary.terminal_id)?.name ?? summary.terminal_id)
    : '';

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('pos.caixa.title')}</h1>
        {!summary && (
          <button
            onClick={() => setOpenModal(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700"
          >
            {t('pos.caixa.open')}
          </button>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}

      {/* No session */}
      {!summary && !loading && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg">{t('pos.caixa.noSession')}</p>
          <p className="text-sm mt-2">{t('pos.caixa.openToStart')}</p>
        </div>
      )}

      {/* Session open */}
      {summary && (
        <>
          {/* Status bar */}
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex flex-wrap gap-4 items-center">
            <span className="inline-flex items-center gap-1.5 text-green-700 font-semibold">
              <span className="w-2 h-2 bg-green-500 rounded-full inline-block" />
              {t('pos.caixa.statusOpen')}
            </span>
            <span className="text-gray-600 text-sm">Terminal: <b>{terminalName}</b></span>
            <span className="text-gray-600 text-sm">Desde: <b>{fmtDate(summary.opened_at)}</b></span>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => navigate('/pos')}
              className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-indigo-700"
            >
              {t('pos.caixa.goToPdv')}
            </button>
            <button
              onClick={() => { setMoveModal('suprimento'); setMoveAmount(''); setMoveReason(''); }}
              className="bg-white border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium hover:bg-gray-50"
            >
              {t('pos.caixa.suprimento')}
            </button>
            <button
              onClick={() => { setMoveModal('sangria'); setMoveAmount(''); setMoveReason(''); }}
              className="bg-white border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium hover:bg-gray-50"
            >
              {t('pos.caixa.sangria')}
            </button>
            <button
              onClick={() => { setCloseModal(true); setCountedAmt(''); }}
              className="bg-red-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-red-700 ml-auto"
            >
              {t('pos.caixa.close')}
            </button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: t('pos.caixa.summaryOpening'),  value: fmtBRL(summary.opening_amount) },
              { label: t('pos.caixa.summaryRevenue'),  value: fmtBRL(summary.total_revenue)  },
              { label: t('pos.caixa.summarySales'),    value: String(summary.total_sales)    },
              { label: t('pos.caixa.summaryBalance'),  value: fmtBRL(summary.total_cash)     },
            ].map(c => (
              <div key={c.label} className="bg-white border border-gray-200 rounded-lg p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide">{c.label}</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{c.value}</p>
              </div>
            ))}
          </div>

          {/* Cash movements table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">{t('pos.caixa.movements')}</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">{t('pos.caixa.movTime')}</th>
                  <th className="px-4 py-2 text-left">{t('pos.caixa.movType')}</th>
                  <th className="px-4 py-2 text-left">{t('pos.caixa.movReason')}</th>
                  <th className="px-4 py-2 text-right">{t('pos.caixa.movAmount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movements.map(m => {
                  const isOut = m.type === 'sangria';
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-500">{fmtDate(m.created_at)}</td>
                      <td className="px-4 py-2 font-medium">{MOVEMENT_LABELS[m.type] ?? m.type}</td>
                      <td className="px-4 py-2 text-gray-500">{m.reason ?? '—'}</td>
                      <td className={`px-4 py-2 text-right font-mono font-semibold ${isOut ? 'text-red-600' : 'text-green-600'}`}>
                        {isOut ? '−' : '+'} {fmtBRL(m.amount)}
                      </td>
                    </tr>
                  );
                })}
                {!movements.length && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">{t('pos.caixa.noMovements')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Open session modal ── */}
      {openModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">{t('pos.caixa.openTitle')}</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('pos.caixa.terminal')}</label>
              <select
                value={selTerminal}
                onChange={e => setSelTerminal(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {terminals.map(term => (
                  <option key={term.id} value={term.id}>{term.code} — {term.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('pos.caixa.openingAmount')}</label>
              <input
                type="number" min="0" step="0.01"
                value={openAmount}
                onChange={e => setOpenAmount(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setOpenModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">{t('pos.cancel')}</button>
              <button
                onClick={handleOpen} disabled={!selTerminal || loading}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? t('pos.saving') : t('pos.caixa.confirmOpen')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Close session modal ── */}
      {closeModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">{t('pos.caixa.closeTitle')}</h2>
            <p className="text-sm text-gray-600">
              {t('pos.caixa.closeExpected')}: <b>{fmtBRL(summary?.total_cash)}</b>
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('pos.caixa.closeCounted')}</label>
              <input
                type="number" min="0" step="0.01"
                value={countedAmt}
                onChange={e => setCountedAmt(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setCloseModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">{t('pos.cancel')}</button>
              <button
                onClick={handleClose} disabled={loading}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? t('pos.saving') : t('pos.caixa.confirmClose')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cash movement modal (sangria / suprimento) ── */}
      {moveModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">
              {moveModal === 'sangria' ? t('pos.caixa.sangriaTitle') : t('pos.caixa.suprimentoTitle')}
            </h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('pos.caixa.movAmount')}</label>
              <input
                type="number" min="0.01" step="0.01"
                value={moveAmount}
                onChange={e => setMoveAmount(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('pos.caixa.movReason')}</label>
              <input
                type="text"
                value={moveReason}
                onChange={e => setMoveReason(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setMoveModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">{t('pos.cancel')}</button>
              <button
                onClick={handleMovement} disabled={!moveAmount || loading}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? t('pos.saving') : t('pos.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
