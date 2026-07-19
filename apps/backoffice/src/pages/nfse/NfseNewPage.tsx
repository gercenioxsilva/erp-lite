import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n';
import { SectionCard, StepProgress } from '../../ds';
import type { Step } from '../../ds';
import './NfseNewPage.css';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface ClientOption { id: string; company_name: string | null; full_name: string | null; }
interface CompanyOption {
  id: string; razao_social: string; is_default: boolean; emite_nfse: boolean;
  codigo_servico_padrao: string | null; aliquota_iss_padrao: string | null;
}

const STEPS: Step[] = [
  { label: 'Cliente',       description: 'Destinatário da NFS-e' },
  { label: 'Serviço',       description: 'Descrição e valor'     },
  { label: 'Dados Fiscais', description: 'ISS e período'         },
  { label: 'Revisão',       description: 'Confira antes de criar' },
];

// NFS-e avulsa: mesma UX de "nota fiscal de venda avulsa" (InvoiceNewPage),
// só que pra um serviço único (regra 24: NFS-e nunca mistura com NF-e).
// POST /v1/nfse cria E emite na mesma chamada (createAndEmitNfse) — mesmo
// endpoint usado pelo "Aceitar" do rascunho proposto pelo assistente IA.
// Readiness/competência/gates são responsabilidade do backend; erros vêm
// como {error: <codigo>}, sem message (ApiError já cai para err.error).
export function NfseNewPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [formClientId,   setFormClientId]   = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAmount,     setFormAmount]     = useState('');
  const [formServiceCode, setFormServiceCode] = useState('');
  const [formIssRate,    setFormIssRate]    = useState('');
  const [formPeriodStart, setFormPeriodStart] = useState('');
  const [formPeriodEnd,   setFormPeriodEnd]   = useState('');
  const [saving,         setSaving]         = useState(false);
  const [formError,      setFormError]      = useState('');

  const [clients,   setClients]   = useState<ClientOption[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [formCompanyId, setFormCompanyId] = useState('');

  const hasClient  = !!formClientId;
  const hasService = !!formDescription.trim() && Number(formAmount) > 0;
  const hasFiscal  = !!formServiceCode.trim() && formIssRate !== '';
  const currentStep = !hasClient ? 1 : !hasService ? 2 : !hasFiscal ? 3 : 4;

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    Promise.all([
      api.get<{ data: ClientOption[] }>(`/v1/clients?tenant_id=${tenantId}&per_page=100`),
      api.get<{ data: CompanyOption[] }>('/v1/companies').catch(() => ({ data: [] })),
    ]).then(([cl, comp]) => {
      if (cancelled) return;
      setClients(cl.data ?? []);
      // Filtrado por emite_nfse=true (regra 53) — mesmo padrão do faturamento
      // de OS (ServiceOrdersPage) e da emissão de NF-e de venda (InvoiceNewPage).
      const nfseCompanies = (comp.data ?? []).filter(c => c.emite_nfse);
      setCompanies(nfseCompanies);
      const def = nfseCompanies.find(c => c.is_default) ?? nfseCompanies[0];
      if (def) {
        setFormCompanyId(prev => prev || def.id);
        setFormServiceCode(prev => prev || def.codigo_servico_padrao || '');
        setFormIssRate(prev => prev || (def.aliquota_iss_padrao != null ? String(def.aliquota_iss_padrao) : ''));
      }
    }).catch(() => {/* non-fatal */});
    return () => { cancelled = true; };
  }, [tenantId]);

  function handleCompanyChange(id: string) {
    setFormCompanyId(id);
    const company = companies.find(c => c.id === id);
    if (company) {
      setFormServiceCode(company.codigo_servico_padrao || '');
      setFormIssRate(company.aliquota_iss_padrao != null ? String(company.aliquota_iss_padrao) : '');
    }
  }

  const amountCalc = Number(formAmount) || 0;
  const issRateCalc = Number(formIssRate) || 0;
  const issValueCalc = Math.round(amountCalc * issRateCalc) / 100;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!formClientId)            { setFormError(t('nfse.errNoClient'));      return; }
    if (!formDescription.trim())  { setFormError(t('nfse.errNoDescription')); return; }
    if (!(amountCalc > 0))        { setFormError(t('nfse.errNoAmount'));      return; }
    setSaving(true); setFormError('');
    try {
      await api.post('/v1/nfse', {
        client_id:    formClientId,
        description:  formDescription.trim(),
        amount:       amountCalc,
        service_code: formServiceCode || undefined,
        iss_rate:     formIssRate !== '' ? Number(formIssRate) : undefined,
        period_start: formPeriodStart || undefined,
        period_end:   formPeriodEnd   || undefined,
        company_id:   formCompanyId   || undefined,
      });
      navigate('/nfse');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('cl.errSave'));
    } finally { setSaving(false); }
  }

  const selectedClient = clients.find(c => c.id === formClientId);

  return (
    <form onSubmit={handleSave} noValidate>
      <div className="nfse-new-bar">
        <StepProgress steps={STEPS} currentStep={currentStep} />
      </div>

      <div className="page-header" style={{ paddingTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
            onClick={() => navigate('/nfse')}>
            ← Voltar
          </button>
          <h1>{t('nfse.newTitle')}</h1>
        </div>
      </div>

      {formError && (
        <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>{formError}</div>
      )}

      <div className="nfse-new-layout">
        <div className="nfse-new-main">

          {/* Step 1 — Cliente */}
          <SectionCard step={1} title={t('nfse.client')}
            description="Selecione o destinatário da NFS-e"
            unlocked>
            <div className="field">
              <label htmlFor="nfse-client">{t('nfse.client')} *</label>
              <select id="nfse-client" value={formClientId}
                onChange={e => setFormClientId(e.target.value)}>
                <option value="">{t('nfse.selectClient')}</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.company_name ?? c.full_name}</option>
                ))}
              </select>
            </div>
            {companies.length > 1 && (
              <div className="field">
                <label htmlFor="nfse-company">{t('comp.companies.emittingCompany')}</label>
                <select id="nfse-company" value={formCompanyId}
                  onChange={e => handleCompanyChange(e.target.value)}>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.razao_social}{c.is_default ? ` (${t('comp.companies.default')})` : ''}</option>
                  ))}
                </select>
              </div>
            )}
          </SectionCard>

          {/* Step 2 — Serviço */}
          <SectionCard step={2} title={t('nfse.description')}
            description="Descreva o serviço prestado e o valor"
            unlocked={hasClient}>
            <div className="field">
              <label htmlFor="nfse-desc">{t('nfse.description')} *</label>
              <textarea id="nfse-desc" value={formDescription}
                onChange={e => setFormDescription(e.target.value)} rows={3} />
            </div>
            <div className="field" style={{ maxWidth: 200 }}>
              <label htmlFor="nfse-amount">{t('nfse.amount')} *</label>
              <input id="nfse-amount" type="number" min="0" step="0.01" value={formAmount}
                onChange={e => setFormAmount(e.target.value)} />
            </div>
          </SectionCard>

          {/* Step 3 — Dados Fiscais */}
          <SectionCard step={3} title={t('nfse.iss')}
            description="Código de serviço (LC 116), alíquota de ISS e período"
            unlocked={hasService}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="nfse-code">{t('nfse.serviceCode')} *</label>
                <input id="nfse-code" value={formServiceCode} maxLength={10}
                  placeholder={t('nfse.serviceCodePH')}
                  onChange={e => setFormServiceCode(e.target.value)} />
              </div>
              <div className="field" style={{ flex: '0 0 140px' }}>
                <label htmlFor="nfse-iss-rate">{t('nfse.issRate')} *</label>
                <input id="nfse-iss-rate" type="number" min="0" step="0.01" value={formIssRate}
                  onChange={e => setFormIssRate(e.target.value)} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="nfse-period-start">{t('nfse.periodStart')}</label>
                <input id="nfse-period-start" type="date" value={formPeriodStart}
                  onChange={e => setFormPeriodStart(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="nfse-period-end">{t('nfse.periodEnd')}</label>
                <input id="nfse-period-end" type="date" value={formPeriodEnd}
                  onChange={e => setFormPeriodEnd(e.target.value)} />
              </div>
            </div>
          </SectionCard>

          {/* Step 4 — Revisão */}
          <SectionCard step={4} title={t('tax.breakdown')}
            description="Confira o valor e o ISS antes de criar"
            unlocked={hasFiscal}>
            <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>
                <span>{t('nfse.iss')} ({issRateCalc.toFixed(2).replace('.', ',')}%)</span>
                <span>{BRL.format(issValueCalc)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 6 }}>
                <span>{t('nfse.amount')}</span>
                <span style={{ color: 'var(--primary)' }}>{BRL.format(amountCalc)}</span>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* Sticky summary sidebar */}
        <aside className="nfse-new-sidebar">
          <div className="card nfse-summary">
            <div className="nfse-summary__header">
              <h3>Resumo</h3>
            </div>
            <div className="nfse-summary__body">
              <div className="nfse-summary__row">
                <span>{t('nfse.client')}</span>
                <span>
                  {selectedClient
                    ? (selectedClient.company_name ?? selectedClient.full_name ?? '—')
                    : <em style={{ color: 'var(--muted)', fontStyle: 'normal' }}>não selecionado</em>}
                </span>
              </div>
              <div className="nfse-summary__row nfse-summary__row--muted">
                <span>{t('nfse.serviceCode')}</span>
                <span>{formServiceCode || '—'}</span>
              </div>
              <div className="nfse-summary__row nfse-summary__row--muted">
                <span>{t('nfse.iss')}</span>
                <span>{BRL.format(issValueCalc)}</span>
              </div>
            </div>
            <div className="nfse-summary__total">
              <span>{t('nfse.amount')}</span>
              <strong>{BRL.format(amountCalc)}</strong>
            </div>
            <div className="nfse-summary__actions">
              <button type="submit" className="btn btn-primary"
                disabled={saving || !hasClient || !hasService}>
                {saving ? t('c.saving') : t('nfse.create')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/nfse')}>
                {t('c.cancel')}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </form>
  );
}
