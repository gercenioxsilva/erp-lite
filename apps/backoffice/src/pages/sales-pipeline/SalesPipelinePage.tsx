import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';
import { Drawer }   from '../../ds/components/Drawer';
import { Switch }   from '../../ds/components/Switch';
import { KPICard }  from '../../ds/components/KPICard';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface Stage { id: string; name: string; sort_order: number; is_active: boolean; }
interface Opportunity {
  id: string; stage_id: string; client_id: string | null; seller_id: string | null;
  proposal_id: string | null; title: string;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  value: string; source: string | null; status: 'open' | 'won' | 'lost';
  lost_reason: string | null; expected_close_date: string | null; notes: string | null;
  created_at: string;
}
interface Activity { id: string; type: string; description: string | null; created_by: string | null; created_at: string; }
interface ClientOption { id: string; company_name: string | null; full_name: string | null; }
interface SellerOption { id: string; name: string; }

const ACTIVITY_LABELS: Record<string, string> = {
  note: 'Nota', call: 'Ligação', meeting: 'Reunião', stage_change: 'Mudança de etapa',
  won: 'Ganha', lost: 'Perdida', proposal_linked: 'Proposta gerada',
};

function newForm() {
  return {
    title: '', client_id: '', seller_id: '', contact_name: '', contact_email: '', contact_phone: '',
    value: '0', source: '', expected_close_date: '', notes: '',
  };
}

