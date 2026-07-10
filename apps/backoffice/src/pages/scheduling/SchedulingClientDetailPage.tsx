import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useModal } from '../../contexts/ModalContext';
import { Can } from '../../rbac';
import { Badge, BalanceBar, DataTable, Drawer, Timeline } from '../../ds';
import type { BadgeVariant, Column, TimelineEvent } from '../../ds';
import { formatDateBR } from '../../lib/schedulingTime';
import { SegmentedControl } from '../reports/_shared/ReportShell';
import {
  SessionFormDrawer, SESSION_STATUS_BADGE, SESSION_STATUS_LABEL, conflictMessage,
} from './SessionFormDrawer';
import type { SessionRow } from './SessionFormDrawer';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type PaymentStatus = 'pending' | 'partial' | 'paid';

interface ClientOpt {
  id:           string;
  company_name: string | null;
  full_name:    string | null;
}

interface AreaOpt {
  id:        string;
  name:      string;
  is_active: boolean;
}

interface ClientPackage {
  id:                 string;
  name:               string;
  area_id:            string | null;
  total_sessions:     number;
  used_sessions:      number;
  remaining_sessions: number;
  payment_status:     PaymentStatus;
  status:             string;
  valid_until:        string | null;
  client_name:        string;
}

interface PackageTemplate {
  id:            string;
  name:          string;
  area_id:       string | null;
  session_count: number;
  price:         string | number | null;
  validity_days: number | null;
}

interface PackageMovement {
  direction:     string;
  quantity:      number;
  balance_after: number;
  reason:        string | null;
  created_at:    string;
}

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  pending: 'Pgto. pendente', partial: 'Pgto. parcial', paid: 'Pago',
};
const PAYMENT_BADGE: Record<PaymentStatus, BadgeVariant> = {
  pending: 'pending', partial: 'issued', paid: 'paid',
};

function packageStatusBadge(status: string): { variant: BadgeVariant; label: string } {
  switch (status) {
    case 'active':    return { variant: 'active',    label: 'Ativo' };
    case 'exhausted': return { variant: 'low',       label: 'Esgotado' };
    case 'expired':   return { variant: 'overdue',   label: 'Expirado' };
    case 'canceled':  return { variant: 'cancelled', label: 'Cancelado' };
    default:          return { variant: 'inactive',  label: status };
  }
}

