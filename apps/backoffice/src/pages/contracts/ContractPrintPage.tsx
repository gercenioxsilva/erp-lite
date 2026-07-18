import { useEffect, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { api }      from '../../lib/api';
import { useI18n }  from '../../i18n';
import { fmtDoc, addressLines, fmt, type PartyData } from '../proposals/ProposalDocument';

interface PrintContract {
  contract_number:   string;
  type:               string;
  description:        string;
  contact_name:        string | null;
  start_date:          string;
  end_date:            string | null;
  billing_frequency:   string;
  billing_day:         number;
  amount:              number;
  status:              string;
  notes:               string | null;
}
interface PrintIssuer extends PartyData { logo_url: string | null; }
interface CustomFieldPrint { label: string; formatted_value: string; }
interface PrintData {
  contract: PrintContract; client: PartyData; issuer: PrintIssuer | null;
  custom_fields: CustomFieldPrint[];
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const FREQ_LABEL: Record<string, string> = {
  monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual',
};

const PRINT_STYLES = `
.contract-print-root{max-width:820px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;
  color:#111;font-size:13px;}
.cp-box{border:1px solid #111;margin-bottom:16px;padding:14px 16px;}
.cp-title{text-align:center;font-weight:700;font-size:16px;margin-bottom:4px;}
.cp-subtitle{text-align:center;font-size:12px;color:#555;margin-bottom:16px;}
.cp-row{display:flex;gap:16px;}
.cp-col{flex:1;}
.cp-k{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#444;margin-bottom:2px;}
.cp-v{font-size:13px;margin-bottom:10px;}
.cp-logo{max-height:60px;max-width:220px;object-fit:contain;}
.cp-table{width:100%;border-collapse:collapse;font-size:12px;}
.cp-table th,.cp-table td{border:1px solid #111;padding:8px;text-align:left;vertical-align:top;}
.cp-table th{background:#f0f0f0;font-size:10px;text-transform:uppercase;letter-spacing:.04em;width:40%;}
@media print{
  .print-hide{display:none !important;}
  .contract-print-root{padding:0;max-width:none;}
}
`;

export function ContractPrintPage() {
  const { contractId } = useParams<{ contractId: string }>();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [state, setState] = useState<'loading' | 'not_found' | 'view'>('loading');
  const [data, setData]   = useState<PrintData | null>(null);

  useEffect(() => {
    if (!contractId || !user) return;
    api.get<PrintData>(`/v1/service-contracts/${contractId}/print`)
      .then(d => { setData(d); setState('view'); })
      .catch(() => setState('not_found'));
  }, [contractId, user]);

  if (authLoading) return <div className="contract-print-root"><style>{PRINT_STYLES}</style>{t('c.loading')}</div>;
  if (!user) return <Navigate to="/login" replace />;

  if (state === 'loading') {
    return <div className="contract-print-root"><style>{PRINT_STYLES}</style>{t('c.loading')}</div>;
  }
  if (state === 'not_found' || !data) {
    return (
      <div className="contract-print-root">
        <style>{PRINT_STYLES}</style>
        <p>{t('sc.printNotFound')}</p>
        <button className="btn btn-secondary btn-sm print-hide" onClick={() => navigate('/contracts')}>
          ← {t('sc.title')}
        </button>
      </div>
    );
  }

  const { contract, client, issuer, custom_fields } = data;
  const clientAddr = addressLines(client);
  const issuerAddr = issuer ? addressLines(issuer) : [];

  return (
    <div className="contract-print-root">
      <style>{PRINT_STYLES}</style>

      <div className="flex-gap print-hide" style={{ marginBottom: 16, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>← {t('c.close')}</button>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>🖨 {t('sc.receipt.print')}</button>
      </div>

      {/* Emissor */}
      <div className="cp-box">
        <div className="cp-row">
          <div className="cp-col">
            {issuer?.logo_url && <img className="cp-logo" src={issuer.logo_url} alt={issuer.name ?? ''} />}
            <div style={{ fontWeight: 700, marginTop: 6 }}>{issuer?.company ?? issuer?.name ?? '—'}</div>
            {issuerAddr.map((l, i) => <div key={i} style={{ fontSize: 12 }}>{l}</div>)}
            {issuer?.document && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                CNPJ: {fmtDoc(issuer.document, issuer.document_type ?? 'CNPJ')}
                {issuer.state_reg && <> · IE: {issuer.state_reg}</>}
              </div>
            )}
          </div>
          <div className="cp-col" style={{ maxWidth: 220 }}>
            <div className="cp-k">{t('sc.number')}</div>
            <div className="cp-v">#{contract.contract_number}</div>
            <div className="cp-k">{t('sc.startDate')}</div>
            <div className="cp-v">{fmt(contract.start_date)}{contract.end_date ? ` – ${fmt(contract.end_date)}` : ''}</div>
            <div className="cp-k">{t('sc.status')}</div>
            <div className="cp-v" style={{ marginBottom: 0 }}>{t(`sc.status.${contract.status}` as Parameters<typeof t>[0])}</div>
          </div>
        </div>
      </div>

      <div className="cp-title">{t('sc.print.docTitle')}</div>
      <div className="cp-subtitle">{contract.description}</div>

      {/* Tomador */}
      <div className="cp-box">
        <div className="cp-k">{t('sc.receipt.tomador')}</div>
        <div><strong>{t('sc.receipt.companyName')}:</strong> {client.name ?? '—'}</div>
        {client.document && <div><strong>{client.document_type ?? 'CNPJ'}:</strong> {fmtDoc(client.document, client.document_type)}</div>}
        {clientAddr.length > 0 && <div><strong>{t('sc.receipt.address')}:</strong> {clientAddr.join(', ')}</div>}
        {client.state_reg && <div><strong>IE:</strong> {client.state_reg}</div>}
        {contract.contact_name && <div><strong>{t('sc.receipt.contact')}:</strong> {contract.contact_name}</div>}
        {client.email && <div><strong>{t('sc.receipt.email')}:</strong> {client.email}</div>}
      </div>

      {/* Cobrança */}
      <div className="cp-box">
        <div className="cp-row">
          <div className="cp-col">
            <div className="cp-k">{t('sc.billingFreq')}</div>
            <div className="cp-v">{FREQ_LABEL[contract.billing_frequency] ?? contract.billing_frequency} · dia {contract.billing_day}</div>
          </div>
          <div className="cp-col">
            <div className="cp-k">{t('sc.amount')}</div>
            <div className="cp-v" style={{ fontWeight: 700, fontSize: 15 }}>{BRL.format(contract.amount)}</div>
          </div>
        </div>
      </div>

      {/* Campos personalizados */}
      {custom_fields.length > 0 && (
        <table className="cp-table" style={{ marginBottom: 16 }}>
          <tbody>
            {custom_fields.map((f, i) => (
              <tr key={i}>
                <th>{f.label}</th>
                <td>{f.formatted_value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {contract.notes && (
        <div className="cp-box">
          <div className="cp-k">{t('sc.notes')}</div>
          <div style={{ whiteSpace: 'pre-line' }}>{contract.notes}</div>
        </div>
      )}
    </div>
  );
}