export function SalesPipelinePage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();

  const [stages,        setStages]        = useState<Stage[]>([]);
  const [opportunities, setOpportunities]  = useState<Opportunity[]>([]);
  const [loading,       setLoading]        = useState(true);
  const [clients,       setClients]        = useState<ClientOption[]>([]);
  const [sellers,       setSellers]        = useState<SellerOption[]>([]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Opportunity | null>(null);
  const [form,        setForm]      = useState(newForm());
  const [formStageId, setFormStageId] = useState('');
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  const [activities, setActivities]     = useState<Activity[]>([]);
  const [noteDraft, setNoteDraft]       = useState('');
  const [noteType, setNoteType]         = useState<'note' | 'call' | 'meeting'>('note');
  const [logging, setLogging]           = useState(false);
  const [lostReasonDraft, setLostReasonDraft] = useState('');
  const [losing, setLosing]             = useState(false);
  const [converting, setConverting]     = useState(false);

  const [configOpen, setConfigOpen]   = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const [draggedId, setDraggedId]     = useState<string | null>(null);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [st, opp] = await Promise.all([
        api.get<{ data: Stage[] }>('/v1/sales-pipeline/stages'),
        api.get<{ data: Opportunity[] }>('/v1/sales-pipeline/opportunities'),
      ]);
      setStages(st.data.filter(s => s.is_active).sort((a, b) => a.sort_order - b.sort_order));
      setOpportunities(opp.data);
    } catch (err: unknown) { modal.error(err); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [tenantId]);

  useEffect(() => {
    if (!drawerOpen || !tenantId) return;
    Promise.all([
      api.get<{ data: ClientOption[] }>(`/v1/clients?per_page=200&tenant_id=${tenantId}`),
      api.get<SellerOption[]>('/v1/sellers/active').catch(() => [] as SellerOption[]),
    ]).then(([cl, sl]) => {
      setClients(cl.data ?? []);
      setSellers(Array.isArray(sl) ? sl : []);
    }).catch(() => {});
  }, [drawerOpen, tenantId]);

  function openCreate(stageId: string) {
    setEditing(null);
    setForm(newForm());
    setFormStageId(stageId || stages[0]?.id || '');
    setActivities([]); setLostReasonDraft(''); setFormError('');
    setDrawerOpen(true);
  }

  async function openDetail(opp: Opportunity) {
    setEditing(opp);
    setForm({
      title: opp.title, client_id: opp.client_id ?? '', seller_id: opp.seller_id ?? '',
      contact_name: opp.contact_name ?? '', contact_email: opp.contact_email ?? '', contact_phone: opp.contact_phone ?? '',
      value: opp.value, source: opp.source ?? '', expected_close_date: opp.expected_close_date ?? '', notes: opp.notes ?? '',
    });
    setFormStageId(opp.stage_id);
    setLostReasonDraft(''); setFormError('');
    setDrawerOpen(true);
    try {
      const r = await api.get<{ data: Activity[] }>(`/v1/sales-pipeline/opportunities/${opp.id}/activities`);
      setActivities(r.data);
    } catch { setActivities([]); }
  }

  function closeDrawer() { setDrawerOpen(false); setEditing(null); }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setFormError(t('sp.errTitle')); return; }
    setSaving(true); setFormError('');
    try {
      const payload = {
        title: form.title.trim(), client_id: form.client_id || undefined, seller_id: form.seller_id || undefined,
        contact_name: form.contact_name || undefined, contact_email: form.contact_email || undefined,
        contact_phone: form.contact_phone || undefined, value: Number(form.value) || 0,
        source: form.source || undefined, expected_close_date: form.expected_close_date || undefined,
        notes: form.notes || undefined,
      };
      if (editing) {
        await api.patch(`/v1/sales-pipeline/opportunities/${editing.id}`, payload);
      } else {
        await api.post('/v1/sales-pipeline/opportunities', { ...payload, stage_id: formStageId });
      }
      closeDrawer(); void load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('sp.errSave'));
    } finally { setSaving(false); }
  }

  async function moveOpportunity(id: string, stageId: string) {
    try { await api.post(`/v1/sales-pipeline/opportunities/${id}/move`, { stage_id: stageId }); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  async function markWon(id: string) {
    const ok = await modal.confirm({ title: t('sp.markWon'), message: t('sp.markWonConfirm'), confirmLabel: t('sp.markWon') });
    if (!ok) return;
    try { await api.post(`/v1/sales-pipeline/opportunities/${id}/won`, {}); closeDrawer(); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  async function markLostQuick(id: string) {
    // Arrastar direto pra coluna Perdido — captura o motivo rápido via prompt
    // nativo (sem dependência nova); refinar depois abrindo o card, se quiser.
    const reason = window.prompt(t('sp.lostReasonPrompt')) ?? '';
    try { await api.post(`/v1/sales-pipeline/opportunities/${id}/lost`, { reason: reason || undefined }); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  async function markLostFromDrawer() {
    if (!editing) return;
    setLosing(true);
    try {
      await api.post(`/v1/sales-pipeline/opportunities/${editing.id}/lost`, { reason: lostReasonDraft || undefined });
      closeDrawer(); void load();
    } catch (err: unknown) { modal.error(err); }
    finally { setLosing(false); }
  }

  async function handleLogActivity() {
    if (!editing || !noteDraft.trim()) return;
    setLogging(true);
    try {
      await api.post(`/v1/sales-pipeline/opportunities/${editing.id}/activities`, { type: noteType, description: noteDraft.trim() });
      setNoteDraft('');
      const r = await api.get<{ data: Activity[] }>(`/v1/sales-pipeline/opportunities/${editing.id}/activities`);
      setActivities(r.data);
    } catch (err: unknown) { modal.error(err); }
    finally { setLogging(false); }
  }

  async function handleConvertToProposal() {
    if (!editing) return;
    const ok = await modal.confirm({ title: t('sp.convert'), message: t('sp.convertConfirm'), confirmLabel: t('sp.convert') });
    if (!ok) return;
    setConverting(true);
    try {
      await api.post(`/v1/sales-pipeline/opportunities/${editing.id}/convert-to-proposal`, {});
      modal.success(t('sp.convertDone'));
      closeDrawer(); void load();
    } catch (err: unknown) { modal.error(err); }
    finally { setConverting(false); }
  }

  async function handleCreateStage() {
    if (!newStageName.trim()) return;
    try {
      await api.post('/v1/sales-pipeline/stages', { name: newStageName.trim() });
      setNewStageName('');
      void load();
    } catch (err: unknown) { modal.error(err); }
  }

  async function toggleStageActive(stage: Stage) {
    try { await api.patch(`/v1/sales-pipeline/stages/${stage.id}`, { is_active: !stage.is_active }); void load(); }
    catch (err: unknown) { modal.error(err); }
  }

  function clientName(id: string | null) {
    if (!id) return null;
    const c = clientsById[id];
    return c ? (c.company_name ?? c.full_name) : null;
  }
  const clientsById = Object.fromEntries(clients.map(c => [c.id, c]));
  const sellerName = (id: string | null) => sellers.find(s => s.id === id)?.name ?? null;

  const openOpps = opportunities.filter(o => o.status === 'open');
  const wonOpps  = opportunities.filter(o => o.status === 'won');
  const lostOpps = opportunities.filter(o => o.status === 'lost');
  const totalOpenValue = openOpps.reduce((s, o) => s + Number(o.value), 0);
  const winRate = (wonOpps.length + lostOpps.length) > 0
    ? Math.round((wonOpps.length / (wonOpps.length + lostOpps.length)) * 100) : 0;

  function onDragStart(id: string) { setDraggedId(id); }
  function onDropOnStage(stageId: string) {
    if (!draggedId) return;
    void moveOpportunity(draggedId, stageId);
    setDraggedId(null);
  }
  function onDropOnWon() {
    if (!draggedId) return;
    void markWon(draggedId);
    setDraggedId(null);
  }
  function onDropOnLost() {
    if (!draggedId) return;
    void markLostQuick(draggedId);
    setDraggedId(null);
  }

  function renderCard(opp: Opportunity) {
    return (
      <div key={opp.id} className="card" draggable onDragStart={() => onDragStart(opp.id)}
        onClick={() => void openDetail(opp)}
        style={{ padding: '10px 12px', marginBottom: 8, cursor: 'grab' }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{opp.title}</div>
        {(clientName(opp.client_id) || opp.contact_name) && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            {clientName(opp.client_id) ?? opp.contact_name}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 13, color: 'var(--primary)' }}>{BRL.format(Number(opp.value))}</strong>
          {sellerName(opp.seller_id) && (
            <span className="badge badge-service" style={{ fontSize: 10 }}>{sellerName(opp.seller_id)}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t('sp.title')}</h1>
        <div className="flex-gap">
          <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => setConfigOpen(true)}>
            {t('sp.configureStages')}
          </button>
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={() => openCreate(stages[0]?.id ?? '')}>
            + {t('sp.new')}
          </button>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{t('sp.pageHint')}</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label={t('sp.kpiOpen')} value={String(openOpps.length)} />
        <KPICard label={t('sp.kpiOpenValue')} value={BRL.format(totalOpenValue)} />
        <KPICard label={t('sp.kpiWinRate')} value={`${winRate}%`} sub={t('sp.kpiWinRateSub')} />
      </div>

      {loading ? (
        <div className="spinner">{t('c.loading')}</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
          {stages.map(stage => (
            <div key={stage.id} onDragOver={e => e.preventDefault()} onDrop={() => onDropOnStage(stage.id)}
              style={{ minWidth: 260, flex: '0 0 260px', background: 'var(--surface)', borderRadius: 10, padding: 10, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong style={{ fontSize: 13 }}>{stage.name}</strong>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{openOpps.filter(o => o.stage_id === stage.id).length}</span>
              </div>
              {openOpps.filter(o => o.stage_id === stage.id).map(renderCard)}
              <button type="button" className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 4 }}
                onClick={() => openCreate(stage.id)}>
                + {t('sp.addCard')}
              </button>
            </div>
          ))}

          <div onDragOver={e => e.preventDefault()} onDrop={onDropOnWon}
            style={{ minWidth: 220, flex: '0 0 220px', background: 'var(--surface)', borderRadius: 10, padding: 10, border: '1px solid var(--success)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13, color: 'var(--success)' }}>{t('sp.won')}</strong>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{wonOpps.length}</span>
            </div>
            {wonOpps.map(renderCard)}
          </div>

          <div onDragOver={e => e.preventDefault()} onDrop={onDropOnLost}
            style={{ minWidth: 220, flex: '0 0 220px', background: 'var(--surface)', borderRadius: 10, padding: 10, border: '1px solid var(--danger)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13, color: 'var(--danger)' }}>{t('sp.lost')}</strong>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{lostOpps.length}</span>
            </div>
            {lostOpps.map(renderCard)}
          </div>
        </div>
      )}

      {/* Drawer de detalhe/criação */}
      <Drawer open={drawerOpen} onClose={closeDrawer} title={editing ? editing.title : t('sp.new')} width="min(620px, 96vw)">
        <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
          <Drawer.Body>
            {formError && <div className="alert alert-error" role="alert">{formError}</div>}

            {editing && (
              <div style={{ marginBottom: 12 }}>
                <span className={`badge ${editing.status === 'won' ? 'badge-active' : editing.status === 'lost' ? 'badge-inactive' : 'badge-service'}`}>
                  {editing.status === 'won' ? t('sp.won') : editing.status === 'lost' ? t('sp.lost') : t('sp.open')}
                </span>
              </div>
            )}

            <div className="field">
              <label>{t('sp.opTitle')} *</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
            </div>

            {!editing && (
              <div className="field">
                <label>{t('sp.stage')}</label>
                <select value={formStageId} onChange={e => setFormStageId(e.target.value)}>
                  {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            <div className="field-row">
              <div className="field">
                <label>{t('sp.client')}</label>
                <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                  <option value="">{t('sp.noClientYet')}</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.company_name ?? c.full_name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>{t('sp.seller')}</label>
                <select value={form.seller_id} onChange={e => setForm(f => ({ ...f, seller_id: e.target.value }))}>
                  <option value="">{t('sp.noSeller')}</option>
                  {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            {!form.client_id && (
              <div className="field-row">
                <div className="field">
                  <label>{t('sp.contactName')}</label>
                  <input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
                </div>
                <div className="field">
                  <label>{t('sp.contactPhone')}</label>
                  <input value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} />
                </div>
              </div>
            )}

            <div className="field-row">
              <div className="field">
                <label>{t('sp.value')}</label>
                <input type="number" min="0" step="0.01" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} />
              </div>
              <div className="field">
                <label>{t('sp.expectedClose')}</label>
                <input type="date" value={form.expected_close_date} onChange={e => setForm(f => ({ ...f, expected_close_date: e.target.value }))} />
              </div>
              <div className="field">
                <label>{t('sp.source')}</label>
                <input value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} placeholder={t('sp.sourcePH')} />
              </div>
            </div>

            <div className="field">
              <label>{t('sp.notes')}</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>

            {editing && editing.status === 'open' && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div className="flex-gap" style={{ marginBottom: 12 }}>
                  <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                    disabled={!editing.client_id || !!editing.proposal_id || converting}
                    onClick={() => void handleConvertToProposal()}>
                    {converting ? t('c.saving') : (editing.proposal_id ? t('sp.alreadyConverted') : t('sp.convert'))}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => void markWon(editing.id)}>
                    {t('sp.markWon')}
                  </button>
                </div>
                <div className="field">
                  <label>{t('sp.lostReason')}</label>
                  <textarea value={lostReasonDraft} onChange={e => setLostReasonDraft(e.target.value)} rows={2} placeholder={t('sp.lostReasonPH')} />
                </div>
                <button type="button" className="btn btn-danger btn-sm" disabled={losing} onClick={() => void markLostFromDrawer()}>
                  {losing ? t('c.saving') : t('sp.markLost')}
                </button>
              </div>
            )}

            {editing && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>{t('sp.activities')}</strong>
                <div className="field-row" style={{ marginBottom: 8 }}>
                  <select value={noteType} onChange={e => setNoteType(e.target.value as 'note' | 'call' | 'meeting')} style={{ flex: '0 0 140px' }}>
                    <option value="note">{t('sp.activityNote')}</option>
                    <option value="call">{t('sp.activityCall')}</option>
                    <option value="meeting">{t('sp.activityMeeting')}</option>
                  </select>
                  <input value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder={t('sp.activityPH')} />
                  <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} disabled={logging || !noteDraft.trim()}
                    onClick={() => void handleLogActivity()}>
                    {t('sp.logActivity')}
                  </button>
                </div>
                {activities.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>{t('sp.noActivities')}</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {activities.map(a => (
                      <div key={a.id} style={{ fontSize: 12, borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>
                        <strong>{ACTIVITY_LABELS[a.type] ?? a.type}</strong>
                        {a.description && <span> — {a.description}</span>}
                        <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                          {new Date(a.created_at).toLocaleString('pt-BR')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Drawer.Body>

          <Drawer.Footer>
            <button type="button" className="btn btn-secondary" onClick={closeDrawer}>{t('c.cancel')}</button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
              {saving ? t('c.saving') : t('c.save')}
            </button>
          </Drawer.Footer>
        </form>
      </Drawer>

      {/* Modal simples de configuração de etapas */}
      {configOpen && (
        <div className="overlay" onClick={() => setConfigOpen(false)}>
          <div className="drawer" style={{ width: 'min(480px, 96vw)' }} onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{t('sp.configureStages')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfigOpen(false)}>✕</button>
            </div>
            <div className="drawer-body">
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{t('sp.configureStagesHint')}</p>
              {stages.map(stage => (
                <div key={stage.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13 }}>{stage.name}</span>
                  <Switch checked={stage.is_active} onChange={() => void toggleStageActive(stage)} label={`${stage.name}: ${stage.is_active ? t('comp.modules.disable') : t('comp.modules.enable')}`} />
                </div>
              ))}
              <div className="field-row" style={{ marginTop: 12 }}>
                <input value={newStageName} onChange={e => setNewStageName(e.target.value)} placeholder={t('sp.newStagePH')} />
                <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => void handleCreateStage()}>
                  + {t('sp.addStage')}
                </button>
              </div>
            </div>
            <div className="drawer-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setConfigOpen(false)}>{t('c.close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
