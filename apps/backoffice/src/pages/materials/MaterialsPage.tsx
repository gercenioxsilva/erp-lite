import { useEffect, useState, useRef, FormEvent } from 'react';
import * as XLSX from 'xlsx';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { Can }      from '../../rbac';
import { ProductPicker, type ProductPickerOption } from '../../ds/components/ProductPicker';

interface KitComp {
  _key:         string;
  component_id: string;
  quantity:     string;
}

function newKitComp(): KitComp {
  return { _key: Math.random().toString(36).slice(2), component_id: '', quantity: '1' };
}

interface Material {
  id:               string;
  sku:              string;
  name:             string;
  description:      string | null;
  notes:            string | null;
  type:             string;
  category:         string | null;
  brand:            string | null;
  unit:             string;
  sale_price:       number;
  cost_price:       number;
  ncm_code:         string | null;
  weight_kg:        number | null;
  length_cm:        number | null;
  width_cm:         number | null;
  height_cm:        number | null;
  is_active:        boolean;
  tracks_inventory: boolean;
}

// Mercado Livre (regra 42) — conexão OAuth por empresa, vínculo material↔anúncio.
interface MlConnection { id: string; company_id: string; status: string; nickname: string | null; }
interface MlLink {
  id: string; connection_id: string; ml_item_id: string | null; ml_variation_id: string | null;
  status: string; sync_price: boolean; sync_stock: boolean;
}

interface MaterialImage {
  id:         string;
  material_id: string;
  image_data: string;   // base64 data URI
  filename:   string | null;
  position:   number;
  is_cover:   boolean;
  alt:        string | null;
  created_at: string;
}

interface ListResp { data: Material[]; total: number; page: number; per_page: number; }

interface PriceHistoryEntry {
  id: string;
  sale_price_before: string | null; sale_price_after: string | null;
  cost_price_before: string | null; cost_price_after: string | null;
  source: 'manual_edit' | 'bulk_import';
  created_at: string;
}

