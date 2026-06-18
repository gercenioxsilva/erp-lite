import { useEffect, useState, FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

interface Material {
  id:               string;
  sku:              string;
  name:             string;
  type:             string;
  category:         string;
  unit:             string;
  sale_price:       number;
  cost_price:       number;
  is_active:        boolean;
  tracks_inventory: boolean;
}

interface ListResp {
  data:  Material[];
  total: number;
  page:  number;
  per_page: number;
}

const EMPTY_FORM = {
  sku: '', name: '', description: '', type: 'product', category: '',
  brand: '', unit: 'UN', sale_price: '', cost_price: '', ncm_code: '',
  weight_kg: '', tracks_inventory: true,
};

export function MaterialsPage() {
  const { tenantId } = useAuth();
  const [items,   setItems]   = useState<Material[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Material | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  const perPage = 20;

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tenant_id: tenantId,
        page: String(page),
        per_page: String(perPage),
        ...(search ? { search } : {}),
      });
      const resp = await api.get<ListResp>(`/v1/materials?${params}`);
      setItems(resp.data);
      setTotal(resp.total);
    } catch {
      //
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [tenantId, page, search]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(m: Material) {
    setEditing(m);
    setForm({
      sku:  m.sku,  name: m.name, description: '', type: m.type,
      category: m.category ?? '', brand: '', unit: m.unit ?? 'UN',
      sale_price: String(m.sale_price ?? ''),
      cost_price: String(m.cost_price ?? ''),
      ncm_code: '', weight_kg: '',
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
        ...form,
        tenant_id:   tenantId,
        sale_price:  form.sale_price  ? Number(form.sale_price)  : undefined,
        cost_price:  form.cost_price  ? Number(form.cost_price)  : undefined,
        weight_kg:   form.weight_kg   ? Number(form.weight_kg)   : undefined,
      };
      if (editing) {
        await api.patch(`/v1/materials/${editing.id}`, payload);
      } else {
        await api.post('/v1/materials', payload);
      }
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Deactivate this material?')) return;
    try {
      await api.delete(`/v1/materials/${id}`);
      void load();
    } catch {
      //
    }
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="page-header">
        <h1>Materials</h1>
        <button className="btn btn-primary" style={{ width: 'auto' }} onClick={openCreate}>
          + New material
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          placeholder="Search by name or SKU…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ maxWidth: 320 }}
        />
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">No materials yet. <button className="btn btn-secondary btn-sm" onClick={openCreate}>Create one</button></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Type</th>
                <th>Unit</th>
                <th className="text-right">Sale price</th>
                <th>Status</th>
                <th>Stock</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(m => (
                <tr key={m.id}>
                  <td><code style={{ fontSize: 12 }}>{m.sku}</code></td>
                  <td>{m.name}</td>
                  <td><span className={`badge badge-${m.type}`}>{m.type}</span></td>
                  <td>{m.unit}</td>
                  <td className="text-right">
                    {m.sale_price != null
                      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(m.sale_price)
                      : '—'}
                  </td>
                  <td>
                    <span className={`badge badge-${m.is_active ? 'active' : 'inactive'}`}>
                      {m.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td>
                    {m.tracks_inventory
                      ? <span className="badge badge-product" style={{ fontSize: 10 }}>tracked</span>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td>
                    <div className="flex-gap">
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(m)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(m.id)}>Del</button>
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
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span className="text-muted" style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {/* ── Drawer ── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{editing ? 'Edit material' : 'New material'}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSave} style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error">{formError}</div>}

                <div className="field-row">
                  <div className="field">
                    <label>SKU *</label>
                    <input value={form.sku} onChange={setF('sku')} required />
                  </div>
                  <div className="field">
                    <label>Unit</label>
                    <select value={form.unit} onChange={setF('unit')}>
                      {['UN','KG','L','M','M2','M3','CX','PC','HR','SV'].map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label>Name *</label>
                  <input value={form.name} onChange={setF('name')} required />
                </div>

                <div className="field">
                  <label>Description</label>
                  <textarea value={form.description} onChange={setF('description')} />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>Type</label>
                    <select value={form.type} onChange={setF('type')}>
                      <option value="product">Product</option>
                      <option value="service">Service</option>
                      <option value="raw_material">Raw material</option>
                      <option value="asset">Asset</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Category</label>
                    <input value={form.category} onChange={setF('category')} />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>Sale price</label>
                    <input type="number" step="0.01" min="0" value={form.sale_price} onChange={setF('sale_price')} />
                  </div>
                  <div className="field">
                    <label>Cost price</label>
                    <input type="number" step="0.01" min="0" value={form.cost_price} onChange={setF('cost_price')} />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>NCM / HS Code</label>
                    <input value={form.ncm_code} onChange={setF('ncm_code')} placeholder="0000.00.00" />
                  </div>
                  <div className="field">
                    <label>Weight (kg)</label>
                    <input type="number" step="0.001" min="0" value={form.weight_kg} onChange={setF('weight_kg')} />
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
                    Track inventory for this material
                  </label>
                </div>
              </div>
              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>Cancel</button>
                <button type="submit"  className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create material'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
