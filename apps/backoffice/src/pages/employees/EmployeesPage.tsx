import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { Drawer }    from '../../ds/components/Drawer';
import { DataTable, type Column } from '../../ds/components/DataTable';
import { Badge }     from '../../ds/components/Badge';

interface Employee {
  id: string; name: string; cpf: string; email: string | null; phone: string | null;
  role_title: string | null; regime: 'clt' | 'pro_labore'; base_salary: string;
  cost_center_id: string | null; hire_date: string; termination_date: string | null; is_active: boolean;
}

interface CostCenter { id: string; code: string; name: string; }

const EMPTY_FORM = {
  name: '', cpf: '', email: '', phone: '', role_title: '', regime: 'clt' as 'clt' | 'pro_labore',
  base_salary: '', cost_center_id: '', hire_date: '',
};

function formatCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatBRL(value: string | number): string {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function EmployeesPage() {
  const { t }  = useI18n();
  const modal  = useModal();

  const [items,       setItems]       = useState<Employee[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Employee | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams(search ? { search } : {});
      const resp = await api.get<{ data: Employee[] }>(`/v1/employees?${params}`);
      setItems(resp.data);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [search]);
  useEffect(() => {
    api.get<CostCenter[]>('/v1/cost-centers/active')
      .then(d => setCostCenters(Array.isArray(d) ? d : []))
      .catch(() => setCostCenters([]));
  }, []);

  function costCenterName(id: string | null): string {
    if (!id) return '—';
    return costCenters.find(c => c.id === id)?.name ?? '—';
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(emp: Employee) {
    setEditing(emp);
    setForm({
      name: emp.name, cpf: formatCpf(emp.cpf), email: emp.email ?? '', phone: emp.phone ?? '',
      role_title: emp.role_title ?? '', regime: emp.regime, base_salary: emp.base_salary,
      cost_center_id: emp.cost_center_id ?? '', hire_date: emp.hire_date,
    });
    setFormError('');
    setDrawerOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const payload = {
        name: form.name, cpf: form.cpf.replace(/\D/g, ''), email: form.email || undefined, phone: form.phone || undefined,
        role_title: form.role_title || undefined, regime: form.regime, base_salary: Number(form.base_salary),
        cost_center_id: form.cost_center_id || undefined, hire_date: form.hire_date,
      };
      if (editing) await api.patch(`/v1/employees/${editing.id}`, payload);
      else         await api.post('/v1/employees', payload);
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('emp.errSave'));
    } finally { setSaving(false); }
  }

  async function handleDeactivate(emp: Employee) {
    const ok = await modal.confirm({ title: t('emp.deactivate'), message: t('emp.deactivateMsg'), confirmLabel: t('c.del'), danger: true });
    if (!ok) return;
    try { await api.delete(`/v1/employees/${emp.id}`); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  const columns: Column<Employee>[] = [
    { key: 'name', header: t('emp.name'), render: e => (
      <div>
        <div style={{ fontWeight: 500 }}>{e.name}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatCpf(e.cpf)}</div>
      </div>
    ) },
    { key: 'role_title', header: t('emp.roleTitle'), render: e => e.role_title || '—' },
    { key: 'regime', header: t('emp.regime'), render: e => (
      <Badge variant={e.regime === 'clt' ? 'product' : 'service'}>{e.regime === 'clt' ? t('emp.regimeClt') : t('emp.regimeProLabore')}</Badge>
    ) },
    { key: 'base_salary', header: t('emp.baseSalary'), align: 'right', render: e => formatBRL(e.base_salary) },
    { key: 'cost_center', header: t('emp.costCenter'), render: e => costCenterName(e.cost_center_id) },
    { key: 'status', header: t('c.status'), render: e => (
      <Badge variant={e.is_active ? 'active' : 'inactive'}>{e.is_active ? t('c.active') : t('c.disabled')}</Badge>
    ) },
    { key: 'actions', header: '', align: 'right', render: e => (
      <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(e)}>{t('c.edit')}</button>
        {e.is_active && (
          <button className="btn btn-danger btn-sm" onClick={() => handleDeactivate(e)}>{t('c.del')}</button>
        )}
      </div>
    ) },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>{t('emp.title')}</h1>
        <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
          + {t('emp.new')}
        </button>
      </div>
      <p className="text-muted" style={{ marginTop: -8, marginBottom: 16 }}>{t('emp.pageHint')}</p>

      <div style={{ marginBottom: 16 }}>
        <input
          placeholder={t('emp.searchPH')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
      </div>

      <div className="card">
        <DataTable
          columns={columns}
          rows={items}
          loading={loading}
          emptyState={<div className="empty-state">{t('emp.empty')}</div>}
        />
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? t('emp.edit') : t('emp.new')}
      >
        <form onSubmit={handleSave} style={{ display: 'contents' }}>
          <Drawer.Body>
            {formError && <div className="alert alert-error">{formError}</div>}

            <div className="field">
              <label>{t('emp.name')} *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>

            <div className="field-row">
              <div className="field">
                <label>{t('emp.cpf')} *</label>
                <input value={form.cpf} onChange={e => setForm(f => ({ ...f, cpf: e.target.value }))}
                  maxLength={14} placeholder="000.000.000-00" required />
              </div>
              <div className="field">
                <label>{t('emp.roleTitle')}</label>
                <input value={form.role_title} onChange={e => setForm(f => ({ ...f, role_title: e.target.value }))} />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>{t('emp.email')}</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="field">
                <label>{t('emp.phone')}</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>{t('emp.regime')} *</label>
                <select value={form.regime} onChange={e => setForm(f => ({ ...f, regime: e.target.value as 'clt' | 'pro_labore' }))}>
                  <option value="clt">{t('emp.regimeClt')}</option>
                  <option value="pro_labore">{t('emp.regimeProLabore')}</option>
                </select>
              </div>
              <div className="field">
                <label>{t('emp.baseSalary')} *</label>
                <input type="number" min={0} step="0.01" value={form.base_salary}
                  onChange={e => setForm(f => ({ ...f, base_salary: e.target.value }))} required />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>{t('emp.costCenter')}</label>
                <select value={form.cost_center_id} onChange={e => setForm(f => ({ ...f, cost_center_id: e.target.value }))}>
                  <option value="">—</option>
                  {costCenters.map(cc => <option key={cc.id} value={cc.id}>{cc.code} — {cc.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>{t('emp.hireDate')} *</label>
                <input type="date" value={form.hire_date} onChange={e => setForm(f => ({ ...f, hire_date: e.target.value }))} required />
              </div>
            </div>

            {form.regime === 'pro_labore' && (
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>{t('emp.proLaboreHint')}</p>
            )}
          </Drawer.Body>

          <Drawer.Footer>
            <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
              {t('c.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
              {saving ? t('c.saving') : editing ? t('emp.save') : t('emp.create')}
            </button>
          </Drawer.Footer>
        </form>
      </Drawer>
    </div>
  );
}