const EMPTY_FORM = {
  sku: '', name: '', description: '', notes: '', type: 'product', category: '',
  brand: '', unit: 'UN', sale_price: '', cost_price: '', ncm_code: '',
  weight_kg: '', length_cm: '', width_cm: '', height_cm: '', tracks_inventory: true,
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// ── Import helpers ─────────────────────────────────────────────────────────────

interface ImportRow {
  sku: string; nome: string; tipo?: string; unidade?: string;
  preco_venda?: string; preco_custo?: string; ncm?: string;
  categoria?: string; marca?: string; peso_kg?: string;
  controla_estoque?: string; descricao?: string; observacoes?: string;
  [key: string]: unknown;
}

interface ImportRowChange { sale_price?: { from: number; to: number }; cost_price?: { from: number; to: number }; }
interface ImportRowResult {
  row: number; sku: string | null;
  action: 'created' | 'updated' | 'unchanged' | 'skipped' | 'error';
  changes?: ImportRowChange;
}
interface ImportResult {
  imported: number; created: number; updated: number; unchanged: number; skipped: number;
  errors: { row: number; message: string }[];
  rows: ImportRowResult[];
}

type ImportPhase = 'idle' | 'analyzing' | 'preview' | 'importing' | 'done';

const XLSX_COLS = ['sku','nome','tipo','unidade','preco_venda','preco_custo',
                   'ncm','categoria','marca','peso_kg','controla_estoque','descricao','observacoes'] as const;

const IMPORT_LAYOUT = [
  { col: 'sku',              req: true,  ex: 'PROD-001' },
  { col: 'nome',             req: true,  ex: 'Parafuso M6' },
  { col: 'tipo',             req: false, ex: 'product / service / raw_material / asset' },
  { col: 'unidade',          req: false, ex: 'UN / KG / L / M / PC' },
  { col: 'preco_venda',      req: false, ex: '29.90' },
  { col: 'preco_custo',      req: false, ex: '15.00' },
  { col: 'ncm',              req: false, ex: '7318.15.00' },
  { col: 'categoria',        req: false, ex: 'Fixadores' },
  { col: 'marca',            req: false, ex: 'Fischer' },
  { col: 'peso_kg',          req: false, ex: '0.050' },
  { col: 'controla_estoque', req: false, ex: 'SIM / NAO' },
  { col: 'descricao',        req: false, ex: 'Parafuso sextavado galvanizado M6x20' },
  { col: 'observacoes',      req: false, ex: 'Uso interno — só aplicável a partir do lote 220' },
];

function downloadTemplate() {
  const header = XLSX_COLS as unknown as string[];
  const ex1: ImportRow = {
    sku: 'PROD-001', nome: 'Parafuso M6', tipo: 'product', unidade: 'UN',
    preco_venda: '29.90', preco_custo: '15.00', ncm: '7318.15.00',
    categoria: 'Fixadores', marca: 'Fischer', peso_kg: '0.050',
    controla_estoque: 'SIM', descricao: 'Parafuso sextavado galvanizado M6x20',
    observacoes: '',
  };
  const ex2: ImportRow = {
    sku: 'SRV-001', nome: 'Consultoria técnica', tipo: 'service', unidade: 'HR',
    preco_venda: '150.00', preco_custo: '', ncm: '',
    categoria: 'Serviços', marca: '', peso_kg: '',
    controla_estoque: 'NAO', descricao: 'Hora de consultoria especializada',
    observacoes: 'Cobrar deslocamento à parte',
  };
  const ws = XLSX.utils.aoa_to_sheet([header, header.map(h => ex1[h] ?? ''), header.map(h => ex2[h] ?? '')]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Materiais');
  XLSX.writeFile(wb, 'modelo_importacao_materiais.xlsx');
}

// ── Component ──────────────────────────────────────────────────────────────────

export function MaterialsPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();
  const [items,      setItems]      = useState<Material[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [typeF,      setTypeF]      = useState('');
  const [catF,       setCatF]       = useState('');
  const [activeF,    setActiveF]    = useState('');
  const [loading,    setLoading]    = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Material | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  // Kit state
  const [kitComponents, setKitComponents] = useState<KitComp[]>([]);
  const [pickList,      setPickList]      = useState<(ProductPickerOption & { sale_price: number })[]>([]);

  // Image state
  const [images,          setImages]          = useState<MaterialImage[]>([]);
  const [imagesLoading,   setImagesLoading]   = useState(false);
  const [imageUploading,  setImageUploading]  = useState(false);
  const [imageError,      setImageError]      = useState('');
  const imgFileRef = useRef<HTMLInputElement>(null);

  // Histórico de preço (somente leitura)
  const [priceHistory,        setPriceHistory]        = useState<PriceHistoryEntry[]>([]);
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);

  // Mercado Livre (regra 42) — módulo opcional, conexão é por empresa/CNPJ.
  const [mlEnabled,     setMlEnabled]     = useState(false);
  const [mlConnections, setMlConnections] = useState<MlConnection[]>([]);
  const [mlLinks,       setMlLinks]       = useState<MlLink[]>([]);
  const [mlLoading,     setMlLoading]     = useState(false);
  const [mlError,       setMlError]       = useState('');
  const [mlSavingLink,  setMlSavingLink]  = useState(false);
  const [mlNewConnectionId, setMlNewConnectionId] = useState('');
  const [mlNewItemId,       setMlNewItemId]       = useState('');

  // Import state
  const [importOpen,      setImportOpen]      = useState(false);
  const [importPhase,     setImportPhase]     = useState<ImportPhase>('idle');
  const [importRows,      setImportRows]      = useState<ImportRow[]>([]);
  const [importPreview,   setImportPreview]   = useState<ImportResult | null>(null);
  const [importResult,    setImportResult]    = useState<ImportResult | null>(null);
  const [importError,     setImportError]     = useState('');
  // Opt-in — desmarcado por padrão: sem marcar, SKU já cadastrado continua
  // sendo ignorado, exatamente como antes.
  const [updateExisting,  setUpdateExisting]  = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const perPage = 20;

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tenant_id: tenantId, page: String(page), per_page: String(perPage),
        ...(search  ? { search }          : {}),
        ...(typeF   ? { type: typeF }     : {}),
        ...(catF    ? { category: catF }  : {}),
        ...(activeF ? { active: activeF } : {}),
      });
      const resp = await api.get<ListResp>(`/v1/materials?${params}`);
      setItems(resp.data);
      setTotal(resp.total);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [tenantId, page, search, typeF, catF, activeF]);

  // Lista de peças disponíveis para compor kits (exclui kits, evita aninhamento).
  async function loadPickList() {
    if (!tenantId) return;
    try {
      const resp = await api.get<ListResp>(`/v1/materials?tenant_id=${tenantId}&per_page=500&active=true`);
      setPickList(
        (resp.data ?? [])
          .filter(m => m.type !== 'kit')
          .map(m => ({ id: m.id, sku: m.sku, name: m.name, description: m.description, sale_price: Number(m.sale_price ?? 0) })),
      );
    } catch { setPickList([]); }
  }

  // Preço sugerido = soma (preço da peça × qtd).
  const kitSuggestedPrice = kitComponents.reduce((sum, c) => {
    const part = pickList.find(p => p.id === c.component_id);
    return sum + (part ? part.sale_price * (Number(c.quantity) || 0) : 0);
  }, 0);

  async function loadImages(materialId: string) {
    setImagesLoading(true);
    setImageError('');
    try {
      const rows = await api.get<MaterialImage[]>(`/v1/materials/${materialId}/images`);
      setImages(rows);
    } catch { setImages([]); }
    finally  { setImagesLoading(false); }
  }

  async function loadPriceHistory(materialId: string) {
    setPriceHistoryLoading(true);
    try {
      const resp = await api.get<{ data: PriceHistoryEntry[] }>(`/v1/materials/${materialId}/price-history?per_page=20`);
      setPriceHistory(resp.data);
    } catch { setPriceHistory([]); }
    finally { setPriceHistoryLoading(false); }
  }

  // Mercado Livre — carregado uma vez (módulo + conexões existem no nível do
  // tenant, não por material). Se o módulo não estiver habilitado ou não
  // houver nenhuma conexão, a seção fica escondida (progressive disclosure).
  async function loadMlSetup() {
    try {
      const mods = await api.get<{ enabled: string[] }>('/v1/tenant/modules');
      const enabled = mods.enabled.includes('mercadolivre');
      setMlEnabled(enabled);
      if (!enabled) return;
      const conns = await api.get<{ data: MlConnection[] }>('/v1/integrations/mercadolivre/connections');
      setMlConnections(conns.data.filter(c => c.status === 'connected'));
    } catch { /* silent — seção de ML só não aparece */ }
  }
  useEffect(() => { void loadMlSetup(); }, []);

  async function loadMlLinks(materialId: string) {
    setMlLoading(true); setMlError('');
    try {
      const resp = await api.get<{ data: MlLink[] }>(`/v1/materials/${materialId}/marketplace-links`);
      setMlLinks(resp.data);
    } catch { setMlLinks([]); }
    finally { setMlLoading(false); }
  }

  async function handleAddMlLink() {
    if (!editing || !mlNewConnectionId) return;
    setMlSavingLink(true); setMlError('');
    try {
      await api.post(`/v1/materials/${editing.id}/marketplace-links`, {
        connection_id: mlNewConnectionId, ml_item_id: mlNewItemId || undefined,
      });
      setMlNewConnectionId(''); setMlNewItemId('');
      await loadMlLinks(editing.id);
    } catch (err: unknown) {
      setMlError(err instanceof Error ? err.message : t('ml.errSave'));
    } finally { setMlSavingLink(false); }
  }

  async function handleRemoveMlLink(linkId: string) {
    if (!editing) return;
    try {
      await api.delete(`/v1/materials/${editing.id}/marketplace-links/${linkId}`);
      await loadMlLinks(editing.id);
    } catch (err: unknown) {
      setMlError(err instanceof Error ? err.message : t('ml.errSave'));
    }
  }

  async function handleSyncMlLink(linkId: string) {
    if (!editing) return;
    try {
      await api.post(`/v1/materials/${editing.id}/marketplace-links/${linkId}/sync`, {});
      await loadMlLinks(editing.id);
    } catch (err: unknown) {
      setMlError(err instanceof Error ? err.message : t('ml.errSave'));
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setImages([]);
    setImageError('');
    setKitComponents([]);
    setMlLinks([]); setMlError('');
    setPriceHistory([]);
    void loadPickList();
    setDrawerOpen(true);
  }

  async function loadKitComponents(kitId: string) {
    try {
      const resp = await api.get<{ data: { component_id: string; quantity: string }[] }>(
        `/v1/materials/${kitId}/components`,
      );
      setKitComponents(
        (resp.data ?? []).map(c => ({
          _key: Math.random().toString(36).slice(2),
          component_id: c.component_id,
          quantity: String(c.quantity ?? '1'),
        })),
      );
    } catch { setKitComponents([]); }
  }

  function openEdit(m: Material) {
    setEditing(m);
    void loadImages(m.id);
    void loadPickList();
    void loadMlLinks(m.id);
    void loadPriceHistory(m.id);
    setMlError(''); setMlNewConnectionId(''); setMlNewItemId('');
    if (m.type === 'kit') void loadKitComponents(m.id);
    else setKitComponents([]);
    setForm({
      sku:             m.sku,
      name:            m.name,
      description:     m.description  ?? '',   // ← bug fix: preenche descrição existente
      notes:           m.notes        ?? '',
      type:            m.type,
      category:        m.category     ?? '',
      brand:           m.brand        ?? '',   // ← bug fix: preenche marca existente
      unit:            m.unit         ?? 'UN',
      sale_price:      String(m.sale_price ?? ''),
      cost_price:      String(m.cost_price ?? ''),
      ncm_code:        m.ncm_code     ?? '',   // ← bug fix: preenche NCM existente
      weight_kg:       m.weight_kg != null ? String(m.weight_kg) : '',
      length_cm:       m.length_cm != null ? String(m.length_cm) : '',
      width_cm:        m.width_cm  != null ? String(m.width_cm)  : '',
      height_cm:       m.height_cm != null ? String(m.height_cm) : '',
      tracks_inventory: m.tracks_inventory,
    });
    setFormError('');
    setDrawerOpen(true);
  }

  function setF(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const val = e.target.type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : e.target.value;
      setForm(f => ({ ...f, [field]: val }));
    };
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        ...form, tenant_id: tenantId,
        sale_price: form.sale_price ? Number(form.sale_price) : undefined,
        cost_price: form.cost_price ? Number(form.cost_price) : undefined,
        weight_kg:  form.weight_kg  ? Number(form.weight_kg)  : undefined,
        length_cm:  form.length_cm  ? Number(form.length_cm)  : undefined,
        width_cm:   form.width_cm   ? Number(form.width_cm)   : undefined,
        height_cm:  form.height_cm  ? Number(form.height_cm)  : undefined,
        ...(form.type === 'kit'
          ? { components: kitComponents
              .filter(c => c.component_id)
              .map(c => ({ component_id: c.component_id, quantity: Number(c.quantity) || 1 })) }
          : {}),
      };
      if (editing) await api.patch(`/v1/materials/${editing.id}`, payload);
      else         await api.post('/v1/materials', payload);
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    } finally { setSaving(false); }
  }

  async function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!editing) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setImageError('');

    const MAX_FILE_BYTES = 500 * 1024;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setImageError(t('mi.imgTypeErr'));
      if (imgFileRef.current) imgFileRef.current.value = '';
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setImageError(t('mi.imgSizeErr'));
      if (imgFileRef.current) imgFileRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUri = ev.target?.result as string;
      setImageUploading(true);
      try {
        await api.post(`/v1/materials/${editing.id}/images`, {
          tenant_id:  tenantId,
          image_data: dataUri,
          filename:   file.name,
        });
        void loadImages(editing.id);
      } catch (err: unknown) {
        setImageError(err instanceof Error ? err.message : t('mi.imgUploadErr'));
      } finally {
        setImageUploading(false);
        if (imgFileRef.current) imgFileRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleSetCover(imageId: string) {
    if (!editing) return;
    setImageError('');
    try {
      await api.patch(`/v1/materials/${editing.id}/images/${imageId}`, { is_cover: true });
      void loadImages(editing.id);
    } catch (err: unknown) {
      setImageError(err instanceof Error ? err.message : t('mi.imgUploadErr'));
    }
  }

  async function handleDeleteImage(imageId: string) {
    if (!editing) return;
    const ok = await modal.confirm({ title: t('mi.imgDelTitle'), message: t('mi.imgDelMsg'), confirmLabel: t('c.del'), danger: true });
    if (!ok) return;
    setImageError('');
    try {
      await api.delete(`/v1/materials/${editing.id}/images/${imageId}`);
      void loadImages(editing.id);
    } catch (err: unknown) {
      setImageError(err instanceof Error ? err.message : t('mi.imgUploadErr'));
    }
  }

  async function handleDelete(id: string) {
    const ok = await modal.confirm({ title: t('m.deact'), message: t('m.deactMsg'), confirmLabel: 'Desativar', danger: true });
    if (!ok) return;
    try { await api.delete(`/v1/materials/${id}`); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  // ── Import handlers ──────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    try {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = new Uint8Array(ev.target!.result as ArrayBuffer);
          const wb   = XLSX.read(data, { type: 'array', cellDates: true });
          const ws   = wb.Sheets[wb.SheetNames[0]];
          const raw  = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
            defval: '', raw: false,
          });

          const valid = raw.filter(r => String(r['nome'] ?? '').trim() !== '');
          if (valid.length === 0) { setImportError(t('mi.importEmpty')); return; }

          setImportRows(valid as ImportRow[]);
          void analyzeImport(valid as ImportRow[]);
        } catch {
          setImportError(t('mi.importParseErr'));
        }
      };
      reader.readAsArrayBuffer(file);
    } catch {
      setImportError(t('mi.importParseErr'));
    }
  }

  // Roda a MESMA rota em dry_run=true — classifica cada linha (novo/atualização/
  // sem alteração/erro) sem escrever nada, pra mostrar o diff antes de confirmar.
  async function analyzeImport(rows: ImportRow[]) {
    if (!tenantId) return;
    setImportPhase('analyzing');
    try {
      const result = await api.post<ImportResult>('/v1/materials/import', {
        tenant_id: tenantId, materials: rows,
        update_existing: updateExisting, dry_run: true,
      });
      setImportPreview(result);
      setImportPhase('preview');
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : t('cl.errSave'));
      setImportPhase('idle');
    }
  }

  async function runImport() {
    if (!tenantId || importRows.length === 0) return;
    setImportPhase('importing');
    try {
      const result = await api.post<ImportResult>('/v1/materials/import', {
        tenant_id: tenantId, materials: importRows,
        update_existing: updateExisting, dry_run: false,
      });
      setImportResult(result);
      setImportPhase('done');
      void load();
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : t('cl.errSave'));
      setImportPhase('preview');
    }
  }

  function closeImport() {
    setImportOpen(false);
    setImportPhase('idle');
    setImportPreview(null);
    setImportRows([]);
    setImportResult(null);
    setImportError('');
    setUpdateExisting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const totalPages = Math.ceil(total / perPage);
  const typeLabel  = (type: string) => t(`m.type.${type}` as Parameters<typeof t>[0]) || type;
  const PREVIEW_MAX = 5;

  return (
    <div>
      <div className="page-header">
        <h1>{t('m.title')}</h1>
        <div className="flex-gap">
          <Can permission="materials:import">
            <button className="btn btn-secondary btn-cta" style={{ width: 'auto' }} onClick={() => setImportOpen(true)}>
              ↑ {t('mi.import')}
            </button>
          </Can>
          <Can permission="materials:create">
            <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
              + {t('m.new')}
            </button>
          </Can>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder={t('m.searchPH')}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ width: 240 }}
        />
        <select value={typeF} onChange={e => { setTypeF(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
          <option value="">{t('flt.allTypes')}</option>
          {(['product', 'service', 'raw_material', 'asset', 'kit'] as const).map(tp => (
            <option key={tp} value={tp}>{typeLabel(tp)}</option>
          ))}
        </select>
        <input
          placeholder={t('flt.category')}
          value={catF}
          onChange={e => { setCatF(e.target.value); setPage(1); }}
          style={{ width: 160 }}
        />
        <select value={activeF} onChange={e => { setActiveF(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
          <option value="">{t('flt.activeAll')}</option>
          <option value="true">{t('flt.activeOnly')}</option>
          <option value="false">{t('flt.inactiveOnly')}</option>
        </select>
        {(search || typeF || catF || activeF) && (
          <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
            onClick={() => { setSearch(''); setTypeF(''); setCatF(''); setActiveF(''); setPage(1); }}>
            {t('flt.clear')}
          </button>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            {t('m.empty')}{' '}
            <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('m.createFirst')}</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('m.sku')}</th>
                <th>{t('m.name')}</th>
                <th>{t('m.type')}</th>
                <th>{t('m.unit')}</th>
                <th className="text-right">{t('m.salePrice')}</th>
                <th>{t('c.status')}</th>
                <th>{t('m.stock')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(m => (
                <tr key={m.id}>
                  <td><code style={{ fontSize: 12 }}>{m.sku}</code></td>
                  <td>{m.name}</td>
                  <td><span className={`badge badge-${m.type}`}>{typeLabel(m.type)}</span></td>
                  <td>{m.unit}</td>
                  <td className="text-right">
                    {m.sale_price != null ? BRL.format(m.sale_price) : '—'}
                  </td>
                  <td>
                    <span className={`badge badge-${m.is_active ? 'active' : 'inactive'}`}>
                      {m.is_active ? t('c.active') : t('c.inactive')}
                    </span>
                  </td>
                  <td>
                    {m.tracks_inventory
                      ? <span className="badge badge-product" style={{ fontSize: 10 }}>{t('m.tracked')}</span>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td>
                    <div className="flex-gap">
                      <Can permission="materials:edit">
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(m)}>{t('c.edit')}</button>
                      </Can>
                      <Can permission="materials:delete">
                        <button className="btn btn-danger btn-sm"    onClick={() => handleDelete(m.id)}>{t('c.del')}</button>
                      </Can>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex-gap mt-16" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            {t('c.prev')}
          </button>
          <span className="text-muted" style={{ fontSize: 13 }}>
            {t('c.page')} {page} {t('c.of')} {totalPages}
          </span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            {t('c.next')}
          </button>
        </div>
      )}

      {/* ── Drawer ─────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{editing ? t('m.edit') : t('m.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSave} style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error">{formError}</div>}

                <div className="field-row">
                  <div className="field">
                    <label>{t('m.sku')} *</label>
                    <input value={form.sku} onChange={setF('sku')} required />
                  </div>
                  <div className="field">
                    <label>{t('m.unit')}</label>
                    <select value={form.unit} onChange={setF('unit')}>
                      {['UN','KG','L','M','M2','M3','CX','PC','HR','SV'].map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label>{t('m.name')} *</label>
                  <input value={form.name} onChange={setF('name')} required />
                </div>

                <div className="field">
                  <label>{t('m.desc')}</label>
                  <textarea value={form.description} onChange={setF('description')} />
                </div>

                <div className="field">
                  <label>{t('m.notes')}</label>
                  <textarea value={form.notes} onChange={setF('notes')} placeholder={t('m.notesPH')} />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>{t('m.type')}</label>
                    <select value={form.type} onChange={setF('type')}>
                      <option value="product">{t('m.type.product')}</option>
                      <option value="service">{t('m.type.service')}</option>
                      <option value="raw_material">{t('m.type.raw_material')}</option>
                      <option value="asset">{t('m.type.asset')}</option>
                      <option value="kit">{t('m.type.kit')}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>{t('m.cat')}</label>
                    <input value={form.category} onChange={setF('category')} />
                  </div>
                </div>

                {form.type === 'kit' && (
                  <div className="field" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--surface)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ margin: 0, fontWeight: 600 }}>{t('m.kit.components')}</label>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                        onClick={() => setKitComponents(prev => [...prev, newKitComp()])}>
                        + {t('m.kit.addPart')}
                      </button>
                    </div>

                    {kitComponents.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0' }}>{t('m.kit.empty')}</p>
                    ) : (
                      kitComponents.map((c, idx) => (
                        <div key={c._key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ flex: 1 }}>
                            <ProductPicker
                              options={pickList}
                              value={c.component_id}
                              onChange={cid => setKitComponents(prev => prev.map((x, i) => i === idx ? { ...x, component_id: cid } : x))}
                              placeholder={t('o.selectMat')}
                              emptyLabel={t('o.noMatch')}
                              ariaLabel={t('m.kit.part')}
                            />
                          </div>
                          <input type="number" min="0.001" step="0.001" value={c.quantity} style={{ width: 80, fontSize: 12 }}
                            aria-label={t('m.kit.qty')}
                            onChange={e => setKitComponents(prev => prev.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} />
                          <button type="button" aria-label={`${t('c.del')} ${idx + 1}`}
                            onClick={() => setKitComponents(prev => prev.filter((_, i) => i !== idx))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18, lineHeight: 1 }}>×</button>
                        </div>
                      ))
                    )}

                    {kitComponents.length > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 13 }}>
                        <span>{t('m.kit.suggested')}: <strong>{BRL.format(kitSuggestedPrice)}</strong></span>
                        <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                          onClick={() => setForm(f => ({ ...f, sale_price: kitSuggestedPrice.toFixed(2) }))}>
                          {t('m.kit.useSuggested')}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="field-row">
                  <div className="field">
                    <label>{t('m.salePrice')}</label>
                    <input type="number" step="0.01" min="0" value={form.sale_price} onChange={setF('sale_price')} />
                  </div>
                  <div className="field">
                    <label>{t('m.costPrice')}</label>
                    <input type="number" step="0.01" min="0" value={form.cost_price} onChange={setF('cost_price')} />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>{t('m.ncm')}</label>
                    <input value={form.ncm_code} onChange={setF('ncm_code')} placeholder="0000.00.00" />
                  </div>
                  <div className="field">
                    <label>{t('m.weight')}</label>
                    <input type="number" step="0.001" min="0" value={form.weight_kg} onChange={setF('weight_kg')} />
                  </div>
                </div>

                <div className="field">
                  <label>{t('m.dimensions')}</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="number" step="0.1" min="0" value={form.length_cm} onChange={setF('length_cm')}
                      placeholder={t('m.length')} aria-label={t('m.length')} />
                    <input type="number" step="0.1" min="0" value={form.width_cm} onChange={setF('width_cm')}
                      placeholder={t('m.width')} aria-label={t('m.width')} />
                    <input type="number" step="0.1" min="0" value={form.height_cm} onChange={setF('height_cm')}
                      placeholder={t('m.height')} aria-label={t('m.height')} />
                  </div>
                </div>

                <div className="field">
                  <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, display: 'flex', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={form.tracks_inventory as boolean}
                      onChange={setF('tracks_inventory')}
                    />
                    {t('m.trackStock')}
                  </label>
                </div>

                {/* ── Imagens do produto (somente no modo edição) ── */}
                {editing && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <label style={{ fontWeight: 600, margin: 0 }}>{t('mi.images')} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>({t('mi.imagesMax')})</span></label>
                      <input
                        ref={imgFileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        style={{ display: 'none' }}
                        onChange={handleImageFileChange}
                      />
                      {images.length < 5 && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ width: 'auto' }}
                          disabled={imageUploading}
                          onClick={() => imgFileRef.current?.click()}
                        >
                          {imageUploading ? t('mi.imgUploading') : `+ ${t('mi.imgAdd')}`}
                        </button>
                      )}
                    </div>

                    {imageError && (
                      <div role="alert" className="alert alert-error" style={{ marginBottom: 10, fontSize: 13 }}>
                        {imageError}
                      </div>
                    )}

                    {imagesLoading ? (
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('c.loading')}</div>
                    ) : images.length === 0 ? (
                      <div style={{
                        border: '2px dashed var(--border)', borderRadius: 8,
                        padding: '20px', textAlign: 'center',
                        color: 'var(--muted)', fontSize: 13,
                      }}>
                        {t('mi.imgEmpty')}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {images.map(img => (
                          <div key={img.id} style={{
                            position: 'relative', width: 100,
                            border: img.is_cover ? '2px solid var(--primary)' : '1px solid var(--border)',
                            borderRadius: 8, overflow: 'hidden',
                            background: 'var(--surface)',
                          }}>
                            <img
                              src={img.image_data}
                              alt={img.alt ?? img.filename ?? 'Imagem do produto'}
                              style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }}
                            />
                            {img.is_cover && (
                              <div style={{
                                position: 'absolute', top: 4, left: 4,
                                background: 'var(--primary)', color: '#fff',
                                fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4,
                              }}>
                                {t('mi.imgCover')}
                              </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 4px' }}>
                              {!img.is_cover && (
                                <button
                                  type="button"
                                  title={t('mi.imgSetCover')}
                                  className="btn btn-secondary btn-sm"
                                  style={{ fontSize: 10, padding: '2px 6px', width: 'auto' }}
                                  onClick={() => handleSetCover(img.id)}
                                >★</button>
                              )}
                              <button
                                type="button"
                                title={t('c.del')}
                                className="btn btn-danger btn-sm"
                                style={{ fontSize: 10, padding: '2px 6px', width: 'auto', marginLeft: 'auto' }}
                                onClick={() => handleDeleteImage(img.id)}
                              >✕</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                      {t('mi.imgHint')}
                    </div>
                  </div>
                )}

                {/* ── Histórico de Preços (somente leitura, só no modo edição) ── */}
                {editing && (
                  <div style={{ marginTop: 20 }}>
                    <label style={{ fontWeight: 600, display: 'block', marginBottom: 10 }}>{t('mi.priceHistory')}</label>
                    {priceHistoryLoading ? (
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('c.loading')}</div>
                    ) : priceHistory.length === 0 ? (
                      <div style={{
                        border: '2px dashed var(--border)', borderRadius: 8,
                        padding: '16px', textAlign: 'center',
                        color: 'var(--muted)', fontSize: 13,
                      }}>
                        {t('mi.priceHistoryEmpty')}
                      </div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: 'var(--surface)' }}>
                              <th style={{ padding: '5px 8px', textAlign: 'left', border: '1px solid var(--border)' }}>{t('mi.priceHistoryDate')}</th>
                              <th style={{ padding: '5px 8px', textAlign: 'left', border: '1px solid var(--border)' }}>{t('mi.priceHistorySale')}</th>
                              <th style={{ padding: '5px 8px', textAlign: 'left', border: '1px solid var(--border)' }}>{t('mi.priceHistoryCost')}</th>
                              <th style={{ padding: '5px 8px', textAlign: 'left', border: '1px solid var(--border)' }}>{t('mi.priceHistorySource')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {priceHistory.map(h => (
                              <tr key={h.id}>
                                <td style={{ padding: '5px 8px', border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                                  {new Date(h.created_at).toLocaleString('pt-BR')}
                                </td>
                                <td style={{ padding: '5px 8px', border: '1px solid var(--border)' }}>
                                  {h.sale_price_before != null && h.sale_price_after != null
                                    ? `${BRL.format(Number(h.sale_price_before))} → ${BRL.format(Number(h.sale_price_after))}`
                                    : '—'}
                                </td>
                                <td style={{ padding: '5px 8px', border: '1px solid var(--border)' }}>
                                  {h.cost_price_before != null && h.cost_price_after != null
                                    ? `${BRL.format(Number(h.cost_price_before))} → ${BRL.format(Number(h.cost_price_after))}`
                                    : '—'}
                                </td>
                                <td style={{ padding: '5px 8px', border: '1px solid var(--border)' }}>
                                  {h.source === 'bulk_import' ? t('mi.priceHistorySourceImport') : t('mi.priceHistorySourceManual')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Mercado Livre (regra 42, só no modo edição, módulo habilitado e com conta conectada) ── */}
                {editing && mlEnabled && mlConnections.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <label style={{ fontWeight: 600, display: 'block', marginBottom: 10 }}>{t('ml.title')}</label>

                    {mlError && <div role="alert" className="alert alert-error" style={{ marginBottom: 10, fontSize: 13 }}>{mlError}</div>}

                    {mlLoading ? (
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('c.loading')}</div>
                    ) : mlLinks.length === 0 ? (
                      <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>{t('ml.noLinks')}</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                        {mlLinks.map(link => {
                          const conn = mlConnections.find(c => c.id === link.connection_id);
                          return (
                            <div key={link.id} className="card" style={{ padding: 12, fontSize: 13 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <strong>{conn?.nickname || t('ml.store')}</strong>
                                  {link.ml_item_id && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>{link.ml_item_id}</span>}
                                  <span className={`badge ${link.status === 'active' ? 'badge-active' : 'badge-inactive'}`} style={{ marginLeft: 8 }}>
                                    {link.status}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                                    onClick={() => void handleSyncMlLink(link.id)}>{t('ml.sync')}</button>
                                  <button type="button" className="btn btn-danger btn-sm" style={{ width: 'auto' }}
                                    onClick={() => void handleRemoveMlLink(link.id)}>{t('c.del')}</button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="field-row">
                      <div className="field">
                        <label>{t('ml.store')}</label>
                        <select value={mlNewConnectionId} onChange={e => setMlNewConnectionId(e.target.value)}>
                          <option value="">{t('ml.selectStore')}</option>
                          {mlConnections.map(c => <option key={c.id} value={c.id}>{c.nickname || c.id}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label>{t('ml.itemId')}</label>
                        <input type="text" value={mlNewItemId} placeholder="MLB123456789"
                          onChange={e => setMlNewItemId(e.target.value)} />
                      </div>
                    </div>
                    <div>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                        disabled={!mlNewConnectionId || mlSavingLink}
                        onClick={() => void handleAddMlLink()}>
                        {mlSavingLink ? t('c.saving') : t('ml.addLink')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  {t('c.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : editing ? t('m.save') : t('m.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Import modal ────────────────────────────────────────────── */}
      {importOpen && (
        <div
          className="overlay"
          onClick={importPhase === 'importing' ? undefined : closeImport}
          style={{ alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'white', borderRadius: 12,
              width: 'min(680px, 95vw)', maxHeight: '90vh',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,.18)',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{t('mi.importTitle')}</h2>
              {importPhase !== 'importing' && (
                <button className="btn btn-secondary btn-sm" onClick={closeImport}>✕</button>
              )}
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
              {importError && (
                <div role="alert" className="alert alert-error" style={{ marginBottom: 14 }}>{importError}</div>
              )}

              {/* ── idle: layout reference + file picker ── */}
              {importPhase === 'idle' && (
                <>
                  <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 13 }}>{t('mi.importDesc')}</p>
                  <div style={{ marginBottom: 16 }}>
                    <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={downloadTemplate}>
                      ↓ {t('mi.importTemplate')}
                    </button>
                  </div>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 20 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface)' }}>
                        <th style={{ padding: '6px 10px', textAlign: 'left', border: '1px solid var(--border)' }}>{t('mi.importColHeader')}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center', border: '1px solid var(--border)', width: 60 }}>{t('mi.importColReq')}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'left', border: '1px solid var(--border)' }}>{t('mi.importColExample')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {IMPORT_LAYOUT.map(row => (
                        <tr key={row.col}>
                          <td style={{ padding: '5px 10px', border: '1px solid var(--border)', fontFamily: 'monospace' }}>{row.col}</td>
                          <td style={{ padding: '5px 10px', border: '1px solid var(--border)', textAlign: 'center', color: row.req ? 'var(--danger)' : 'var(--muted)' }}>
                            {row.req ? '●' : '○'}
                          </td>
                          <td style={{ padding: '5px 10px', border: '1px solid var(--border)', color: 'var(--muted)' }}>{row.ex}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="field" style={{ marginBottom: 14 }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontWeight: 400 }}>
                      <input
                        type="checkbox"
                        checked={updateExisting}
                        onChange={e => setUpdateExisting(e.target.checked)}
                        style={{ marginTop: 2 }}
                      />
                      <span>
                        {t('mi.importUpdateExisting')}
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 400, marginTop: 2 }}>
                          {t('mi.importUpdateExistingHint')}
                        </div>
                      </span>
                    </label>
                  </div>
                  <div className="field">
                    <label>{t('mi.importFile')}</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFileChange}
                    />
                  </div>
                </>
              )}

              {/* ── analyzing: dry-run classificando as linhas antes de mostrar o preview ── */}
              {importPhase === 'analyzing' && (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div className="spinner" style={{ marginBottom: 12 }}>{t('mi.importAnalyzing')}</div>
                </div>
              )}

              {/* ── preview: diff do que vai acontecer, antes de confirmar ── */}
              {importPhase === 'preview' && importPreview && (
                <>
                  {renderImportOutcome(importPreview, true)}
                </>
              )}

              {/* ── importing ── */}
              {importPhase === 'importing' && (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div className="spinner" style={{ marginBottom: 12 }}>{t('mi.importDoing')}</div>
                </div>
              )}

              {/* ── done ── */}
              {importPhase === 'done' && importResult && (
                <>
                  <p style={{ marginTop: 0, fontSize: 15, fontWeight: 600 }}>{t('mi.importDone')}</p>
                  {renderImportOutcome(importResult, false)}
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {importPhase === 'idle' && (
                <button className="btn btn-secondary" onClick={closeImport}>{t('c.cancel')}</button>
              )}
              {importPhase === 'preview' && (
                <>
                  <button className="btn btn-secondary" onClick={() => { setImportPhase('idle'); setImportRows([]); setImportPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                    {t('c.cancel')}
                  </button>
                  <button className="btn btn-primary" style={{ width: 'auto' }} onClick={runImport}>
                    {t('mi.importBtn')} {(importPreview?.created ?? 0) + (importPreview?.updated ?? 0)} {t('mi.importMaterials')}
                  </button>
                </>
              )}
              {importPhase === 'done' && (
                <button className="btn btn-primary" style={{ width: 'auto' }} onClick={closeImport}>
                  {t('mi.importClose')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Resumo de resultado (usado tanto no preview — "o que vai acontecer" — quanto
  // no "done" — "o que aconteceu"). `isPreview` só troca a moldura/tom do texto.
  function renderImportOutcome(result: ImportResult, isPreview: boolean) {
    const updatedRows = result.rows.filter(r => r.action === 'updated');
    const errorRows = [...result.errors];

    return (
      <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <span className="badge badge-active">✨ {result.created} {t('mi.importCreated')}</span>
          {result.updated > 0 && (
            <span className="badge" style={{ background: 'var(--primary)', color: '#fff' }}>
              🔄 {result.updated} {t('mi.importUpdated')}
            </span>
          )}
          {result.unchanged > 0 && (
            <span className="badge badge-inactive">⏭ {result.unchanged} {t('mi.importUnchanged')}</span>
          )}
          {result.skipped > 0 && (
            <span className="badge" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
              ⊘ {result.skipped} {t('mi.importSkipped')}
            </span>
          )}
        </div>

        {isPreview && result.updated > 0 && !updateExisting && (
          <div role="alert" className="alert alert-error" style={{ marginBottom: 14, fontSize: 12.5 }}>
            {t('mi.importUpdateHintOff')}
          </div>
        )}

        {updatedRows.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: 13 }}>{t('mi.importUpdatedDetail')}</strong>
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface)' }}>
                    <th style={{ padding: '5px 8px', textAlign: 'left', border: '1px solid var(--border)' }}>{t('mi.importErrRow')}</th>
                    <th style={{ padding: '5px 8px', textAlign: 'left', border: '1px solid var(--border)', fontFamily: 'monospace' }}>SKU</th>
                    <th style={{ padding: '5px 8px', textAlign: 'left', border: '1px solid var(--border)' }}>{t('mi.priceHistorySale')}</th>
                    <th style={{ padding: '5px 8px', textAlign: 'left', border: '1px solid var(--border)' }}>{t('mi.priceHistoryCost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {updatedRows.slice(0, PREVIEW_MAX).map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: '5px 8px', border: '1px solid var(--border)' }}>{r.row}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid var(--border)', fontFamily: 'monospace' }}>{r.sku}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid var(--border)' }}>
                        {r.changes?.sale_price
                          ? `${BRL.format(r.changes.sale_price.from)} → ${BRL.format(r.changes.sale_price.to)}`
                          : '—'}
                      </td>
                      <td style={{ padding: '5px 8px', border: '1px solid var(--border)' }}>
                        {r.changes?.cost_price
                          ? `${BRL.format(r.changes.cost_price.from)} → ${BRL.format(r.changes.cost_price.to)}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {updatedRows.length > PREVIEW_MAX && (
              <p style={{ color: 'var(--muted)', fontSize: 12, margin: '8px 0 0' }}>
                {t('mi.importMore')} {updatedRows.length - PREVIEW_MAX} {t('mi.importMoreRows')}
              </p>
            )}
          </div>
        )}

        {errorRows.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <strong style={{ fontSize: 13 }}>{t('mi.importErrors')}</strong>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 8 }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  <th style={{ padding: '4px 8px', border: '1px solid var(--border)', width: 60 }}>{t('mi.importErrRow')}</th>
                  <th style={{ padding: '4px 8px', border: '1px solid var(--border)', textAlign: 'left' }}>Descrição</th>
                </tr>
              </thead>
              <tbody>
                {errorRows.map((e, i) => (
                  <tr key={i}>
                    <td style={{ padding: '4px 8px', border: '1px solid var(--border)', textAlign: 'center' }}>{e.row}</td>
                    <td style={{ padding: '4px 8px', border: '1px solid var(--border)', color: 'var(--danger)' }}>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }
}
