import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n';
import type { TKey } from '../../i18n/pt-BR';
import { usePermissions } from '../../rbac';
import { Switch } from '../../ds/components/Switch';
import { DataTable, type Column } from '../../ds/components/DataTable';
import { Badge } from '../../ds/components/Badge';

// WhatsApp — Cobranças e Notificações: conexão da conta, checklist de
// configuração, automações/templates/mensagens e o manual embutido, tudo
// consolidado aqui em Minha Empresa > Integrações (regra 83). Antes vivia
// espalhado entre esta seção (só a conexão) e uma tela própria em /whatsapp
// (menu Comercial) — credenciais sensíveis do tenant não deveriam morar num
// item de navegação solto; agora é um único lugar, junto do resto das
// integrações. Nenhuma rota/endpoint de backend mudou — só onde a tela mora.

interface WhatsAppAccount {
  id: string; provider: string; whatsapp_number: string | null; display_name: string | null;
  status: 'pending' | 'connected' | 'disconnected';
}

interface Automation {
  template_key: string;
  enabled: boolean;
  config: { days_before?: number; days_after?: number };
  last_attempt_status: 'sent' | 'skipped' | null;
  last_skip_reason: string | null;
}

interface TemplateView {
  template_key: string;
  variables: string[];
  body_preview: string;
  provider_template_id: string | null;
  status: 'pending_approval' | 'approved' | 'rejected';
}

