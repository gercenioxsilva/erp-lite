import { useEffect, useState, FormEvent } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { useModal } from '../../contexts/ModalContext';

interface Technician {
  id: string; name: string; email: string; phone: string | null;
  cpf: string; specialty: string | null; is_active: boolean;
}
interface ListResp { data: Technician[]; total: number; page: number; per_page: number; }

function maskCPF(cpf: string): string {
  const d = cpf.replace(/\D/g, '');
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : cpf;
}

export function TechniciansPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const modal = useModal();

  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Technician | null>(null);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');
  const [resending, setResending]   = useState(false);

  const [name,      setName]      = useState('');
  const [email,     setEmail]     = useState('');
  const [phone,     setPhone]     = useState('');
  const [cpf,       setCpf]       = useState('');
  const [specialty, setSpecialty] = useState('');

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ per_page: '50', ...(search ? { search } : {}) });
      const r = await api.get<ListResp>(`/v1/technicians?${p}`);
      setTechnicians(r.data);
    } catch { /**/ } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [tenantId, search]);

  function openCreate() {
    setEditing(null);
    setName(''); setEmail(''); setPhone(''); setCpf(''); setSpecialty('');
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(tc: Technician) {
    setEditing(tc);
    setName(tc.name); setEmail(tc.email); setPhone(tc.phone ?? ''); setCpf(tc.cpf); setSpecialty(tc.specialty ?? '');
    setFormError('');
    setDrawerOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!name.trim())  { setFormError(t('tech.name')  + ' *'); return; }
    if (!email.trim()) { setFormError(t('tech.email') + ' *'); return; }
    if (!cpf.trim())   { setFormError(t('tech.cpf')   + ' *'); return; }
    setSaving(true); setFormError('');
    try {
      const payload = {
        name: name.trim(), email: email.trim(), phone: phone || undefined,
        cpf: cpf.replace(/\D/g, ''), specialty: specialty || undefined,
      };
      if (editing) await api.patch(`/v1/technicians/${editing.id}`, payload);
      else         await api.post('/v1/technicians', payload);
      setDrawerOpen(false);
      if (!editing) modal.success(t('tech.created'));
      void load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setFormError(msg.includes('CPF') ? t('tech.errCPF') : msg.includes('E-mail') || msg.includes('mail') ? t('tech.errEmail') : msg || t('tech.errCPF'));
    } finally { setSaving(false); }
  }

  async function handleResendInvite() {
    if (!editing) return;
    const ok = await modal.confirm({
      title: t('tech.resendInvite'),
      message: t('tech.resendInviteConfirm'),
      confirmLabel: t('tech.resendInvite'),
    });
    if (!ok) return;
    setResending(true);
    try {
      await api.post(`/v1/technicians/${editing.id}/resend-invite`, {});
      modal.success(t('tech.resendInviteSent'));
    } catch (err: unknown) { modal.error(err); }
    finally { setResending(false); }
  }

  async function toggleActive(tech: Technician) {
    const ok = await modal.confirm({
      title: tech.is_active ? t('tech.deactivate') : t('tech.activate'),
      message: tech.is_active ? t('tech.deactivateConfirm') : t('tech.activate') + '?',
      danger: tech.is_active,
    });
    if (!ok) return;
    try {
      await api.patch(`/v1/technicians/${tech.id}/active`, { is_active: !tech.is_active });
      void load();
    } catch (err: unknown) { modal.error(err); }
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t('tech.title')}</h1>
        <button className="btn btn-primary btn-cta" style={{ width: 'auto' }} onClick={openCreate}>
          + {t('tech.new')}
        </button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <input placeholder={t('c.search')} value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner">{t('c.loading')}</div>
        ) : technicians.length === 0 ? (
          <div className="empty-state">{t('tech.empty')}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('tech.name')}</th>
                <th>{t('tech.email')}</th>
                <th>{t('tech.phone')}</th>
                <th>{t('tech.cpf')}</th>
                <th>{t('tech.specialty')}</th>
                <th style={{ width: 90 }}>{t('c.status')}</th>
                <th style={{ width: 200 }}></th>
              </tr>
            </thead>
            <tbody>
              {technicians.map(tc => (
                <tr key={tc.id}>
                  <td style={{ fontWeight: 500 }}>{tc.name}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{tc.email}</td>
                  <td>{tc.phone ?? '—'}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{maskCPF(tc.cpf)}</td>
                  <td>{tc.specialty ?? '—'}</td>
                  <td>
                    <span className={`badge ${tc.is_active ? 'badge-active' : 'badge-inactive'}`}>
                      {tc.is_active ? t('tech.active') : t('tech.inactive')}
                    </span>
                  </td>
                  <td>
                    <div className="flex-gap">
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(tc)}>{t('c.edit')}</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(tc)}>
                        {tc.is_active ? t('tech.deactivate') : t('tech.activate')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {drawerOpen && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{editing ? t('tech.edit') : t('tech.new')}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSave} noValidate style={{ display: 'contents' }}>
              <div className="drawer-body">
                {formError && <div className="alert alert-error" role="alert">{formError}</div>}

                <div className="field">
                  <label htmlFor="tc-name">{t('tech.name')} *</label>
                  <input id="tc-name" value={name} onChange={e => setName(e.target.value)} required />
                </div>
                <div className="field">
                  <label htmlFor="tc-email">{t('tech.email')} *</label>
                  <input id="tc-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="tc-phone">{t('tech.phone')}</label>
                    <input id="tc-phone" value={phone} onChange={e => setPhone(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="tc-cpf">{t('tech.cpf')} *</label>
                    <input id="tc-cpf" value={cpf} onChange={e => setCpf(e.target.value)} maxLength={14} placeholder="000.000.000-00" required />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="tc-specialty">{t('tech.specialty')}</label>
                  <input id="tc-specialty" value={specialty} onChange={e => setSpecialty(e.target.value)} />
                </div>

                {editing && (
                  <div style={{ marginTop: 8, padding: '12px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>{t('tech.accessTitle')}</strong>
                    <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{t('tech.accessHint')}</p>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                      disabled={resending} onClick={() => void handleResendInvite()}>
                      {resending ? t('c.saving') : t('tech.resendInvite')}
                    </button>
                  </div>
                )}
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDrawerOpen(false)}>{t('c.cancel')}</button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? t('c.saving') : t('c.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
