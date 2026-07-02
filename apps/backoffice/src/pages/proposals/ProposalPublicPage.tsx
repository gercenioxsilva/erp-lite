import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ProposalDocument, ProposalDocumentStyle,
  type ProposalData, type ItemData, type PartyData, type IssuerData,
} from './ProposalDocument';

interface PublicProposal {
  proposal: ProposalData;
  items: ItemData[];
  issuer: IssuerData;
  client: PartyData | null;
  client_name: string | null;
}

async function fetchPublic<T>(path: string, options?: RequestInit): Promise<T> {
  const base = (window as any).__API_BASE__ || (import.meta as any).env?.VITE_API_URL || '';
  const res = await fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}

type PageState =
  | 'loading' | 'not_found' | 'view' | 'accepting' | 'rejecting'
  | 'done_accept' | 'done_reject' | 'already_accepted' | 'already_rejected'
  | 'expired' | 'cancelled';

/* ── Page ───────────────────────────────────────────────────────────────── */
export function ProposalPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>('loading');
  const [data, setData]   = useState<PublicProposal | null>(null);
  const [error, setError] = useState('');

  const [acceptName,  setAcceptName]  = useState('');
  const [acceptEmail, setAcceptEmail] = useState('');
  const [acceptNotes, setAcceptNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting]   = useState(false);

  useEffect(() => {
    if (!token) { setState('not_found'); return; }
    fetchPublic<PublicProposal>(`/v1/public/proposals/${token}`)
      .then(d => {
        setData(d);
        const s = d.proposal.status;
        if (s === 'accepted')       setState('already_accepted');
        else if (s === 'rejected')  setState('already_rejected');
        else if (s === 'expired')   setState('expired');
        else if (s === 'cancelled') setState('cancelled');
        else setState('view');
      })
      .catch(() => setState('not_found'));
  }, [token]);

  async function handleAccept() {
    if (!acceptName.trim())  { setError('Seu nome é obrigatório.'); return; }
    if (!acceptEmail.trim()) { setError('Seu e-mail é obrigatório.'); return; }
    setSubmitting(true); setError('');
    try {
      await fetchPublic(`/v1/public/proposals/${token}/accept`, {
        method: 'POST',
        body: JSON.stringify({ name: acceptName.trim(), email: acceptEmail.trim(), notes: acceptNotes.trim() || undefined }),
      });
      setState('done_accept');
    } catch { setError('Erro ao enviar. Tente novamente.'); }
    finally { setSubmitting(false); }
  }

  async function handleReject() {
    setSubmitting(true); setError('');
    try {
      await fetchPublic(`/v1/public/proposals/${token}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      });
      setState('done_reject');
    } catch { setError('Erro ao enviar. Tente novamente.'); }
    finally { setSubmitting(false); }
  }

  const Style = <ProposalDocumentStyle />;

  /* ── Terminal / simple states ── */
  if (state === 'loading') {
    return <div className="pp-root">{Style}<div className="pp-card" style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Carregando proposta…</div></div>;
  }
  if (state === 'not_found') {
    return (
      <div className="pp-root">{Style}
        <div className="pp-card" style={{ padding: 40, textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'Archivo', color: '#E0241C', margin: '0 0 8px' }}>Proposta não encontrada</h2>
          <p style={{ color: '#6B7280', margin: 0 }}>Este link é inválido ou a proposta foi removida.</p>
        </div>
      </div>
    );
  }
  if (state === 'done_accept') {
    return (
      <div className="pp-root">{Style}
        <div className="pp-card">
          <div className="pp-header"><div className="pp-header__inner"><div className="pp-num" style={{ fontSize: 30 }}>Proposta aceita ✓</div></div></div>
          <div className="pp-body"><p style={{ fontSize: 16 }}>Obrigado! Em breve nossa equipe entrará em contato para prosseguir.</p></div>
        </div>
      </div>
    );
  }
  if (state === 'done_reject') {
    return (
      <div className="pp-root">{Style}
        <div className="pp-card">
          <div className="pp-header"><div className="pp-header__inner"><div className="pp-num" style={{ fontSize: 30 }}>Solicitação enviada</div></div></div>
          <div className="pp-body"><p style={{ fontSize: 16 }}>Recebemos sua solicitação de alteração. Prepararemos uma nova proposta em breve.</p></div>
        </div>
      </div>
    );
  }

  const proposal = data!.proposal;
  const items    = data!.items;
  const issuer   = data!.issuer;
  const client   = data!.client;

  const pill =
    state === 'already_accepted' ? <span className="pp-pill pp-pill--accepted">Aceita</span>
    : state === 'expired'        ? <span className="pp-pill pp-pill--expired">Expirada</span>
    : state === 'already_rejected' ? <span className="pp-pill pp-pill--open">Em revisão</span>
    : state === 'cancelled'      ? <span className="pp-pill pp-pill--open">Cancelada</span>
    : <span className="pp-pill pp-pill--open">Proposta comercial</span>;

  const banner = (
    <>
      {state === 'already_accepted' && (
        <div className="pp-banner pp-banner--ok">
          Esta proposta já foi aceita{proposal.accepted_by_name ? ` por ${proposal.accepted_by_name}` : ''}.
        </div>
      )}
      {state === 'already_rejected' && <div className="pp-banner pp-banner--warn">Esta proposta aguarda revisão.</div>}
      {state === 'expired' && <div className="pp-banner pp-banner--err">Esta proposta expirou. Entre em contato para solicitar uma nova.</div>}
      {state === 'cancelled' && <div className="pp-banner pp-banner--mut">Esta proposta foi cancelada.</div>}
    </>
  );

  return (
    <div className="pp-root">
      {Style}
      <ProposalDocument
        proposal={proposal} items={items} issuer={issuer} client={client}
        clientName={client?.name || data!.client_name} pill={pill} banner={banner}
      >
        {/* Actions */}
        {state === 'view' && (
          <div className="pp-actions print-hide">
            <button className="pp-btn pp-btn--accept" onClick={() => { setState('accepting'); setError(''); }}>✓ Aceitar Proposta</button>
            <button className="pp-btn pp-btn--ghost" onClick={() => { setState('rejecting'); setError(''); }}>✕ Solicitar Alterações</button>
          </div>
        )}

        {state === 'accepting' && (
          <div className="print-hide" style={{ marginTop: 22 }}>
            <div className="pp-h"><span className="pp-h__bar" /><span className="pp-h__t">Confirmar aceite</span></div>
            {error && <div className="pp-banner pp-banner--err">{error}</div>}
            <input className="pp-input" placeholder="Seu nome *" value={acceptName} onChange={e => setAcceptName(e.target.value)} />
            <input className="pp-input" type="email" placeholder="Seu e-mail *" value={acceptEmail} onChange={e => setAcceptEmail(e.target.value)} />
            <textarea className="pp-textarea" placeholder="Observações (opcional)" value={acceptNotes} onChange={e => setAcceptNotes(e.target.value)} />
            <div className="pp-actions">
              <button className="pp-btn pp-btn--accept" onClick={handleAccept} disabled={submitting}>{submitting ? 'Enviando…' : 'Confirmar aceite'}</button>
              <button className="pp-btn pp-btn--ghost" onClick={() => setState('view')}>Voltar</button>
            </div>
          </div>
        )}

        {state === 'rejecting' && (
          <div className="print-hide" style={{ marginTop: 22 }}>
            <div className="pp-h"><span className="pp-h__bar" /><span className="pp-h__t">Solicitar alterações</span></div>
            {error && <div className="pp-banner pp-banner--err">{error}</div>}
            <textarea className="pp-textarea" placeholder="Descreva o que precisa ser alterado (ex.: corrigir CNPJ, endereço, itens…)" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
            <div className="pp-actions">
              <button className="pp-btn pp-btn--warn" onClick={handleReject} disabled={submitting}>{submitting ? 'Enviando…' : 'Enviar solicitação'}</button>
              <button className="pp-btn pp-btn--ghost" onClick={() => setState('view')}>Voltar</button>
            </div>
          </div>
        )}
      </ProposalDocument>

      {(state === 'view' || state === 'already_accepted' || state === 'already_rejected') && (
        <div className="pp-tools print-hide">
          <button className="pp-btn pp-btn--ghost pp-btn--sm" onClick={() => window.print()}>🖨 Imprimir / Salvar PDF</button>
        </div>
      )}
      <div className="pp-powered print-hide">Powered by Orquestra ERP</div>
    </div>
  );
}
