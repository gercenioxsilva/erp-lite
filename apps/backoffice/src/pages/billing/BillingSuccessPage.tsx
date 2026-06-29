import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';

export function BillingSuccessPage() {
  const { t } = useI18n();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>{t('billing.successTitle')}</h1>
      <p style={{ color: 'var(--muted)', fontSize: 16, marginBottom: 32, maxWidth: 400 }}>{t('billing.successMsg')}</p>
      <Link to="/dashboard" className="btn btn-primary" style={{ width: 'auto', padding: '10px 32px' }}>
        {t('billing.goToDashboard')}
      </Link>
    </div>
  );
}
