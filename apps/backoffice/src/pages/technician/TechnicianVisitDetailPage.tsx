import { useEffect, useRef, useState, PointerEvent as ReactPointerEvent } from 'react';
import { useParams, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';
import { TechnicianLayout } from './TechnicianLayout';
import { compressImage, canvasToPngBlob, uploadToPresignedPost, type PresignedUpload } from '../../lib/visitUpload';

interface VisitDetail {
  id: string; status: string; scheduled_at: string; report_notes: string | null;
  signature_s3_key: string | null; signed_by_name: string | null;
}
interface OrderInfo { id: string; number: string; title: string; description: string | null; type: string; }
interface ClientInfo {
  id: string; company_name: string | null; full_name: string | null;
  phone: string | null; mobile: string | null; email: string | null;
  street: string | null; street_number: string | null; complement: string | null;
  neighborhood: string | null; city: string | null; state: string | null; zip_code: string | null;
}
// Formulário técnico dinâmico (migration 0088) — schema definido pelo
// admin do tenant em Minha Empresa → Campos da Visita Técnica; o técnico
// preenche as respostas aqui, no momento da visita.
interface VisitFieldDefinition {
  id: string; label: string; field_type: 'text' | 'decimal' | 'integer' | 'date' | 'boolean'; required: boolean;
}
interface VisitFieldValue { field_definition_id: string; value: string | null; }
interface VisitResponse {
  visit: VisitDetail; order: OrderInfo | null; client: ClientInfo | null;
  fieldDefinitions: VisitFieldDefinition[]; fieldValues: VisitFieldValue[];
}

// Monta o endereço completo pra exibição e pra query do link de mapa —
// omite partes ausentes em vez de deixar buracos tipo "Rua X,  - Bairro".
function formatAddress(c: ClientInfo): string {
  const line1 = [c.street, c.street_number].filter(Boolean).join(', ');
  const parts = [line1, c.complement, c.neighborhood, c.city && c.state ? `${c.city}/${c.state}` : c.city, c.zip_code].filter(Boolean);
  return parts.join(' — ');
}

export function TechnicianVisitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  const [state, setState]   = useState<'loading' | 'ready' | 'not_found'>('loading');
  const [data, setData]     = useState<VisitResponse | null>(null);
  const [error, setError]   = useState('');

  const [checkingIn, setCheckingIn] = useState(false);
  const [reportNotes, setReportNotes] = useState('');
  const [completing, setCompleting] = useState(false);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signedByName, setSignedByName] = useState('');
  const [signatureConfirmed, setSignatureConfirmed] = useState(false);
  const [signing, setSigning] = useState(false);

  async function load() {
    try {
      const r = await api.get<VisitResponse>(`/v1/technician/visits/${id}`);
      setData(r);
      setReportNotes(r.visit.report_notes || '');
      setSignatureConfirmed(!!r.visit.signature_s3_key);
      // Pré-preenche com respostas já salvas — o técnico pode reabrir a
      // visita (ex.: perdeu conexão) e não perde o que já respondeu.
      const values: Record<string, string> = {};
      for (const v of r.fieldValues) if (v.value != null) values[v.field_definition_id] = v.value;
      setCustomFieldValues(values);
      setState('ready');
    } catch {
      setState('not_found');
    }
  }
  useEffect(() => { if (user?.role === 'technician' && id) void load(); }, [user, id]);

  if (authLoading) return <div className="spinner">{t('c.loading')}</div>;
  if (!user) return <Navigate to={`/tecnico/entrar?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  if (user.role !== 'technician') return <Navigate to="/dashboard" replace />;

  async function handleCheckIn() {
    setCheckingIn(true); setError('');
    try {
      await api.post(`/v1/technician/visits/${id}/check-in`, {});
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : t('tp.linkExpired'));
    } finally { setCheckingIn(false); }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingPhoto(true); setError('');
    try {
      const compressed = await compressImage(file);
      const idempotencyKey = crypto.randomUUID();
      const presigned = await api.post<PresignedUpload>(`/v1/technician/visits/${id}/photos/presign`, { content_type: 'image/jpeg' });
      await uploadToPresignedPost(presigned, compressed, `${idempotencyKey}.jpg`);
      await api.post(`/v1/technician/visits/${id}/photos/confirm`, {
        s3_key: presigned.key, content_type: 'image/jpeg',
        file_size_bytes: compressed.size, idempotency_key: idempotencyKey,
      });
      setPhotoPreviews(prev => [...prev, URL.createObjectURL(compressed)]);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : t('tp.uploading'));
    } finally { setUploadingPhoto(false); }
  }

  function canvasPos(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function startDraw(e: ReactPointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = canvasPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function draw(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = canvasPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#0D1B2A'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
    setHasSignature(true);
  }
  function endDraw() { drawingRef.current = false; }
  function clearSignature() {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false); setSignatureConfirmed(false);
  }

  async function confirmSignature() {
    if (!hasSignature) return;
    if (!signedByName.trim()) { setError(t('tp.signedByName') + ' *'); return; }
    setSigning(true); setError('');
    try {
      const blob = await canvasToPngBlob(canvasRef.current!);
      const presigned = await api.post<PresignedUpload>(`/v1/technician/visits/${id}/signature/presign`, {});
      await uploadToPresignedPost(presigned, blob, 'signature.png');
      await api.post(`/v1/technician/visits/${id}/signature/confirm`, { s3_key: presigned.key, signed_by_name: signedByName.trim() });
      setSignatureConfirmed(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : t('tp.confirmSignature'));
    } finally { setSigning(false); }
  }

  async function handleComplete() {
    // Validação client-side dos campos obrigatórios do formulário técnico —
    // mesmo espírito do required nativo usado em ContractsPage.tsx, mas
    // manual aqui porque este bloco não é um <form> (mistura fotos/
    // assinatura/relatório, cada um com o próprio fluxo de salvamento).
    // O backend valida de novo (nunca confia só no client), mas travar aqui
    // evita o roundtrip e mostra o campo faltante em pt-BR.
    const missing = (data?.fieldDefinitions ?? []).find(def => def.required && !customFieldValues[def.id]?.trim());
    if (missing) { setError(`${missing.label}: ${t('tp.fieldRequired')}`); return; }

    setCompleting(true); setError('');
    try {
      await api.post(`/v1/technician/visits/${id}/complete`, {
        report_notes: reportNotes || undefined,
        custom_fields: (data?.fieldDefinitions ?? []).map(def => ({
          field_definition_id: def.id,
          value: customFieldValues[def.id]?.trim() || null,
        })),
      });
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : t('tp.complete'));
    } finally { setCompleting(false); }
  }

  if (state === 'loading') return <TechnicianLayout><div className="spinner">{t('c.loading')}</div></TechnicianLayout>;
  if (state === 'not_found' || !data) return (
    <TechnicianLayout>
      <div className="empty-state">{t('tp.notFound')}</div>
      <button className="btn btn-secondary btn-sm" style={{ width: 'auto', marginTop: 12 }} onClick={() => navigate('/tecnico/visitas')}>{t('tp.backToList')}</button>
    </TechnicianLayout>
  );

  const { visit, order, client } = data;
  const clientName    = client ? (client.company_name ?? client.full_name) : null;
  const clientAddress = client ? formatAddress(client) : '';

  return (
    <TechnicianLayout>
      <button className="btn btn-secondary btn-sm" style={{ width: 'auto', marginBottom: 14 }} onClick={() => navigate('/tecnico/visitas')}>
        {t('tp.backToList')}
      </button>

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>{t('tp.order')}</div>
        <h1 style={{ fontSize: 19, margin: '0 0 8px' }}>{order?.title ?? '—'}</h1>
        {order?.description && <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 10px' }}>{order.description}</p>}
        {clientName && (
          <div style={{ fontSize: 13, marginBottom: 4 }}><strong>{t('tp.client')}:</strong> {clientName}</div>
        )}
        {clientAddress && (
          <div style={{ fontSize: 13, marginBottom: 4, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span><strong>{t('tp.clientAddress')}:</strong> {clientAddress}</span>
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clientAddress)}`}
              target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
              {t('tp.openInMaps')} ↗
            </a>
          </div>
        )}
        {client?.phone && (
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <strong>{t('tp.clientPhone')}:</strong> <a href={`tel:${client.phone}`}>{client.phone}</a>
          </div>
        )}
        {client?.mobile && (
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <strong>{t('tp.clientMobile')}:</strong> <a href={`tel:${client.mobile}`}>{client.mobile}</a>
          </div>
        )}
        {client?.email && (
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <strong>{t('tp.clientEmail')}:</strong> <a href={`mailto:${client.email}`}>{client.email}</a>
          </div>
        )}
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {t('tp.scheduledFor')}: {new Date(visit.scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

      {visit.status === 'scheduled' && (
        <button className="btn btn-primary" onClick={handleCheckIn} disabled={checkingIn}>
          {checkingIn ? t('c.saving') : t('tp.checkIn')}
        </button>
      )}

      {visit.status === 'in_progress' && (
        <>
          {/* ── Fotos ── */}
          <div className="card" style={{ padding: 18, marginBottom: 16 }}>
            <strong style={{ display: 'block', marginBottom: 10 }}>{t('tp.photos')}</strong>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
              onChange={handlePhotoChange} style={{ display: 'none' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {photoPreviews.map((src, i) => (
                <img key={i} src={src} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
              ))}
            </div>
            <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
              disabled={uploadingPhoto} onClick={() => fileInputRef.current?.click()}>
              {uploadingPhoto ? t('tp.uploading') : t('tp.addPhoto')}
            </button>
          </div>

          {/* ── Assinatura ── */}
          <div className="card" style={{ padding: 18, marginBottom: 16 }}>
            <strong style={{ display: 'block', marginBottom: 4 }}>{t('tp.signature')}</strong>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{t('tp.signatureConsent')}</p>

            {signatureConfirmed ? (
              <div className="alert alert-success">{t('tp.confirmSignature')} ✓ {visit.signed_by_name}</div>
            ) : (
              <>
                <canvas
                  ref={canvasRef} width={560} height={180}
                  style={{ width: '100%', maxWidth: 560, height: 180, touchAction: 'none', background: '#fff', border: '1px dashed var(--border)', borderRadius: 8, marginBottom: 8 }}
                  onPointerDown={startDraw} onPointerMove={draw} onPointerUp={endDraw} onPointerLeave={endDraw}
                />
                <div className="field" style={{ maxWidth: 320 }}>
                  <label htmlFor="signed-by">{t('tp.signedByName')}</label>
                  <input id="signed-by" value={signedByName} onChange={e => setSignedByName(e.target.value)} placeholder={t('tp.signedByNamePH')} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={clearSignature}>{t('tp.clearSignature')}</button>
                  <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                    disabled={!hasSignature || signing} onClick={confirmSignature}>
                    {signing ? t('c.saving') : t('tp.confirmSignature')}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ── Formulário técnico dinâmico (migration 0088) ── */}
          {data.fieldDefinitions.length > 0 && (
            <div className="card" style={{ padding: 18, marginBottom: 16 }}>
              <strong style={{ display: 'block', marginBottom: 10 }}>{t('tp.customFieldsTitle')}</strong>
              {data.fieldDefinitions.map(def => (
                <div className="field" key={def.id}>
                  <label>{def.label}{def.required ? ' *' : ''}</label>
                  {def.field_type === 'boolean' ? (
                    <select
                      value={customFieldValues[def.id] ?? ''}
                      onChange={e => setCustomFieldValues(v => ({ ...v, [def.id]: e.target.value }))}>
                      <option value="">—</option>
                      <option value="true">{t('c.yes')}</option>
                      <option value="false">{t('c.no')}</option>
                    </select>
                  ) : (
                    <input
                      type={def.field_type === 'date' ? 'date' : (def.field_type === 'decimal' || def.field_type === 'integer') ? 'number' : 'text'}
                      step={def.field_type === 'decimal' ? '0.01' : undefined}
                      value={customFieldValues[def.id] ?? ''}
                      onChange={e => setCustomFieldValues(v => ({ ...v, [def.id]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Relatório + finalizar ── */}
          <div className="card" style={{ padding: 18, marginBottom: 16 }}>
            <div className="field">
              <label htmlFor="report">{t('tp.reportNotes')}</label>
              <textarea id="report" rows={4} value={reportNotes} onChange={e => setReportNotes(e.target.value)} placeholder={t('tp.reportNotesPH')} />
            </div>
            <button className="btn btn-primary" disabled={!signatureConfirmed || completing} onClick={handleComplete}>
              {completing ? t('c.saving') : t('tp.complete')}
            </button>
          </div>
        </>
      )}

      {(visit.status === 'completed' || visit.status === 'cancelled') && (
        <div className="card" style={{ padding: 18 }}>
          <div className="alert alert-success" style={{ marginBottom: 12 }}>{t('tp.visitCompleted')}</div>
          {visit.report_notes && <p style={{ fontSize: 14 }}>{visit.report_notes}</p>}
          {visit.signed_by_name && <p style={{ fontSize: 13, color: 'var(--muted)' }}>Assinado por {visit.signed_by_name}</p>}
          {data.fieldValues.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              {data.fieldValues.map(fv => {
                const def = data.fieldDefinitions.find(d => d.id === fv.field_definition_id);
                if (!def || fv.value == null) return null;
                const display = def.field_type === 'boolean' ? (fv.value === 'true' ? t('c.yes') : t('c.no')) : fv.value;
                return (
                  <div key={fv.field_definition_id} style={{ fontSize: 13, marginBottom: 4 }}>
                    <strong>{def.label}:</strong> {display}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </TechnicianLayout>
  );
}
