import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { SectionCard, StepProgress } from '../../ds';
import { ProductPicker } from '../../ds/components/ProductPicker';
import type { Step } from '../../ds';
import './InvoiceNewPage.css';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const PCT = (n: number) => `${n.toFixed(2).replace('.', ',')}%`;

interface ClientOption   { id: string; company_name: string | null; full_name: string | null; }
interface MaterialOption { id: string; sku: string; name: string; ncm_code: string | null; sale_price: number | null; description?: string | null; type?: string | null; }
interface KitComponentRow { component_id: string; quantity: string; sku: string | null; name: string; unit: string; sale_price: string | null; ncm_code: string | null; }
interface OrderOption    { id: string; number: string; client_id: string; client_name: string; status: string; }
interface CostCenter { id: string; code: string; name: string; }
interface StockItem  { material_id: string; quantity: number; }
interface SellerOption { id: string; name: string; }

interface FormItem {
  _key: string; material_id: string; name: string;
  ncm_code: string; cfop: string; quantity: string; unit_price: string;
  icms_cst?: string; icms_rate?: number; icms_value?: number;
  pis_cst?: string;  pis_rate?: number;  pis_value?: number;
  cofins_cst?: string; cofins_rate?: number; cofins_value?: number;
  ipi_rate?: string; ipi_value?: number;
}

interface TaxResult {
  lines: Array<{
    icms_cst: string; icms_base: number; icms_rate: number; icms_value: number;
    pis_cst: string;  pis_base: number;  pis_rate: number;  pis_value: number;
    cofins_cst: string; cofins_base: number; cofins_rate: number; cofins_value: number;
    ipi_base: number; ipi_rate: number; ipi_value: number;
  }>;
  totals: {
    subtotal: number; icms_total: number; pis_total: number;
    cofins_total: number; ipi_total: number; embedded_tax_total: number; grand_total: number;
  };
  applied_rates: { icms: number; pis: number; cofins: number; };
}

function newItem(): FormItem {
  return {
    _key: Math.random().toString(36).slice(2),
    material_id: '', name: '', ncm_code: '', cfop: '', quantity: '1', unit_price: '0',
  };
}

const STEPS: Step[] = [
  { label: 'Pedido',        description: 'Série e vínculo'   },
  { label: 'Cliente',       description: 'Destinatário NF-e' },
  { label: 'Itens',         description: 'Produtos'          },
  { label: 'Dados Fiscais', description: 'Regime tributário' },
  { label: 'Revisão',       description: 'Impostos e total'  },
];

