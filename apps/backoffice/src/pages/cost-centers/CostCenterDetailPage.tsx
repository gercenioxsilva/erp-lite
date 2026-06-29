import { useEffect, useState, FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';
import { EditDrawer, EntryDrawer, AdjustDrawer } from './CostCenterDrawers';
import type { MaterialOption } from './CostCenterDrawers';

// ── Types ──────────────────────────────────────────────────────────────────────

interface CostCenter {
  id:             string;
  code:           string;
  name:           string;
  description:    string | null;
  allow_negative: boolean;
  is_active:      boolean;
}

interface StockItem {
  material_id:   string;
  material_name: string;
  quantity:      number;
  avg_cost:      number;
  total_value:   number;
}

interface Movement {
  id:            string;
  occurred_at:   string;
  material_id:   string;
  material_name: string;
  direction:     'in' | 'out';
  quantity:      number;
  unit_cost:     number;
  total:         number;
  balance_after: number;
}

interface StockResp     { data: StockItem[]; total: number; }
interface MovementResp  { data: Movement[];  total: number; page: number; per_page: number; }
interface MaterialsResp { data: MaterialOption[]; total: number; }

interface InsufficientStockError {
  error:     'insufficient_stock';
  available: number;
  requested: number;
}

// ── Empty forms ────────────────────────────────────────────────────────────────

const EMPTY_EDIT   = { name: '', description: '', allow_negative: false, is_active: true };
const EMPTY_ENTRY  = { material_id: '', quantity: '', unit_cost: '', note: '' };
const EMPTY_ADJUST = { material_id: '', target_quantity: '', note: '' };

const EMPTY_MOV_FILTERS = { material_id: '', direction: '', from: '', to: '' };

// ── Currency / number helpers ─────────────────────────────────────────────────

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtNum(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CostCenterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const { t } = useI18n();

  // ── Cost center header state ───────────────────────────────────────────────
  const [cc,            setCc]           = useState<CostCenter | null>(null);
  const [headerLoading, setHeaderLoading] = useState(true);
  const [headerError,   setHeaderError]   = useState('');

  // ── Edit drawer state ──────────────────────────────────────────────────────
  const [editOpen,   setEditOpen]   = useState(false);
  const [editForm,   setEditForm]   = useState({ ...EMPTY_EDIT });
  const [editSaving, setEditSaving] = useState(false);
  const [editError,  setEditError]  = useState('');

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'stock' | 'movements'>('stock');

  // ── Materials (for selects) ────────────────────────────────────────────────
  const [materials, setMaterials] = useState<MaterialOption[]>([]);

  // ── Stock tab state ────────────────────────────────────────────────────────
  const [stock,        setStock]        = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError,   setStockError]   = useState('');

  // Entry drawer
  const [entryOpen,   setEntryOpen]   = useState(false);
  const [entryForm,   setEntryForm]   = useState({ ...EMPTY_ENTRY });
  const [entrySaving, setEntrySaving] = useState(false);
  const [entryError,  setEntryError]  = useState('');

  // Adjustment drawer
  const [adjustOpen,   setAdjustOpen]   = useState(false);
  const [adjustForm,   setAdjustForm]   = useState({ ...EMPTY_ADJUST });
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustError,  setAdjustError]  = useState('');

  // ── Movements tab state ────────────────────────────────────────────────────
  const [movements,  setMovements] = useState<Movement[]>([]);
  const [movTotal,   setMovTotal]  = useState(0);
  const [movPage,    setMovPage]   = useState(1);
  const [movLoading, setMovLoading] = useState(false);
  const [movError,   setMovError]  = useState('');
  const [movFilters, setMovFilters] = useState({ ...EMPTY_MOV_FILTERS });

  const MOV_PER_PAGE = 20;

  // ── Load cost center header ────────────────────────────────────────────────

  async function loadCC() {
    if (!tenantId || !id) return;
    setHeaderLoading(true);
    setHeaderError('');
    try {
      const resp = await api.get<CostCenter>(`/v1/cost-centers/${id}?tenant_id=${tenantId}`);
      setCc(resp);
    } catch (err: unknown) {
      setHeaderError(err instanceof Error ? err.message : 'Erro ao carregar centro de custo.');
    } finally {
      setHeaderLoading(false);
    }
  }

  // ── Load materials for selects ─────────────────────────────────────────────

  async function loadMaterials() {
    if (!tenantId) return;
    try {
      const resp = await api.get<MaterialsResp>(
        `/v1/materials?tenant_id=${tenantId}&per_page=200`,
      );
      setMaterials(resp.data ?? []);
    } catch {
      // non-fatal — falls back to text input
    }
  }

  // ── Load stock ─────────────────────────────────────────────────────────────

  async function loadStock() {
    if (!tenantId || !id) return;
    setStockLoading(true);
    setStockError('');
    try {
      const resp = await api.get<StockResp>(
        `/v1/cost-centers/${id}/stock?tenant_id=${tenantId}`,
      );
      setStock(resp.data ?? []);
    } catch (err: unknown) {
      setStockError(err instanceof Error ? err.message : 'Erro ao carregar estoque.');
    } finally {
      setStockLoading(false);
    }
  }

  // ── Load movements ─────────────────────────────────────────────────────────

  async function loadMovements() {
    if (!tenantId || !id) return;
    setMovLoading(true);
    setMovError('');
    try {
      const p = new URLSearchParams({
        tenant_id: tenantId,
        page:      String(movPage),
        per_page:  String(MOV_PER_PAGE),
        ...(movFilters.material_id ? { material_id: movFilters.material_id } : {}),
        ...(movFilters.direction   ? { direction:   movFilters.direction }   : {}),
        ...(movFilters.from        ? { from:         movFilters.from }       : {}),
        ...(movFilters.to          ? { to:           movFilters.to }         : {}),
      });
      const resp = await api.get<MovementResp>(
        `/v1/cost-centers/${id}/movements?${p}`,
      );
      setMovements(resp.data ?? []);
      setMovTotal(resp.total ?? 0);
    } catch (err: unknown) {
      setMovError(err instanceof Error ? err.message : 'Erro ao carregar movimentações.');
    } finally {
      setMovLoading(false);
    }
  }

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => { void loadCC(); },        [tenantId, id]);
  useEffect(() => { void loadMaterials(); }, [tenantId]);
  useEffect(() => { if (activeTab === 'stock')     void loadStock(); },     [tenantId, id, activeTab]);
  useEffect(() => { if (activeTab === 'movements') void loadMovements(); }, [tenantId, id, activeTab, movPage, movFilters]);

  // ── Edit drawer handlers ───────────────────────────────────────────────────

  function openEdit() {
    if (!cc) return;
    setEditForm({
      name:           cc.name,
      description:    cc.description ?? '',
      allow_negative: cc.allow_negative,
      is_active:      cc.is_active,
    });
    setEditError('');
    setEditOpen(true);
  }

  async function handleEditSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !id) return;
    if (!editForm.name.trim()) { setEditError('Nome é obrigatório.'); return; }
    setEditSaving(true);
    setEditError('');
    try {
      await api.patch(`/v1/cost-centers/${id}`, {
        tenant_id:      tenantId,
        name:           editForm.name.trim(),
        description:    editForm.description.trim() || undefined,
        allow_negative: editForm.allow_negative,
        is_active:      editForm.is_active,
      });
      setEditOpen(false);
      void loadCC();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setEditSaving(false);
    }
  }

  // ── Entry drawer handlers ──────────────────────────────────────────────────

  function openEntry() {
    setEntryForm({ ...EMPTY_ENTRY });
    setEntryError('');
    setEntryOpen(true);
  }

  async function handleEntrySubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !id) return;
    if (!entryForm.material_id.trim()) { setEntryError('Selecione o material.'); return; }
    const qty = parseFloat(entryForm.quantity);
    if (!qty || qty <= 0) { setEntryError('Informe uma quantidade maior que zero.'); return; }
    const cost = parseFloat(entryForm.unit_cost);
    if (!cost || cost < 0) { setEntryError('Informe um custo unitário válido.'); return; }
    setEntrySaving(true);
    setEntryError('');
    try {
      await api.post(`/v1/cost-centers/${id}/entries`, {
        tenant_id:   tenantId,
        material_id: entryForm.material_id.trim(),
        quantity:    qty,
        unit_cost:   cost,
        note:        entryForm.note.trim() || undefined,
      });
      setEntryOpen(false);
      void loadStock();
    } catch (err: unknown) {
      const raw = err as { status?: number; message?: string };
      if (raw.status === 422) {
        try {
          const parsed: InsufficientStockError = JSON.parse(raw.message ?? '{}');
          if (parsed.error === 'insufficient_stock') {
            setEntryError(
              `Saldo insuficiente: disponível ${fmtNum(parsed.available)}, solicitado ${fmtNum(parsed.requested)}`,
            );
            return;
          }
        } catch { /**/ }
      }
      setEntryError(err instanceof Error ? err.message : 'Erro ao registrar entrada.');
    } finally {
      setEntrySaving(false);
    }
  }

  // ── Adjustment drawer handlers ─────────────────────────────────────────────

  function openAdjust() {
    setAdjustForm({ ...EMPTY_ADJUST });
    setAdjustError('');
    setAdjustOpen(true);
  }

  async function handleAdjustSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !id) return;
    if (!adjustForm.material_id.trim()) { setAdjustError('Selecione o material.'); return; }
    const target = parseFloat(adjustForm.target_quantity);
    if (isNaN(target) || target < 0) { setAdjustError('Informe uma quantidade alvo válida.'); return; }
    setAdjustSaving(true);
    setAdjustError('');
    try {
      await api.post(`/v1/cost-centers/${id}/adjustments`, {
        tenant_id:       tenantId,
        material_id:     adjustForm.material_id.trim(),
        target_quantity: target,
        note:            adjustForm.note.trim() || undefined,
      });
      setAdjustOpen(false);
      void loadStock();
    } catch (err: unknown) {
      const raw = err as { status?: number; message?: string };
      if (raw.status === 422) {
        try {
          const parsed: InsufficientStockError = JSON.parse(raw.message ?? '{}');
          if (parsed.error === 'insufficient_stock') {
            setAdjustError(
              `Saldo insuficiente: disponível ${fmtNum(parsed.available)}, solicitado ${fmtNum(parsed.requested)}`,
            );
            return;
          }
        } catch { /**/ }
      }
      setAdjustError(err instanceof Error ? err.message : 'Erro ao registrar ajuste.');
    } finally {
      setAdjustSaving(false);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const movTotalPages = Math.ceil(movTotal / MOV_PER_PAGE);

  // ── Render loading / error header states ───────────────────────────────────

  if (headerLoading) {
    return (
      <div>
        <div className="page-header">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/cost-centers')}>
            ← {t('cc.title')}
          </button>
        </div>
        <div className="spinner">{t('c.loading')}</div>
      </div>
    );
  }

  if (headerError || !cc) {
    return (
      <div>
        <div className="page-header">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/cost-centers')}>
            ← {t('cc.title')}
          </button>
        </div>
        <div className="alert alert-error">{headerError || 'Centro de custo não encontrado.'}</div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/cost-centers')}
            aria-label="Voltar para Centros de Custo"
          >
            ← {t('cc.title')}
          </button>
          <h1 style={{ margin: 0, fontSize: 20 }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{cc.code}</span>
            {' — '}
            {cc.name}
          </h1>
          <span className={`badge badge-${cc.is_active ? 'service' : 'raw_material'}`}>
            {cc.is_active ? t('c.active') : t('c.inactive')}
          </span>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={openEdit}>
          {t('c.edit')}
        </button>
      </div>

      {/* ── Description ──────────────────────────────────────────────── */}
      {cc.description && (
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>
          {cc.description}
        </p>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div role="tablist" className="flex-gap" style={{ borderBottom: '2px solid var(--border)', marginBottom: 24 }}>
        {(['stock', 'movements'] as const).map(tab => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            className="btn btn-secondary btn-sm"
            style={{
              borderBottom: activeTab === tab ? '2px solid var(--accent, #0070f3)' : '2px solid transparent',
              borderRadius: 0,
              fontWeight: activeTab === tab ? 700 : 400,
            }}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'stock' ? t('cc.stock') : t('cc.movements')}
          </button>
        ))}
      </div>

      {/* ── Tab: Estoque ──────────────────────────────────────────────── */}
      {activeTab === 'stock' && (
        <div>
          {stockLoading ? (
            <div className="spinner">{t('c.loading')}</div>
          ) : stockError ? (
            <div className="alert alert-error">{stockError}</div>
          ) : (
            <div className="card">
              {stock.length === 0 ? (
                <div className="empty-state">Nenhum registro encontrado.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th style={{ textAlign: 'right' }}>{t('cc.quantity')}</th>
                      <th style={{ textAlign: 'right' }}>Custo Médio</th>
                      <th style={{ textAlign: 'right' }}>Valor Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.map(item => (
                      <tr key={item.material_id}>
                        <td style={{ fontWeight: 500 }}>{item.material_name}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtNum(item.quantity)}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtBRL(item.avg_cost)}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {fmtBRL(item.total_value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex-gap mt-16">
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={openEntry}>
              + {t('cc.entry')}
            </button>
            <button className="btn btn-secondary" style={{ width: 'auto' }} onClick={openAdjust}>
              {t('cc.adjustment')}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Movimentações ────────────────────────────────────────── */}
      {activeTab === 'movements' && (
        <div>
          {/* Filters */}
          <div className="flex-gap" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
            {materials.length > 0 ? (
              <select
                value={movFilters.material_id}
                onChange={e => { setMovFilters(f => ({ ...f, material_id: e.target.value })); setMovPage(1); }}
                style={{ maxWidth: 220 }}
              >
                <option value="">Todos os materiais</option>
                {materials.map(m => (
                  <option key={m.id} value={m.id}>{m.sku ? `${m.sku} — ` : ''}{m.name}</option>
                ))}
              </select>
            ) : null}

            <select
              value={movFilters.direction}
              onChange={e => { setMovFilters(f => ({ ...f, direction: e.target.value })); setMovPage(1); }}
              style={{ maxWidth: 160 }}
            >
              <option value="">Todos os tipos</option>
              <option value="in">{t('cc.direction.in')}</option>
              <option value="out">{t('cc.direction.out')}</option>
            </select>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              De{' '}
              <input
                type="date"
                value={movFilters.from}
                onChange={e => { setMovFilters(f => ({ ...f, from: e.target.value })); setMovPage(1); }}
                style={{ maxWidth: 150 }}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              Até{' '}
              <input
                type="date"
                value={movFilters.to}
                onChange={e => { setMovFilters(f => ({ ...f, to: e.target.value })); setMovPage(1); }}
                style={{ maxWidth: 150 }}
              />
            </label>
          </div>

          {/* Table */}
          {movLoading ? (
            <div className="spinner">{t('c.loading')}</div>
          ) : movError ? (
            <div className="alert alert-error">{movError}</div>
          ) : (
            <div className="card">
              {movements.length === 0 ? (
                <div className="empty-state">Nenhum registro encontrado.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Material</th>
                      <th>Tipo</th>
                      <th style={{ textAlign: 'right' }}>Quantidade</th>
                      <th style={{ textAlign: 'right' }}>Custo Unit.</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'right' }}>Saldo após</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map(mv => (
                      <tr key={mv.id}>
                        <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDate(mv.occurred_at)}</td>
                        <td style={{ fontWeight: 500 }}>{mv.material_name}</td>
                        <td>
                          <span className={`badge badge-${mv.direction === 'in' ? 'service' : 'raw_material'}`}>
                            {mv.direction === 'in' ? t('cc.direction.in') : t('cc.direction.out')}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtNum(mv.quantity)}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtBRL(mv.unit_cost)}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtBRL(mv.total)}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>
                          {fmtNum(mv.balance_after)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Pagination */}
          {movTotalPages > 1 && (
            <div className="flex-gap mt-16" style={{ justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary btn-sm"
                disabled={movPage <= 1}
                onClick={() => setMovPage(p => p - 1)}
              >
                {t('c.prev')}
              </button>
              <span className="text-muted" style={{ fontSize: 13 }}>
                {t('c.page')} {movPage} {t('c.of')} {movTotalPages}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={movPage >= movTotalPages}
                onClick={() => setMovPage(p => p + 1)}
              >
                {t('c.next')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Drawers ───────────────────────────────────────────────────── */}
      <EditDrawer
        open={editOpen}
        form={editForm}
        saving={editSaving}
        error={editError}
        onClose={() => setEditOpen(false)}
        onChange={setEditForm}
        onSubmit={handleEditSave}
      />
      <EntryDrawer
        open={entryOpen}
        form={entryForm}
        saving={entrySaving}
        error={entryError}
        materials={materials}
        onClose={() => setEntryOpen(false)}
        onChange={setEntryForm}
        onSubmit={handleEntrySubmit}
      />
      <AdjustDrawer
        open={adjustOpen}
        form={adjustForm}
        saving={adjustSaving}
        error={adjustError}
        materials={materials}
        onClose={() => setAdjustOpen(false)}
        onChange={setAdjustForm}
        onSubmit={handleAdjustSubmit}
      />
    </div>
  );
}