interface WhatsAppMessage {
  id: string;
  template_key: string;
  phone_e164: string;
  status: string;
  status_reason: string | null;
  client_name: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, 'active' | 'inactive' | 'service'> = {
  queued: 'service', sent: 'service', delivered: 'active', read: 'active',
  failed: 'inactive', undelivered: 'inactive',
};

function templateLabel(t: (k: TKey) => string, key: string): string {
  return t(`wa.template.${key}` as TKey);
}

export function WhatsAppSettingsCard() {
  const { can } = usePermissions();
  const [moduleEnabled, setModuleEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const mods = await api.get<{ enabled: string[] }>('/v1/tenant/modules');
        setModuleEnabled((mods.enabled ?? []).includes('whatsapp'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Sem a permissão o backend recusaria de qualquer forma (403) — esconder a
  // seção é só UX; a autoridade é sempre o requirePermission de cada rota
  // /v1/whatsapp/* (mesmo padrão de EngineKeysCard/LeadCaptureKeysCard).
  if (!can('whatsapp:view')) return null;
  if (!loading && !moduleEnabled) return null;
  if (loading) return null;

  return <WhatsAppSettingsBody canManage={can('whatsapp:manage')} />;
}

function WhatsAppSettingsBody({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [account, setAccount] = useState<WhatsAppAccount | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [tab, setTab] = useState<'automations' | 'templates' | 'messages'>('automations');
  const [manualOpen, setManualOpen] = useState(false);

  async function loadOverview() {
    const [acc, autoResp, tplResp] = await Promise.all([
      api.get<WhatsAppAccount | null>('/v1/whatsapp/account'),
      api.get<{ data: Automation[] }>('/v1/whatsapp/automations'),
      api.get<{ data: TemplateView[] }>('/v1/whatsapp/templates'),
    ]);
    setAccount(acc);
    setAutomations(autoResp.data);
    setTemplates(tplResp.data);
  }
  useEffect(() => { void loadOverview(); }, []);

  const connected = account?.status === 'connected';
  const approvedCount = templates.filter(tpl => tpl.status === 'approved').length;
  const activeCount = automations.filter(a => a.enabled).length;
  const strugglingCount = automations.filter(a => a.enabled && a.last_attempt_status === 'skipped').length;

  return (
    <div className="card" style={{ padding: 20, marginTop: 24 }}>
      <strong>{t('comp.whatsapp.title')}</strong>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 16px' }}>{t('comp.whatsapp.subtitle')}</p>

      <ChecklistCard
        connected={connected} approvedCount={approvedCount} totalTemplates={templates.length || 5}
        activeCount={activeCount} strugglingCount={strugglingCount}
      />

      <WhatsAppConnectionForm account={account} canManage={canManage} onChanged={acc => setAccount(acc)} />

      <div style={{ display: 'flex', gap: 6, margin: '20px 0 16px', borderBottom: '1px solid var(--border)' }}>
        {(['automations', 'templates', 'messages'] as const).map(key => (
          <button key={key} type="button"
            onClick={() => setTab(key)}
            style={{
              padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 500,
              borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent',
              color: tab === key ? 'var(--primary)' : 'var(--muted)',
            }}>
            {key === 'automations' ? t('wa.tabAutomations') : key === 'templates' ? t('wa.tabTemplates') : t('wa.tabMessages')}
          </button>
        ))}
      </div>

      {tab === 'automations' && <AutomationsTab items={automations} canManage={canManage} onChanged={() => void loadOverview()} />}
      {tab === 'templates'   && <TemplatesTab items={templates} canManage={canManage} onChanged={() => void loadOverview()} />}
      {tab === 'messages'    && <MessagesTab />}

      <WhatsAppManual open={manualOpen} onToggle={() => setManualOpen(o => !o)} />
    </div>
  );
}

// ── Checklist de configuração (UX inovadora — regra 83) ─────────────────────
// Antes: nada dizia por que uma automação ligada não estava disparando. Estes
// 3 passos + o aviso de "precisa de atenção" tornam o estado real (conta
// conectada? templates aprovados? alguma automação ativa travando?) visível
// de cara, sem precisar abrir cada aba pra descobrir.
function ChecklistCard({ connected, approvedCount, totalTemplates, activeCount, strugglingCount }: {
  connected: boolean; approvedCount: number; totalTemplates: number; activeCount: number; strugglingCount: number;
}) {
  const { t } = useI18n();
  return (
    <div className="card" style={{ padding: 16, background: 'var(--surface-2)', marginBottom: 16 }}>
      <strong style={{ fontSize: 13 }}>{t('wa.checklist.title')}</strong>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('wa.checklist.step1')}</span>
          <Badge variant={connected ? 'active' : 'inactive'}>
            {connected ? t('wa.checklist.connected') : t('wa.checklist.notConnected')}
          </Badge>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('wa.checklist.step2')}</span>
          <Badge variant={approvedCount === totalTemplates ? 'active' : 'service'}>
            {approvedCount} {t('c.of')} {totalTemplates} {t('wa.checklist.approved')}
          </Badge>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('wa.checklist.step3')}</span>
          <Badge variant={activeCount > 0 ? 'active' : 'service'}>
            {activeCount} {t('c.of')} 5 {t('wa.checklist.active')}
          </Badge>
        </div>
      </div>

      {strugglingCount > 0 && (
        <div role="alert" className="alert alert-error" style={{ marginTop: 12, fontSize: 13 }}>
          <strong>{t('wa.checklist.attentionTitle')}:</strong> {strugglingCount} {t('wa.checklist.attentionBody')}
        </div>
      )}
    </div>
  );
}

// ── Manual embutido (colapsável) ─────────────────────────────────────────────
function WhatsAppManual({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const steps = [1, 2, 3, 4, 5] as const;
  return (
    <div className="card" style={{ padding: 16, marginTop: 20 }}>
      <button type="button" onClick={onToggle}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> <span>{t('wa.manual.toggle')}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {steps.map(n => (
            <div key={n}>
              <strong style={{ fontSize: 13 }}>{t(`wa.manual.step${n}Title` as TKey)}</strong>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '2px 0 0' }}>{t(`wa.manual.step${n}Body` as TKey)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Conexão da conta Twilio ───────────────────────────────────────────────────
function WhatsAppConnectionForm({ account, canManage, onChanged }: {
  account: WhatsAppAccount | null; canManage: boolean; onChanged: (acc: WhatsAppAccount | null) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ whatsapp_number: '', account_sid: '', auth_token: '' });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; reason?: string } | null>(null);

  useEffect(() => {
    if (account) setForm(f => ({ ...f, whatsapp_number: account.whatsapp_number ?? '' }));
  }, [account]);

  const connected = account?.status === 'connected';

  async function handleConnect() {
    setSaving(true); setError('');
    try {
      const acc = await api.patch<WhatsAppAccount>('/v1/whatsapp/account', form);
      onChanged(acc);
      setForm(f => ({ ...f, account_sid: '', auth_token: '' }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('comp.whatsapp.errSave'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setSaving(true); setError('');
    try {
      await api.delete('/v1/whatsapp/account');
      onChanged(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('comp.whatsapp.errSave'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true); setTestResult(null);
    try {
      const res = await api.post<{ ok: boolean; reason?: string }>('/v1/whatsapp/account/test', {});
      setTestResult(res);
    } catch (err: unknown) {
      setTestResult({ ok: false, reason: err instanceof Error ? err.message : t('comp.whatsapp.testFailed') });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span className={`badge ${connected ? 'badge-active' : 'badge-inactive'}`}>
          {connected ? t('comp.integrations.connected') : t('comp.integrations.disconnected')}
        </span>
      </div>

      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {testResult && (
        <div role="alert" className={`alert ${testResult.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16 }}>
          {testResult.ok ? t('comp.whatsapp.testOk') : (testResult.reason || t('comp.whatsapp.testFailed'))}
        </div>
      )}

      <div className="field">
        <label>{t('comp.whatsapp.number')}</label>
        <input value={form.whatsapp_number} placeholder="+5511999999999" disabled={!canManage}
          onChange={e => setForm(f => ({ ...f, whatsapp_number: e.target.value }))} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>{t('comp.whatsapp.accountSid')}</label>
          <input value={form.account_sid} disabled={!canManage}
            placeholder={connected ? '••••••••' : 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
            onChange={e => setForm(f => ({ ...f, account_sid: e.target.value }))} />
        </div>
        <div className="field">
          <label>{t('comp.whatsapp.authToken')}</label>
          <input type="password" value={form.auth_token} disabled={!canManage}
            placeholder={connected ? '••••••••' : ''}
            onChange={e => setForm(f => ({ ...f, auth_token: e.target.value }))} />
        </div>
      </div>

      {canManage && (
        <div className="flex-gap" style={{ marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={saving} onClick={() => void handleConnect()}>
            {saving ? t('c.saving') : connected ? t('comp.whatsapp.update') : t('comp.integrations.connect')}
          </button>
          {connected && (
            <>
              <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} disabled={testing} onClick={() => void handleTestConnection()}>
                {testing ? t('comp.whatsapp.testing') : t('comp.whatsapp.test')}
              </button>
              <button className="btn btn-danger btn-sm" style={{ width: 'auto' }} disabled={saving} onClick={() => void handleDisconnect()}>
                {t('comp.integrations.disconnect')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Automações ────────────────────────────────────────────────────────────────
// Cada card agora mostra o resultado da ÚLTIMA tentativa real de disparo
// (last_attempt_status/last_skip_reason, migration 0093) — antes disso, uma
// automação "ligada" que nunca conseguia enviar (conta não conectada, template
// não aprovado etc.) não dava nenhum sinal disso na tela.
function AutomationsTab({ items, canManage, onChanged }: {
  items: Automation[]; canManage: boolean; onChanged: () => void;
}) {
  const { t } = useI18n();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function toggle(a: Automation) {
    setBusyKey(a.template_key); setError('');
    try {
      const config = a.template_key === 'invoice_due_soon' ? { days_before: a.config.days_before ?? 3 }
        : a.template_key === 'invoice_overdue' ? { days_after: a.config.days_after ?? 3 } : {};
      await api.patch(`/v1/whatsapp/automations/${a.template_key}`, { enabled: !a.enabled, config });
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('wa.errSave'));
    } finally { setBusyKey(null); }
  }

  async function updateDays(a: Automation, field: 'days_before' | 'days_after', value: number) {
    setBusyKey(a.template_key); setError('');
    try {
      await api.patch(`/v1/whatsapp/automations/${a.template_key}`, { enabled: a.enabled, config: { [field]: value } });
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('wa.errSave'));
    } finally { setBusyKey(null); }
  }

  return (
    <div>
      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      <div className="modules-grid">
        {items.map(a => (
          <div key={a.template_key} className={`module-card${a.enabled ? ' module-card--on' : ''}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div>
                <strong>{templateLabel(t, a.template_key)}</strong>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>{t(`wa.templateDesc.${a.template_key}` as TKey)}</p>
                {a.template_key === 'invoice_due_soon' && (
                  <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {t('wa.daysBefore')}
                    <input type="number" min={1} max={30} style={{ width: 60 }} disabled={!canManage}
                      value={a.config.days_before ?? 3}
                      onChange={e => void updateDays(a, 'days_before', Number(e.target.value))} />
                  </div>
                )}
                {a.template_key === 'invoice_overdue' && (
                  <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {t('wa.daysAfter')}
                    <input type="number" min={1} max={90} style={{ width: 60 }} disabled={!canManage}
                      value={a.config.days_after ?? 3}
                      onChange={e => void updateDays(a, 'days_after', Number(e.target.value))} />
                  </div>
                )}
                {a.enabled && (
                  <p style={{ fontSize: 12, marginTop: 8, color: a.last_attempt_status === 'skipped' ? 'var(--danger, #c0392b)' : 'var(--muted)' }}>
                    {a.last_attempt_status === 'sent' ? t('wa.lastAttempt.sent')
                      : a.last_attempt_status === 'skipped' ? `${t('wa.lastAttempt.skippedPrefix')} ${t(`wa.skipReason.${a.last_skip_reason ?? 'unknown_error'}` as TKey)}`
                      : t('wa.lastAttempt.never')}
                  </p>
                )}
              </div>
              <Switch checked={a.enabled} disabled={busyKey === a.template_key || !canManage} onChange={() => void toggle(a)}
                label={`${templateLabel(t, a.template_key)}: ${a.enabled ? t('comp.modules.disable') : t('comp.modules.enable')}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────
function TemplatesTab({ items, canManage, onChanged }: {
  items: TemplateView[]; canManage: boolean; onChanged: () => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function saveSid(key: string) {
    const sid = drafts[key]?.trim();
    if (!sid) return;
    setSaving(key); setError('');
    try {
      await api.patch(`/v1/whatsapp/templates/${key}`, { provider_template_id: sid });
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('wa.errSave'));
    } finally { setSaving(null); }
  }

  return (
    <div>
      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{t('wa.templatesHint')}</p>
      {items.map(tpl => (
        <div key={tpl.template_key} className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>{templateLabel(t, tpl.template_key)}</strong>
            <span className={`badge ${tpl.status === 'approved' ? 'badge-active' : tpl.status === 'rejected' ? 'badge-inactive' : 'badge-service'}`}>
              {t(`wa.templateStatus.${tpl.status}` as TKey)}
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-line', marginBottom: 12 }}>{tpl.body_preview}</p>
          <div className="field-row" style={{ alignItems: 'flex-end' }}>
            <div className="field">
              <label>{t('wa.contentSid')}</label>
              <input placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" disabled={!canManage}
                value={drafts[tpl.template_key] ?? tpl.provider_template_id ?? ''}
                onChange={e => setDrafts(d => ({ ...d, [tpl.template_key]: e.target.value }))} />
            </div>
            {canManage && (
              <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                disabled={saving === tpl.template_key} onClick={() => void saveSid(tpl.template_key)}>
                {saving === tpl.template_key ? t('c.saving') : t('c.save')}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Mensagens ─────────────────────────────────────────────────────────────────
function MessagesTab() {
  const { t } = useI18n();
  const [items, setItems] = useState<WhatsAppMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage]   = useState(1);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const resp = await api.get<{ data: WhatsAppMessage[]; total: number }>(`/v1/whatsapp/messages?page=${page}&per_page=20`);
      setItems(resp.data); setTotal(resp.total);
    } catch { /**/ } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [page]);

  const columns: Column<WhatsAppMessage>[] = [
    { key: 'client', header: t('wa.client'), render: m => m.client_name ?? m.phone_e164 },
    { key: 'template', header: t('wa.template'), render: m => templateLabel(t, m.template_key) },
    { key: 'status', header: t('c.status'), render: m => (
      <div>
        <Badge variant={STATUS_BADGE[m.status] ?? 'service'}>{t(`wa.messageStatus.${m.status}` as TKey)}</Badge>
        {/* Motivo real do provedor (Twilio ErrorMessage, gravado via webhook de
            status em whatsapp_messages.status_reason) — já vinha da API, só
            nunca tinha sido exibido; sem isso "Falhou" não dizia nada sobre o
            porquê. */}
        {(m.status === 'failed' || m.status === 'undelivered') && m.status_reason && (
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0', maxWidth: 260 }}>{m.status_reason}</p>
        )}
      </div>
    ) },
    { key: 'created_at', header: t('wa.sentAt'), render: m => new Date(m.created_at).toLocaleString('pt-BR') },
  ];

  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div className="card">
        <DataTable columns={columns} rows={items} loading={loading}
          emptyState={<div className="empty-state">{t('wa.emptyMessages')}</div>} />
      </div>
      {totalPages > 1 && (
        <div className="flex-gap mt-16" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('c.prev')}</button>
          <span className="text-muted" style={{ fontSize: 13 }}>{t('c.page')} {page} {t('c.of')} {totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t('c.next')}</button>
        </div>
      )}
    </div>
  );
}
