import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { Can }      from '../../rbac';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Installment {
  installment_number: number;
  days_offset:         number;
  percentage:           number | string;
}

interface PaymentPlan {
  id:           string;
  name:         string;
  description:  string | null;
  is_active:    boolean;
  is_default:   boolean;
  installments: Installment[];
}

interface ListResp { data: PaymentPlan[]; }

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_INSTALLMENT: Installment = { installment_number: 1, days_offset: 0, percentage: 100 };

const EMPTY_FORM = {
  name:         '',
  description:  '',
  is_default:   false,
  installments: [{ ...EMPTY_INSTALLMENT }] as Installment[],
};

// ── Main component ─────────────────────────────────────────────────────────────

export function PaymentPlansPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();

  // ── List state ─────────────────────────────────────────────────────────────
  const [items,   setItems]   = useState<PaymentPlan[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Drawer (create / edit) state ───────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<PaymentPlan | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  // ── Data loading ───────────────────────────────────────────────────────────

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const resp = await api.get<ListResp>('/v1/payment-plans');
      setItems(resp.data);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [tenantId]);

  // ── Drawer helpers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, installments: [{ ...EMPTY_INSTALLMENT }] });
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(plan: PaymentPlan) {
    setEditing(plan);
    setForm({
      name:         plan.name,
      description:  plan.description ?? '',
      is_default:   plan.is_default,
      installments: plan.installments.map(i => ({ ...i, percentage: Number(i.percentage) })),
    });
    setFormError('');
    setDrawerOpen(true);
  }

  function addInstallment() {
    setForm(f => ({
      ...f,
      installments: [...f.installments, {
        installment_number: f.installments.length + 1, days_offset: 30, percentage: 0,
      }],
    }));
  }

  function removeInstallment(idx: number) {
    setForm(f => ({
      ...f,
      installments: f.installments
        .filter((_, i) => i !== idx)
        .map((it, i) => ({ ...it, installment_number: i + 1 })),
    }));
  }

  function updateInstallment(idx: number, field: 'days_offset' | 'percentage', value: string) {
    setForm(f => ({
      ...f,
      installments: f.installments.map((it, i) => i === idx ? { ...it, [field]: value === '' ? '' : Number(value) } : it),
    }));
  }

  const percentageSum = form.installments.reduce((s, it) => s + (Number(it.percentage) || 0), 0);
  const sumIsValid = Math.abs(percentageSum - 100) < 0.011; // mesma tolerância do domínio (paymentPlanDomain.ts)

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setFormError('');

    if (!form.name.trim()) { setFormError(t('pp.errName')); return; }
    if (!form.installments.length) { setFormError(t('pp.errNoInstallments')); return; }
    if (!sumIsValid) { setFormError(t('pp.errSum').replace('{sum}', percentageSum.toFixed(2))); return; }

    setSaving(true);
    try {
      const payload = {
        name:        form.name.trim(),
        description: form.description.trim() || undefined,
        is_default:  form.is_default,
        installments: form.installments.map(it => ({
          installment_number: it.installment_number,
          days_offset:         Number(it.days_offset) || 0,
          percentage:           Number(it.percentage) || 0,
        })),
      };
      if (editing) await api.patch(`/v1/payment-plans/${editing.id}`, payload);
      else         await api.post('/v1/payment-plans', payload);
      setDrawerOpen(false);
      void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('pp.errSave'));
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    const ok = await modal.confirm({
      title:        t('pp.deactivate'),
      message:      t('pp.deactivateMsg'),
      confirmLabel: t('c.del'),
      danger:       true,
    });
    if (!ok) return;
    try { await api.delete(`/v1/payment-plans/${id}`); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <h1>{t('pp.title')}</h1>
        <Can permission="payment_plans:create">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
            + {t('pp.new')}
          </button>
        </Can>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -8, marginBottom: 16 }}>{t('pp.subtitle')}</p>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            {t('c.empty')}{' '}
            <Can permission="payment_plans:create">
              <button className="btn btn-secondary btn-sm" onClick={openCreate}>{t('pp.new')}</button>
            </Can>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('pp.name')}</th>
                <th>{t('pp.installmentsCol')}</th>
                <th>{t('pp.defaultCol')}</th>
                <th>{t('c.active')}</th>
                <th>{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(plan => (
                <tr key={plan.id}>
                  <td style={{ fontWeight: 500 }}>
                    {plan.name}
                    {plan.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{plan.description}</div>}
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {plan.installments.length === 1
                      ? t('pp.singleInstallment')
                      : `${plan.installments.length}x — ${plan.installments.map(i => `D+${i.days_offset}`).join(', ')}`}
                  </td>
                  <td>{plan.is_default && <span className="badge badge-service">{t('pp.defaultCol')}</span>}</td>
                  <td>
                    <span className={`badge badge-${plan.is_active ? 'service' : 'raw_material'}`}>
                      {plan.is_active ? t('c.active') : t('c.inactive')}
                    </span>
                  </td>
                  <td>
                    <div className="flex-gap">
                      <Can permission="payment_plans:edit">
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(plan)}>{t('c.edit')}</button>
                      </Can>
                      <Can permission="payment_plans:delete">
                        {plan.is_active && (
                          <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(plan.id)}>{t('c.del')}</button>
                        )}
                      </Can>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Drawer — create / edit ────────────────────────────────────── */}
      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{editing ? t('pp.edit') : t('pp.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                <div className="field">
                  <label>{t('pp.name')} *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder={t('pp.namePH')} required />
                </div>

                <div className="field">
                  <label>{t('pp.description')}</label>
                  <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder={t('pp.descriptionPH')} />
                </div>

                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={form.is_default}
                      onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))}
                      style={{ width: 'auto', margin: 0 }} />
                    {t('pp.isDefault')}
                  </label>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('pp.isDefaultHint')}</span>
                </div>

                <div className="field">
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{t('pp.installments')}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: sumIsValid ? 'var(--success, green)' : 'var(--danger)' }}>
                      {t('pp.sum')}: {percentageSum.toFixed(2)}%
                    </span>
                  </label>
                  <table style={{ width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                        <th style={{ width: 40 }}>#</th>
                        <th>{t('pp.daysOffset')}</th>
                        <th>{t('pp.percentage')}</th>
                        <th style={{ width: 32 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.installments.map((it, idx) => (
                        <tr key={idx}>
                          <td>{it.installment_number}</td>
                          <td>
                            <input type="number" min={0} value={it.days_offset}
                              onChange={e => updateInstallment(idx, 'days_offset', e.target.value)}
                              style={{ fontSize: 13 }} />
                          </td>
                          <td>
                            <input type="number" min={0} max={100} step={0.01} value={it.percentage}
                              onChange={e => updateInstallment(idx, 'percentage', e.target.value)}
                              style={{ fontSize: 13 }} />
                          </td>
                          <td>
                            {form.installments.length > 1 && (
                              <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto', padding: '2px 8px' }}
                                onClick={() => removeInstallment(idx)}>✕</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8, width: 'auto' }}
                    onClick={addInstallment}>
                    + {t('pp.addInstallment')}
                  </button>
                </div>
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>
                  {t('c.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : editing ? t('c.save') : t('pp.new')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