export function InvoiceNewPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();
  const navigate = useNavigate();

  const [formClientId,   setFormClientId]   = useState('');
  const [formOrderId,    setFormOrderId]    = useState('');
  const [formNotes,      setFormNotes]      = useState('');
  const [formSerie,      setFormSerie]      = useState('1');
  const [formItems,      setFormItems]      = useState<FormItem[]>([newItem()]);
  const [formTaxRegime,  setFormTaxRegime]  = useState('lucro_presumido');
  const [formDestState,  setFormDestState]  = useState('SP');
  const [taxResult,      setTaxResult]      = useState<TaxResult | null>(null);
  const [calcTaxLoad,    setCalcTaxLoad]    = useState(false);
  const [calcTaxError,   setCalcTaxError]   = useState('');
  const [saving,         setSaving]         = useState(false);
  const [formError,      setFormError]      = useState('');
  const [nfeAmbiente,    setNfeAmbiente]    = useState<number | null>(null);

  const [clients,   setClients]   = useState<ClientOption[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [orders,    setOrders]    = useState<OrderOption[]>([]);

  const [costCenters,      setCostCenters]      = useState<CostCenter[]>([]);
  const [formCostCenterId, setFormCostCenterId] = useState('');
  const [ccStock,          setCcStock]          = useState<StockItem[]>([]);
  const [sellers,          setSellers]          = useState<SellerOption[]>([]);
  const [formSellerId,     setFormSellerId]     = useState('');

  const hasClient = !!formClientId;
  const hasItems  = formItems.some(it => it.name);
  const hasFiscal = !!(formTaxRegime && formDestState);
  const hasTax    = !!taxResult;

  const currentStep = !hasClient ? 1 : !hasItems ? 2 : !hasFiscal ? 3 : hasTax ? 5 : 4;


  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    Promise.all([
      api.get<{ data: ClientOption[] }>(`/v1/clients?tenant_id=${tenantId}&per_page=100`),
      api.get<{ data: MaterialOption[] }>(`/v1/materials?tenant_id=${tenantId}&per_page=500`),
      api.get<{ data: OrderOption[] }>(`/v1/orders?tenant_id=${tenantId}&per_page=100`),
      api.get<{ focus_ambiente: number | null }>(`/v1/nfe-config?tenant_id=${tenantId}`).catch(() => ({ focus_ambiente: null })),
      api.get<{ data: CostCenter[] }>(`/v1/cost-centers/active?tenant_id=${tenantId}`).catch(() => ({ data: [] as CostCenter[] })),
      api.get<SellerOption[]>('/v1/sellers/active').catch(() => [] as SellerOption[]),
    ]).then(([cl, mt, or, cfg, cc, sl]) => {
      if (cancelled) return;
      setClients(cl.data ?? []);
      setMaterials(mt.data ?? []);
      setOrders((or.data ?? []).filter(o => !['cancelled', 'delivered'].includes(o.status)));
      setNfeAmbiente(cfg.focus_ambiente ?? null);
      setCostCenters(cc.data ?? []);
      setSellers(Array.isArray(sl) ? sl : []);
    }).catch(() => {/* non-fatal */});
    return () => { cancelled = true; };
  }, [tenantId]);

  async function handleOrderChange(orderId: string) {
    setFormOrderId(orderId);
    setTaxResult(null);
    if (!orderId) { setFormClientId(''); setFormItems([newItem()]); return; }
    try {
      const detail = await api.get<{
        client_id: string;
        items: Array<{ material_id: string | null; name: string; quantity: number; unit_price: number; }>;
      }>(`/v1/orders/${orderId}`);
      setFormClientId(detail.client_id);
      setFormItems(
        detail.items.length > 0
          ? detail.items.map(it => ({
              _key: Math.random().toString(36).slice(2),
              material_id: it.material_id ?? '',
              name: it.name,
              ncm_code: materials.find(m => m.id === it.material_id)?.ncm_code ?? '',
              cfop: '',
              quantity: String(it.quantity),
              unit_price: String(it.unit_price),
            }))
          : [newItem()],
      );
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    }
  }

  async function handleCostCenterChange(id: string) {
    setFormCostCenterId(id);
    setCcStock([]);
    if (!id) return;
    try {
      const resp = await api.get<{ data: StockItem[] }>(`/v1/cost-centers/${id}/stock`);
      setCcStock(resp.data ?? []);
    } catch { /* non-fatal */ }
  }

  function addItem() { setFormItems(prev => [...prev, newItem()]); setTaxResult(null); }

  function handlePickMaterial(idx: number, id: string) {
    if (!id) { updateItem(idx, 'material_id', ''); return; }
    const mat = materials.find(m => m.id === id);
    if (mat?.type === 'kit') { void addKit(idx, id); return; }
    updateItem(idx, 'material_id', id);
  }

  async function addKit(idx: number, kitId: string) {
    let comps: KitComponentRow[] = [];
    try {
      const resp = await api.get<{ data: KitComponentRow[] }>(`/v1/materials/${kitId}/components`);
      comps = resp.data ?? [];
    } catch { comps = []; }

    const expand = comps.length > 0 && await modal.confirm({
      title:        t('o.kit.title'),
      message:      t('o.kit.message'),
      confirmLabel: t('o.kit.expand'),
      cancelLabel:  t('o.kit.closed'),
    });

    if (expand) {
      const lines: FormItem[] = comps.map(c => ({
        _key:        Math.random().toString(36).slice(2),
        material_id: c.component_id,
        name:        c.name,
        ncm_code:    c.ncm_code ?? '',
        cfop:        '',
        quantity:    String(Number(c.quantity) || 1),
        unit_price:  c.sale_price ? String(c.sale_price) : '0',
      }));
      setFormItems(prev => [...prev.slice(0, idx), ...lines, ...prev.slice(idx + 1)]);
      setTaxResult(null);
    } else {
      updateItem(idx, 'material_id', kitId);
    }
  }
  function removeItem(idx: number) { setFormItems(prev => prev.filter((_, i) => i !== idx)); setTaxResult(null); }

  function updateItem(idx: number, field: string, val: string) {
    setTaxResult(null);
    setFormItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      if (field === 'material_id') {
        const mat = materials.find(m => m.id === val);
        return {
          ...item, material_id: val, name: mat?.name ?? '',
          ncm_code: mat?.ncm_code ?? '',
          unit_price: mat?.sale_price != null ? String(mat.sale_price) : item.unit_price,
        };
      }
      return { ...item, [field]: val };
    }));
  }

  async function handleCalculateTaxes() {
    const valid = formItems.filter(it => it.name && Number(it.quantity) > 0);
    if (!valid.length) { setCalcTaxError(t('o.errNoItems')); return; }
    setCalcTaxLoad(true); setCalcTaxError('');
    try {
      const result = await api.post<TaxResult>('/v1/tax/calculate', {
        origin_state:      'SP',
        destination_state: formDestState.toUpperCase() || 'SP',
        tax_regime:        formTaxRegime,
        lines: valid.map(it => ({
          ncm_code:   it.ncm_code || undefined,
          quantity:   Number(it.quantity),
          unit_price: Number(it.unit_price),
          ipi_rate:   it.ipi_rate ? Number(it.ipi_rate) : 0,
        })),
      });
      let ri = 0;
      setFormItems(prev => prev.map(item => {
        if (!item.name || !(Number(item.quantity) > 0)) return item;
        const line = result.lines[ri++];
        if (!line) return item;
        return {
          ...item,
          icms_cst: line.icms_cst, icms_rate: line.icms_rate, icms_value: line.icms_value,
          pis_cst:  line.pis_cst,  pis_rate:  line.pis_rate,  pis_value:  line.pis_value,
          cofins_cst: line.cofins_cst, cofins_rate: line.cofins_rate, cofins_value: line.cofins_value,
          ipi_value: line.ipi_value,
        };
      }));
      setTaxResult(result);
    } catch (err: unknown) {
      setCalcTaxError(err instanceof Error ? err.message : 'Erro ao calcular impostos');
    } finally { setCalcTaxLoad(false); }
  }

  const subtotalCalc = formItems.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0,
  );

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    if (!formClientId) { setFormError(t('inv.errNoClient')); return; }
    if (!formItems.some(it => it.name)) { setFormError(t('o.errNoItems')); return; }
    setSaving(true); setFormError('');
    try {
      await api.post('/v1/invoices', {
        tenant_id: tenantId, client_id: formClientId,
        order_id: formOrderId || undefined, serie: formSerie,
        notes: formNotes || null,
        cost_center_id: formCostCenterId || null,
        seller_id: formSellerId || undefined,
        tax_regime: formTaxRegime, origin_state: 'SP',
        items: formItems.filter(it => it.name).map(it => {
          const base = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
          return {
            material_id: it.material_id || undefined, name: it.name,
            ncm_code: it.ncm_code || undefined, cfop: it.cfop || undefined,
            quantity: Number(it.quantity), unit_price: Number(it.unit_price),
            icms_cst: it.icms_cst,   icms_base: base,
            icms_rate: it.icms_rate  ?? 0, icms_value: it.icms_value  ?? 0,
            pis_cst:  it.pis_cst,    pis_base:  base,
            pis_rate: it.pis_rate    ?? 0, pis_value:  it.pis_value   ?? 0,
            cofins_cst: it.cofins_cst, cofins_base: base,
            cofins_rate: it.cofins_rate ?? 0, cofins_value: it.cofins_value ?? 0,
            ipi_rate: it.ipi_rate ? Number(it.ipi_rate) : 0,
            ipi_value: it.ipi_value ?? 0,
          };
        }),
      });
      navigate('/invoices');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    } finally { setSaving(false); }
  }

  const selectedClient = clients.find(c => c.id === formClientId);

  return (
    <form onSubmit={handleSave} noValidate>
      {/* Sticky step progress bar */}
      <div className="inv-new-bar">
        <StepProgress steps={STEPS} currentStep={currentStep} />
      </div>

      {/* Page header */}
      <div className="page-header" style={{ paddingTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
            onClick={() => navigate('/invoices')}>
            ← Voltar
          </button>
          <h1>{t('inv.new')}</h1>
          {nfeAmbiente === 1 && <span className="env-badge env-badge--prod">{t('nfe.envBadge.prod')}</span>}
          {nfeAmbiente === 2 && <span className="env-badge env-badge--homo">{t('nfe.envBadge.homo')}</span>}
        </div>
      </div>

      {formError && (
        <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>{formError}</div>
      )}

      <div className="inv-new-layout">
        {/* Main column */}
        <div className="inv-new-main">

          {/* Step 1 — Pedido & Série */}
          <SectionCard step={1} title={`${t('inv.fromOrder')} & ${t('inv.serie')}`}
            description="Vincule a um pedido existente ou inicie do zero"
            unlocked>
            <div className="field-row">
              <div className="field">
                <label htmlFor="inv-order">{t('inv.fromOrder')}</label>
                <select id="inv-order" value={formOrderId}
                  onChange={e => void handleOrderChange(e.target.value)}>
                  <option value="">{t('inv.selectOrder')}</option>
                  {orders.map(o => (
                    <option key={o.id} value={o.id}>#{o.number} — {o.client_name}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: '0 0 100px' }}>
                <label htmlFor="inv-serie">{t('inv.serie')}</label>
                <input id="inv-serie" value={formSerie}
                  onChange={e => setFormSerie(e.target.value)} maxLength={10} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="inv-cost-center">{t('cc.costCenter')}</label>
              <select id="inv-cost-center" value={formCostCenterId}
                onChange={e => void handleCostCenterChange(e.target.value)}>
                <option value="">{t('cc.none')}</option>
                {costCenters.map(cc => (
                  <option key={cc.id} value={cc.id}>{cc.code} — {cc.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="inv-seller">{t('sel.seller')}</label>
              <select id="inv-seller" value={formSellerId}
                onChange={e => setFormSellerId(e.target.value)}>
                <option value="">{t('sel.none')}</option>
                {sellers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </SectionCard>

          {/* Step 2 — Cliente */}
          <SectionCard step={2} title={t('inv.client')}
            description="Selecione o destinatário da nota fiscal"
            unlocked>
            <div className="field">
              <label htmlFor="inv-client">{t('inv.client')} *</label>
              <select id="inv-client" value={formClientId}
                onChange={e => setFormClientId(e.target.value)}>
                <option value="">{t('o.selectClient')}</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.company_name ?? c.full_name}</option>
                ))}
              </select>
            </div>
          </SectionCard>

          {/* Step 3 — Itens */}
          <SectionCard step={3} title={t('o.items')}
            description="Adicione os produtos com NCM e CFOP"
            unlocked={hasClient}>
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                  onClick={addItem}>+ {t('o.addItem')}</button>
              </div>
              {formItems.length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>{t('o.noItems')}</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 600, fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface)' }}>
                        <th style={{ padding: '6px 10px', textAlign: 'left', width: '32%' }}>{t('o.material')}</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', width: '10%' }}>{t('o.qty')}</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', width: '13%' }}>{t('o.unitPrice')}</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', width: '13%' }}>{t('inv.ncm')}</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', width: '13%' }}>{t('inv.cfop')}</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', width: '15%' }}>{t('o.lineTotal')}</th>
                        <th style={{ width: '4%' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {formItems.map((item, idx) => (
                        <tr key={item._key} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 10px' }}>
                            <ProductPicker
                              options={materials}
                              value={item.material_id}
                              onChange={id => handlePickMaterial(idx, id)}
                              placeholder={t('o.selectMat')}
                              emptyLabel={t('o.noMatch')}
                              ariaLabel={t('o.material')}
                              kitLabel={t('o.kit.badge')}
                            />
                            {!item.material_id && (
                              <input placeholder={t('o.namePH')} value={item.name}
                                onChange={e => updateItem(idx, 'name', e.target.value)}
                                style={{ marginTop: 4, fontSize: 12 }} />
                            )}
                            {formCostCenterId && item.material_id && (() => {
                              const stock = ccStock.find(s => s.material_id === item.material_id);
                              if (stock && stock.quantity < Number(item.quantity)) {
                                return (
                                  <div style={{ fontSize: 11, color: '#d97706', marginTop: 4 }}>
                                    ⚠ Saldo insuficiente no centro de custo para este material (disponível: {stock.quantity})
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input type="number" min="0.001" step="0.001" value={item.quantity}
                              onChange={e => updateItem(idx, 'quantity', e.target.value)}
                              style={{ fontSize: 12 }} />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input type="number" min="0" step="0.01" value={item.unit_price}
                              onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                              style={{ fontSize: 12 }} />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input placeholder="0000.00.00" value={item.ncm_code}
                              onChange={e => updateItem(idx, 'ncm_code', e.target.value)}
                              style={{ fontSize: 12 }} />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input placeholder="5102" value={item.cfop}
                              onChange={e => updateItem(idx, 'cfop', e.target.value)}
                              style={{ fontSize: 12 }} />
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, fontSize: 12 }}>
                            {BRL.format((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button type="button" onClick={() => removeItem(idx)}
                              aria-label={`remove-item-${idx}`}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18, padding: '0 8px' }}>
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          </SectionCard>

          {/* Step 4 — Dados Fiscais */}
          <SectionCard step={4} title={`${t('tax.regime')} & ${t('tax.destState')}`}
            description="Define os impostos aplicáveis à operação"
            unlocked={hasItems}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="inv-regime">{t('tax.regime')}</label>
                <select id="inv-regime" value={formTaxRegime}
                  onChange={e => { setFormTaxRegime(e.target.value); setTaxResult(null); }}>
                  <option value="lucro_presumido">{t('tax.regimeLLP')}</option>
                  <option value="lucro_real">{t('tax.regimeLR')}</option>
                  <option value="simples_nacional">{t('tax.regimeSN')}</option>
                  <option value="mei">{t('tax.regimeMEI')}</option>
                </select>
              </div>
              <div className="field" style={{ flex: '0 0 130px' }}>
                <label htmlFor="inv-dest">{t('tax.destState')}</label>
                <input id="inv-dest" value={formDestState} maxLength={2}
                  onChange={e => { setFormDestState(e.target.value.toUpperCase()); setTaxResult(null); }}
                  placeholder="SP" />
              </div>
            </div>
          </SectionCard>

          {/* Step 5 — Revisão */}
          <SectionCard step={5} title={t('tax.breakdown')}
            description="Calcule os impostos e revise o total antes de salvar"
            unlocked={hasFiscal}>
            <>
              <div className="field">
                <label htmlFor="inv-notes">{t('o.notes')}</label>
                <textarea id="inv-notes" value={formNotes}
                  onChange={e => setFormNotes(e.target.value)} rows={2} />
              </div>

              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: taxResult ? 10 : 0 }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t('tax.breakdown')}</span>
                  <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                    disabled={calcTaxLoad} onClick={handleCalculateTaxes}>
                    {calcTaxLoad ? t('tax.calculating') : `⊕ ${t('tax.calculate')}`}
                  </button>
                </div>

                {calcTaxError && (
                  <p style={{ color: 'var(--danger)', fontSize: 12, margin: '6px 0 0' }}>{calcTaxError}</p>
                )}

                {taxResult && (
                  <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 10, marginTop: 6, fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: 4 }}>
                      <span>{t('tax.icms')} {PCT(taxResult.applied_rates.icms)} <em style={{ fontSize: 11 }}>({t('tax.embedded')})</em></span>
                      <span>{BRL.format(taxResult.totals.icms_total)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: 4 }}>
                      <span>{t('tax.pis')} {PCT(taxResult.applied_rates.pis)} <em style={{ fontSize: 11 }}>({t('tax.embedded')})</em></span>
                      <span>{BRL.format(taxResult.totals.pis_total)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: 10 }}>
                      <span>{t('tax.cofins')} {PCT(taxResult.applied_rates.cofins)} <em style={{ fontSize: 11 }}>({t('tax.embedded')})</em></span>
                      <span>{BRL.format(taxResult.totals.cofins_total)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)', paddingTop: 6, marginBottom: 8 }}>
                      <span>Carga tributária total embutida</span>
                      <span>{BRL.format(taxResult.totals.embedded_tax_total)}</span>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: taxResult ? '1px solid var(--border)' : 'none', paddingTop: taxResult ? 8 : 0 }}>
                  <span>{taxResult ? t('tax.grandTotal') : t('inv.total')}</span>
                  <span data-testid="inv-total-value" style={{ color: 'var(--primary)' }}>
                    {BRL.format(taxResult ? taxResult.totals.grand_total : subtotalCalc)}
                  </span>
                </div>
              </div>
            </>
          </SectionCard>
        </div>

        {/* Sticky summary sidebar */}
        <aside className="inv-new-sidebar">
          <div className="card inv-summary">
            <div className="inv-summary__header">
              <h3>Resumo</h3>
            </div>
            <div className="inv-summary__body">
              <div className="inv-summary__row">
                <span>Cliente</span>
                <span>
                  {selectedClient
                    ? (selectedClient.company_name ?? selectedClient.full_name ?? '—')
                    : <em style={{ color: 'var(--muted)', fontStyle: 'normal' }}>não selecionado</em>}
                </span>
              </div>
              <div className="inv-summary__row">
                <span>Itens</span>
                <span>{formItems.filter(i => i.name).length}</span>
              </div>
              <div className="inv-summary__row">
                <span>Subtotal</span>
                <span>{BRL.format(subtotalCalc)}</span>
              </div>
              {taxResult && (
                <>
                  <div className="inv-summary__row inv-summary__row--muted">
                    <span>ICMS</span>
                    <span>{BRL.format(taxResult.totals.icms_total)}</span>
                  </div>
                  <div className="inv-summary__row inv-summary__row--muted">
                    <span>PIS + COFINS</span>
                    <span>{BRL.format(taxResult.totals.pis_total + taxResult.totals.cofins_total)}</span>
                  </div>
                </>
              )}
            </div>
            <div className="inv-summary__total">
              <span>{taxResult ? t('tax.grandTotal') : t('inv.total')}</span>
              <strong>
                {BRL.format(taxResult ? taxResult.totals.grand_total : subtotalCalc)}
              </strong>
            </div>
            <div className="inv-summary__actions">
              <button type="submit" className="btn btn-primary"
                disabled={saving || !hasClient || !hasItems}>
                {saving ? t('c.saving') : t('inv.create')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/invoices')}>
                {t('c.cancel')}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </form>
  );
}
