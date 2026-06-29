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

// ── Search icon ────────────────────────────────────────────────────────────

function IcoSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="7" cy="7" r="5"/><path d="M11 11l3 3"/>
    </svg>
  );
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

  // ── Helpers ────────────────────────────────────────────────────────────

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
    if (!sessionId) { navigate('/pos/caixa'); return; }
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
    if (!sessionId) { navigate('/pos/caixa'); return; }
    createSale();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'F9') { e.preventDefault(); handleFinalize(); }
      else if (e.key === 'F4') { e.preventDefault(); setShowCancel(true); }
      else if (e.key === 'Escape') { setShowDrop(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId, sale]);

  // ── Product search (debounced) ──────────────────────────────────────────

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search.trim()) { setProducts([]); setShowDrop(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get<Product[]>(`/v1/pos/products?q=${encodeURIComponent(search)}&limit=8`);
        setProducts(res);
        setShowDrop(true);
      } catch { setProducts([]); }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // ── Actions ─────────────────────────────────────────────────────────────

  async function handleAddProduct(product: Product) {
    if (!saleId) return;
    setShowDrop(false); setSearch('');
    try {
      await api.post(`/v1/pos/sales/${saleId}/items`, { product_id: product.id, quantity: 1 });
      await loadSale(saleId);
    } catch (e: unknown) { showError(e instanceof Error ? e.message : 'Erro ao adicionar item'); }
  }

  async function handleQtyBlur(itemId: string, qty: string) {
    if (!saleId) return;
    const n = parseFloat(qty);
    if (isNaN(n) || n <= 0) return;
    try {
      await api.patch(`/v1/pos/sales/${saleId}/items/${itemId}`, { quantity: n });
      await loadSale(saleId);
    } catch (e: unknown) { showError(e instanceof Error ? e.message : 'Erro ao atualizar quantidade'); }
  }

  async function handleRemoveItem(itemId: string) {
    if (!saleId) return;
    try {
      await api.delete(`/v1/pos/sales/${saleId}/items/${itemId}`);
      await loadSale(saleId);
    } catch (e: unknown) { showError(e instanceof Error ? e.message : 'Erro ao remover item'); }
  }

  async function handleAddPayment() {
    if (!saleId || !payAmount) return;
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) return;
    try {
      await api.post(`/v1/pos/sales/${saleId}/payments`, { method: payMethod, amount });
      setPayAmount('');
      await loadSale(saleId);
    } catch (e: unknown) { showError(e instanceof Error ? e.message : 'Erro ao adicionar pagamento'); }
  }

  async function handleRemovePayment(paymentId: string) {
    if (!saleId) return;
    try {
      await api.delete(`/v1/pos/sales/${saleId}/payments/${paymentId}`);
      await loadSale(saleId);
    } catch (e: unknown) { showError(e instanceof Error ? e.message : 'Erro ao remover pagamento'); }
  }

  async function handleCustomerBlur() {
    if (!saleId || (!custDoc && !custName)) return;
    try {
      await api.post(`/v1/pos/sales/${saleId}/customer`, { doc: custDoc || undefined, name: custName || undefined });
    } catch { /* non-critical */ }
  }

  async function handleFinalize() {
    if (!saleId || !canFinalize) return;
    setLoading(true);
    try {
      await api.post(`/v1/pos/sales/${saleId}/finalize`, {});
      await loadSale(saleId);
      setShowModal(true);
    } catch (e: unknown) { showError(e instanceof Error ? e.message : 'Erro ao finalizar venda'); }
    finally { setLoading(false); }
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
      } catch { /* keep polling */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [showModal, saleId, sale?.fiscal_status]);

  async function handleReissueFiscal() {
    if (!saleId) return;
    try {
      await api.post(`/v1/pos/sales/${saleId}/reissue-fiscal`, {});
      await loadSale(saleId);
    } catch (e: unknown) { showError(e instanceof Error ? e.message : 'Erro ao reemitir NFC-e'); }
  }

  function handleNewSale() {
    if (pollRef.current) clearInterval(pollRef.current);
    setShowModal(false);
    setSaleId(null); setSale(null);
    setCustDoc(''); setCustName(''); setPayAmount('');
    createSale();
  }

  async function handleCancel() {
    if (!saleId) return;
    setLoading(true);
    try {
      await api.post(`/v1/pos/sales/${saleId}/cancel`, { reason: cancelReason || 'Cancelado pelo operador' });
      setShowCancel(false); setCancelReason('');
      handleNewSale();
    } catch (e: unknown) { showError(e instanceof Error ? e.message : 'Erro ao cancelar venda'); }
    finally { setLoading(false); }
  }

  // ── Derived values ──────────────────────────────────────────────────────

  const saleTotal   = Number(sale?.total ?? 0);
  const totalPaid   = (sale?.payments ?? []).reduce((acc, p) => acc + Number(p.amount), 0);
  const remaining   = Math.max(0, saleTotal - totalPaid);
  const canFinalize = (sale?.items?.length ?? 0) > 0 && remaining <= 0.001;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="pos-shell">

      {/* ── Top bar ── */}
      <header className="pos-topbar">
        <span className="pos-topbar-brand">PDV</span>
        {saleId && <span className="pos-topbar-id">#{saleId.slice(0, 8)}</span>}
        {error && <span className="pos-error-bar">{error}</span>}
        <div className="pos-topbar-actions">
          <button onClick={handleNewSale} className="pos-kbd pos-kbd-primary">F2 Nova venda</button>
          <button onClick={() => setShowCancel(true)} className="pos-kbd pos-kbd-danger">F4 Cancelar</button>
          <button onClick={() => navigate('/pos/caixa')} className="pos-kbd pos-kbd-ghost">← Caixa</button>
        </div>
      </header>

      {/* ── Main area ── */}
      <div className="pos-body">

        {/* ── Left: Cart ── */}
        <div className="pos-cart">

          {/* Search */}
          <div className="pos-search-wrap">
            <span className="pos-search-icon"><IcoSearch /></span>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={() => products.length > 0 && setShowDrop(true)}
              placeholder="Buscar produto — F2 para focar…"
              className="pos-search"
            />
            {showDrop && products.length > 0 && (
              <div className="pos-search-drop">
                {products.map(p => (
                  <button key={p.id} onClick={() => handleAddProduct(p)} className="pos-search-item">
                    <span>{p.name}</span>
                    <span className="pos-search-price">{fmtBRL(p.sale_price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cart items */}
          <div className="pos-items">
            {(!sale || sale.items.length === 0) ? (
              <div className="pos-items-empty">
                <span className="pos-items-empty-icon">🛒</span>
                <p className="pos-items-empty-text">Carrinho vazio</p>
                <p className="pos-items-empty-hint">Busque um produto acima ou pressione F2</p>
              </div>
            ) : (
              <table className="pos-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="center">Qtd</th>
                    <th className="right">Preço</th>
                    <th className="right">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map(item => (
                    <tr key={item.id}>
                      <td className="td-name">{item.description}</td>
                      <td className="td-qty">
                        <input
                          type="number"
                          min="0.001"
                          step="1"
                          defaultValue={item.quantity}
                          onBlur={e => handleQtyBlur(item.id, e.target.value)}
                          className="pos-qty-input"
                        />
                      </td>
                      <td className="td-price">{fmtBRL(item.unit_price)}</td>
                      <td className="td-total">{fmtBRL(item.total)}</td>
                      <td className="td-action">
                        <button onClick={() => handleRemoveItem(item.id)} className="pos-remove-btn" title="Remover">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Customer */}
          <div className="pos-customer">
            <input
              type="text"
              value={custDoc}
              onChange={e => setCustDoc(e.target.value)}
              onBlur={handleCustomerBlur}
              placeholder="CPF / CNPJ"
              className="pos-customer-input pos-customer-doc"
            />
            <input
              type="text"
              value={custName}
              onChange={e => setCustName(e.target.value)}
              onBlur={handleCustomerBlur}
              placeholder="Nome do cliente (opcional)"
              className="pos-customer-input pos-customer-name"
            />
          </div>
        </div>

        {/* ── Right: Payment panel ── */}
        <aside className="pos-payment">

          {/* Totals — signature element */}
          <div className="pos-total-block">
            <div className="pos-total-row">
              <span className="pos-total-label">Subtotal</span>
              <span className="pos-total-value">{fmtBRL(sale?.subtotal)}</span>
            </div>
            {Number(sale?.discount_amount ?? 0) > 0 && (
              <div className="pos-total-row">
                <span className="pos-total-label pos-total-discount-label">Desconto</span>
                <span className="pos-total-value pos-total-discount-value">−{fmtBRL(sale?.discount_amount)}</span>
              </div>
            )}
            <div className="pos-grand-total">
              <span className="pos-grand-label">Total</span>
              <span className="pos-grand-value">{fmtBRL(sale?.total)}</span>
            </div>
            <div className={`pos-remaining ${remaining > 0.001 ? 'pos-remaining-due' : 'pos-remaining-ok'}`}>
              <span>{remaining > 0.001 ? 'Falta pagar' : 'Troco'}</span>
              <span className="pos-remaining-value">
                {remaining > 0.001 ? fmtBRL(remaining) : fmtBRL(totalPaid - saleTotal)}
              </span>
            </div>
          </div>

          {/* Payment method */}
          <div className="pos-method-block">
            <p className="pos-method-label">Forma de pagamento</p>
            <div className="pos-methods">
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m}
                  onClick={() => setPayMethod(m)}
                  className={`pos-method-btn${payMethod === m ? ' selected' : ''}`}
                >
                  {PAYMENT_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div className="pos-amount-block">
            <div className="pos-amount-row">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={e => setPayAmount(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddPayment()}
                placeholder="0,00"
                className="pos-amount-input"
              />
              <button onClick={handleAddPayment} disabled={!payAmount || loading} className="pos-ok-btn">
                OK
              </button>
            </div>
          </div>

          {/* Payments list */}
          <div className="pos-payments-list">
            {(sale?.payments ?? []).length === 0 ? (
              <p className="pos-payment-empty">Nenhum pagamento lançado</p>
            ) : (
              (sale?.payments ?? []).map(p => (
                <div key={p.id} className="pos-payment-item">
                  <span className="pos-payment-method">{PAYMENT_LABELS[p.method] ?? p.method}</span>
                  <div className="pos-payment-row-right">
                    <span className="pos-payment-amount">{fmtBRL(p.amount)}</span>
                    <button onClick={() => handleRemovePayment(p.id)} className="pos-remove-btn" title="Remover">×</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Finalize */}
          <div className="pos-finalize-block">
            <button
              onClick={handleFinalize}
              disabled={!canFinalize || loading}
              className="pos-finalize-btn"
            >
              {loading ? 'Processando…' : 'F9  FINALIZAR'}
            </button>
          </div>
        </aside>
      </div>

      {/* ── Cancel modal ── */}
      {showCancel && (
        <div className="pos-modal-backdrop">
          <div className="pos-modal">
            <p className="pos-modal-title">Cancelar venda</p>
            <p className="pos-modal-sub">Motivo do cancelamento (opcional):</p>
            <input
              type="text"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Ex: Desistência do cliente"
              className="pos-modal-input"
            />
            <div className="pos-modal-footer">
              <button onClick={() => setShowCancel(false)} className="pos-modal-cancel">Voltar</button>
              <button onClick={handleCancel} disabled={loading} className="pos-modal-confirm">
                {loading ? 'Cancelando…' : 'Confirmar cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Finalize modal ── */}
      {showModal && sale && (
        <div className="pos-modal-backdrop">
          <div className="pos-modal">

            {sale.fiscal_status === 'processando' && (
              <div className="pos-modal-spinner">
                <div className="pos-spinner" />
                <p className="pos-modal-spinner-text">Aguardando autorização da SEFAZ…</p>
              </div>
            )}

            {sale.fiscal_status === 'autorizado' && (
              <div className="pos-modal-success">
                <p className="pos-modal-success-title">✓ NFC-e Autorizada</p>
                {sale.fiscal_qrcode && (
                  <img src={sale.fiscal_qrcode} alt="QR Code NFC-e" className="pos-modal-qr" />
                )}
                {sale.fiscal_chave && (
                  <p className="pos-modal-chave">{sale.fiscal_chave}</p>
                )}
                {sale.fiscal_url_danfe && (
                  <a href={sale.fiscal_url_danfe} target="_blank" rel="noopener noreferrer" className="pos-danfe-link">
                    Abrir DANFE →
                  </a>
                )}
              </div>
            )}

            {sale.fiscal_status === 'pendente' && (
              <div className="pos-modal-pending">
                <p className="pos-modal-pending-title">Venda Finalizada</p>
                <p className="pos-modal-pending-sub">NFC-e não configurada · modo offline</p>
              </div>
            )}

            {sale.fiscal_status === 'erro_autorizacao' && (
              <div>
                <p className="pos-modal-error-title">Erro na autorização NFC-e</p>
                {sale.fiscal_message && (
                  <p className="pos-modal-error-msg">{sale.fiscal_message}</p>
                )}
                <button onClick={handleReissueFiscal} className="pos-modal-reissue-btn">
                  Reemitir NFC-e
                </button>
              </div>
            )}

            <hr className="pos-modal-divider" />
            <button onClick={handleNewSale} className="pos-modal-new-btn">
              Nova venda (F2)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
