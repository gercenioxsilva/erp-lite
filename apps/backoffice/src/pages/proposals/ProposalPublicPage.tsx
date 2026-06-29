import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

interface ProposalData {
  number: string; title: string; status: string;
  valid_until: string | null; notes: string | null; terms_text: string | null;
  delivery_time: string | null; payment_method: string | null;
  subtotal: number; discount: number; shipping: number; total: number;
  accepted_at: string | null; accepted_by_name: string | null;
  rejected_at: string | null; rejected_reason: string | null;
}
interface ItemData {
  name: string; sku: string | null; unit: string;
  quantity: number; unit_price: number; discount_pct: number; total: number; notes: string | null;
}
interface IssuerData { name: string; logo_url: string | null; }

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'À vista', pix: 'PIX', boleto: 'Boleto', card: 'Cartão de crédito',
  card_installments: 'Cartão parcelado', transfer: 'Transferência / TED', to_agree: 'A combinar',
};
const paymentLabel = (k: string | null): string => (k ? (PAYMENT_LABELS[k] ?? k) : '');
interface PublicProposal {
  proposal: ProposalData;
  items: ItemData[];
  issuer: IssuerData;
  client_name: string | null;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

async function fetchPublic<T>(path: string, options?: RequestInit): Promise<T> {
  const base = (window as any).__API_BASE__ || (import.meta as any).env?.VITE_API_URL || '';
  const url = base + path;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}

function fmt(d: string | null) {
  if (!d) return '';
  return new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR');
}

type PageState = 'loading' | 'not_found' | 'view' | 'accepting' | 'rejecting' | 'done_accept' | 'done_reject' | 'already_accepted' | 'already_rejected' | 'expired' | 'cancelled';

export function ProposalPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [state,    setState]    = useState<PageState>('loading');
  const [data,     setData]     = useState<PublicProposal | null>(null);
  const [error,    setError]    = useState('');

