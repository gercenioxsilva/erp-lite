import { useEffect, useState, FormEvent } from 'react';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';

interface Payable {
  id: string; description: string; supplier_name: string | null; category: string;
  document_number: string | null; amount: string; paid_amount: string;
  due_date: string; status: string; notes: string | null; created_at: string;
}

interface Payment {
  id: string; payment_date: string; amount: string;
  payment_method: string; reference: string | null; notes: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#d97706', partial: '#2563eb', paid: '#16a34a',
  overdue: '#dc2626', cancelled: '#6b7280',
};

const PAYMENT_METHODS = [
  { value: 'pix',           label: 'PIX' },
  { value: 'bank_transfer', label: 'Transferência Bancária' },
  { value: 'boleto',        label: 'Boleto' },
  { value: 'cash',          label: 'Dinheiro' },
  { value: 'credit_card',   label: 'Cartão de Crédito' },
  { value: 'debit_card',    label: 'Cartão de Débito' },
  { value: 'check',         label: 'Cheque' },
  { value: 'other',         label: 'Outro' },
];

const CATEGORIES = [
  { value: 'rent',      label: 'Aluguel' },
  { value: 'utilities', label: 'Utilidades (água, luz, tel)' },
  { value: 'payroll',   label: 'Folha de pagamento' },
  { value: 'supplies',  label: 'Suprimentos' },
  { value: 'services',  label: 'Serviços' },
  { value: 'taxes',     label: 'Impostos e taxas' },
  { value: 'other',     label: 'Outros' },
];

