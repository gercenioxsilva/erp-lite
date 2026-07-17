import { useEffect, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { api }      from '../../lib/api';
import { useI18n }  from '../../i18n';
import { fmtDoc, addressLines, fmt, type PartyData } from '../proposals/ProposalDocument';

interface ReceiptContract { description: string; billing_day: number; contact_name: string | null; }
interface ReceiptBilling {
  document_number: string | null; created_at: string; due_date: string;
  period_start: string; period_end: string; amount: number;
}
interface ReceiptIssuer extends PartyData { logo_url: string | null; }
interface ReceiptBankAccount { bank_code: string; agency: string; account: string; account_digit: string; }
interface ReceiptData {
  contract: ReceiptContract; client: PartyData; billing: ReceiptBilling;
  issuer: ReceiptIssuer | null; bank_account: ReceiptBankAccount | null;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const BANK_NAMES: Record<string, string> = { '336': 'C6 Bank', '341': 'Itaú' };

function referenceLabel(periodStart: string): string {
  const [y, m] = periodStart.slice(0, 10).split('-');
  return `${MONTHS[Number(m) - 1]}/${y.slice(2)}`;
}

const RECEIPT_STYLES = `
.receipt-root{max-width:820px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;
  color:#111;font-size:13px;}
.receipt-box{border:1px solid #111;margin-bottom:-1px;}
.receipt-row{display:flex;}
.receipt-row>.receipt-col{flex:1;border-right:1px solid #111;padding:8px 12px;}
.receipt-row>.receipt-col:last-child{border-right:none;}
.receipt-k{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#444;margin-bottom:2px;}
.receipt-v{font-size:13px;}
.receipt-title{text-align:center;font-weight:700;font-size:15px;padding:10px;border-bottom:1px solid #111;}
.receipt-table{width:100%;border-collapse:collapse;font-size:12px;}
.receipt-table th,.receipt-table td{border:1px solid #111;padding:8px;vertical-align:top;}
.receipt-table th{background:#f0f0f0;font-size:10px;text-transform:uppercase;letter-spacing:.04em;}
.receipt-totals{width:280px;margin-left:auto;font-size:13px;}
.receipt-totals .row{display:flex;justify-content:space-between;padding:4px 12px;}
.receipt-totals .row--total{font-weight:700;border-top:1px solid #111;}
.receipt-obs{border:1px solid #111;padding:10px 12px;font-size:12px;line-height:1.7;}
.receipt-logo{max-height:60px;max-width:220px;object-fit:contain;}
@media print{
  .print-hide{display:none !important;}
  .receipt-root{padding:0;max-width:none;}
}
`;

/**
 * Nota de Locação / Recibo / Fatura — documento interno SEM valor fiscal
 * (nunca fala com Focus NF-e/NFS-e), disponível só pra cobranças de contratos
 * type='rental'. Reaproveita fmtDoc/addressLines/fmt de ProposalDocument.tsx
 * (regra 36 — nunca reimplementar máscara de documento/endereço) mas tem
 * layout próprio, bem diferente do cartão colorido de proposta.
 */
export function ContractBillingReceiptPrintPage() {
  const { contractId, billingId } = useParams<{ contractId: string; billingId: string }>();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [state, setState] = useState<'loading' | 'not_found' | 'view'>('loading');
  const [data, setData]   = useState<ReceiptData | null>(null);

  useEffect(() => {
    if (!contractId || !billingId || !user) return;
    api.get<ReceiptData>(`/v1/service-contracts/${contractId}/billings/${billingId}/receipt`)
      .then(d => { setData(d); setState('view'); })
      .catch(() => setState('not_found'));
  }, [contractId, billingId, user]);

  if (authLoading) return <div className="receipt-root"><style>{RECEIPT_STYLES}</style>{t('c.loading')}</div>;
  if (!user) return <Navigate to="/login" replace />;

  if (state === 'loading') {
    return <div className="receipt-root"><style>{RECEIPT_STYLES}</style>{t('c.loading')}</div>;
  }
  if (state === 'not_found' || !data) {
    return (
      <div className="receipt-root">
        <style>{RECEIPT_STYLES}</style>
        <p>{t('sc.receipt.notFound')}</p>
        <button className="btn btn-secondary btn-sm print-hide" onClick={() => navigate('/contracts')}>
          ← {t('sc.title')}
        </button>
      </div>
    );
  }

  const { contract, client, billing, issuer, bank_account } = data;
  const clientAddr = addressLines(client);
  const issuerAddr = issuer ? addressLines(issuer) : [];
  const bankLabel = bank_account ? (BANK_NAMES[bank_account.bank_code] ?? bank_account.bank_code) : null;

  const description = [
    contract.description,
    `Serviço Prestado na ${client.name ?? ''}.`,
    clientAddr.length ? `Endereço - ${clientAddr.join(', ')}` : '',
    `Período de Locação: de ${fmt(billing.period_start)} a ${fmt(billing.period_end)}`,
  ].filter(Boolean).join('\n');

  return (
    <div className="receipt-root">
      <style>{RECEIPT_STYLES}</style>

      <div className="flex-gap print-hide" style={{ marginBottom: 16, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>← {t('c.close')}</button>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>🖨 {t('sc.receipt.print')}</button>
      </div>

      {/* Bloco de recebimento (topo) */}
      <div className="receipt-box receipt-row" style={{ marginBottom: 24 }}>
        <div className="receipt-col" style={{ maxWidth: 220 }}>
          <div className="receipt-k">{t('sc.receipt.receivedDate')}</div>
        </div>
        <div className="receipt-col">
          <div className="receipt-k">{t('sc.receipt.receiverSignature')}</div>
        </div>
      </div>

      {/* Cabeçalho — emissor + número/datas */}
      <div className="receipt-box">
        <div className="receipt-title">{t('sc.receipt.docTitle')} Nº {billing.document_number ?? '—'}</div>
        <div className="receipt-row">
          <div className="receipt-col">
            {issuer?.logo_url && <img className="receipt-logo" src={issuer.logo_url} alt={issuer.name ?? ''} />}
            <div style={{ fontWeight: 700, marginTop: 6 }}>{issuer?.company ?? issuer?.name ?? '—'}</div>
            {issuerAddr.map((l, i) => <div key={i} style={{ fontSize: 12 }}>{l}</div>)}
            {issuer?.document && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                CNPJ: {fmtDoc(issuer.document, issuer.document_type ?? 'CNPJ')}
                {issuer.state_reg && <> · IE: {issuer.state_reg}</>}
              </div>
            )}
          </div>
          <div className="receipt-col" style={{ maxWidth: 220 }}>
            <div className="receipt-k">{t('sc.receipt.issueDate')}</div>
            <div className="receipt-v" style={{ marginBottom: 8 }}>{fmt(billing.created_at.slice(0, 10))}</div>
            <div className="receipt-k">{t('sc.receipt.reference')}</div>
            <div className="receipt-v" style={{ marginBottom: 8 }}>{referenceLabel(billing.period_start)}</div>
            <div className="receipt-k">{t('sc.receipt.dueDate')}</div>
            <div className="receipt-v">{fmt(billing.due_date)}</div>
          </div>
        </div>
      </div>

      {/* Tomador */}
      <div className="receipt-box" style={{ padding: 10, marginTop: -1 }}>
        <div className="receipt-k">{t('sc.receipt.tomador')}</div>
        <div className="receipt-row" style={{ marginTop: 4 }}>
          <div className="receipt-col" style={{ border: 'none', padding: 0 }}>
            <div><strong>{t('sc.receipt.companyName')}:</strong> {client.name ?? '—'}</div>
            {client.document && <div><strong>{client.document_type ?? 'CNPJ'}:</strong> {fmtDoc(client.document, client.document_type)}</div>}
            {clientAddr.length > 0 && <div><strong>{t('sc.receipt.address')}:</strong> {clientAddr.join(', ')}</div>}
            {client.state_reg && <div><strong>IE:</strong> {client.state_reg}</div>}
            {contract.contact_name && <div><strong>{t('sc.receipt.contact')}:</strong> {contract.contact_name}</div>}
            {client.email && <div><strong>{t('sc.receipt.email')}:</strong> {client.email}</div>}
          </div>
        </div>
      </div>

      {/* Item */}
      <table className="receipt-table" style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th style={{ width: 50 }}>{t('sc.receipt.item')}</th>
            <th>{t('sc.receipt.description')}</th>
            <th style={{ width: 60 }}>{t('sc.receipt.qty')}</th>
            <th style={{ width: 120 }}>{t('sc.receipt.monthlyValue')}</th>
            <th style={{ width: 120 }}>{t('sc.receipt.totalValue')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ textAlign: 'center' }}>1</td>
            <td style={{ whiteSpace: 'pre-line' }}>{description}</td>
            <td style={{ textAlign: 'center' }}>1</td>
            <td style={{ textAlign: 'right' }}>{BRL.format(billing.amount)}</td>
            <td style={{ textAlign: 'right' }}>{BRL.format(billing.amount)}</td>
          </tr>
        </tbody>
      </table>

      <div className="receipt-totals" style={{ marginTop: 8, marginBottom: 20 }}>
        <div className="row"><span>{t('sc.receipt.totalValue')}</span><span>{BRL.format(billing.amount)}</span></div>
        <div className="row"><span>{t('sc.receipt.others')}</span><span>—</span></div>
        <div className="row row--total"><span>{t('sc.receipt.totalToPay')}</span><span>{BRL.format(billing.amount)}</span></div>
      </div>

      {bank_account && (
        <div style={{ marginBottom: 20 }}>
          <div className="receipt-k" style={{ textAlign: 'center', marginBottom: 8 }}>{t('sc.receipt.paymentData')}</div>
          <div style={{ textAlign: 'center', fontSize: 13, lineHeight: 1.8 }}>
            <div>{t('sc.receipt.bank')}: {bankLabel}</div>
            <div>{t('sc.receipt.checkingAccount')}: {bank_account.account}-{bank_account.account_digit}</div>
            <div>{t('sc.receipt.agency')}: {bank_account.agency}</div>
          </div>
        </div>
      )}

      <div className="receipt-obs">
        <strong>{t('sc.receipt.observations')}:</strong>
        <div>1- {t('sc.receipt.paymentCondition').replace('{day}', String(contract.billing_day))}</div>
        <div>2- {t('sc.receipt.referencePeriod')}: {referenceLabel(billing.period_start)}</div>
      </div>
    </div>
  );
}