  const [acceptName,  setAcceptName]  = useState('');
  const [acceptEmail, setAcceptEmail] = useState('');
  const [acceptNotes, setAcceptNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [submitting,   setSubmitting]   = useState(false);

  useEffect(() => {
    if (!token) { setState('not_found'); return; }
    fetchPublic<PublicProposal>(`/v1/public/proposals/${token}`)
      .then(d => {
        setData(d);
        const s = d.proposal.status;
        if (s === 'accepted')  setState('already_accepted');
        else if (s === 'rejected') setState('already_rejected');
        else if (s === 'expired')  setState('expired');
        else if (s === 'cancelled') setState('cancelled');
        else setState('view');
      })
      .catch(() => setState('not_found'));
  }, [token]);

  async function handleAccept() {
    if (!acceptName.trim()) { setError('Seu nome é obrigatório.'); return; }
    if (!acceptEmail.trim()) { setError('Seu e-mail é obrigatório.'); return; }
    setSubmitting(true); setError('');
    try {
      await fetchPublic(`/v1/public/proposals/${token}/accept`, {
        method: 'POST',
        body: JSON.stringify({ name: acceptName.trim(), email: acceptEmail.trim(), notes: acceptNotes.trim() || undefined }),
      });
      setState('done_accept');
    } catch {
      setError('Erro ao enviar. Tente novamente.');
    } finally { setSubmitting(false); }
  }

  async function handleReject() {
    setSubmitting(true); setError('');
    try {
      await fetchPublic(`/v1/public/proposals/${token}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      });
      setState('done_reject');
    } catch {
      setError('Erro ao enviar. Tente novamente.');
    } finally { setSubmitting(false); }
  }

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh', background: '#F2F5FB', fontFamily: 'sans-serif',
    display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px',
  };
  const cardStyle: React.CSSProperties = {
    width: '100%', maxWidth: 680, background: '#fff', borderRadius: 12,
    boxShadow: '0 2px 16px rgba(0,0,0,.08)', overflow: 'hidden', marginBottom: 24,
  };
  const hdrStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg,#3B5CE4,#00B4D8)',
    padding: '28px 32px', color: '#fff',
  };
  const bodyStyle: React.CSSProperties = { padding: '28px 32px' };
  const sectionStyle: React.CSSProperties = {
    borderTop: '1px solid #e5e7eb', paddingTop: 20, marginTop: 20,
  };
  const rowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between',
    padding: '6px 0', fontSize: 14, borderBottom: '1px solid #f3f4f6',
  };
  const labelStyle: React.CSSProperties = { color: '#6b7280' };
  const valueStyle: React.CSSProperties = { fontWeight: 600, color: '#0D1B2A' };
  const btnPrimary: React.CSSProperties = {
    background: '#3B5CE4', color: '#fff', border: 'none', borderRadius: 8,
    padding: '12px 28px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
  };
  const btnSecondary: React.CSSProperties = {
    background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8,
    padding: '12px 28px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8,
    fontSize: 14, marginBottom: 12, boxSizing: 'border-box',
  };
  const textareaStyle: React.CSSProperties = { ...inputStyle, height: 80, resize: 'vertical' };

  if (state === 'loading') {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, ...bodyStyle, textAlign: 'center', color: '#6b7280' }}>
          Carregando proposta...
        </div>
      </div>
    );
  }

  if (state === 'not_found') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ ...bodyStyle, textAlign: 'center' }}>
            <h2 style={{ color: '#dc2626' }}>Proposta não encontrada</h2>
            <p style={{ color: '#6b7280' }}>Este link é inválido ou a proposta foi removida.</p>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'done_accept') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ ...hdrStyle, background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}>
            <h1 style={{ margin: 0 }}>Proposta aceita!</h1>
          </div>
          <div style={{ ...bodyStyle, textAlign: 'center' }}>
            <p style={{ fontSize: 16, color: '#374151' }}>Obrigado! Em breve nossa equipe entrará em contato para prosseguir.</p>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'done_reject') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ ...hdrStyle, background: 'linear-gradient(135deg,#f59e0b,#d97706)' }}>
            <h1 style={{ margin: 0 }}>Solicitação enviada!</h1>
          </div>
          <div style={{ ...bodyStyle, textAlign: 'center' }}>
            <p style={{ fontSize: 16, color: '#374151' }}>Recebemos sua solicitação de alteração. Prepararemos uma nova proposta em breve.</p>
          </div>
        </div>
      </div>
    );
  }

  const proposal = data!.proposal;
  const items    = data!.items;
  const issuer   = data!.issuer;

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {/* Header */}
        <div style={hdrStyle}>
          {issuer.logo_url && (
            <img src={issuer.logo_url} alt={issuer.name} style={{ height: 48, marginBottom: 12, objectFit: 'contain' }} />
          )}
          <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 4 }}>{issuer.name}</div>
          <h1 style={{ margin: '0 0 4px', fontSize: 24 }}>Proposta #{proposal.number}</h1>
          <div style={{ fontSize: 15, opacity: 0.9 }}>{proposal.title}</div>
        </div>

        <div style={bodyStyle}>
          {/* Meta */}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
            {data!.client_name && (
              <div><span style={labelStyle}>Para: </span><strong>{data!.client_name}</strong></div>
            )}
            {proposal.valid_until && (
              <div><span style={labelStyle}>Válida até: </span><strong>{fmt(proposal.valid_until)}</strong></div>
            )}
            {proposal.delivery_time && (
              <div><span style={labelStyle}>Prazo de entrega: </span><strong>{proposal.delivery_time}</strong></div>
            )}
            {proposal.payment_method && (
              <div><span style={labelStyle}>Pagamento: </span><strong>{paymentLabel(proposal.payment_method)}</strong></div>
            )}
            {(state === 'already_accepted' || proposal.status === 'accepted') && proposal.accepted_by_name && (
              <div><span style={{ ...labelStyle, color: '#16a34a' }}>Aceita por: </span><strong style={{ color: '#16a34a' }}>{proposal.accepted_by_name}</strong></div>
            )}
          </div>

          {/* Status messages */}
          {state === 'already_accepted' && (
            <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#15803d' }}>
              Esta proposta já foi aceita.
            </div>
          )}
          {state === 'already_rejected' && (
            <div style={{ background: '#fefce8', border: '1px solid #fde047', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#854d0e' }}>
              Esta proposta aguarda revisão.
            </div>
          )}
          {state === 'expired' && (
            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#991b1b' }}>
              Esta proposta expirou. Entre em contato para solicitar uma nova proposta.
            </div>
          )}
          {state === 'cancelled' && (
            <div style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#374151' }}>
              Esta proposta foi cancelada.
            </div>
          )}

          {/* Items */}
          <div style={sectionStyle}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#374151' }}>Itens</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#F2F5FB' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 500 }}>Item</th>
                    <th style={{ padding: '8px 8px', textAlign: 'center', color: '#6b7280', fontWeight: 500, width: 60 }}>Qtd</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', color: '#6b7280', fontWeight: 500, width: 110 }}>Preço</th>
                    {items.some(it => it.discount_pct > 0) && (
                      <th style={{ padding: '8px 8px', textAlign: 'right', color: '#6b7280', fontWeight: 500, width: 70 }}>Desc.</th>
                    )}
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280', fontWeight: 500, width: 110 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 500 }}>{it.name}</div>
                        {it.sku && <div style={{ fontSize: 12, color: '#9ca3af' }}>SKU: {it.sku}</div>}
                        {it.notes && <div style={{ fontSize: 12, color: '#6b7280' }}>{it.notes}</div>}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', color: '#374151' }}>
                        {Number(it.quantity)}{it.unit !== 'UN' ? ` ${it.unit}` : ''}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', color: '#374151' }}>
                        {BRL.format(Number(it.unit_price))}
                      </td>
                      {items.some(x => x.discount_pct > 0) && (
                        <td style={{ padding: '10px 8px', textAlign: 'right', color: '#6b7280' }}>
                          {it.discount_pct > 0 ? `${it.discount_pct}%` : ''}
                        </td>
                      )}
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>
                        {BRL.format(Number(it.total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div style={{ ...sectionStyle, maxWidth: 320, marginLeft: 'auto' }}>
            <div style={rowStyle}>
              <span style={labelStyle}>Subtotal</span>
              <span style={valueStyle}>{BRL.format(proposal.subtotal)}</span>
            </div>
            {proposal.discount > 0 && (
              <div style={rowStyle}>
                <span style={labelStyle}>Desconto</span>
                <span style={{ ...valueStyle, color: '#dc2626' }}>− {BRL.format(proposal.discount)}</span>
              </div>
            )}
            {proposal.shipping > 0 && (
              <div style={rowStyle}>
                <span style={labelStyle}>Frete</span>
                <span style={valueStyle}>+ {BRL.format(proposal.shipping)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontWeight: 700, fontSize: 18 }}>
              <span>Total</span>
              <span style={{ color: '#3B5CE4' }}>{BRL.format(proposal.total)}</span>
            </div>
          </div>

          {/* Notes & Terms */}
          {proposal.notes && (
            <div style={sectionStyle}>
              <h3 style={{ margin: '0 0 8px', fontSize: 15, color: '#374151' }}>Observações</h3>
              <p style={{ margin: 0, fontSize: 14, color: '#374151', whiteSpace: 'pre-wrap' }}>{proposal.notes}</p>
            </div>
          )}
          {proposal.terms_text && (
            <div style={sectionStyle}>
              <h3 style={{ margin: '0 0 8px', fontSize: 15, color: '#374151' }}>Termos e condições</h3>
              <p style={{ margin: 0, fontSize: 13, color: '#6b7280', whiteSpace: 'pre-wrap' }}>{proposal.terms_text}</p>
            </div>
          )}

          {/* Action buttons */}
          {state === 'view' && (
            <div style={sectionStyle}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button style={btnPrimary} onClick={() => { setState('accepting'); setError(''); }}>
                  ✓ Aceitar Proposta
                </button>
                <button style={btnSecondary} onClick={() => { setState('rejecting'); setError(''); }}>
                  ✗ Solicitar Alterações
                </button>
              </div>
            </div>
          )}

          {/* Accept form */}
          {state === 'accepting' && (
            <div style={sectionStyle}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#374151' }}>Confirmar Aceite</h3>
              {error && <div style={{ background: '#fee2e2', borderRadius: 6, padding: '10px 14px', marginBottom: 12, color: '#dc2626', fontSize: 14 }}>{error}</div>}
              <input style={inputStyle} placeholder="Seu nome *" value={acceptName} onChange={e => setAcceptName(e.target.value)} />
              <input style={inputStyle} type="email" placeholder="Seu e-mail *" value={acceptEmail} onChange={e => setAcceptEmail(e.target.value)} />
              <textarea style={textareaStyle} placeholder="Observações (opcional)" value={acceptNotes} onChange={e => setAcceptNotes(e.target.value)} />
              <div style={{ display: 'flex', gap: 12 }}>
                <button style={btnPrimary} onClick={handleAccept} disabled={submitting}>
                  {submitting ? 'Enviando...' : 'Confirmar Aceite'}
                </button>
                <button style={btnSecondary} onClick={() => setState('view')}>Voltar</button>
              </div>
            </div>
          )}

          {/* Reject form */}
          {state === 'rejecting' && (
            <div style={sectionStyle}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#374151' }}>Solicitar Alterações</h3>
              {error && <div style={{ background: '#fee2e2', borderRadius: 6, padding: '10px 14px', marginBottom: 12, color: '#dc2626', fontSize: 14 }}>{error}</div>}
              <textarea style={textareaStyle} placeholder="Descreva o que precisa ser alterado" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
              <div style={{ display: 'flex', gap: 12 }}>
                <button style={{ ...btnSecondary, background: '#fff7ed', borderColor: '#f59e0b', color: '#d97706' }}
                  onClick={handleReject} disabled={submitting}>
                  {submitting ? 'Enviando...' : 'Enviar Solicitação'}
                </button>
                <button style={btnSecondary} onClick={() => setState('view')}>Voltar</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Print / PDF */}
      {(state === 'view' || state === 'already_accepted' || state === 'already_rejected') && (
        <div style={{ marginBottom: 16 }} className="print-hide">
          <button
            style={{ ...btnSecondary, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => window.print()}
          >
            🖨 Imprimir / Salvar PDF
          </button>
        </div>
      )}

      <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center' }} className="print-hide">
        Powered by Orquestra ERP
      </div>
    </div>
  );
}