export function PayablesPage() {
  const { tenantId } = useAuth();
  const { t }        = useI18n();

  const [items, setItems]         = useState<Payable[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [statusFilter, setStatus] = useState('');
  const [catFilter, setCat]       = useState('');
  const [search, setSearch]       = useState('');
  const [loading, setLoading]     = useState(false);

  const [selected, setSelected]   = useState<(Payable & { payments: Payment[] }) | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm]             = useState({
    supplier_name: '', category: 'other', description: '', document_number: '', amount: '', due_date: '', notes: '',
  });
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');

  const [payForm, setPayForm]       = useState({ payment_date: '', amount: '', payment_method: 'pix', reference: '', notes: '' });
  const [payError, setPayError]     = useState('');
  const [payingSave, setPayingSave] = useState(false);

  const PER_PAGE = 20;

  useEffect(() => {
    if (!tenantId) return;
    loadItems();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, page, statusFilter, catFilter, search]);

  async function loadItems() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (statusFilter) qs.set('status', statusFilter);
      if (catFilter)    qs.set('category', catFilter);
      if (search)       qs.set('search', search);
      const data = await api.get<any>(`/v1/payables?${qs}`);
      setItems(data.data); setTotal(data.total);
    } finally { setLoading(false); }
  }

  async function openDetail(pay: Payable) {
    const full = await api.get<any>(`/v1/payables/${pay.id}`);
    setSelected(full); setDetailOpen(true); setPayError('');
    setPayForm({ payment_date: '', amount: '', payment_method: 'pix', reference: '', notes: '' });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault(); setFormError('');
    if (!form.description.trim()) { setFormError(t('pay.errDesc')); return; }
    if (!form.amount || Number(form.amount) <= 0) { setFormError(t('pay.errAmount')); return; }
    if (!form.due_date) { setFormError(t('pay.errDue')); return; }
    setSaving(true);
    try {
      await api.post('/v1/payables', {
        supplier_name:   form.supplier_name   || null,
        category:        form.category,
        description:     form.description,
        document_number: form.document_number || null,
        amount:          Number(form.amount),
        due_date:        form.due_date,
        notes:           form.notes || null,
      });
      setCreateOpen(false);
      setForm({ supplier_name: '', category: 'other', description: '', document_number: '', amount: '', due_date: '', notes: '' });
      loadItems();
    } catch (err: any) {
      setFormError(err.message || t('pay.errSave'));
    } finally { setSaving(false); }
  }

  async function handlePayment(e: FormEvent) {
    e.preventDefault(); setPayError('');
    if (!payForm.payment_date) { setPayError(t('pay.errPayDate')); return; }
    if (!payForm.amount || Number(payForm.amount) <= 0) { setPayError(t('pay.errPayAmt')); return; }
    setPayingSave(true);
    try {
      await api.post(`/v1/payables/${selected!.id}/payments`, {
        payment_date:   payForm.payment_date,
        amount:         Number(payForm.amount),
        payment_method: payForm.payment_method,
        reference:      payForm.reference || null,
        notes:          payForm.notes    || null,
      });
      const updated = await api.get<any>(`/v1/payables/${selected!.id}`);
      setSelected(updated);
      setPayForm({ payment_date: '', amount: '', payment_method: 'pix', reference: '', notes: '' });
      loadItems();
    } catch (err: any) {
      setPayError(err.message || t('pay.errSave'));
    } finally { setPayingSave(false); }
  }

  async function handleDeletePayment(paymentId: string) {
    if (!selected) return;
    try {
      await api.delete(`/v1/payables/${selected.id}/payments/${paymentId}`);
      const updated = await api.get<any>(`/v1/payables/${selected.id}`);
      setSelected(updated); loadItems();
    } catch (err: any) { setPayError(err.message || t('pay.errSave')); }
  }

  async function handleCancel(id: string) {
    try {
      await api.post(`/v1/payables/${id}/cancel`, {});
      setDetailOpen(false); loadItems();
    } catch (err: any) { setPayError(err.message || t('pay.errSave')); }
  }

  const pages   = Math.max(1, Math.ceil(total / PER_PAGE));
  const fmt     = (v: string) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
  const catLabel = (v: string) => CATEGORIES.find(c => c.value === v)?.label || v;

  return (
    <div>
      <div className="page-header">
        <h1>{t('pay.title')}</h1>
        <button className="btn btn-primary" onClick={() => {
          setCreateOpen(true); setFormError('');
          setForm({ supplier_name: '', category: 'other', description: '', document_number: '', amount: '', due_date: '', notes: '' });
        }}>{t('pay.new')}</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input className="search-input" placeholder={t('pay.searchPH')}
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select className="btn btn-secondary" value={statusFilter}
          onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t('pay.allStatuses')}</option>
          <option value="pending">{t('pay.status.pending')}</option>
          <option value="partial">{t('pay.status.partial')}</option>
          <option value="paid">{t('pay.status.paid')}</option>
          <option value="overdue">{t('pay.status.overdue')}</option>
          <option value="cancelled">{t('pay.status.cancelled')}</option>
        </select>
        <select className="btn btn-secondary" value={catFilter}
          onChange={e => { setCat(e.target.value); setPage(1); }}>
          <option value="">{t('pay.allCategories')}</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">{t('pay.empty')}</div>
        ) : (
          <table>
            <thead><tr>
              <th>{t('pay.supplier')}</th>
              <th>{t('pay.description')}</th>
              <th>{t('pay.category')}</th>
              <th>{t('pay.dueDate')}</th>
              <th style={{ textAlign: 'right' }}>{t('pay.amount')}</th>
              <th style={{ textAlign: 'right' }}>{t('pay.paid')}</th>
              <th>{t('pay.status')}</th>
              <th>{t('c.actions')}</th>
            </tr></thead>
            <tbody>
              {items.map(pay => (
                <tr key={pay.id}>
                  <td>{pay.supplier_name || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td>
                    <div>{pay.description}</div>
                    {pay.document_number && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Doc: {pay.document_number}</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>{catLabel(pay.category)}</td>
                  <td style={{ fontSize: 13 }}>{fmtDate(pay.due_date)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(pay.amount)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmt(pay.paid_amount)}</td>
                  <td>
                    <span className="badge" style={{ background: STATUS_COLORS[pay.status] + '22', color: STATUS_COLORS[pay.status], border: `1px solid ${STATUS_COLORS[pay.status]}44`, fontWeight: 600, fontSize: 11 }}>
                      {t(`pay.status.${pay.status}` as any)}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => openDetail(pay)}>
                      {t('pay.details')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}>{t('c.prev')}</button>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t('c.page')} {page} {t('c.of')} {pages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= pages}
            onClick={() => setPage(p => p + 1)}>{t('c.next')}</button>
        </div>
      )}

      {/* ── Drawer: Nova conta ── */}
      {createOpen && (
        <div className="overlay" onClick={() => setCreateOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{t('pay.new')}</h2>
              <button onClick={() => setCreateOpen(false)}>{t('c.close')}</button>
            </div>
            <form onSubmit={handleCreate} noValidate>
              <div className="drawer-body">
                {formError && <div role="alert" className="alert alert-error">{formError}</div>}
                <div className="field-row">
                  <div className="field">
                    <label>{t('pay.supplier')}</label>
                    <input type="text" value={form.supplier_name}
                      onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{t('pay.category')}</label>
                    <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                      {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label>{t('pay.description')} *</label>
                  <input type="text" value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required />
                </div>
                <div className="field">
                  <label>{t('pay.docNumber')}</label>
                  <input type="text" value={form.document_number}
                    onChange={e => setForm(f => ({ ...f, document_number: e.target.value }))}
                    placeholder={t('pay.docNumberPH')} />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>{t('pay.amount')} *</label>
                    <input type="number" min="0.01" step="0.01" value={form.amount}
                      onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
                  </div>
                  <div className="field">
                    <label>{t('pay.dueDate')} *</label>
                    <input type="date" value={form.due_date}
                      onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} required />
                  </div>
                </div>
                <div className="field">
                  <label>{t('pay.notes')}</label>
                  <input type="text" value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary"
                  onClick={() => setCreateOpen(false)}>{t('c.cancel')}</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? t('c.saving') : t('pay.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Drawer: Detalhes ── */}
      {detailOpen && selected && (
        <div className="overlay" onClick={() => setDetailOpen(false)}>
          <div className="drawer" style={{ width: 'min(560px, 96vw)' }} onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{selected.description}</h2>
              <button onClick={() => setDetailOpen(false)}>{t('c.close')}</button>
            </div>
            <div className="drawer-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ textAlign: 'center', padding: 12, background: 'var(--surface)', borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('pay.amount')}</div>
                  <div style={{ fontWeight: 700 }}>{fmt(selected.amount)}</div>
                </div>
                <div style={{ textAlign: 'center', padding: 12, background: 'var(--surface)', borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('pay.paid')}</div>
                  <div style={{ fontWeight: 700, color: '#16a34a' }}>{fmt(selected.paid_amount)}</div>
                </div>
                <div style={{ textAlign: 'center', padding: 12, background: 'var(--surface)', borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('pay.remaining')}</div>
                  <div style={{ fontWeight: 700, color: '#dc2626' }}>
                    {fmt(String(Math.max(0, Number(selected.amount) - Number(selected.paid_amount))))}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                {t('pay.dueDate')}: <strong>{fmtDate(selected.due_date)}</strong>
                &nbsp;·&nbsp; {t('pay.category')}: <strong>{catLabel(selected.category)}</strong>
                &nbsp;·&nbsp;
                <span style={{ color: STATUS_COLORS[selected.status], fontWeight: 600 }}>
                  {t(`pay.status.${selected.status}` as any)}
                </span>
              </div>

              {selected.payments.length > 0 && (
                <>
                  <h4 style={{ marginBottom: 8 }}>{t('pay.paymentsHistory')}</h4>
                  <table style={{ marginBottom: 16 }}>
                    <thead><tr>
                      <th>{t('pay.payDate')}</th>
                      <th style={{ textAlign: 'right' }}>{t('pay.amount')}</th>
                      <th>{t('pay.method')}</th>
                      <th></th>
                    </tr></thead>
                    <tbody>
                      {selected.payments.map(p => (
                        <tr key={p.id}>
                          <td style={{ fontSize: 12 }}>{fmtDate(p.payment_date)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(p.amount)}</td>
                          <td style={{ fontSize: 12 }}>{PAYMENT_METHODS.find(m => m.value === p.payment_method)?.label || p.payment_method}</td>
                          <td>
                            {selected.status !== 'cancelled' && (
                              <button className="btn btn-danger btn-sm"
                                onClick={() => handleDeletePayment(p.id)}>{t('pay.reverse')}</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {selected.status !== 'paid' && selected.status !== 'cancelled' && (
                <>
                  <h4 style={{ marginBottom: 8 }}>{t('pay.registerPayment')}</h4>
                  {payError && <div role="alert" className="alert alert-error">{payError}</div>}
                  <form onSubmit={handlePayment} noValidate>
                    <div className="field-row">
                      <div className="field">
                        <label>{t('pay.payDate')} *</label>
                        <input type="date" value={payForm.payment_date}
                          onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))} required />
                      </div>
                      <div className="field">
                        <label>{t('pay.amount')} *</label>
                        <input type="number" min="0.01" step="0.01" value={payForm.amount}
                          onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} required />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>{t('pay.method')}</label>
                        <select value={payForm.payment_method}
                          onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value }))}>
                          {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label>{t('pay.reference')}</label>
                        <input type="text" value={payForm.reference}
                          onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))}
                          placeholder={t('pay.referencePH')} />
                      </div>
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={payingSave} style={{ width: '100%' }}>
                      {payingSave ? t('c.saving') : t('pay.registerPayment')}
                    </button>
                  </form>
                </>
              )}

              {selected.status !== 'paid' && selected.status !== 'cancelled' && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <button className="btn btn-danger btn-sm" onClick={() => handleCancel(selected.id)}>
                    {t('pay.cancel')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
