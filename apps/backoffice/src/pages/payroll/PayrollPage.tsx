import { useEffect, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api }      from '../../lib/api';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { Drawer }    from '../../ds/components/Drawer';
import { DataTable, type Column } from '../../ds/components/DataTable';
import { Badge }     from '../../ds/components/Badge';

interface PayrollRun {
  id: string; reference_month: string; status: 'draft' | 'closed';
  gross_total: string; deductions_total: string; net_total: string; employer_charges_total: string;
}

interface LineItem { description: string; amount: number; }

interface PayrollEntry {
  id: string; employee_id: string; employee_name: string; regime: 'clt' | 'pro_labore'; base_salary: string;
  extra_earnings: LineItem[]; extra_deductions: LineItem[];
  inss_value: string; irrf_value: string; fgts_value: string;
  ferias_provisao: string; decimo_terceiro_provisao: string;
  gross_total: string; deductions_total: string; net_total: string; payable_id: string | null;
}

function formatBRL(value: string | number): string {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export function PayrollPage() {
  const { t }  = useI18n();
  const modal  = useModal();

  const [runs,    setRuns]    = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);

  const [genOpen, setGenOpen] = useState(false);
  const [genMonth, setGenMonth] = useState('');
  const [genSaving, setGenSaving] = useState(false);
  const [genError, setGenError] = useState('');

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [closing, setClosing] = useState(false);

  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [adjustEarnings, setAdjustEarnings] = useState<LineItem[]>([]);
  const [adjustDeductions, setAdjustDeductions] = useState<LineItem[]>([]);
  const [adjustDescDraft, setAdjustDescDraft] = useState('');
  const [adjustAmountDraft, setAdjustAmountDraft] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const resp = await api.get<{ data: PayrollRun[] }>('/v1/payroll');
      setRuns(resp.data);
    } catch { /**/ } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function openGenerate() {
    setGenMonth('');
    setGenError('');
    setGenOpen(true);
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    setGenError('');
    setGenSaving(true);
    try {
      await api.post('/v1/payroll', { reference_month: `${genMonth}-01` });
      setGenOpen(false);
      void load();
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message : t('payroll.errGenerate'));
    } finally { setGenSaving(false); }
  }

  async function openDetail(run: PayrollRun) {
    setSelectedRun(run);
    setDetailOpen(true);
    setEditingEntryId(null);
    setEntriesLoading(true);
    try {
      const resp = await api.get<{ run: PayrollRun; entries: PayrollEntry[] }>(`/v1/payroll/${run.id}`);
      setEntries(resp.entries);
    } catch { setEntries([]); } finally { setEntriesLoading(false); }
  }

  function openAdjust(entry: PayrollEntry) {
    setEditingEntryId(entry.id);
    setAdjustEarnings(entry.extra_earnings ?? []);
    setAdjustDeductions(entry.extra_deductions ?? []);
    setAdjustDescDraft('');
    setAdjustAmountDraft('');
  }

  function addLine(kind: 'earning' | 'deduction') {
    const amount = Number(adjustAmountDraft);
    if (!adjustDescDraft.trim() || !Number.isFinite(amount) || amount <= 0) return;
    const item = { description: adjustDescDraft.trim(), amount };
    if (kind === 'earning') setAdjustEarnings(prev => [...prev, item]);
    else setAdjustDeductions(prev => [...prev, item]);
    setAdjustDescDraft('');
    setAdjustAmountDraft('');
  }

  async function saveAdjustments(entryId: string) {
    setAdjustSaving(true);
    try {
      await api.patch(`/v1/payroll/entries/${entryId}`, { extra_earnings: adjustEarnings, extra_deductions: adjustDeductions });
      setEditingEntryId(null);
      if (selectedRun) await openDetail(selectedRun);
    } catch (err: unknown) { modal.error(err); } finally { setAdjustSaving(false); }
  }

  async function handleClose() {
    if (!selectedRun) return;
    const ok = await modal.confirm({ title: t('payroll.close'), message: t('payroll.closeMsg'), confirmLabel: t('payroll.close'), danger: true });
    if (!ok) return;
    setClosing(true);
    try {
      await api.post(`/v1/payroll/${selectedRun.id}/close`, {});
      await openDetail(selectedRun);
      void load();
    } catch (err: unknown) { modal.error(err); } finally { setClosing(false); }
  }

  const columns: Column<PayrollRun>[] = [
    { key: 'month', header: t('payroll.month'), render: r => <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{formatMonth(r.reference_month)}</span> },
    { key: 'status', header: t('c.status'), render: r => (
      <Badge variant={r.status === 'closed' ? 'active' : 'draft'}>{r.status === 'closed' ? t('payroll.statusClosed') : t('payroll.statusDraft')}</Badge>
    ) },
    { key: 'gross', header: t('payroll.grossTotal'), align: 'right', render: r => formatBRL(r.gross_total) },
    { key: 'net', header: t('payroll.netTotal'), align: 'right', render: r => formatBRL(r.net_total) },
    { key: 'employer', header: t('payroll.employerCharges'), align: 'right', render: r => formatBRL(r.employer_charges_total) },
    { key: 'actions', header: '', align: 'right', render: r => (
      <button className="btn btn-secondary btn-sm" onClick={() => openDetail(r)}>{t('payroll.open')}</button>
    ) },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>{t('payroll.title')}</h1>
        <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openGenerate}>
          + {t('payroll.generate')}
        </button>
      </div>
      <p className="text-muted" style={{ marginTop: -8, marginBottom: 16 }}>{t('payroll.pageHint')}</p>

      <div className="card">
        <DataTable columns={columns} rows={runs} loading={loading} emptyState={<div className="empty-state">{t('payroll.empty')}</div>} />
      </div>

      {/* ── Gerar Folha do Mês ─────────────────────────────────────────── */}
      <Drawer open={genOpen} onClose={() => setGenOpen(false)} width="min(420px, 96vw)" title={t('payroll.generate')}>
        <form onSubmit={handleGenerate} style={{ display: 'contents' }}>
          <Drawer.Body>
            {genError && <div className="alert alert-error">{genError}</div>}
            <div className="field">
              <label>{t('payroll.month')} *</label>
              <input type="month" value={genMonth} onChange={e => setGenMonth(e.target.value)} required />
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>{t('payroll.generateHint')}</p>
          </Drawer.Body>
          <Drawer.Footer>
            <button type="button" className="btn btn-secondary" onClick={() => setGenOpen(false)}>{t('c.cancel')}</button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={genSaving}>
              {genSaving ? t('c.saving') : t('payroll.generate')}
            </button>
          </Drawer.Footer>
        </form>
      </Drawer>

      {/* ── Detalhe da folha ───────────────────────────────────────────── */}
      <Drawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width="min(760px, 96vw)"
        title={selectedRun ? `${t('payroll.title')} — ${formatMonth(selectedRun.reference_month)}` : ''}
        subTitle={selectedRun ? (selectedRun.status === 'closed' ? t('payroll.statusClosed') : t('payroll.statusDraft')) : undefined}
      >
        <Drawer.Body>
          {entriesLoading ? (
            <div className="spinner">{t('c.loading')}</div>
          ) : entries.length === 0 ? (
            <div className="empty-state">{t('payroll.noEntries')}</div>
          ) : (
            entries.map(entry => (
              <div key={entry.id} className="card" style={{ padding: 16, marginBottom: 12 }}>
                <div className="flex-gap" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <div>
                    <strong>{entry.employee_name}</strong>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {entry.regime === 'clt' ? t('emp.regimeClt') : t('emp.regimeProLabore')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>{formatBRL(entry.net_total)}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('payroll.netTotal')}</div>
                  </div>
                </div>

                <div style={{ fontSize: 13, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 }}>
                  <span>{t('payroll.grossTotal')}: {formatBRL(entry.gross_total)}</span>
                  <span>INSS: {formatBRL(entry.inss_value)}</span>
                  <span>IRRF: {formatBRL(entry.irrf_value)}</span>
                  {entry.regime === 'clt' && <span>FGTS: {formatBRL(entry.fgts_value)}</span>}
                </div>

                <div className="flex-gap">
                  {selectedRun?.status === 'draft' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => openAdjust(entry)}>{t('payroll.adjust')}</button>
                  )}
                  <Link to={`/payroll/entries/${entry.id}/print`} className="btn btn-secondary btn-sm" style={{ width: 'auto' }}>
                    🖨 {t('payroll.payslip')}
                  </Link>
                </div>

                {editingEntryId === entry.id && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <div className="field-row">
                      <div className="field">
                        <label>{t('payroll.adjustDesc')}</label>
                        <input value={adjustDescDraft} onChange={e => setAdjustDescDraft(e.target.value)} placeholder={t('payroll.adjustDescPH')} />
                      </div>
                      <div className="field">
                        <label>{t('payroll.adjustAmount')}</label>
                        <input type="number" min={0} step="0.01" value={adjustAmountDraft} onChange={e => setAdjustAmountDraft(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex-gap" style={{ marginBottom: 10 }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => addLine('earning')}>+ {t('payroll.addEarning')}</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => addLine('deduction')}>+ {t('payroll.addDeduction')}</button>
                    </div>

                    {adjustEarnings.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('payroll.earnings')}</div>
                        {adjustEarnings.map((it, idx) => (
                          <div key={idx} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                            <span>{it.description}</span>
                            <span className="flex-gap">
                              {formatBRL(it.amount)}
                              <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                                onClick={() => setAdjustEarnings(prev => prev.filter((_, i) => i !== idx))}>✕</button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {adjustDeductions.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('payroll.deductions')}</div>
                        {adjustDeductions.map((it, idx) => (
                          <div key={idx} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                            <span>{it.description}</span>
                            <span className="flex-gap">
                              {formatBRL(it.amount)}
                              <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                                onClick={() => setAdjustDeductions(prev => prev.filter((_, i) => i !== idx))}>✕</button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex-gap">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingEntryId(null)}>{t('c.cancel')}</button>
                      <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={adjustSaving}
                        onClick={() => saveAdjustments(entry.id)}>
                        {adjustSaving ? t('c.saving') : t('c.save')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <button type="button" className="btn btn-secondary" onClick={() => setDetailOpen(false)}>{t('c.close')}</button>
          {selectedRun?.status === 'draft' && entries.length > 0 && (
            <button type="button" className="btn btn-danger" style={{ width: 'auto' }} disabled={closing} onClick={handleClose}>
              {closing ? t('c.saving') : t('payroll.close')}
            </button>
          )}
        </Drawer.Footer>
      </Drawer>
    </div>
  );
}
