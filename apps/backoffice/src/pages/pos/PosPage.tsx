import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  sale_price: string;
  gtin: string | null;
  unit: string | null;
}

interface SaleItem {
  id: string;
  product_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  total: string;
}

interface SalePayment {
  id: string;
  method: string;
  amount: string;
  change_amount: string;
}

interface Sale {
  id: string;
  status: string;
  subtotal: string;
  discount_amount: string;
  total: string;
  customer_doc: string | null;
  customer_name: string | null;
  focus_ref: string | null;
  fiscal_status: string;
  fiscal_chave: string | null;
  fiscal_qrcode: string | null;
  fiscal_url_danfe: string | null;
  fiscal_message: string | null;
  items: SaleItem[];
  payments: SalePayment[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Dinheiro',
  pix: 'PIX',
  debit: 'Débito',
  credit: 'Crédito',
  voucher: 'Voucher',
  store_credit: 'Crédito Loja',
};

const PAYMENT_METHODS = ['cash', 'pix', 'debit', 'credit', 'voucher'] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtBRL(val: string | number | null | undefined): string {
  return Number(val ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── Component ──────────────────────────────────────────────────────────────

export function PosPage() {
  const navigate = useNavigate();

  // Core state
  const [saleId, setSaleId]       = useState<string | null>(null);
  const [sale, setSale]           = useState<Sale | null>(null);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  // Product search
  const [search, setSearch]       = useState('');
  const [products, setProducts]   = useState<Product[]>([]);
  const [showDrop, setShowDrop]   = useState(false);
  const searchRef                 = useRef<HTMLInputElement>(null);
  const debounceRef               = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Payment
  const [payMethod, setPayMethod] = useState<string>('cash');
  const [payAmount, setPayAmount] = useState('');

  // Customer
  const [custDoc, setCustDoc]     = useState('');
  const [custName, setCustName]   = useState('');

  // Finalize modal
  const [showModal, setShowModal] = useState(false);
  const pollRef                   = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cancel modal
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // ── Error helper ────────────────────────────────────────────────────────

  function showError(msg: string) {
    setError(msg);
    setTimeout(() => setError(''), 4000);
  }

  // ── Sale helpers ────────────────────────────────────────────────────────

  const loadSale = useCallback(async (id: string) => {
    try {
      const s = await api.get<Sale>(`/v1/pos/sales/${id}`);
      setSale(s);
      setCustDoc(s.customer_doc ?? '');
      setCustName(s.customer_name ?? '');
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Erro ao carregar venda');
    }
  }, []);

  const createSale = useCallback(async () => {
    const sessionId = localStorage.getItem('pos_session_id');
    if (!sessionId) {
      navigate('/pos/caixa');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{ id: string }>('/v1/pos/sales', { session_id: sessionId });
      setSaleId(res.id);
      await loadSale(res.id);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Erro ao criar venda');
    } finally {
      setLoading(false);
    }
  }, [navigate, loadSale]);

  // ── On mount ────────────────────────────────────────────────────────────

  useEffect(() => {
    const sessionId = localStorage.getItem('pos_session_id');
    if (!sessionId) {
      navigate('/pos/caixa');
      return;
    }
    createSale();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F9') {
        e.preventDefault();
        handleFinalize();
      } else if (e.key === 'F4') {
        e.preventDefault();
        setShowCancel(true);
      } else if (e.key === 'Escape') {
        setShowDrop(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId, sale]);

  // ── Product search (debounced) ──────────────────────────────────────────

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search.trim()) {
      setProducts([]);
      setShowDrop(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get<Product[]>(`/v1/pos/products?q=${encodeURIComponent(search)}&limit=8`);
        setProducts(res);
        setShowDrop(true);
      } catch {
        setProducts([]);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // ── Add item ────────────────────────────────────────────────────────────

  async function handleAddProduct(product: Product) {
    if (!saleId) return;
    setShowDrop(false);
    setSearch('');
    try {
      await api.post(`/v1/pos/sales/${saleId}/items`, { product_id: product.id, quantity: 1 });
      await loadSale(saleId);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Erro ao adicionar item');
    }
  }

  // ── Qty change ──────────────────────────────────────────────────────────

  async function handleQtyBlur(itemId: string, qty: string) {
    if (!saleId) return;
    const n = parseFloat(qty);
    if (isNaN(n) || n <= 0) return;
    try {
      await api.patch(`/v1/pos/sales/${saleId}/items/${itemId}`, { quantity: n });
      await loadSale(saleId);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Erro ao atualizar quantidade');
    }
  }

  // ── Remove item ─────────────────────────────────────────────────────────

  async function handleRemoveItem(itemId: string) {
    if (!saleId) return;
    try {
      await api.delete(`/v1/pos/sales/${saleId}/items/${itemId}`);
      await loadSale(saleId);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Erro ao remover item');
    }
  }

  // ── Add payment ─────────────────────────────────────────────────────────

  async function handleAddPayment() {
    if (!saleId || !payAmount) return;
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) return;
    try {
      await api.post(`/v1/pos/sales/${saleId}/payments`, { method: payMethod, amount });
      setPayAmount('');
      await loadSale(saleId);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Erro ao adicionar pagamento');
    }
  }

  // ── Remove payment ──────────────────────────────────────────────────────

  async function handleRemovePayment(paymentId: string) {
    if (!saleId) return;
    try {
      await api.delete(`/v1/pos/sales/${saleId}/payments/${paymentId}`);
      await loadSale(saleId);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Erro ao remover pagamento');
    }
  }

  // ── Customer blur ───────────────────────────────────────────────────────

  async function handleCustomerBlur() {
    if (!saleId || (!custDoc && !custName)) return;
    try {
      await api.post(`/v1/pos/sales/${saleId}/customer`, { doc: custDoc || undefined, name: custName || undefined });
    } catch {
      // non-critical, silently ignore
    }
  }

  // ── Finalize ────────────────────────────────────────────────────────────

  async function handleFinalize() {
    if (!saleId || !canFinalize) return;
    setLoading(true);
    try {
      await api.post(`/v1/pos/sales/${saleId}/finalize`, {});
      await loadSale(saleId);
      setShowModal(true);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Erro ao finalizar venda');
    } finally {
      setLoading(false);
    }
  }

  // ── Polling for fiscal status ───────────────────────────────────────────

  useEffect(() => {
    if (!showModal || !saleId) return;
    if (sale?.fiscal_status !== 'processando') return;

    pollRef.current = setInterval(async () => {
      try {
        const s = await api.get<Sale>(`/v1/pos/sales/${saleId}`);
        setSale(s);
        if (s.fiscal_status !== 'processando') {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // keep polling
      }
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [showModal, saleId, sale?.fiscal_status]);

  // ── Reissue NFC-e ───────────────────────────────────────────────────────

  async function handleReissueFiscal() {
    if (!saleId) return;
    try {
      await api.post(`/v1/pos/sales/${saleId}/reissue-fiscal`, {});
      await loadSale(saleId);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Erro ao reemitir NFC-e');
    }
  }

  // ── Nova venda ──────────────────────────────────────────────────────────

  function handleNewSale() {
    if (pollRef.current) clearInterval(pollRef.current);
    setShowModal(false);
    setSaleId(null);
    setSale(null);
    setCustDoc('');
    setCustName('');
    setPayAmount('');
    createSale();
  }

  // ── Cancel ──────────────────────────────────────────────────────────────

  async function handleCancel() {
    if (!saleId) return;
    setLoading(true);
    try {
      await api.post(`/v1/pos/sales/${saleId}/cancel`, { reason: cancelReason || 'Cancelado pelo operador' });
      setShowCancel(false);
      setCancelReason('');
      handleNewSale();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Erro ao cancelar venda');
    } finally {
      setLoading(false);
    }
  }

  // ── Derived values ──────────────────────────────────────────────────────

  const saleTotal  = Number(sale?.total ?? 0);
  const totalPaid  = (sale?.payments ?? []).reduce((acc, p) => acc + Number(p.amount), 0);
  const remaining  = Math.max(0, saleTotal - totalPaid);
  const canFinalize = (sale?.items?.length ?? 0) > 0 && remaining <= 0.001;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 text-white flex flex-col">

      {/* ── Top bar ── */}
      <header className="flex items-center gap-4 px-4 py-2 bg-gray-800 border-b border-gray-700 shrink-0">
        <span className="font-bold text-lg tracking-wide text-indigo-400">PDV</span>
        {saleId && (
          <span className="text-xs text-gray-400">Venda #{saleId.slice(0, 8)}</span>
        )}
        {error && (
          <span className="flex-1 text-center text-sm text-red-400 font-medium">{error}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleNewSale}
            className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 rounded font-semibold transition-colors"
            title="F2 – Nova Venda"
          >
            F2 Nova
          </button>
          <button
            onClick={() => setShowCancel(true)}
            className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 rounded font-semibold transition-colors"
            title="F4 – Cancelar Venda"
          >
            F4 Cancelar
          </button>
          <button
            onClick={() => navigate('/pos/caixa')}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            ← Caixa
          </button>
        </div>
      </header>

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Cart ── */}
        <div className="flex flex-col flex-1 overflow-hidden border-r border-gray-700">

          {/* Search bar */}
          <div className="relative px-4 pt-4 pb-2 shrink-0">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={() => products.length > 0 && setShowDrop(true)}
              placeholder="🔍  Buscar produto (F2)…"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            {showDrop && products.length > 0 && (
              <ul className="absolute left-4 right-4 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-10 max-h-64 overflow-y-auto">
                {products.map(p => (
                  <li key={p.id}>
                    <button
                      onClick={() => handleAddProduct(p)}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-700 flex justify-between items-center text-sm transition-colors"
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="text-indigo-400 font-semibold ml-4 shrink-0">{fmtBRL(p.sale_price)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Items table */}
          <div className="flex-1 overflow-y-auto px-4 pb-2">
            {(!sale || sale.items.length === 0) ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
                <span className="text-4xl">🛒</span>
                <p className="text-sm">Nenhum item adicionado</p>
                <p className="text-xs">Use o campo acima ou pressione F2 para buscar produtos</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900 text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="px-2 py-2 text-left">Produto</th>
                    <th className="px-2 py-2 text-center w-24">Qtd</th>
                    <th className="px-2 py-2 text-right w-28">Preço</th>
                    <th className="px-2 py-2 text-right w-28">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {sale.items.map(item => (
                    <tr key={item.id} className="hover:bg-gray-800/50 transition-colors">
                      <td className="px-2 py-2">{item.description}</td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="number"
                          min="0.001"
                          step="1"
                          defaultValue={item.quantity}
                          onBlur={e => handleQtyBlur(item.id, e.target.value)}
                          className="w-20 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-center text-sm focus:outline-none focus:border-indigo-500"
                        />
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-gray-300">{fmtBRL(item.unit_price)}</td>
                      <td className="px-2 py-2 text-right font-mono font-semibold">{fmtBRL(item.total)}</td>
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={() => handleRemoveItem(item.id)}
                          className="text-gray-500 hover:text-red-400 transition-colors text-base leading-none"
                          title="Remover item"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Customer fields */}
          <div className="shrink-0 px-4 py-3 border-t border-gray-700 flex gap-3">
            <input
              type="text"
              value={custDoc}
              onChange={e => setCustDoc(e.target.value)}
              onBlur={handleCustomerBlur}
              placeholder="CPF / CNPJ"
              className="w-44 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm placeholder-gray-400 focus:outline-none focus:border-indigo-500"
            />
            <input
              type="text"
              value={custName}
              onChange={e => setCustName(e.target.value)}
              onBlur={handleCustomerBlur}
              placeholder="Nome do cliente"
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm placeholder-gray-400 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* ── Right: Payment panel ── */}
        <aside className="w-72 flex flex-col shrink-0 bg-gray-850 overflow-hidden">

          {/* Totals */}
          <div className="px-4 pt-4 pb-3 border-b border-gray-700 space-y-1">
            <div className="flex justify-between text-sm text-gray-400">
              <span>Subtotal</span>
              <span className="font-mono">{fmtBRL(sale?.subtotal)}</span>
            </div>
            {Number(sale?.discount_amount ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-green-400">
                <span>Desconto</span>
                <span className="font-mono">−{fmtBRL(sale?.discount_amount)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold mt-1 pt-1 border-t border-gray-700">
              <span>Total</span>
              <span className="font-mono text-white">{fmtBRL(sale?.total)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-400">
              <span>Pago</span>
              <span className="font-mono text-green-400">{fmtBRL(totalPaid)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold">
              <span>{remaining > 0 ? 'Falta' : 'Troco'}</span>
              <span className={`font-mono ${remaining > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {remaining > 0 ? fmtBRL(remaining) : fmtBRL(totalPaid - saleTotal)}
              </span>
            </div>
          </div>

          {/* Payment method buttons */}
          <div className="px-4 pt-3 pb-2 border-b border-gray-700 shrink-0">
            <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Forma de pagamento</p>
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m}
                  onClick={() => setPayMethod(m)}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                    payMethod === m
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {PAYMENT_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {/* Amount input */}
          <div className="px-4 py-3 border-b border-gray-700 shrink-0">
            <div className="flex gap-2">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={e => setPayAmount(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddPayment()}
                placeholder="Valor"
                className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm placeholder-gray-400 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={handleAddPayment}
                disabled={!payAmount || loading}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded text-sm font-semibold transition-colors"
              >
                OK
              </button>
            </div>
          </div>

          {/* Payments list */}
          <div className="flex-1 overflow-y-auto px-4 py-2">
            {(sale?.payments ?? []).length === 0 ? (
              <p className="text-xs text-gray-500 text-center mt-2">Nenhum pagamento lançado</p>
            ) : (
              <ul className="space-y-1">
                {(sale?.payments ?? []).map(p => (
                  <li key={p.id} className="flex items-center justify-between text-sm bg-gray-800 rounded px-3 py-1.5">
                    <span className="text-gray-300">{PAYMENT_LABELS[p.method] ?? p.method}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-green-400">{fmtBRL(p.amount)}</span>
                      <button
                        onClick={() => handleRemovePayment(p.id)}
                        className="text-gray-500 hover:text-red-400 transition-colors text-base leading-none"
                        title="Remover"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Finalize button */}
          <div className="px-4 py-4 shrink-0 border-t border-gray-700">
            <button
              onClick={handleFinalize}
              disabled={!canFinalize || loading}
              className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-bold text-base tracking-wide transition-colors"
              title="F9 – Finalizar"
            >
              {loading ? 'Processando…' : 'F9  FINALIZAR'}
            </button>
          </div>
        </aside>
      </div>

      {/* ── Cancel modal ── */}
      {showCancel && (
        <div className="fixed inset-0 bg-black/60 z-60 flex items-center justify-center">
          <div className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">Cancelar Venda</h2>
            <p className="text-sm text-gray-400">Informe o motivo do cancelamento (opcional):</p>
            <input
              type="text"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Motivo"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-red-500"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCancel(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Voltar
              </button>
              <button
                onClick={handleCancel}
                disabled={loading}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm rounded-lg font-semibold transition-colors"
              >
                {loading ? 'Cancelando…' : 'Confirmar Cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Finalize modal ── */}
      {showModal && sale && (
        <div className="fixed inset-0 bg-black/70 z-60 flex items-center justify-center">
          <div className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-5">

            {/* processando */}
            {sale.fiscal_status === 'processando' && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-300 text-sm">Aguardando autorização da SEFAZ…</p>
              </div>
            )}

            {/* autorizado */}
            {sale.fiscal_status === 'autorizado' && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-green-400 text-center">NFC-e Autorizada</h2>
                {sale.fiscal_qrcode && (
                  <div className="flex justify-center">
                    <img
                      src={sale.fiscal_qrcode}
                      alt="QR Code NFC-e"
                      className="w-48 h-48 rounded border border-gray-600"
                    />
                  </div>
                )}
                {sale.fiscal_chave && (
                  <p className="text-xs text-gray-400 text-center break-all font-mono">{sale.fiscal_chave}</p>
                )}
                {sale.fiscal_url_danfe && (
                  <div className="text-center">
                    <a
                      href={sale.fiscal_url_danfe}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 text-sm underline"
                    >
                      Abrir DANFE
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* pendente (modo offline / NFC-e não configurada) */}
            {sale.fiscal_status === 'pendente' && (
              <div className="text-center space-y-2 py-4">
                <p className="text-xl font-bold text-white">Venda Finalizada</p>
                <p className="text-sm text-gray-400">NFC-e não configurada (modo offline)</p>
              </div>
            )}

            {/* erro_autorizacao */}
            {sale.fiscal_status === 'erro_autorizacao' && (
              <div className="space-y-3 py-2">
                <p className="text-red-400 font-semibold text-center">Erro na autorização NFC-e</p>
                {sale.fiscal_message && (
                  <p className="text-sm text-gray-400 text-center">{sale.fiscal_message}</p>
                )}
                <div className="flex justify-center">
                  <button
                    onClick={handleReissueFiscal}
                    className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-sm font-semibold transition-colors"
                  >
                    Reemitir NFC-e
                  </button>
                </div>
              </div>
            )}

            {/* Nova venda button — always visible */}
            <div className="flex justify-center border-t border-gray-700 pt-4">
              <button
                onClick={handleNewSale}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold text-sm transition-colors"
              >
                Nova Venda (F2)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
