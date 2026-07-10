import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

// Página 403 amigável. Renderizada dentro do Layout (shell + menu continuam),
// para o usuário não ficar perdido.
export function AccessDeniedPage() {
  const { t } = useI18n();

  return (
    <div className="empty-state" style={{ maxWidth: 520, margin: '72px auto', textAlign: 'center' }}>
      <div style={{ fontSize: 52, lineHeight: 1, marginBottom: 16 }} aria-hidden>🔒</div>
      <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 10 }}>{t('rbac.403.title')}</h1>
      <p style={{ marginBottom: 24, opacity: 0.75 }}>{t('rbac.403.message')}</p>
      <Link to="/dashboard" className="btn btn-primary btn-cta" style={{ width: 'auto', display: 'inline-block' }}>
        {t('rbac.403.back')}
      </Link>
    </div>
  );
}
