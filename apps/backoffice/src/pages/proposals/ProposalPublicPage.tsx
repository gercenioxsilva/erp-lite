import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

/* ── Types ──────────────────────────────────────────────────────────────── */
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
  quantity: number; unit_price: number; discount_pct: number; total: number;
  notes: string | null; image_url: string | null;
}
interface PartyData {
  name: string | null;
  company?: string | null;
  document: string | null;
  document_type: string | null;
  state_reg?: string | null;
  email: string | null;
  phone: string | null;
  website?: string | null;
  street: string | null;
  street_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
}
interface IssuerData extends PartyData { logo_url: string | null; banner_url: string | null; }
interface PublicProposal {
  proposal: ProposalData;
  items: ItemData[];
  issuer: IssuerData;
  client: PartyData | null;
  client_name: string | null;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'À vista', pix: 'PIX', boleto: 'Boleto', card: 'Cartão de crédito',
  card_installments: 'Cartão parcelado', transfer: 'Transferência / TED', to_agree: 'A combinar',
};
const paymentLabel = (k: string | null): string => (k ? (PAYMENT_LABELS[k] ?? k) : '');

const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');

function fmtDoc(doc: string | null, type: string | null): string {
  if (!doc) return '—';
  const d = digits(doc);
  if ((type === 'CNPJ' || !type) && d.length === 14)
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if ((type === 'CPF' || !type) && d.length === 11)
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return doc;
}
function fmtCep(cep: string | null): string {
  const d = digits(cep);
  return d.length === 8 ? d.replace(/(\d{5})(\d{3})/, '$1-$2') : (cep ?? '');
}
function fmtPhone(p: string | null): string {
  const d = digits(p);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return p ?? '';
}
function addressLines(o: PartyData): string[] {
  const l1 = [o.street, o.street_number].filter(Boolean).join(', ') +
    (o.complement ? ` — ${o.complement}` : '');
  const cityUf = [o.city, o.state].filter(Boolean).join('/');
  const l2 = [o.neighborhood, cityUf].filter(Boolean).join(' · ');
  const l3 = o.zip_code ? `CEP ${fmtCep(o.zip_code)}` : '';
  return [l1, l2, l3].map(s => s.trim()).filter(Boolean);
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

function fmt(d: string | null) {
  if (!d) return '';
  return new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR');
}

type PageState =
  | 'loading' | 'not_found' | 'view' | 'accepting' | 'rejecting'
  | 'done_accept' | 'done_reject' | 'already_accepted' | 'already_rejected'
  | 'expired' | 'cancelled';

/* ── Icons (inline, currentColor) ───────────────────────────────────────── */
const IconPin = () => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>);
const IconDoc = () => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>);
const IconMail = () => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>);
const IconPhone = () => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>);
const IconCalendar = () => (<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>);

/* ── Scoped stylesheet (fonts + layout + print) ─────────────────────────── */
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

.pp-root{--navy:#15244B;--navy-2:#1E3266;--red:#E0241C;--blue:#1F4FD0;--blue-h:#1A45B8;
  --paper:#FFFFFF;--paper-2:#EEF1F7;--line:#E4E8F0;--muted:#6B7280;--text:#1A2233;--green:#16A34A;
  min-height:100vh;background:var(--paper-2);color:var(--text);
  font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased;
  box-sizing:border-box;padding:24px 16px;overflow-x:hidden;}
.pp-root,.pp-root *{box-sizing:border-box;min-width:0;}
.pp-card,.pp-footer{margin-left:auto;margin-right:auto;}
.pp-tools{justify-content:center;}
.pp-powered{text-align:center;}
.pp-card{width:100%;max-width:780px;background:var(--paper);border-radius:16px;
  box-shadow:0 12px 44px rgba(21,36,75,.14),0 1px 0 rgba(21,36,75,.04);overflow:hidden;margin-bottom:18px;}

