import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n';
import type { TKey } from '../../i18n/pt-BR';
import { Can, usePermissions } from '../../rbac';
import { Drawer, TimeGrid } from '../../ds';
import type { TimeGridColumn, TimeGridBlock } from '../../ds';
import {
  addDaysISO, formatDateBR, todayISO, weekOf, weekdayOf, WEEKDAY_LABELS_SHORT,
} from '../../lib/schedulingTime';
import { visitConflictMessage } from './ServiceOrdersPage';

// Agenda do Técnico (regra 78) — visão de calendário das visitas técnicas,
// no mesmo estilo visual do Agendamento (SchedulingCalendarPage.tsx), mas
// service_visits/technicians continua um domínio próprio: só a camada de
// grade (TimeGrid) é compartilhada, os dados nunca se misturam.

interface TechnicianOption { id: string; name: string; is_active: boolean; }
interface OrderOption { id: string; number: string; title: string; status: string; }
type VisitStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
interface AgendaVisit {
  id:                    string;
  service_order_id:      string;
  service_order_number:  string;
  service_order_title:   string;
  technician_id:          string;
  technician_name:        string;
  client_name:            string | null;
  scheduled_at:           string; // ISO
  ends_at:                string; // ISO
  duration_minutes:       number;
  status:                 VisitStatus;
}

const STATUS_BADGE: Record<VisitStatus, string> = {
  scheduled: 'badge-raw_material', in_progress: 'badge-product',
  completed: 'badge-active', cancelled: 'badge-inactive', no_show: 'badge-cancelled',
};