function fmtBRL(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const EMPTY_GRANT = {
  template_id:    '',
  name:           '',
  area_id:        '',
  total_sessions: '10',
  price:          '',
  validity_days:  '',
  notes:          '',
};

// ── Componente ────────────────────────────────────────────────────────────────

export function SchedulingClientDetailPage() {
  const { id } = useParams();
  const clientId = id ?? '';
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const modal = useModal();

  const [clientName, setClientName] = useState('');
  const [areas,      setAreas]      = useState<AreaOpt[]>([]);

  // ── Pacotes ──
  const [packages,        setPackages]        = useState<ClientPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [paymentSavingId, setPaymentSavingId] = useState<string | null>(null);

  // Drawer de movimentos
  const [movementsPkg, setMovementsPkg] = useState<ClientPackage | null>(null);
  const [movements,    setMovements]    = useState<TimelineEvent[] | null>(null);

  // Drawer de concessão
  const [grantOpen,      setGrantOpen]      = useState(false);
  const [grant,          setGrant]          = useState({ ...EMPTY_GRANT });
  const [grantPayment,   setGrantPayment]   = useState<PaymentStatus>('pending');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templates,      setTemplates]      = useState<PackageTemplate[]>([]);
  const [grantError,     setGrantError]     = useState('');
  const [grantSaving,    setGrantSaving]    = useState(false);

  // ── Sessões ──
  const [sessions,        setSessions]        = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [formOpen,        setFormOpen]        = useState(false);
  const [formSession,     setFormSession]     = useState<SessionRow | null>(null);
  const [declineTarget,   setDeclineTarget]   = useState<SessionRow | null>(null);
  const [declineReason,   setDeclineReason]   = useState('');
  const [declineError,    setDeclineError]    = useState('');
  const [acting,          setActing]          = useState(false);

  // ── Portal ──
  const [portalOpen,   setPortalOpen]   = useState(false);
  const [portalForm,   setPortalForm]   = useState({ email: '', password: '', name: '' });
  const [portalError,  setPortalError]  = useState('');
  const [portalSaving, setPortalSaving] = useState(false);

  // ── Carregamento ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!tenantId || !clientId) return;
    const p = new URLSearchParams({ tenant_id: tenantId, page: '1', per_page: '100' });
    api.get<{ data: ClientOpt[] }>(`/v1/clients?${p}`)
      .then(r => {
        const c = r.data.find(x => x.id === clientId);
        if (c) setClientName(c.company_name ?? c.full_name ?? '');
      })
      .catch(() => { /**/ });
  }, [tenantId, clientId]);

  useEffect(() => {
    api.get<{ data: AreaOpt[] }>('/v1/scheduling/areas?include_inactive=true')
      .then(r => setAreas(r.data))
      .catch(() => setAreas([]));
  }, []);

  const loadPackages = useCallback(async () => {
    if (!clientId) return;
    setPackagesLoading(true);
    try {
      const resp = await api.get<{ data: ClientPackage[] }>(`/v1/scheduling/client-packages?client_id=${clientId}`);
      setPackages(resp.data);
      // Fallback do nome do cliente quando ele não está na 1ª página da lista.
      if (resp.data.length > 0) setClientName(prev => prev || resp.data[0].client_name);
    } catch { /**/ } finally { setPackagesLoading(false); }
  }, [clientId]);

  const loadSessions = useCallback(async () => {
    if (!clientId) return;
    setSessionsLoading(true);
    try {
      const resp = await api.get<{ data: SessionRow[] }>(`/v1/scheduling/sessions?client_id=${clientId}&per_page=100`);
      setSessions(resp.data);
      if (resp.data.length > 0) setClientName(prev => prev || resp.data[0].client_name);
    } catch { /**/ } finally { setSessionsLoading(false); }
  }, [clientId]);

  useEffect(() => { void loadPackages(); }, [loadPackages]);
  useEffect(() => { void loadSessions(); }, [loadSessions]);

  // Movimentos do pacote selecionado → Timeline
  useEffect(() => {
    if (!movementsPkg) { setMovements(null); return; }
    api.get<{ data: PackageMovement[] }>(`/v1/scheduling/client-packages/${movementsPkg.id}/movements`)
      .then(r => setMovements(r.data.map(m => ({
        event_type: `${m.direction === 'credit' ? 'Crédito' : 'Débito'} de ${m.quantity} ${m.quantity === 1 ? 'sessão' : 'sessões'} · saldo ${m.balance_after}${m.reason ? ` — ${m.reason}` : ''}`,
        status_code: null,
        protocol:    null,
        created_at:  m.created_at,
      }))))
      .catch(() => setMovements([]));
  }, [movementsPkg]);

  const areaName = useMemo(() => new Map(areas.map(a => [a.id, a.name])), [areas]);
  const activeAreas = useMemo(() => areas.filter(a => a.is_active), [areas]);

  // ── Ações de pacote ──────────────────────────────────────────────────────

  async function setPayment(pkg: ClientPackage, ps: PaymentStatus) {
    if (pkg.payment_status === ps || paymentSavingId) return;
    setPaymentSavingId(pkg.id);
    try {
      await api.post(`/v1/scheduling/client-packages/${pkg.id}/payment-status`, { payment_status: ps });
      void loadPackages();
    } catch (err: unknown) { modal.error(err); } finally { setPaymentSavingId(null); }
  }

  async function cancelPackage(pkg: ClientPackage) {
    const ok = await modal.confirm({
      title:        'Cancelar pacote',
      message:      `Cancelar o pacote "${pkg.name}"? O saldo restante (${pkg.remaining_sessions}) deixa de valer para novas sessões.`,
      confirmLabel: 'Cancelar pacote',
      danger:       true,
    });
    if (!ok) return;
    try {
      await api.post(`/v1/scheduling/client-packages/${pkg.id}/cancel`, {});
      void loadPackages();
    } catch (err: unknown) { modal.error(err); }
  }

  // ── Concessão de pacote ──────────────────────────────────────────────────

  function openGrant() {
    setGrant({ ...EMPTY_GRANT });
    setGrantPayment('pending');
    setSaveAsTemplate(false);
    setGrantError('');
    setGrantOpen(true);
    api.get<{ data: PackageTemplate[] }>('/v1/scheduling/package-templates')
      .then(r => setTemplates(r.data))
      .catch(() => setTemplates([]));
  }

  function setG(field: keyof typeof EMPTY_GRANT) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setGrant(g => ({ ...g, [field]: e.target.value }));
  }

  function pickTemplate(e: React.ChangeEvent<HTMLSelectElement>) {
    const templateId = e.target.value;
    const tpl = templates.find(t => t.id === templateId);
    if (!tpl) { setGrant(g => ({ ...g, template_id: '' })); return; }
    // Pré-preenche a partir do modelo e mantém tudo editável.
    setGrant({
      template_id:    tpl.id,
      name:           tpl.name,
      area_id:        tpl.area_id ?? '',
      total_sessions: String(tpl.session_count),
      price:          tpl.price !== null ? String(tpl.price) : '',
      validity_days:  tpl.validity_days !== null ? String(tpl.validity_days) : '',
      notes:          '',
    });
    setSaveAsTemplate(false);
  }

  async function handleGrant(e: FormEvent) {
    e.preventDefault();
    setGrantError('');

    const total = parseInt(grant.total_sessions, 10);
    if (!grant.name.trim())                       { setGrantError('Informe o nome do pacote.'); return; }
    if (!Number.isInteger(total) || total < 1)    { setGrantError('O total de sessões deve ser de pelo menos 1.'); return; }

    setGrantSaving(true);
    try {
      await api.post('/v1/scheduling/client-packages', {
        client_id:        clientId,
        template_id:      grant.template_id || undefined,
        name:             grant.name.trim(),
        area_id:          grant.area_id || undefined,
        total_sessions:   total,
        price:            grant.price !== '' ? Number(grant.price) : undefined,
        validity_days:    grant.validity_days !== '' ? parseInt(grant.validity_days, 10) : undefined,
        payment_status:   grantPayment,
        notes:            grant.notes.trim() || undefined,
        save_as_template: (!grant.template_id && saveAsTemplate) || undefined,
      });
      setGrantOpen(false);
      void loadPackages();
    } catch (err: unknown) {
      setGrantError(err instanceof Error ? err.message : 'Erro ao conceder o pacote.');
    } finally { setGrantSaving(false); }
  }

  // ── Ações de sessão ──────────────────────────────────────────────────────

  async function runSessionAction(fn: () => Promise<unknown>, conflictPrefix?: string) {
    setActing(true);
    try {
      await fn();
      void loadSessions();
      void loadPackages(); // concluir/cancelar mexe no saldo do pacote
    } catch (err: unknown) {
      const conflict = conflictMessage(err);
      if (conflict) modal.error(new Error(`${conflictPrefix ?? 'Não foi possível concluir a ação.'} ${conflict}`));
      else modal.error(err);
    } finally { setActing(false); }
  }

  function approveSession(s: SessionRow) {
    void runSessionAction(
      () => api.post(`/v1/scheduling/sessions/${s.id}/approve`, {}),
      'Não foi possível aprovar.',
    );
  }

  async function declineSession() {
    if (!declineTarget) return;
    if (!declineReason.trim()) { setDeclineError('Informe o motivo da recusa — o cliente verá esta mensagem.'); return; }
    await runSessionAction(() =>
      api.post(`/v1/scheduling/sessions/${declineTarget.id}/decline`, { reason: declineReason.trim() }));
    setDeclineTarget(null);
  }

  async function completeSession(s: SessionRow) {
    const ok = await modal.confirm({
      title:        'Concluir sessão',
      message:      s.package_id
        ? 'Concluir esta sessão? 1 sessão será debitada do saldo do pacote.'
        : 'Marcar esta sessão como concluída?',
      confirmLabel: 'Concluir',
    });
    if (!ok) return;
    void runSessionAction(() => api.post(`/v1/scheduling/sessions/${s.id}/complete`, {}));
  }

  async function cancelSession(s: SessionRow) {
    const ok = await modal.confirm({
      title:        'Cancelar sessão',
      message:      `Cancelar a sessão de ${formatDateBR(s.date)} às ${s.start_time}? O horário volta a ficar livre.`,
      confirmLabel: 'Cancelar sessão',
      danger:       true,
    });
    if (!ok) return;
    void runSessionAction(() => api.post(`/v1/scheduling/sessions/${s.id}/cancel`, {}));
  }

  async function deleteSession(s: SessionRow) {
    const ok = await modal.confirm({
      title:        'Excluir sessão',
      message:      'Excluir definitivamente esta sessão? Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      danger:       true,
    });
    if (!ok) return;
    void runSessionAction(() => api.delete(`/v1/scheduling/sessions/${s.id}`));
  }

  // ── Portal ───────────────────────────────────────────────────────────────

  async function handlePortal(e: FormEvent) {
    e.preventDefault();
    setPortalError('');
    if (!portalForm.email.includes('@'))   { setPortalError('Informe um e-mail válido.'); return; }
    if (portalForm.password.length < 8)    { setPortalError('A senha deve ter pelo menos 8 caracteres.'); return; }

    setPortalSaving(true);
    try {
      await api.post(`/v1/clients/${clientId}/portal-user`, {
        email:    portalForm.email.trim(),
        password: portalForm.password,
        ...(portalForm.name.trim() ? { name: portalForm.name.trim() } : {}),
      });
      setPortalOpen(false);
      modal.success('Acesso ao portal criado. Compartilhe o e-mail e a senha com o cliente.');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        setPortalError('Este e-mail já está em uso por outro usuário.');
      } else {
        setPortalError(err instanceof Error ? err.message : 'Erro ao criar o acesso.');
      }
    } finally { setPortalSaving(false); }
  }

  // ── Colunas da tabela de sessões ─────────────────────────────────────────

  const sessionColumns: Column<SessionRow>[] = [
    { key: 'date',   header: 'Data',    render: s => formatDateBR(s.date) },
    { key: 'time',   header: 'Horário', render: s => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.start_time}–{s.end_time}</span> },
    { key: 'area',   header: 'Área',    render: s => areaName.get(s.area_id) ?? '—' },
    {
      key: 'status', header: 'Status',
      render: s => <Badge variant={SESSION_STATUS_BADGE[s.status]}>{SESSION_STATUS_LABEL[s.status]}</Badge>,
    },
    {
      key: 'actions', header: '',
      render: s => (
        <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
          {s.status === 'pending' && (
            <Can permission="scheduling:manage">
              <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={acting}
                onClick={() => approveSession(s)}>Aprovar</button>
              <button className="btn btn-danger btn-sm" disabled={acting}
                onClick={() => { setDeclineTarget(s); setDeclineReason(''); setDeclineError(''); }}>Recusar</button>
            </Can>
          )}
          {s.status === 'confirmed' && (
            <>
              <Can permission="scheduling:complete">
                <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={acting}
                  onClick={() => void completeSession(s)}>Concluir</button>
              </Can>
              <Can permission="scheduling:manage">
                <button className="btn btn-secondary btn-sm" disabled={acting}
                  onClick={() => { setFormSession(s); setFormOpen(true); }}>Editar</button>
                <button className="btn btn-secondary btn-sm" disabled={acting}
                  onClick={() => void cancelSession(s)}>Cancelar</button>
                <button className="btn btn-danger btn-sm" disabled={acting}
                  onClick={() => void deleteSession(s)}>Excluir</button>
              </Can>
            </>
          )}
          {(s.status === 'canceled' || s.status === 'declined') && (
            <Can permission="scheduling:manage">
              <button className="btn btn-danger btn-sm" disabled={acting}
                onClick={() => void deleteSession(s)}>Excluir</button>
            </Can>
          )}
          {s.status === 'completed' && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Imutável</span>
          )}
        </div>
      ),
    },
  ];

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <button className="btn btn-secondary btn-sm" style={{ marginBottom: 8 }} onClick={() => navigate(-1)}>
            ← Voltar
          </button>
          <h1 style={{ margin: 0 }}>{clientName || 'Cliente'}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>Agendamento · ficha do cliente</p>
        </div>
        <Can permission="scheduling:manage">
          <button className="btn btn-primary btn-cta" style={{ width: 'auto' }}
            onClick={() => { setFormSession(null); setFormOpen(true); }}>
            + Agendar sessão
          </button>
        </Can>
      </div>

      {/* ── Pacotes ──────────────────────────────────────────────────── */}
      <SectionHeader
        title="Pacotes"
        action={(
          <Can permission="scheduling_packages:grant">
            <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={openGrant}>
              + Conceder pacote
            </button>
          </Can>
        )}
      />
      {packagesLoading ? (
        <div className="card"><div className="spinner" style={{ margin: '32px auto' }}>Carregando…</div></div>
      ) : packages.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            Nenhum pacote concedido a este cliente.{' '}
            <Can permission="scheduling_packages:grant">
              <button className="btn btn-secondary btn-sm" onClick={openGrant}>Conceder o primeiro</button>
            </Can>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {packages.map(pkg => {
            const st = packageStatusBadge(pkg.status);
            return (
              <div key={pkg.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <strong style={{ flex: 1, fontSize: 14 }}>{pkg.name}</strong>
                  <Badge variant={PAYMENT_BADGE[pkg.payment_status] ?? 'pending'}>
                    {PAYMENT_LABEL[pkg.payment_status] ?? pkg.payment_status}
                  </Badge>
                  <Badge variant={st.variant}>{st.label}</Badge>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                  {pkg.area_id ? (areaName.get(pkg.area_id) ?? '—') : 'Qualquer área'}
                  {' · '}
                  {pkg.valid_until ? `válido até ${formatDateBR(pkg.valid_until)}` : 'sem prazo de validade'}
                </div>

                <BalanceBar total={pkg.total_sessions} used={pkg.used_sessions} />

                <Can permission="scheduling_packages:payment">
                  <div style={{ margin: '12px 0 0' }}>
                    <SegmentedControl<PaymentStatus>
                      value={pkg.payment_status}
                      onChange={ps => void setPayment(pkg, ps)}
                      options={[
                        { value: 'pending', label: 'Pendente' },
                        { value: 'partial', label: 'Parcial' },
                        { value: 'paid',    label: 'Pago' },
                      ]}
                    />
                  </div>
                </Can>

                <div className="flex-gap" style={{ marginTop: 12 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setMovementsPkg(pkg)}>
                    Movimentos
                  </button>
                  {pkg.status === 'active' && (
                    <Can permission="scheduling_packages:manage">
                      <button className="btn btn-danger btn-sm" onClick={() => void cancelPackage(pkg)}>
                        Cancelar
                      </button>
                    </Can>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Sessões ──────────────────────────────────────────────────── */}
      <SectionHeader title="Sessões" />
      <div className="card">
        <DataTable<SessionRow>
          columns={sessionColumns}
          rows={sessions}
          loading={sessionsLoading}
          emptyState="Nenhuma sessão registrada para este cliente."
        />
      </div>

      {/* ── Acesso ao portal ─────────────────────────────────────────── */}
      <SectionHeader title="Acesso ao portal" />
      <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <p style={{ flex: 1, margin: 0, fontSize: 13, color: 'var(--muted)', minWidth: 220 }}>
          Crie um login para o cliente solicitar e acompanhar as próprias sessões no portal de agendamento.
        </p>
        <Can permission="clients:edit">
          <button className="btn btn-secondary" style={{ width: 'auto' }}
            onClick={() => { setPortalForm({ email: '', password: '', name: '' }); setPortalError(''); setPortalOpen(true); }}>
            Conceder acesso
          </button>
        </Can>
      </div>

      {/* ── Drawer: movimentos do pacote ─────────────────────────────── */}
      <Drawer
        open={movementsPkg !== null}
        onClose={() => setMovementsPkg(null)}
        title="Movimentos do pacote"
        subTitle={movementsPkg?.name}
      >
        <Drawer.Body>
          {movements === null
            ? <div className="spinner" style={{ margin: '32px auto' }}>Carregando…</div>
            : <Timeline events={movements} />}
        </Drawer.Body>
        <Drawer.Footer>
          <button className="btn btn-secondary" onClick={() => setMovementsPkg(null)}>Fechar</button>
        </Drawer.Footer>
      </Drawer>

      {/* ── Drawer: conceder pacote ──────────────────────────────────── */}
      <Drawer open={grantOpen} onClose={() => setGrantOpen(false)} title="Conceder pacote" subTitle={clientName || undefined}>
        <form onSubmit={handleGrant} noValidate style={{ display: 'contents' }}>
          <div className="drawer-body">
            {grantError && <div className="alert alert-error" role="alert">{grantError}</div>}

            <div className="field">
              <label>Modelo</label>
              <select value={grant.template_id} onChange={pickTemplate}>
                <option value="">Personalizado (avulso)</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                O modelo pré-preenche os campos abaixo — tudo continua editável.
              </span>
            </div>

            <div className="field">
              <label>Nome do pacote *</label>
              <input value={grant.name} onChange={setG('name')} required placeholder="Ex.: 10 sessões de fisioterapia" />
            </div>

            <div className="field-row">
              <div className="field">
                <label>Área</label>
                <select value={grant.area_id} onChange={setG('area_id')}>
                  <option value="">Qualquer área</option>
                  {activeAreas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Total de sessões *</label>
                <input type="number" min={1} value={grant.total_sessions} onChange={setG('total_sessions')} required />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>Valor (R$)</label>
                <input type="number" min={0} step="0.01" value={grant.price} onChange={setG('price')} placeholder="0,00" />
                {grant.price !== '' && !Number.isNaN(Number(grant.price)) && (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtBRL(grant.price)}</span>
                )}
              </div>
              <div className="field">
                <label>Validade (dias)</label>
                <input type="number" min={1} value={grant.validity_days} onChange={setG('validity_days')}
                  placeholder="Sem prazo" />
              </div>
            </div>

            <div className="field">
              <label>Pagamento</label>
              <div>
                <SegmentedControl<PaymentStatus>
                  value={grantPayment}
                  onChange={setGrantPayment}
                  options={[
                    { value: 'pending', label: 'Pendente' },
                    { value: 'partial', label: 'Parcial' },
                    { value: 'paid',    label: 'Pago' },
                  ]}
                />
              </div>
            </div>

            <div className="field">
              <label>Observações</label>
              <textarea value={grant.notes} onChange={setG('notes')} rows={2} />
            </div>

            {!grant.template_id && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={saveAsTemplate}
                  onChange={e => setSaveAsTemplate(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
                Salvar como modelo para reutilizar com outros clientes
              </label>
            )}
          </div>

          <div className="drawer-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setGrantOpen(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={grantSaving}>
              {grantSaving ? 'Salvando…' : 'Conceder pacote'}
            </button>
          </div>
        </form>
      </Drawer>

      {/* ── Drawer: recusar sessão ───────────────────────────────────── */}
      <Drawer
        open={declineTarget !== null}
        onClose={() => setDeclineTarget(null)}
        title="Recusar sessão"
        subTitle={declineTarget ? `${formatDateBR(declineTarget.date)} · ${declineTarget.start_time}–${declineTarget.end_time}` : undefined}
      >
        <Drawer.Body>
          {declineError && <div className="alert alert-error" role="alert">{declineError}</div>}
          <div className="field">
            <label>Motivo da recusa *</label>
            <textarea value={declineReason} rows={4} autoFocus
              onChange={e => setDeclineReason(e.target.value)}
              placeholder="Ex.: horário indisponível — sugerimos outro dia" />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              O motivo é obrigatório e será exibido ao cliente.
            </span>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <button className="btn btn-secondary" onClick={() => setDeclineTarget(null)} disabled={acting}>
            Voltar
          </button>
          <button className="btn btn-danger" style={{ width: 'auto' }} disabled={acting}
            onClick={() => void declineSession()}>
            {acting ? 'Recusando…' : 'Confirmar recusa'}
          </button>
        </Drawer.Footer>
      </Drawer>

      {/* ── Drawer: acesso ao portal ─────────────────────────────────── */}
      <Drawer open={portalOpen} onClose={() => setPortalOpen(false)} title="Conceder acesso ao portal"
        subTitle={clientName || undefined}>
        <form onSubmit={handlePortal} noValidate style={{ display: 'contents' }}>
          <div className="drawer-body">
            {portalError && <div className="alert alert-error" role="alert">{portalError}</div>}

            <div className="field">
              <label>E-mail *</label>
              <input type="email" value={portalForm.email} required
                onChange={e => setPortalForm(f => ({ ...f, email: e.target.value }))}
                placeholder="cliente@email.com" />
            </div>
            <div className="field">
              <label>Senha *</label>
              <input type="password" value={portalForm.password} required minLength={8}
                onChange={e => setPortalForm(f => ({ ...f, password: e.target.value }))} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Mínimo de 8 caracteres.</span>
            </div>
            <div className="field">
              <label>Nome de exibição</label>
              <input value={portalForm.name}
                onChange={e => setPortalForm(f => ({ ...f, name: e.target.value }))}
                placeholder={clientName || 'Opcional'} />
            </div>
          </div>

          <div className="drawer-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setPortalOpen(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={portalSaving}>
              {portalSaving ? 'Criando…' : 'Criar acesso'}
            </button>
          </div>
        </form>
      </Drawer>

      {/* ── Drawer: agendar/editar sessão ────────────────────────────── */}
      <SessionFormDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => { void loadSessions(); void loadPackages(); }}
        initial={{ client_id: clientId }}
        session={formSession}
      />
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, margin: '26px 0 12px',
    }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
      {action}
    </div>
  );
}
