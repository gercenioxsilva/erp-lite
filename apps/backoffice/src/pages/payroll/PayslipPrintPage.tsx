import { useEffect, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { api }      from '../../lib/api';
import { useI18n }  from '../../i18n';

interface LineItem { description: string; amount: number; }

interface PayslipEntry {
  id: string; employee_name: string; regime: 'clt' | 'pro_labore'; base_salary: string;
  extra_earnings: LineItem[]; extra_deductions: LineItem[];
  inss_value: string; irrf_value: string; fgts_value: string;
  ferias_provisao: string; decimo_terceiro_provisao: string;
  gross_total: string; deductions_total: string; net_total: string;
}

interface PayslipResponse { entry: PayslipEntry; referenceMonth: string; runStatus: string; }

function formatBRL(value: string | number): string {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

/**
 * Holerite — mesmo padrão de impressão de Proposta/OS: sem lib de PDF,
 * window.print(). Ferramenta de cálculo/organização interna (regra
 * correspondente no README) — nunca um documento oficial de eSocial.
 */
export function PayslipPrintPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [state, setState] = useState<'loading' | 'not_found' | 'view'>('loading');
  const [data, setData]   = useState<PayslipResponse | null>(null);

  useEffect(() => {
    if (!id || !user) return;
    api.get<PayslipResponse>(`/v1/payroll/entries/${id}/print`)
      .then(d => { setData(d); setState('view'); })
      .catch(() => setState('not_found'));
  }, [id, user]);

  if (authLoading) return <div className="spinner">{t('c.loading')}</div>;
  if (!user) return <Navigate to="/login" replace />;

  if (state === 'loading') return <div className="spinner">{t('c.loading')}</div>;
  if (state === 'not_found' || !data) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2>{t('payroll.printNotFound')}</h2>
        <button className="btn btn-secondary btn-sm print-hide" style={{ width: 'auto', marginTop: 16 }} onClick={() => navigate('/payroll')}>
          ← {t('payroll.title')}
        </button>
      </div>
    );
  }

  const { entry } = data;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <div className="print-hide flex-gap" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
        <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => navigate(-1)}>← {t('c.close')}</button>
        <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => window.print()}>🖨 {t('payroll.print')}</button>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
          {t('payroll.payslip')} — <span style={{ textTransform: 'capitalize' }}>{formatMonth(data.referenceMonth)}</span>
        </div>
        <h1 style={{ fontSize: 20, margin: 0 }}>{entry.employee_name}</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
          {entry.regime === 'clt' ? t('emp.regimeClt') : t('emp.regimeProLabore')}
        </p>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <table>
          <tbody>
            <tr><td>{t('payroll.baseSalary')}</td><td style={{ textAlign: 'right' }}>{formatBRL(entry.base_salary)}</td></tr>
            {entry.extra_earnings.map((it, idx) => (
              <tr key={`earn-${idx}`}><td>{it.description}</td><td style={{ textAlign: 'right' }}>{formatBRL(it.amount)}</td></tr>
            ))}
            <tr style={{ fontWeight: 600 }}><td>{t('payroll.grossTotal')}</td><td style={{ textAlign: 'right' }}>{formatBRL(entry.gross_total)}</td></tr>
            <tr><td>INSS</td><td style={{ textAlign: 'right' }}>- {formatBRL(entry.inss_value)}</td></tr>
            <tr><td>IRRF</td><td style={{ textAlign: 'right' }}>- {formatBRL(entry.irrf_value)}</td></tr>
            {entry.extra_deductions.map((it, idx) => (
              <tr key={`ded-${idx}`}><td>{it.description}</td><td style={{ textAlign: 'right' }}>- {formatBRL(it.amount)}</td></tr>
            ))}
            <tr style={{ fontWeight: 700, borderTop: '1px solid var(--border)' }}>
              <td>{t('payroll.netTotal')}</td><td style={{ textAlign: 'right' }}>{formatBRL(entry.net_total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {entry.regime === 'clt' && (
        <div className="card" style={{ padding: 24, marginBottom: 16 }}>
          <strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>{t('payroll.employerCharges')}</strong>
          <table>
            <tbody>
              <tr><td>FGTS (8%)</td><td style={{ textAlign: 'right' }}>{formatBRL(entry.fgts_value)}</td></tr>
              <tr><td>{t('payroll.feriasProvisao')}</td><td style={{ textAlign: 'right' }}>{formatBRL(entry.ferias_provisao)}</td></tr>
              <tr><td>{t('payroll.decimoTerceiroProvisao')}</td><td style={{ textAlign: 'right' }}>{formatBRL(entry.decimo_terceiro_provisao)}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--muted)' }}>{t('payroll.legalDisclaimer')}</p>
    </div>
  );
}