/* Header band w/ logo + product banner */
.pp-header{position:relative;background:linear-gradient(115deg,var(--navy) 0%,var(--navy-2) 100%);
  color:#fff;padding:30px 34px 30px;overflow:hidden;}
.pp-header__media{position:absolute;top:0;right:0;bottom:0;left:38%;background-size:cover;background-position:center right;}
.pp-header__media::after{content:"";position:absolute;inset:0;
  background:linear-gradient(90deg,var(--navy) 2%,rgba(21,36,75,.78) 26%,rgba(21,36,75,.05) 100%);}
.pp-header::after{content:"";position:absolute;right:-40px;top:-30px;width:160px;height:200px;
  background:var(--red);transform:rotate(18deg);opacity:.9;border-radius:0 0 0 60px;z-index:0;}
.pp-header__inner{position:relative;z-index:2;}
.pp-logo{height:58px;max-width:280px;object-fit:contain;display:block;}
.pp-issuer-name{font-family:'Archivo';font-weight:800;font-size:22px;letter-spacing:.2px;}
.pp-propblock{margin-top:30px;}
.pp-eyebrow{font-family:'Archivo';font-size:13px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;color:#A9BAE0;}
.pp-num{font-family:'Archivo';font-weight:900;font-size:52px;line-height:.96;margin-top:2px;
  font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.pp-rule{height:4px;width:84px;background:var(--red);margin:14px 0 12px;border-radius:3px;}
.pp-title{font-family:'Archivo';font-weight:600;font-size:15px;letter-spacing:.04em;text-transform:uppercase;
  color:#CBD6EF;max-width:60%;overflow-wrap:anywhere;}

/* "Para" / validity card */
.pp-meta{margin:18px 24px;display:flex;flex-wrap:wrap;gap:16px 24px;align-items:center;justify-content:space-between;
  background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:18px 24px;
  box-shadow:0 4px 16px rgba(21,36,75,.05);}
.pp-meta__to .pp-meta__k{color:var(--red);font-family:'Archivo';font-weight:700;font-size:13px;letter-spacing:.04em;text-transform:uppercase;}
.pp-meta__to .pp-meta__v{font-family:'Archivo';font-weight:800;font-size:22px;color:var(--navy);line-height:1.1;margin-top:2px;}
.pp-meta__valid{display:flex;align-items:center;gap:12px;}
.pp-meta__cal{color:var(--red);flex:none;}
.pp-meta__k{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);}
.pp-meta__v{font-family:'Archivo';font-weight:800;font-size:18px;color:var(--navy);}
.pp-pill{font-size:12px;font-weight:600;padding:6px 13px;border-radius:999px;border:1px solid var(--line);white-space:nowrap;}
.pp-pill--accepted{background:#E9F8EF;color:#15803D;border-color:#A7E3BE;}
.pp-pill--expired{background:#FDECEC;color:#991B1B;border-color:#F6B9B9;}
.pp-pill--open{background:#EEF2FB;color:var(--navy);border-color:#D5DEF3;}

.pp-body{padding:8px 24px 28px;}

/* Section heading */
.pp-h{display:flex;align-items:center;gap:10px;margin:22px 0 14px;}
.pp-h__bar{width:14px;height:14px;background:var(--red);border-radius:3px;transform:skewX(-8deg);}
.pp-h__t{font-family:'Archivo';font-weight:800;font-size:15px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--navy);}

/* Items table */
.pp-table-wrap{width:100%;max-width:100%;min-width:0;overflow-x:auto;-webkit-overflow-scrolling:touch;
  border:1px solid var(--line);border-radius:12px;}
.pp-table{width:100%;min-width:420px;border-collapse:collapse;font-size:14px;}
.pp-table thead th{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#fff;
  background:var(--navy);font-weight:700;padding:13px 14px;font-family:'Archivo';}
.pp-table thead th.r{text-align:right;}
.pp-table thead th.c{text-align:center;}
.pp-table tbody td{padding:14px;border-bottom:1px solid var(--line);vertical-align:middle;}
.pp-table tbody tr:last-child td{border-bottom:0;}
.pp-itemcell{display:flex;align-items:center;gap:14px;}
.pp-thumb{width:54px;height:54px;flex:none;border-radius:10px;object-fit:cover;border:1px solid var(--line);background:#fff;}
.pp-thumb--ph{display:flex;align-items:center;justify-content:center;color:#C2C9D6;background:var(--paper-2);}
.pp-item-name{font-family:'Archivo';font-weight:700;color:var(--navy);font-size:15px;overflow-wrap:break-word;}
.pp-item-sub{font-size:12px;color:#94A0B5;font-family:'JetBrains Mono',monospace;margin-top:3px;}
.pp-num-cell{font-variant-numeric:tabular-nums;}

/* Totals */
.pp-summary{margin-top:18px;}
.pp-chips{display:flex;flex-wrap:wrap;gap:8px 22px;margin-bottom:14px;}
.pp-chip{display:inline-flex;align-items:baseline;gap:8px;font-size:13px;}
.pp-chip__k{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
.pp-chip__v{font-weight:600;color:var(--navy);}
.pp-trow{display:flex;justify-content:space-between;align-items:center;padding:11px 4px;font-size:15px;border-top:1px solid var(--line);}
.pp-trow__k{color:var(--muted);}
.pp-trow__v{font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;}
.pp-total{display:flex;justify-content:space-between;align-items:baseline;padding:16px 4px 4px;border-top:2px solid var(--navy);margin-top:4px;}
.pp-total__k{font-family:'Archivo';font-weight:800;font-size:22px;color:var(--navy);}
.pp-total__v{font-family:'Archivo';font-weight:900;font-size:34px;color:var(--blue);font-variant-numeric:tabular-nums;letter-spacing:-.01em;}

/* Prose */
.pp-prose{font-size:14px;color:var(--text);white-space:pre-wrap;line-height:1.5;}
.pp-prose--muted{font-size:13px;color:var(--muted);}

/* Banner / status */
.pp-banner{border-radius:10px;padding:13px 16px;font-size:14px;font-weight:500;margin:0 0 14px;}
.pp-banner--ok{background:#E9F8EF;border:1px solid #A7E3BE;color:#15803D;}
.pp-banner--warn{background:#FEFCE8;border:1px solid #FDE68A;color:#854D0E;}
.pp-banner--err{background:#FDECEC;border:1px solid #F6B9B9;color:#991B1B;}
.pp-banner--mut{background:#F3F4F6;border:1px solid var(--line);color:#374151;}

/* Actions / forms */
.pp-actions{display:flex;flex-direction:column;gap:12px;margin-top:22px;}
.pp-btn{font-family:'Archivo';font-weight:800;font-size:17px;border-radius:12px;padding:16px 26px;
  cursor:pointer;border:2px solid transparent;transition:transform .06s ease,filter .15s ease,background .15s ease;
  display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;}
.pp-btn:hover{filter:brightness(1.03);}
.pp-btn:active{transform:translateY(1px);}
.pp-btn:disabled{opacity:.6;cursor:default;}
.pp-btn:focus-visible{outline:3px solid #9FB0D0;outline-offset:2px;}
.pp-btn--accept{background:var(--blue);color:#fff;}
.pp-btn--accept:hover{background:var(--blue-h);}
.pp-btn--ghost{background:#fff;color:var(--navy);border-color:var(--line);}
.pp-btn--ghost:hover{border-color:var(--navy);}
.pp-btn--warn{background:#FFF7ED;color:#B45309;border-color:#F4C77B;}
.pp-btn--sm{width:auto;font-size:13px;padding:10px 18px;border-radius:9px;}
.pp-input,.pp-textarea{width:100%;padding:13px 14px;border:1px solid var(--line);border-radius:10px;
  font-size:15px;font-family:'Inter';box-sizing:border-box;margin-bottom:12px;background:#fff;color:var(--text);}
.pp-input:focus,.pp-textarea:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(31,79,208,.15);}
.pp-textarea{height:96px;resize:vertical;}

/* Footer */
.pp-footer{background:var(--navy);color:#C9D3E6;border-radius:16px;width:100%;max-width:780px;
  padding:24px 30px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:22px 30px;margin-bottom:14px;
  border-top:4px solid var(--red);}
.pp-foot__k{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8E9DBC;margin-bottom:7px;
  display:flex;align-items:center;gap:8px;}
.pp-foot__ico{width:26px;height:26px;flex:none;border-radius:7px;background:var(--red);color:#fff;
  display:inline-flex;align-items:center;justify-content:center;}
.pp-foot__v{font-size:13px;color:#EAF0FA;line-height:1.55;}
.pp-foot__v--mono{font-family:'JetBrains Mono',monospace;}
.pp-foot__brand{font-family:'Archivo';font-weight:800;font-size:15px;color:#fff;}

.pp-tools{display:flex;gap:10px;margin-bottom:8px;}
.pp-powered{font-size:12px;color:#9AA3B2;text-align:center;}

@media (max-width:640px){
  .pp-header{padding:24px 20px;}
  .pp-header__media{left:50%;}
  .pp-num{font-size:38px;}
  .pp-title{max-width:100%;}
  .pp-meta{margin:14px;padding:16px;flex-direction:column;align-items:flex-start;}
  .pp-body{padding-left:16px;padding-right:16px;}
  .pp-total__v{font-size:28px;}
}
@media print{
  .print-hide{display:none !important;}
  .pp-root{background:#fff;padding:0;}
  .pp-card,.pp-footer{box-shadow:none;border:1px solid var(--line);}
  .pp-header__media{print-color-adjust:exact;-webkit-print-color-adjust:exact;}
}
@media (prefers-reduced-motion:reduce){ .pp-btn{transition:none;} }
`;

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

  const Style = <style dangerouslySetInnerHTML={{ __html: STYLES }} />;

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
  const clientName = client?.name || data!.client_name;
  const hasDiscountCol = items.some(it => it.discount_pct > 0);
  const issuerAddr = addressLines(issuer);

  const pill =
    state === 'already_accepted' ? <span className="pp-pill pp-pill--accepted">Aceita</span>
    : state === 'expired'        ? <span className="pp-pill pp-pill--expired">Expirada</span>
    : state === 'already_rejected' ? <span className="pp-pill pp-pill--open">Em revisão</span>
    : state === 'cancelled'      ? <span className="pp-pill pp-pill--open">Cancelada</span>
    : <span className="pp-pill pp-pill--open">Proposta comercial</span>;

  return (
    <div className="pp-root">
      {Style}
      <div className="pp-card">
        {/* Header — logo + product banner */}
        <header className="pp-header">
          {issuer.banner_url && <div className="pp-header__media" style={{ backgroundImage: `url(${issuer.banner_url})` }} />}
          <div className="pp-header__inner">
            {issuer.logo_url
              ? <img className="pp-logo" src={issuer.logo_url} alt={issuer.name ?? 'Logo'} />
              : <div className="pp-issuer-name">{issuer.name}</div>}
            <div className="pp-propblock">
              <div className="pp-eyebrow">Proposta</div>
              <div className="pp-num">Nº {proposal.number}</div>
              <div className="pp-rule" />
              <div className="pp-title">{proposal.title}</div>
            </div>
          </div>
        </header>

        {/* Para / válida até */}
        <div className="pp-meta">
          <div className="pp-meta__to">
            <div className="pp-meta__k">Para:</div>
            <div className="pp-meta__v">{clientName || 'Cliente'}</div>
          </div>
          <div className="pp-meta__valid">
            {proposal.valid_until && (<>
              <span className="pp-meta__cal"><IconCalendar /></span>
              <div><div className="pp-meta__k">Válida até:</div><div className="pp-meta__v">{fmt(proposal.valid_until)}</div></div>
            </>)}
            {pill}
          </div>
        </div>

        <div className="pp-body">
          {/* Status banners */}
          {state === 'already_accepted' && (
            <div className="pp-banner pp-banner--ok">
              Esta proposta já foi aceita{proposal.accepted_by_name ? ` por ${proposal.accepted_by_name}` : ''}.
            </div>
          )}
          {state === 'already_rejected' && <div className="pp-banner pp-banner--warn">Esta proposta aguarda revisão.</div>}
          {state === 'expired' && <div className="pp-banner pp-banner--err">Esta proposta expirou. Entre em contato para solicitar uma nova.</div>}
          {state === 'cancelled' && <div className="pp-banner pp-banner--mut">Esta proposta foi cancelada.</div>}

          {/* Items */}
          <div className="pp-h"><span className="pp-h__bar" /><span className="pp-h__t">Itens</span></div>
          <div className="pp-table-wrap">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="c" style={{ width: 70 }}>Qtd</th>
                  <th className="r" style={{ width: 120 }}>Preço</th>
                  {hasDiscountCol && <th className="r" style={{ width: 70 }}>Desc.</th>}
                  <th className="r" style={{ width: 130 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      <div className="pp-itemcell">
                        {it.image_url
                          ? <img className="pp-thumb" src={it.image_url} alt={it.name} />
                          : <span className="pp-thumb pp-thumb--ph" aria-hidden>
                              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                            </span>}
                        <div>
                          <div className="pp-item-name">{it.name}</div>
                          {it.sku && <div className="pp-item-sub">SKU {it.sku}</div>}
                          {it.notes && <div className="pp-prose--muted" style={{ marginTop: 3 }}>{it.notes}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="c pp-num-cell">{Number(it.quantity)}{it.unit && it.unit !== 'UN' ? ` ${it.unit}` : ''}</td>
                    <td className="r pp-num-cell">{BRL.format(Number(it.unit_price))}</td>
                    {hasDiscountCol && <td className="r pp-num-cell" style={{ color: '#6B7280' }}>{it.discount_pct > 0 ? `${it.discount_pct}%` : '—'}</td>}
                    <td className="r pp-num-cell" style={{ fontWeight: 800, color: 'var(--navy)' }}>{BRL.format(Number(it.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="pp-summary">
            {(proposal.delivery_time || proposal.payment_method) && (
              <div className="pp-chips">
                {proposal.delivery_time && (
                  <span className="pp-chip"><span className="pp-chip__k">Prazo de entrega</span><span className="pp-chip__v">{proposal.delivery_time}</span></span>
                )}
                {proposal.payment_method && (
                  <span className="pp-chip"><span className="pp-chip__k">Pagamento</span><span className="pp-chip__v">{paymentLabel(proposal.payment_method)}</span></span>
                )}
              </div>
            )}
            <div className="pp-trow"><span className="pp-trow__k">Subtotal</span><span className="pp-trow__v">{BRL.format(proposal.subtotal)}</span></div>
            {proposal.discount > 0 && <div className="pp-trow"><span className="pp-trow__k">Desconto</span><span className="pp-trow__v" style={{ color: 'var(--red)' }}>− {BRL.format(proposal.discount)}</span></div>}
            {proposal.shipping > 0 && <div className="pp-trow"><span className="pp-trow__k">Frete</span><span className="pp-trow__v">+ {BRL.format(proposal.shipping)}</span></div>}
            <div className="pp-total"><span className="pp-total__k">Total</span><span className="pp-total__v">{BRL.format(proposal.total)}</span></div>
          </div>

          {/* Notes & Terms */}
          {proposal.notes && (<>
            <div className="pp-h"><span className="pp-h__bar" /><span className="pp-h__t">Observações</span></div>
            <p className="pp-prose" style={{ margin: 0 }}>{proposal.notes}</p>
          </>)}
          {proposal.terms_text && (<>
            <div className="pp-h"><span className="pp-h__bar" /><span className="pp-h__t">Termos e condições</span></div>
            <p className="pp-prose pp-prose--muted" style={{ margin: 0 }}>{proposal.terms_text}</p>
          </>)}

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
        </div>
      </div>

      {/* Footer — issuer registration data */}
      <footer className="pp-footer">
        <div>
          <div className="pp-foot__k"><span className="pp-foot__ico"><IconPin /></span>{issuer.company || issuer.name}</div>
          {issuerAddr.map((l, i) => <div key={i} className="pp-foot__v">{l}</div>)}
        </div>
        {issuer.document && (
          <div>
            <div className="pp-foot__k"><span className="pp-foot__ico"><IconDoc /></span>{issuer.document_type || 'CNPJ'}</div>
            <div className="pp-foot__v pp-foot__v--mono">{fmtDoc(issuer.document, issuer.document_type)}</div>
            {issuer.state_reg && (<><div className="pp-foot__k" style={{ marginTop: 8 }}>IE</div><div className="pp-foot__v pp-foot__v--mono">{issuer.state_reg}</div></>)}
          </div>
        )}
        {(issuer.email || issuer.website) && (
          <div>
            <div className="pp-foot__k"><span className="pp-foot__ico"><IconMail /></span>Email</div>
            {issuer.email && <div className="pp-foot__v">{issuer.email}</div>}
            {issuer.website && <div className="pp-foot__v">{issuer.website}</div>}
          </div>
        )}
        {issuer.phone && (
          <div>
            <div className="pp-foot__k"><span className="pp-foot__ico"><IconPhone /></span>Telefone</div>
            <div className="pp-foot__v pp-foot__v--mono">{fmtPhone(issuer.phone)}</div>
          </div>
        )}
      </footer>

      {(state === 'view' || state === 'already_accepted' || state === 'already_rejected') && (
        <div className="pp-tools print-hide">
          <button className="pp-btn pp-btn--ghost pp-btn--sm" onClick={() => window.print()}>🖨 Imprimir / Salvar PDF</button>
        </div>
      )}
      <div className="pp-powered print-hide">Powered by Orquestra ERP</div>
    </div>
  );
}
