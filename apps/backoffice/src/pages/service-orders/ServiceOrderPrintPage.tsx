import { useEffect, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { api }      from '../../lib/api';
import { useI18n }  from '../../i18n';
import type { TKey } from '../../i18n/pt-BR';

interface VisitPhoto { id: string; caption: string | null; created_at: string; url: string; }
interface PrintVisit {
  id: string; status: string; scheduled_at: string; checked_in_at: string | null; checked_out_at: string | null;
  report_notes: string | null; signed_by_name: string | null; signed_at: string | null;
  technician_name: string | null; photos: VisitPhoto[]; signature_url: string | null;
}
interface PrintServiceOrder {
  id: string; number: string; title: string; description: string | null; type: string; status: string; created_at: string;
  client_name: string | null; client_phone: string | null; client_mobile: string | null; client_email: string | null;
  client_street: string | null; client_street_number: string | null; client_complement: string | null;
  client_neighborhood: string | null; client_city: string | null; client_state: string | null; client_zip_code: string | null;
  visits: PrintVisit[];
}

// Mesma lógica de endereço/badge já usada em TechnicianVisitDetailPage.tsx e
// ServiceOrdersPage.tsx — pequena o bastante pra não valer extrair pra um
// util compartilhado, cada tela mantém sua própria cópia.
function formatAddress(so: PrintServiceOrder): string {
  const line1 = [so.client_street, so.client_street_number].filter(Boolean).join(', ');
  const parts = [
    line1, so.client_complement, so.client_neighborhood,
    so.client_city && so.client_state ? `${so.client_city}/${so.client_state}` : so.client_city,
    so.client_zip_code,
  ].filter(Boolean);
  return parts.join(' — ');
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    draft: 'badge-service', scheduled: 'badge-raw_material', in_progress: 'badge-product',
    completed: 'badge-active', cancelled: 'badge-inactive',
  };
  return map[s] ?? 'badge-service';
}

/**
 * "Espelho do técnico" — mesma visão que o técnico de campo vê no portal
 * dele (cliente completo, visitas com foto/assinatura), autenticada por
 * tenantId. Deliberadamente NÃO mostra itens da OS, porque o técnico também
 * não vê — objetivo é o tenant conferir exatamente o que chega pro técnico,
 * e ter uma versão imprimível pro dia a dia.
 */
export function ServiceOrderPrintPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [state, setState] = useState<'loading' | 'not_found' | 'view'>('loading');
  const [data, setData]   = useState<PrintServiceOrder | null>(null);

  useEffect(() => {
    if (!id || !user) return;
    api.get<PrintServiceOrder>(`/v1/service-orders/${id}/print`)
      .then(d => { setData(d); setState('view'); })
      .catch(() => setState('not_found'));
  }, [id, user]);

  if (authLoading) return <div className="spinner">{t('c.loading')}</div>;
  if (!user) return <Navigate to="/login" replace />;

  if (state === 'loading') return <div className="spinner">{t('c.loading')}</div>;
  if (state === 'not_found' || !data) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2>{t('so.printNotFound')}</h2>
        <button className="btn btn-secondary btn-sm print-hide" style={{ width: 'auto', marginTop: 16 }} onClick={() => navigate('/service-orders')}>
          ← {t('so.title')}
        </button>
      </div>
    );
  }

  const clientAddress = formatAddress(data);
  const hasClientInfo = data.client_name || clientAddress || data.client_phone || data.client_mobile || data.client_email;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <div className="print-hide flex-gap" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
        <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => navigate(-1)}>← {t('c.close')}</button>
        <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => window.print()}>🖨 {t('so.print')}</button>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
          {t('tp.order')} #{data.number}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>{data.title}</h1>
          <span className={`badge ${statusBadge(data.status)}`}>{t(`so.status.${data.status}` as TKey)}</span>
        </div>
        {data.description && <p style={{ fontSize: 14, color: 'var(--muted)', margin: 0 }}>{data.description}</p>}
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>{t('so.printClientTitle')}</strong>
        {!hasClientInfo ? (
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{t('so.printNoClient')}</p>
        ) : (
          <>
            {data.client_name && <div style={{ fontSize: 14, marginBottom: 4 }}><strong>{t('tp.client')}:</strong> {data.client_name}</div>}
            {clientAddress && (
              <div style={{ fontSize: 14, marginBottom: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span><strong>{t('tp.clientAddress')}:</strong> {clientAddress}</span>
                <a className="print-hide" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clientAddress)}`}
                  target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
                  {t('tp.openInMaps')} ↗
                </a>
              </div>
            )}
            {data.client_phone  && <div style={{ fontSize: 14, marginBottom: 4 }}><strong>{t('tp.clientPhone')}:</strong> {data.client_phone}</div>}
            {data.client_mobile && <div style={{ fontSize: 14, marginBottom: 4 }}><strong>{t('tp.clientMobile')}:</strong> {data.client_mobile}</div>}
            {data.client_email  && <div style={{ fontSize: 14 }}><strong>{t('tp.clientEmail')}:</strong> {data.client_email}</div>}
          </>
        )}
      </div>

      <strong style={{ display: 'block', marginBottom: 10, fontSize: 14 }}>{t('so.visits')}</strong>
      {data.visits.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>{t('so.printNoVisits')}</p>
      ) : data.visits.map(v => (
        <div key={v.id} className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <span className={`badge ${statusBadge(v.status)}`}>{v.status}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              {new Date(v.scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </div>
          {v.technician_name && <div style={{ fontSize: 13, marginBottom: 6 }}><strong>{t('so.technician')}:</strong> {v.technician_name}</div>}

          {v.report_notes && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>{t('tp.reportNotes')}</div>
              <p style={{ fontSize: 14, margin: 0, whiteSpace: 'pre-wrap' }}>{v.report_notes}</p>
            </div>
          )}

          {v.photos.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{t('tp.photos')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {v.photos.map(p => (
                  <img key={p.id} src={p.url} alt={p.caption ?? ''}
                    style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                ))}
              </div>
            </div>
          )}

          {v.signature_url && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                {t('tp.signature')} — {v.signed_by_name}
                {v.signed_at && ` (${new Date(v.signed_at).toLocaleDateString('pt-BR')})`}
              </div>
              <img src={v.signature_url} alt="Assinatura" style={{ maxWidth: 280, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