function pad(n: number) { return String(n).padStart(2, '0'); }
// Agrupamento por dia/hora é sempre no fuso LOCAL do navegador (o técnico e
// o dispatcher enxergam o mesmo relógio de parede) — scheduled_at/ends_at
// chegam em ISO UTC da API.
function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localHm(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DURATIONS = ['30', '60', '90', '120', '180', '240'];

export function ServiceOrdersAgendaPage() {
  const { t } = useI18n();
  const { can } = usePermissions();
  const canAssign = can('service_orders:assign');

  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [mode, setMode]               = useState<'single' | 'all'>('single');
  const [technicianId, setTechnicianId] = useState('');
  const [view, setView]               = useState<'week' | 'day'>('week');
  const [anchor, setAnchor]           = useState(todayISO());
  const [visits, setVisits]           = useState<AgendaVisit[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState('');

  const [detail, setDetail] = useState<AgendaVisit | null>(null);

  const [createOpen, setCreateOpen]         = useState(false);
  const [createOrders, setCreateOrders]     = useState<OrderOption[]>([]);
  const [createOrderId, setCreateOrderId]   = useState('');
  const [createTechId, setCreateTechId]     = useState('');
  const [createDate, setCreateDate]         = useState('');
  const [createTime, setCreateTime]         = useState('');
  const [createDuration, setCreateDuration] = useState('60');
  const [createSaving, setCreateSaving]     = useState(false);
  const [createError, setCreateError]       = useState('');

  const activeTechnicians = useMemo(() => technicians.filter(x => x.is_active), [technicians]);

  // "Todos os técnicos" só faz sentido num único dia por vez — comparar N
  // técnicos numa semana inteira não caberia numa grade legível.
  const effectiveView = mode === 'all' ? 'day' : view;
  const week = weekOf(anchor);
  const from = effectiveView === 'day' ? anchor : week[0];
  const to   = effectiveView === 'day' ? anchor : week[6];

  useEffect(() => {
    api.get<{ data: TechnicianOption[] }>('/v1/technicians?per_page=100')
      .then(r => {
        setTechnicians(r.data);
        const active = r.data.filter(x => x.is_active);
        setTechnicianId(prev => prev || active[0]?.id || '');
      })
      .catch(() => setTechnicians([]));
  }, []);

  // Busca com 1 dia de folga em cada ponta: o backend corta o período em
  // UTC, mas o agrupamento em colunas aqui é no fuso local — a folga evita
  // perder visitas perto da virada do dia por essa diferença. O excedente
  // nunca aparece: o filtro de `blocks` abaixo só desenha o que cai numa
  // coluna realmente visível.
  const loadVisits = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const p = new URLSearchParams({ from: addDaysISO(from, -1), to: addDaysISO(to, 1) });
      if (mode === 'single' && technicianId) p.set('technician_id', technicianId);
      const resp = await api.get<{ data: AgendaVisit[] }>(`/v1/service-orders/visits?${p}`);
      setVisits(resp.data);
    } catch (err) {
      setVisits([]);
      setLoadError(err instanceof Error ? err.message : t('soa.loadError'));
    } finally { setLoading(false); }
  }, [mode, technicianId, from, to, t]);

  useEffect(() => { void loadVisits(); }, [loadVisits]);

  // ── Colunas + blocos ──────────────────────────────────────────────────────

  const columns: TimeGridColumn[] = useMemo(() => {
    if (mode === 'all') {
      return activeTechnicians.map(tc => ({ key: tc.id, label: tc.name }));
    }
    const days = effectiveView === 'day' ? [anchor] : week;
    const today = todayISO();
    return days.map(date => ({
      key: date, label: Number(date.slice(8, 10)),
      sublabel: WEEKDAY_LABELS_SHORT[weekdayOf(date)],
      highlighted: date === today,
    }));
  }, [mode, activeTechnicians, effectiveView, anchor, week]);

  const columnKeys = useMemo(() => new Set(columns.map(c => c.key)), [columns]);

  const blocks: TimeGridBlock[] = useMemo(() => visits
    .filter(v => v.status === 'scheduled' || v.status === 'in_progress' || v.status === 'completed')
    .map(v => ({
      id:          v.id,
      columnKey:   mode === 'all' ? v.technician_id : localDateKey(v.scheduled_at),
      start:       localHm(v.scheduled_at),
      end:         localHm(v.ends_at),
      statusClass: v.status,
      title:       v.client_name ?? v.service_order_title,
      subtitle:    mode === 'all' ? `#${v.service_order_number}` : v.technician_name,
      tooltip:     `${localHm(v.scheduled_at)}–${localHm(v.ends_at)} · ${v.client_name ?? v.service_order_title} · OS ${v.service_order_number}`,
    }))
    .filter(b => columnKeys.has(b.columnKey)),
  [visits, mode, columnKeys]);

  // ── Handlers do grid ──────────────────────────────────────────────────────

  function handleBlockClick(id: string) {
    const v = visits.find(x => x.id === id);
    if (v) setDetail(v);
  }

  function handleSlotClick(columnKey: string, time: string) {
    const date = mode === 'all' ? anchor : columnKey;
    const techId = mode === 'all' ? columnKey : technicianId;
    openCreate(date, time, techId);
  }

  function openCreate(date?: string, time?: string, techId?: string) {
    setCreateError('');
    setCreateOrderId('');
    setCreateTechId(techId || (mode === 'single' ? technicianId : ''));
    setCreateDate(date || anchor);
    setCreateTime(time || '09:00');
    setCreateDuration('60');
    setCreateOpen(true);
    if (createOrders.length === 0) {
      api.get<{ data: OrderOption[] }>('/v1/service-orders?per_page=100')
        .then(r => setCreateOrders(r.data.filter(o => o.status !== 'completed' && o.status !== 'cancelled')))
        .catch(() => setCreateOrders([]));
    }
  }

  async function submitCreate() {
    if (!createOrderId) { setCreateError(t('soa.selectOrder')); return; }
    if (!createTechId)  { setCreateError(t('so.selectTechnician')); return; }
    if (!createDate || !createTime) { setCreateError(t('so.scheduledAt') + ' *'); return; }
    setCreateSaving(true); setCreateError('');
    try {
      await api.post(`/v1/service-orders/${createOrderId}/visits`, {
        technician_id: createTechId,
        scheduled_at: new Date(`${createDate}T${createTime}`).toISOString(),
        duration_minutes: Number(createDuration),
      });
      setCreateOpen(false);
      void loadVisits();
    } catch (err: unknown) {
      const conflict = visitConflictMessage(err);
      setCreateError(conflict ?? (err instanceof Error ? err.message : t('cl.errSave')));
    } finally { setCreateSaving(false); }
  }

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="page-header">
        <h1>{t('soa.title')}</h1>
        <Can permission="service_orders:assign">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={() => openCreate()}>
            {t('soa.newVisit')}
          </button>
        </Can>
      </div>

      <div className="flex-gap" style={{ marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div role="group" aria-label={t('soa.title')} style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {(['single', 'all'] as const).map(m => (
            <button key={m} className="btn btn-sm" style={{
              width: 'auto', border: 'none', borderRadius: 0,
              background: mode === m ? 'var(--primary)' : 'transparent',
              color: mode === m ? '#fff' : undefined,
            }} onClick={() => setMode(m)}>
              {m === 'single' ? t('soa.modeSingle') : t('soa.modeAll')}
            </button>
          ))}
        </div>

        {mode === 'single' && (
          <select value={technicianId} onChange={e => setTechnicianId(e.target.value)}
            style={{ width: 'auto', minWidth: 200 }} aria-label={t('so.technician')}>
            {activeTechnicians.length === 0 && <option value="">{t('soa.noTechnicians')}</option>}
            {activeTechnicians.map(tc => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
          </select>
        )}

        {mode === 'single' && (
          <div role="group" aria-label={t('soa.title')} style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {(['week', 'day'] as const).map(v => (
              <button key={v} className="btn btn-sm" style={{
                width: 'auto', border: 'none', borderRadius: 0,
                background: view === v ? 'var(--primary)' : 'transparent',
                color: view === v ? '#fff' : undefined,
              }} onClick={() => setView(v)}>
                {v === 'week' ? t('soa.viewWeek') : t('soa.viewDay')}
              </button>
            ))}
          </div>
        )}

        <div className="flex-gap" style={{ alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setAnchor(a => addDaysISO(a, effectiveView === 'day' ? -1 : -7))}
            aria-label={effectiveView === 'day' ? t('soa.prevDay') : t('soa.prevWeek')}>‹</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setAnchor(todayISO())}>{t('soa.today')}</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setAnchor(a => addDaysISO(a, effectiveView === 'day' ? 1 : 7))}
            aria-label={effectiveView === 'day' ? t('soa.nextDay') : t('soa.nextWeek')}>›</button>
          <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 4 }}>
            {effectiveView === 'day' ? formatDateBR(anchor) : `${formatDateBR(from)} – ${formatDateBR(to)}`}
          </span>
        </div>
      </div>

      {loadError && (
        <div role="alert" style={{ marginBottom: 12, color: 'var(--danger, #b91c1c)', fontSize: 13 }}>{loadError}</div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        {loading ? (
          <div className="spinner" style={{ margin: '48px auto' }}>{t('c.loading')}</div>
        ) : columns.length === 0 ? (
          <div className="empty-state">{t('soa.noTechnicians')}</div>
        ) : (
          <TimeGrid
            ariaLabel={t('soa.title')}
            columns={columns}
            blocks={blocks}
            onBlockClick={handleBlockClick}
            onSlotClick={canAssign ? handleSlotClick : undefined}
          />
        )}
      </div>

      {/* ── Drawer de detalhe da visita ────────────────────────────────── */}
      <Drawer open={detail !== null} onClose={() => setDetail(null)} title={t('soa.detailTitle')}
        subTitle={detail ? `${localHm(detail.scheduled_at)}–${localHm(detail.ends_at)}` : undefined}>
        {detail && (
          <>
            <div className="drawer-body">
              <div style={{ marginBottom: 14 }}>
                <span className={`badge ${STATUS_BADGE[detail.status]}`}>{t(`so.status.${detail.status}` as TKey)}</span>
              </div>
              <DetailRow label={t('soa.serviceOrder')} value={`${detail.service_order_number} — ${detail.service_order_title}`} />
              <DetailRow label={t('soa.client')} value={detail.client_name ?? '—'} />
              <DetailRow label={t('so.technician')} value={detail.technician_name} />
              <DetailRow label={t('soa.when')} value={`${formatDateBR(localDateKey(detail.scheduled_at))} · ${localHm(detail.scheduled_at)}–${localHm(detail.ends_at)}`} />
            </div>
            <div className="drawer-footer">
              <Link to={`/service-orders?edit=${detail.service_order_id}`} className="btn btn-primary" style={{ width: 'auto', textDecoration: 'none', textAlign: 'center' }}>
                {t('soa.viewServiceOrder')}
              </Link>
            </div>
          </>
        )}
      </Drawer>

      {/* ── Drawer de criação de visita ───────────────────────────────── */}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title={t('soa.createTitle')}>
        <div className="drawer-body">
          {createError && <div className="alert alert-error" role="alert">{createError}</div>}
          <div className="field">
            <label>{t('soa.serviceOrder')}</label>
            <select value={createOrderId} onChange={e => setCreateOrderId(e.target.value)}>
              <option value="">{t('soa.selectOrder')}</option>
              {createOrders.map(o => <option key={o.id} value={o.id}>{o.number} — {o.title}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{t('so.technician')}</label>
            <select value={createTechId} onChange={e => setCreateTechId(e.target.value)}>
              <option value="">{t('so.selectTechnician')}</option>
              {activeTechnicians.map(tc => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label>{t('soa.date')}</label>
              <input type="date" value={createDate} onChange={e => setCreateDate(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('soa.time')}</label>
              <input type="time" value={createTime} onChange={e => setCreateTime(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('so.duration')}</label>
              <select value={createDuration} onChange={e => setCreateDuration(e.target.value)}>
                {DURATIONS.map(d => <option key={d} value={d}>{d} {t('so.durationMinutesSuffix')}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="drawer-footer">
          <button className="btn btn-secondary" onClick={() => setCreateOpen(false)} disabled={createSaving}>{t('c.cancel')}</button>
          <button className="btn btn-primary" style={{ width: 'auto' }} disabled={createSaving} onClick={() => void submitCreate()}>
            {createSaving ? t('c.saving') : t('soa.newVisit')}
          </button>
        </div>
      </Drawer>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
      <span style={{ flex: '0 0 150px', color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}
