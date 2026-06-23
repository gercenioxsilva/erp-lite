import { useEffect, useState, FormEvent } from 'react';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';

interface StockItem {
  id: string; sku: string; name: string; type: string; category: string | null;
  unit: string; sale_price: string; cost_price: string;
  quantity: string; min_qty: string; max_qty: string | null; is_low_stock: boolean;
}

interface StockMovement {
  id: string; movement_type: string; quantity: string;
  quantity_before: string; quantity_after: string;
  reason: string | null; reference_type: string | null; created_at: string;
  material_id: string; sku: string; material_name: string; unit: string;
}

const METHOD_LABELS: Record<string, string> = {
  pix: 'PIX', bank_transfer: 'Transferência', cash: 'Dinheiro',
  credit_card: 'Cartão Crédito', debit_card: 'Cartão Débito',
  boleto: 'Boleto', check: 'Cheque', other: 'Outro',
};

export function StockPage() {
  const { tenantId } = useAuth();
  const { t }        = useI18n();

  const [tab, setTab]         = useState<'position' | 'movements'>('position');
  const [items, setItems]     = useState<StockItem[]>([]);
  const [movements, setMovs]  = useState<StockMovement[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [mvSearch, setMvSearch] = useState('');
  const [mvType, setMvType]   = useState('');
  const [loading, setLoading] = useState(false);

  // Adjust drawer
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [selItem, setSelItem]         = useState<StockItem | null>(null);
  const [adjQty, setAdjQty]           = useState('');
  const [adjReason, setAdjReason]     = useState('');
  const [adjType, setAdjType]         = useState<'in'|'out'|'adjustment'>('adjustment');
  const [saving, setSaving]           = useState(false);
  const [formError, setFormError]     = useState('');

  const PER_PAGE = 20;

  useEffect(() => {
    if (!tenantId) return;
    if (tab === 'position') loadStock();
    else loadMovements();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, tab, page, search, mvType]);

  async function loadStock() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (search) qs.set('search', search);
      const data = await api.get(`/v1/stock?${qs}`);
      setItems(data.data); setTotal(data.total);
    } finally { setLoading(false); }
  }

  async function loadMovements() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (mvType)   qs.set('movement_type', mvType);
      const data = await api.get(`/v1/stock/movements?${qs}`);
      setMovs(data.data); setTotal(data.total);
    } finally { setLoading(false); }
  }

  function openAdjust(item: StockItem) {
    setSelItem(item); setAdjQty(''); setAdjReason(''); setAdjType('adjustment');
    setFormError(''); setDrawerOpen(true);
  }

  async function handleAdjust(e: FormEvent) {
    e.preventDefault(); setFormError('');
    const qty = Number(adjQty);
    if (!qty || qty <= 0) { setFormError(t('stk.errQty')); return; }
    setSaving(true);
    try {
      await api.post(`/v1/materials/${selItem!.id}/stock/movements`, {
        movement_type: adjType,
        quantity: qty,
        reason: adjReason || undefined,
      });
      setDrawerOpen(false);
      loadStock();
    } catch (err: any) {
      setFormError(err.message || t('stk.errSave'));
    } finally { setSaving(false); }
  }

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const mvTypeColor: Record<string, string> = {
    in: '#16a34a', out: '#dc2626', adjustment: '#d97706', return: '#2563eb', transfer: '#7c3aed',
  };

  return (
    <div>
      <div className="page-header">
        <h1>{t('stk.title')}</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['position', 'movements'] as const).map(tb => (
          <button key={tb} className={`btn ${tab === tb ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setTab(tb); setPage(1); }}>
            {tb === 'position' ? t('stk.tabPosition') : t('stk.tabMovements')}
          </button>
        ))}
      </div>

      {/* ── POSIÇÃO DE ESTOQUE ── */}
      {tab === 'position' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input className="search-input" placeholder={t('stk.searchPH')}
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>

          <div className="card">
            {loading ? (
              <div className="spinner">{t('c.loading')}</div>
            ) : items.length === 0 ? (
              <div className="empty-state">{t('stk.empty')}</div>
            ) : (
              <table>
                <thead><tr>
                  <th>{t('stk.sku')}</th>
                  <th>{t('stk.material')}</th>
                  <th>{t('stk.category')}</th>
                  <th style={{ textAlign: 'right' }}>{t('stk.qty')}</th>
                  <th style={{ textAlign: 'right' }}>{t('stk.minQty')}</th>
                  <th>{t('stk.status')}</th>
                  <th>{t('c.actions')}</th>
                </tr></thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id}>
                      <td><code style={{ fontSize: 12 }}>{item.sku}</code></td>
                      <td>{item.name}</td>
                      <td>{item.category || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600,
                        color: item.is_low_stock ? 'var(--danger)' : undefined }}>
                        {Number(item.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} {item.unit}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                        {Number(item.min_qty).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} {item.unit}
                      </td>
                      <td>
                        {item.is_low_stock
                          ? <span className="badge badge-inactive">{t('stk.lowStock')}</span>
                          : <span className="badge badge-active">{t('stk.ok')}</span>}
                      </td>
                      <td>
                        <button className="btn btn-secondary btn-sm"
                          onClick={() => openAdjust(item)}>{t('stk.adjust')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── HISTÓRICO DE MOVIMENTOS ── */}
      {tab === 'movements' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <select className="btn btn-secondary"
              value={mvType} onChange={e => { setMvType(e.target.value); setPage(1); }}>
              <option value="">{t('stk.allTypes')}</option>
              <option value="in">{t('stk.mv.in')}</option>
              <option value="out">{t('stk.mv.out')}</option>
              <option value="adjustment">{t('stk.mv.adjustment')}</option>
              <option value="return">{t('stk.mv.return')}</option>
              <option value="transfer">{t('stk.mv.transfer')}</option>
            </select>
          </div>

          <div className="card">
            {loading ? (
              <div className="spinner">{t('c.loading')}</div>
            ) : movements.length === 0 ? (
              <div className="empty-state">{t('stk.emptyMov')}</div>
            ) : (
              <table>
                <thead><tr>
                  <th>{t('stk.date')}</th>
                  <th>{t('stk.material')}</th>
                  <th>{t('stk.mvType')}</th>
                  <th style={{ textAlign: 'right' }}>{t('stk.qty')}</th>
                  <th style={{ textAlign: 'right' }}>{t('stk.before')}</th>
                  <th style={{ textAlign: 'right' }}>{t('stk.after')}</th>
                  <th>{t('stk.reason')}</th>
                </tr></thead>
                <tbody>
                  {movements.map(mv => (
                    <tr key={mv.id}>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {new Date(mv.created_at).toLocaleString('pt-BR')}
                      </td>
                      <td>
                        <div>{mv.material_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{mv.sku}</div>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: mvTypeColor[mv.movement_type] || '#64748b' }}>
                          {t(`stk.mv.${mv.movement_type}` as any)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {Number(mv.quantity) > 0 ? '+' : ''}{Number(mv.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} {mv.unit}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                        {Number(mv.quantity_before).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                        {Number(mv.quantity_after).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {mv.reason || (mv.reference_type ? `ref: ${mv.reference_type}` : '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Paginação */}
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}>{t('c.prev')}</button>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>
            {t('c.page')} {page} {t('c.of')} {pages}
          </span>
          <button className="btn btn-secondary btn-sm" disabled={page >= pages}
            onClick={() => setPage(p => p + 1)}>{t('c.next')}</button>
        </div>
      )}

      {/* Drawer de ajuste */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{t('stk.adjustTitle')}: {selItem?.name}</h2>
              <button onClick={() => setDrawerOpen(false)}>{t('c.close')}</button>
            </div>
            <form onSubmit={handleAdjust} noValidate>
              <div className="drawer-body">
                {formError && <div role="alert" className="alert alert-error">{formError}</div>}

                <div style={{ marginBottom: 12, padding: 12, background: 'var(--surface)', borderRadius: 6 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('stk.currentQty')}</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {Number(selItem?.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} {selItem?.unit}
                  </div>
                </div>

                <div className="field">
                  <label>{t('stk.mvType')}</label>
                  <select value={adjType} onChange={e => setAdjType(e.target.value as any)}>
                    <option value="in">{t('stk.mv.in')}</option>
                    <option value="out">{t('stk.mv.out')}</option>
                    <option value="adjustment">{t('stk.mv.adjustment')}</option>
                  </select>
                </div>

                <div className="field">
                  <label>{t('stk.qty')} *</label>
                  <input type="number" min="0.001" step="0.001"
                    value={adjQty} onChange={e => setAdjQty(e.target.value)} required />
                </div>

                <div className="field">
                  <label>{t('stk.reason')}</label>
                  <input type="text" value={adjReason} onChange={e => setAdjReason(e.target.value)}
                    placeholder={t('stk.reasonPH')} />
                </div>
              </div>
              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary"
                  onClick={() => setDrawerOpen(false)}>{t('c.cancel')}</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? t('c.saving') : t('stk.adjustBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
