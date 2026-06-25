import { useEffect, useState, FormEvent } from 'react';
import { api }     from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';

interface Receivable {
  id: string; description: string; amount: string; paid_amount: string;
  due_date: string; status: string; client_id: string | null; client_name: string | null;
  invoice_id: string | null; notes: string | null; created_at: string;
  boleto_id: string | null;
}

interface Payment {
  id: string; payment_date: string; amount: string;
  payment_method: string; reference: string | null; notes: string | null;
}

interface BoletoInfo {
  id: string;
  status: 'pending' | 'sent' | 'error' | 'expired' | 'paid';
  nosso_numero: string | null;
  brcode: string | null;
  boleto_url: string | null;
  issued_at: string | null;
  expires_at: string | null;
}

interface Client { id: string; company_name: string | null; full_name: string | null; }

const STATUS_COLORS: Record<string, string> = {
  pending: '#d97706', partial: '#2563eb', paid: '#16a34a',
  overdue: '#dc2626', cancelled: '#6b7280',
};

const BOLETO_STATUS_COLORS: Record<string, string> = {
  pending: '#d97706', sent: '#16a34a', error: '#dc2626',
  expired: '#6b7280', paid: '#16a34a',
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

export function ReceivablesPage() {
  const { tenantId } = useAuth();
  const { t }        = useI18n();

  const [items, setItems]         = useState<Receivable[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [statusFilter, setStatus] = useState('');
  const [search, setSearch]       = useState('');
  const [loading, setLoading]     = useState(false);

  // Detail drawer
  const [selected, setSelected]   = useState<(Receivable & { payments: Payment[] }) | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Create drawer
  const [createOpen, setCreateOpen] = useState(false);
  const [clients, setClients]       = useState<Client[]>([]);
  const [form, setForm]             = useState({ client_id: '', description: '', amount: '', due_date: '', notes: '' });
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');

  // Payment sub-form
  const [payForm, setPayForm]       = useState({ payment_date: '', amount: '', payment_method: 'pix', reference: '', notes: '' });
  const [payError, setPayError]     = useState('');
  const [payingSave, setPayingSave] = useState(false);

  // Boleto section
  const [boleto, setBoleto]           = useState<BoletoInfo | null>(null);
  const [boletoLoading, setBoletoLoading] = useState(false);
  const [emitting, setEmitting]       = useState(false);
  const [boletoError, setBoletoError] = useState('');
  const [brcodeCopied, setBrcodeCopied] = useState(false);

  const PER_PAGE = 20;

  useEffect(() => {
    if (!tenantId) return;
    loadItems();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, page, statusFilter, search]);

  useEffect(() => {
    if (!createOpen || !tenantId) return;
    let cancelled = false;
    api.get<any>(`/v1/clients?tenant_id=${tenantId}&per_page=100&page=1`)
      .then(d => { if (!cancelled) setClients(d.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [createOpen, tenantId]);

  async function loadItems() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (statusFilter) qs.set('status', statusFilter);
      if (search)       qs.set('search', search);
      const data = await api.get<any>(`/v1/receivables?${qs}`);
      setItems(data.data); setTotal(data.total);
    } finally { setLoading(false); }
  }

  async function loadBoleto(receivableId: string) {
    setBoletoLoading(true);
    try {
      const data = await api.get<any>(`/v1/receivables/${receivableId}/boleto`);
      setBoleto(data.boleto ?? null);
    } catch { setBoleto(null); }
    finally { setBoletoLoading(false); }
  }

  async function openDetail(rec: Receivable) {
    const full = await api.get<any>(`/v1/receivables/${rec.id}`);
    setSelected(full);
    setBoleto(null); setBoletoError(''); setBrcodeCopied(false);
    setPayError('');
    setPayForm({ payment_date: '', amount: '', payment_method: 'pix', reference: '', notes: '' });
    if (full.boleto_id) await loadBoleto(full.id);
    setDetailOpen(true);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault(); setFormError('');
    if (!form.description.trim()) { setFormError(t('rec.errDesc')); return; }
    if (!form.amount || Number(form.amount) <= 0) { setFormError(t('rec.errAmount')); return; }
    if (!form.due_date) { setFormError(t('rec.errDue')); return; }
    setSaving(true);
    try {
      await api.post('/v1/receivables', {
        client_id:   form.client_id || null,
        description: form.description,
        amount:      Number(form.amount),
        due_date:    form.due_date,
        notes:       form.notes || null,
      });
      setCreateOpen(false);
      setForm({ client_id: '', description: '', amount: '', due_date: '', notes: '' });
      loadItems();
    } catch (err: any) {
      setFormError(err.message || t('rec.errSave'));
    } finally { setSaving(false); }
  }

  async function handlePayment(e: FormEvent) {
    e.preventDefault(); setPayError('');
    if (!payForm.payment_date) { setPayError(t('rec.errPayDate')); return; }
    if (!payForm.amount || Number(payForm.amount) <= 0) { setPayError(t('rec.errPayAmt')); return; }
    setPayingSave(true);
    try {
      await api.post(`/v1/receivables/${selected!.id}/payments`, {
        payment_date:   payForm.payment_date,
        amount:         Number(payForm.amount),
        payment_method: payForm.payment_method,
        reference:      payForm.reference || null,
        notes:          payForm.notes    || null,
      });
      const updated = await api.get<any>(`/v1/receivables/${selected!.id}`);
      setSelected(updated);
      setPayForm({ payment_date: '', amount: '', payment_method: 'pix', reference: '', notes: '' });
      loadItems();
    } catch (err: any) {
      setPayError(err.message || t('rec.errSave'));
    } finally { setPayingSave(false); }
  }

  async function handleDeletePayment(paymentId: string) {
    if (!selected) return;
    try {
      await api.delete(`/v1/receivables/${selected.id}/payments/${paymentId}`);
      const updated = await api.get<any>(`/v1/receivables/${selected.id}`);
      setSelected(updated); loadItems();
    } catch (err: any) {
      setPayError(err.message || t('rec.errSave'));
    }
  }

  async function handleCancel(id: string) {
    try {
      await api.post(`/v1/receivables/${id}/cancel`, {});
      setDetailOpen(false); loadItems();
    } catch (err: any) {
      setPayError(err.message || t('rec.errSave'));
    }
  }

  async function handleEmitBoleto() {
    if (!selected) return;
    setBoletoError(''); setEmitting(true);
    try {
      await api.post(`/v1/receivables/${selected.id}/emit-boleto`, {});
      const updated = await api.get<any>(`/v1/receivables/${selected.id}`);
      setSelected(updated);
      await loadBoleto(selected.id);
    } catch (err: any) {
      setBoletoError(err.message || t('bill.errEmit'));
    } finally { setEmitting(false); }
  }

  async function handleExpireBoleto() {
    if (!selected || !window.confirm(t('bill.expireConfirm'))) return;
    setBoletoError('');
    try {
      await api.put(`/v1/receivables/${selected.id}/boleto/expire`, {});
      await loadBoleto(selected.id);
    } catch (err: any) {
      setBoletoError(err.message || t('bill.errEmit'));
    }
  }

  function copyBrcode() {
    if (!boleto?.brcode) return;
    navigator.clipboard.writeText(boleto.brcode).then(() => {
      setBrcodeCopied(true);
      setTimeout(() => setBrcodeCopied(false), 2000);
    });
  }

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const fmt   = (v: string) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');

  return (
    <div>
      <div className="page-header">
        <h1>{t('rec.title')}</h1>
        <button className="btn btn-primary" onClick={() => { setCreateOpen(true); setFormError(''); setForm({ client_id: '', description: '', amount: '', due_date: '', notes: '' }); }}>
          {t('rec.new')}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input className="search-input" placeholder={t('rec.searchPH')}
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select className="btn btn-secondary" value={statusFilter}
          onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t('rec.allStatuses')}</option>
          <option value="pending">{t('rec.status.pending')}</option>
          <option value="partial">{t('rec.status.partial')}</option>
          <option value="paid">{t('rec.status.paid')}</option>
          <option value="overdue">{t('rec.status.overdue')}</option>
          <option value="cancelled">{t('rec.status.cancelled')}</option>
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">{t('rec.empty')}</div>
        ) : (
          <table>
            <thead><tr>
              <th>{t('rec.client')}</th>
              <th>{t('rec.description')}</th>
              <th>{t('rec.dueDate')}</th>
              <th style={{ textAlign: 'right' }}>{t('rec.amount')}</th>
              <th style={{ textAlign: 'right' }}>{t('rec.paid')}</th>
              <th>{t('rec.status')}</th>
              <th>{t('c.actions')}</th>
            </tr></thead>
            <tbody>
              {items.map(rec => (
                <tr key={rec.id}>
                  <td>{rec.client_name || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td>{rec.description}</td>
                  <td style={{ fontSize: 13 }}>{fmtDate(rec.due_date)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(rec.amount)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmt(rec.paid_amount)}</td>
                  <td>
                    <span className="badge" style={{ background: STATUS_COLORS[rec.status] + '22', color: STATUS_COLORS[rec.status], border: `1px solid ${STATUS_COLORS[rec.status]}44`, fontWeight: 600, fontSize: 11 }}>
                      {t(`rec.status.${rec.status}` as any)}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => openDetail(rec)}>
                      {t('rec.details')}
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
              <h2>{t('rec.new')}</h2>
              <button onClick={() => setCreateOpen(false)}>{t('c.close')}</button>
            </div>
            <form onSubmit={handleCreate} noValidate>
              <div className="drawer-body">
                {formError && <div role="alert" className="alert alert-error">{formError}</div>}
                <div className="field">
                  <label>{t('rec.client')}</label>
                  <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                    <option value="">{t('rec.noClient')}</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>{t('rec.description')} *</label>
                  <input type="text" value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>{t('rec.amount')} *</label>
                    <input type="number" min="0.01" step="0.01" value={form.amount}
                      onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
                  </div>
                  <div className="field">
                    <label>{t('rec.dueDate')} *</label>
                    <input type="date" value={form.due_date}
                      onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} required />
                  </div>
                </div>
                <div className="field">
                  <label>{t('rec.notes')}</label>
                  <input type="text" value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary"
                  onClick={() => setCreateOpen(false)}>{t('c.cancel')}</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? t('c.saving') : t('rec.create')}
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
              {/* Resumo */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ textAlign: 'center', padding: 12, background: 'var(--surface)', borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('rec.amount')}</div>
                  <div style={{ fontWeight: 700 }}>{fmt(selected.amount)}</div>
                </div>
                <div style={{ textAlign: 'center', padding: 12, background: 'var(--surface)', borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('rec.paid')}</div>
                  <div style={{ fontWeight: 700, color: '#16a34a' }}>{fmt(selected.paid_amount)}</div>
                </div>
                <div style={{ textAlign: 'center', padding: 12, background: 'var(--surface)', borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('rec.remaining')}</div>
                  <div style={{ fontWeight: 700, color: '#dc2626' }}>
                    {fmt(String(Math.max(0, Number(selected.amount) - Number(selected.paid_amount))))}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                {t('rec.dueDate')}: <strong>{fmtDate(selected.due_date)}</strong>
                &nbsp;·&nbsp;
                {t('rec.status')}: <span style={{ color: STATUS_COLORS[selected.status], fontWeight: 600 }}>
                  {t(`rec.status.${selected.status}` as any)}
                </span>
              </div>

              {/* Pagamentos registrados */}
              {selected.payments.length > 0 && (
                <>
                  <h4 style={{ marginBottom: 8 }}>{t('rec.paymentsHistory')}</h4>
                  <table style={{ marginBottom: 16 }}>
                    <thead><tr>
                      <th>{t('rec.payDate')}</th>
                      <th style={{ textAlign: 'right' }}>{t('rec.amount')}</th>
                      <th>{t('rec.method')}</th>
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
                                onClick={() => handleDeletePayment(p.id)}>{t('rec.reverse')}</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {/* Registrar pagamento */}
              {selected.status !== 'paid' && selected.status !== 'cancelled' && (
                <>
                  <h4 style={{ marginBottom: 8 }}>{t('rec.registerPayment')}</h4>
                  {payError && <div role="alert" className="alert alert-error">{payError}</div>}
                  <form onSubmit={handlePayment} noValidate>
                    <div className="field-row">
                      <div className="field">
                        <label>{t('rec.payDate')} *</label>
                        <input type="date" value={payForm.payment_date}
                          onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))} required />
                      </div>
                      <div className="field">
                        <label>{t('rec.amount')} *</label>
                        <input type="number" min="0.01" step="0.01" value={payForm.amount}
                          onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} required />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>{t('rec.method')}</label>
                        <select value={payForm.payment_method}
                          onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value }))}>
                          {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label>{t('rec.reference')}</label>
                        <input type="text" value={payForm.reference}
                          onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))}
                          placeholder={t('rec.referencePH')} />
                      </div>
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={payingSave} style={{ width: '100%' }}>
                      {payingSave ? t('c.saving') : t('rec.registerPayment')}
                    </button>
                  </form>
                </>
              )}

              {/* ── Seção Boleto ── */}
              {selected.status !== 'cancelled' && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <h4 style={{ marginBottom: 8 }}>{t('bill.boleto')}</h4>

                  {boletoError && <div role="alert" className="alert alert-error" style={{ marginBottom: 8 }}>{boletoError}</div>}

                  {boletoLoading ? (
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('c.loading')}</div>
                  ) : !selected.boleto_id ? (
                    selected.status !== 'paid' && (
                      <button className="btn btn-secondary btn-sm" onClick={handleEmitBoleto} disabled={emitting}>
                        {emitting ? t('bill.emitting') : t('bill.emitBoleto')}
                      </button>
                    )
                  ) : boleto ? (
                    <div>
                      <div style={{ fontSize: 13, marginBottom: 8 }}>
                        {t('bill.statusLabel')}:{' '}
                        <strong style={{ color: BOLETO_STATUS_COLORS[boleto.status] }}>
                          {t(`bill.status.${boleto.status}` as any)}
                        </strong>
                      </div>

                      {boleto.nosso_numero && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                          {t('bill.nossoNumero')}: <code style={{ fontFamily: 'monospace' }}>{boleto.nosso_numero}</code>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        {boleto.boleto_url && (
                          <a href={boleto.boleto_url} target="_blank" rel="noopener noreferrer"
                             className="btn btn-secondary btn-sm">
                            {t('bill.viewBoleto')}
                          </a>
                        )}
                        {boleto.brcode && (
                          <button className="btn btn-secondary btn-sm" onClick={copyBrcode}>
                            {brcodeCopied ? t('bill.copiedBrcode') : t('bill.copyBrcode')}
                          </button>
                        )}
                        {boleto.status !== 'expired' && boleto.status !== 'paid' && (
                          <button className="btn btn-danger btn-sm" onClick={handleExpireBoleto}>
                            {t('bill.expire')}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Cancelar conta */}
              {selected.status !== 'paid' && selected.status !== 'cancelled' && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <button className="btn btn-danger btn-sm" onClick={() => handleCancel(selected.id)}>
                    {t('rec.cancel')}
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
