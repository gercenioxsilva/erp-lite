import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n';
import { Switch } from '../../ds/components/Switch';
import { DataTable, type Column } from '../../ds/components/DataTable';
import { Badge } from '../../ds/components/Badge';

// WhatsApp — Cobranças e Notificações: automações (liga/desliga + dias antes/
// depois do vencimento), templates (status de aprovação + Content SID) e log
// de mensagens. Conexão da conta em si fica em Minha Empresa > Integrações
// (WhatsAppIntegrationSection, CompanyPage.tsx) — aqui só o que roda depois
// de conectado.

interface Automation {
  template_key: string;
  enabled: boolean;
  config: { days_before?: number; days_after?: number };
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

export function WhatsAppPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'automations' | 'templates' | 'messages'>('automations');

  return (
    <div>
      <div className="page-header">
        <h1>{t('wa.title')}</h1>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
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

      {tab === 'automations' && <AutomationsTab />}
      {tab === 'templates'   && <TemplatesTab />}
      {tab === 'messages'    && <MessagesTab />}
    </div>
  );
}

function templateLabel(t: (k: any) => string, key: string): string {
  return t(`wa.template.${key}` as any);
}

// ── Automações ────────────────────────────────────────────────────────────────
function AutomationsTab() {
  const { t } = useI18n();
  const [items, setItems]   = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError]   = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const resp = await api.get<{ data: Automation[] }>('/v1/whatsapp/automations');
      setItems(resp.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('wa.errLoad'));
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function toggle(a: Automation) {
    setBusyKey(a.template_key); setError('');
    try {
      const config = a.template_key === 'invoice_due_soon' ? { days_before: a.config.days_before ?? 3 }
        : a.template_key === 'invoice_overdue' ? { days_after: a.config.days_after ?? 3 } : {};
      await api.patch(`/v1/whatsapp/automations/${a.template_key}`, { enabled: !a.enabled, config });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('wa.errSave'));
    } finally { setBusyKey(null); }
  }

  async function updateDays(a: Automation, field: 'days_before' | 'days_after', value: number) {
    setBusyKey(a.template_key); setError('');
    try {
      await api.patch(`/v1/whatsapp/automations/${a.template_key}`, { enabled: a.enabled, config: { [field]: value } });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('wa.errSave'));
    } finally { setBusyKey(null); }
  }

  if (loading) return <div className="spinner">{t('c.loading')}</div>;

  return (
    <div>
      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      <div className="modules-grid">
        {items.map(a => (
          <div key={a.template_key} className={`module-card${a.enabled ? ' module-card--on' : ''}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div>
                <strong>{templateLabel(t, a.template_key)}</strong>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>{t(`wa.templateDesc.${a.template_key}` as any)}</p>
                {a.template_key === 'invoice_due_soon' && (
                  <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {t('wa.daysBefore')}
                    <input type="number" min={1} max={30} style={{ width: 60 }}
                      value={a.config.days_before ?? 3}
                      onChange={e => void updateDays(a, 'days_before', Number(e.target.value))} />
                  </div>
                )}
                {a.template_key === 'invoice_overdue' && (
                  <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {t('wa.daysAfter')}
                    <input type="number" min={1} max={90} style={{ width: 60 }}
                      value={a.config.days_after ?? 3}
                      onChange={e => void updateDays(a, 'days_after', Number(e.target.value))} />
                  </div>
                )}
              </div>
              <Switch checked={a.enabled} disabled={busyKey === a.template_key} onChange={() => void toggle(a)}
                label={`${templateLabel(t, a.template_key)}: ${a.enabled ? t('comp.modules.disable') : t('comp.modules.enable')}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────
function TemplatesTab() {
  const { t } = useI18n();
  const [items, setItems] = useState<TemplateView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true); setError('');
    try {
      const resp = await api.get<{ data: TemplateView[] }>('/v1/whatsapp/templates');
      setItems(resp.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('wa.errLoad'));
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function saveSid(key: string) {
    const sid = drafts[key]?.trim();
    if (!sid) return;
    setSaving(key); setError('');
    try {
      await api.patch(`/v1/whatsapp/templates/${key}`, { provider_template_id: sid });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('wa.errSave'));
    } finally { setSaving(null); }
  }

  if (loading) return <div className="spinner">{t('c.loading')}</div>;

  return (
    <div>
      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{t('wa.templatesHint')}</p>
      {items.map(tpl => (
        <div key={tpl.template_key} className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>{templateLabel(t, tpl.template_key)}</strong>
            <span className={`badge ${tpl.status === 'approved' ? 'badge-active' : tpl.status === 'rejected' ? 'badge-inactive' : 'badge-service'}`}>
              {t(`wa.templateStatus.${tpl.status}` as any)}
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-line', marginBottom: 12 }}>{tpl.body_preview}</p>
          <div className="field-row" style={{ alignItems: 'flex-end' }}>
            <div className="field">
              <label>{t('wa.contentSid')}</label>
              <input placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={drafts[tpl.template_key] ?? tpl.provider_template_id ?? ''}
                onChange={e => setDrafts(d => ({ ...d, [tpl.template_key]: e.target.value }))} />
            </div>
            <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
              disabled={saving === tpl.template_key} onClick={() => void saveSid(tpl.template_key)}>
              {saving === tpl.template_key ? t('c.saving') : t('c.save')}
            </button>
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
      <Badge variant={STATUS_BADGE[m.status] ?? 'service'}>{t(`wa.messageStatus.${m.status}` as any)}</Badge>
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
