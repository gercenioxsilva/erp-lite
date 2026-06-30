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
  quantity: number; unit_price: number; discount_pct: number; total: number; notes: string | null;
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
interface IssuerData extends PartyData { logo_url: string | null; }
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

/* ── Scoped stylesheet (fonts + layout + print) ─────────────────────────── */
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

.pp-root{--ink:#14213D;--ink-2:#1E2A47;--paper:#FFFFFF;--paper-2:#F5F7FB;--line:#E6E8EF;
  --muted:#6B7280;--text:#1A2233;--gold:#C8A24B;--green:#16A34A;--danger:#DC2626;
  min-height:100vh;background:var(--paper-2);color:var(--text);
  font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased;
  box-sizing:border-box;padding:28px 16px;overflow-x:hidden;}
.pp-root,.pp-root *{box-sizing:border-box;min-width:0;}
.pp-card,.pp-footer{margin-left:auto;margin-right:auto;}
.pp-tools{justify-content:center;}
.pp-powered{text-align:center;}
.pp-card{width:100%;max-width:760px;background:var(--paper);border-radius:14px;
  box-shadow:0 10px 40px rgba(20,33,61,.10),0 1px 0 rgba(20,33,61,.04);overflow:hidden;margin-bottom:18px;}

/* Header band */
.pp-header{background:var(--ink);color:#fff;padding:30px 36px 26px;position:relative;}
.pp-header__top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap;}
.pp-logo{height:46px;max-width:230px;object-fit:contain;}
.pp-issuer-name{font-family:'Archivo';font-weight:700;font-size:18px;letter-spacing:.2px;}
.pp-propnum{text-align:right;}
.pp-eyebrow{font-size:11px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:#9FB0D0;}
.pp-num{font-family:'Archivo';font-weight:800;font-size:34px;line-height:1;margin-top:2px;
  font-variant-numeric:tabular-nums;}
.pp-rule{height:2px;width:64px;background:var(--gold);margin:18px 0 14px;border-radius:2px;}
.pp-title{font-family:'Archivo';font-weight:600;font-size:19px;line-height:1.25;max-width:560px;overflow-wrap:anywhere;}

/* Meta strip */
.pp-meta{display:flex;flex-wrap:wrap;gap:10px 28px;align-items:center;padding:18px 36px;
  border-bottom:1px solid var(--line);background:var(--paper);}
.pp-meta__k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);}
.pp-meta__v{font-family:'Archivo';font-weight:700;font-size:15px;color:var(--ink);}
.pp-pill{margin-left:auto;font-size:12px;font-weight:600;padding:5px 12px;border-radius:999px;
  border:1px solid var(--line);}
.pp-pill--accepted{background:#E9F8EF;color:#15803D;border-color:#A7E3BE;}
.pp-pill--expired{background:#FDECEC;color:#991B1B;border-color:#F6B9B9;}
.pp-pill--open{background:#EEF2FB;color:var(--ink);}

.pp-body{padding:24px 36px 30px;}

/* Section heading */
.pp-h{display:flex;align-items:center;gap:10px;margin:26px 0 14px;}
.pp-h__bar{width:4px;height:16px;background:var(--gold);border-radius:2px;}
.pp-h__t{font-family:'Archivo';font-weight:700;font-size:14px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--ink);}
.pp-h:first-child{margin-top:6px;}

/* Verification cards */
.pp-note{display:flex;gap:10px;background:#FCF6E9;border:1px solid #ECDCB3;border-left:3px solid var(--gold);
  border-radius:8px;padding:11px 14px;font-size:13px;color:#7A5B16;line-height:1.45;margin-bottom:14px;}
.pp-cards{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.pp-party{border:1px solid var(--line);border-radius:10px;overflow:hidden;}
.pp-party--client{border-color:#D8C089;box-shadow:0 0 0 1px #ECDCB3 inset;}
.pp-party__head{display:flex;align-items:center;gap:8px;padding:10px 14px;font-family:'Archivo';
  font-weight:700;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#fff;background:var(--ink);}
.pp-party--client .pp-party__head{background:var(--gold);color:#3A2D08;}
.pp-party__body{padding:12px 14px;}
.pp-drow{padding:6px 0;border-bottom:1px dashed var(--line);}
.pp-drow:last-child{border-bottom:0;}
.pp-drow__k{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
.pp-drow__v{font-family:'JetBrains Mono','ui-monospace',monospace;font-size:13px;font-weight:500;
  color:var(--text);line-height:1.4;word-break:break-word;}
.pp-drow__v--name{font-family:'Archivo';font-weight:700;font-size:14px;}
.pp-drow__missing{color:#B91C1C;font-family:'Inter';font-style:italic;font-weight:500;}

/* Items table */
.pp-table-wrap{width:100%;max-width:100%;min-width:0;overflow-x:auto;-webkit-overflow-scrolling:touch;
  border:1px solid var(--line);border-radius:10px;}
.pp-table{width:100%;min-width:360px;border-collapse:collapse;font-size:13.5px;}
.pp-item-name{overflow-wrap:break-word;}
.pp-table thead th:first-child{border-top-left-radius:10px;}
.pp-table thead th:last-child{border-top-right-radius:10px;}
.pp-table thead th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#fff;
  background:var(--ink);font-weight:600;padding:10px 12px;}
.pp-table thead th.r{text-align:right;}
.pp-table thead th.c{text-align:center;}
.pp-table tbody td{padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:top;}
.pp-table tbody tr:nth-child(even) td{background:#FAFBFD;}
.pp-item-name{font-weight:600;color:var(--text);}
.pp-item-sub{font-size:12px;color:#9AA1AE;font-family:'JetBrains Mono',monospace;margin-top:2px;}
.pp-num-cell{font-variant-numeric:tabular-nums;}

/* Totals */
.pp-summary{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;justify-content:space-between;margin-top:18px;}
.pp-chips{display:flex;flex-direction:column;gap:8px;}
.pp-chip{display:inline-flex;align-items:baseline;gap:8px;font-size:13px;}
.pp-chip__k{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
.pp-chip__v{font-weight:600;color:var(--ink);}
.pp-totals{min-width:280px;margin-left:auto;}
.pp-trow{display:flex;justify-content:space-between;padding:6px 0;font-size:14px;border-bottom:1px solid var(--line);}
.pp-trow__k{color:var(--muted);}
.pp-trow__v{font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;}
.pp-total{display:flex;justify-content:space-between;align-items:baseline;
  margin-top:10px;padding:14px 16px;background:var(--ink);border-radius:10px;color:#fff;}
.pp-total__k{font-family:'Archivo';font-weight:600;font-size:14px;letter-spacing:.05em;text-transform:uppercase;}
.pp-total__v{font-family:'Archivo';font-weight:800;font-size:26px;font-variant-numeric:tabular-nums;}

/* Prose */
.pp-prose{font-size:14px;color:var(--text);white-space:pre-wrap;line-height:1.5;}
.pp-prose--muted{font-size:13px;color:var(--muted);}

/* Banner */
.pp-banner{border-radius:10px;padding:13px 16px;font-size:14px;font-weight:500;margin:6px 0 0;}
.pp-banner--ok{background:#E9F8EF;border:1px solid #A7E3BE;color:#15803D;}
.pp-banner--warn{background:#FEFCE8;border:1px solid #FDE68A;color:#854D0E;}
.pp-banner--err{background:#FDECEC;border:1px solid #F6B9B9;color:#991B1B;}
.pp-banner--mut{background:#F3F4F6;border:1px solid var(--line);color:#374151;}

/* Actions / forms */
.pp-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;}
.pp-btn{font-family:'Archivo';font-weight:700;font-size:15px;border-radius:10px;padding:13px 26px;
  cursor:pointer;border:1px solid transparent;transition:transform .06s ease,filter .15s ease;display:inline-flex;
  align-items:center;gap:8px;}
.pp-btn:hover{filter:brightness(1.04);}
.pp-btn:active{transform:translateY(1px);}
.pp-btn:disabled{opacity:.6;cursor:default;}
.pp-btn:focus-visible{outline:3px solid #9FB0D0;outline-offset:2px;}
.pp-btn--accept{background:var(--green);color:#fff;}
.pp-btn--ink{background:var(--ink);color:#fff;}
.pp-btn--ghost{background:#fff;color:var(--ink);border-color:var(--line);}
.pp-btn--warn{background:#FFF7ED;color:#B45309;border-color:#F4C77B;}
.pp-input,.pp-textarea{width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:9px;
  font-size:14px;font-family:'Inter';box-sizing:border-box;margin-bottom:11px;background:#fff;color:var(--text);}
.pp-input:focus,.pp-textarea:focus{outline:none;border-color:var(--ink);box-shadow:0 0 0 3px #E6ECF7;}
.pp-textarea{height:84px;resize:vertical;}

/* Footer */
.pp-footer{background:var(--ink);color:#C9D3E6;border-radius:14px;width:100%;max-width:760px;
  padding:22px 28px;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:18px 28px;margin-bottom:14px;}
.pp-foot__k{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#7E8DAB;margin-bottom:5px;
  display:flex;align-items:center;gap:6px;}
.pp-foot__v{font-size:13px;color:#EAF0FA;line-height:1.5;}
.pp-foot__v--mono{font-family:'JetBrains Mono',monospace;}
.pp-foot__brand{font-family:'Archivo';font-weight:700;font-size:15px;color:#fff;}

.pp-tools{display:flex;gap:10px;margin-bottom:8px;}
.pp-powered{font-size:12px;color:#9AA3B2;text-align:center;}

@media (max-width:640px){
  .pp-header,.pp-body{padding-left:20px;padding-right:20px;}
  .pp-meta{padding-left:20px;padding-right:20px;}
  .pp-num{font-size:28px;}
  .pp-propnum{text-align:left;}
  .pp-cards{grid-template-columns:1fr;}
  .pp-total__v{font-size:22px;}
}
@media print{
  .print-hide{display:none !important;}
  .pp-root{background:#fff;padding:0;}
  .pp-card,.pp-footer{box-shadow:none;border:1px solid var(--line);}
}
@media (prefers-reduced-motion:reduce){ .pp-btn{transition:none;} }
`;

/* ── Small render helpers ───────────────────────────────────────────────── */
function DataRow({ k, v, name, missing }: { k: string; v: string | null; name?: boolean; missing?: boolean }) {
  return (
    <div className="pp-drow">
      <div className="pp-drow__k">{k}</div>
      {v
        ? <div className={'pp-drow__v' + (name ? ' pp-drow__v--name' : '')}>{v}</div>
        : <div className={'pp-drow__v ' + (missing ? 'pp-drow__missing' : '')}>{missing ? 'Não informado' : '—'}</div>}
    </div>
  );
}

function PartyCard({ title, icon, party, isClient }: { title: string; icon: string; party: PartyData; isClient?: boolean }) {
  const addr = addressLines(party);
  return (
    <div className={'pp-party' + (isClient ? ' pp-party--client' : '')}>
      <div className="pp-party__head"><span aria-hidden>{icon}</span>{title}</div>
      <div className="pp-party__body">
        <DataRow k={party.document_type === 'CPF' ? 'Nome' : 'Razão social'} v={party.name} name />
        <DataRow k={party.document_type || 'CNPJ'} v={fmtDoc(party.document, party.document_type)} missing={isClient} />
        {party.state_reg !== undefined && <DataRow k="Inscrição estadual" v={party.state_reg ?? null} />}
        <DataRow k="Endereço" v={addr.length ? addr.join('  ·  ') : null} missing={isClient} />
        <DataRow k="Telefone" v={party.phone ? fmtPhone(party.phone) : null} />
        <DataRow k="E-mail" v={party.email} />
      </div>
    </div>
  );
}

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
          <h2 style={{ fontFamily: 'Archivo', color: '#DC2626', margin: '0 0 8px' }}>Proposta não encontrada</h2>
          <p style={{ color: '#6B7280', margin: 0 }}>Este link é inválido ou a proposta foi removida.</p>
        </div>
      </div>
    );
  }
  if (state === 'done_accept') {
    return (
      <div className="pp-root">{Style}
        <div className="pp-card">
          <div className="pp-header" style={{ background: 'var(--green)' }}>
            <div className="pp-num" style={{ fontSize: 26 }}>Proposta aceita ✓</div>
          </div>
          <div className="pp-body"><p style={{ fontSize: 16 }}>Obrigado! Em breve nossa equipe entrará em contato para prosseguir.</p></div>
        </div>
      </div>
    );
  }
  if (state === 'done_reject') {
    return (
      <div className="pp-root">{Style}
        <div className="pp-card">
          <div className="pp-header" style={{ background: '#B45309' }}>
            <div className="pp-num" style={{ fontSize: 26 }}>Solicitação enviada</div>
          </div>
          <div className="pp-body"><p style={{ fontSize: 16 }}>Recebemos sua solicitação de alteração. Prepararemos uma nova proposta em breve.</p></div>
        </div>
      </div>
    );
  }

  const proposal = data!.proposal;
  const items    = data!.items;
  const issuer   = data!.issuer;
  const client   = data!.client;
  const hasDiscountCol = items.some(it => it.discount_pct > 0);

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
        {/* Header */}
        <header className="pp-header">
          <div className="pp-header__top">
            {issuer.logo_url
              ? <img className="pp-logo" src={issuer.logo_url} alt={issuer.name ?? 'Logo'} />
              : <div className="pp-issuer-name">{issuer.name}</div>}
            <div className="pp-propnum">
              <div className="pp-eyebrow">Proposta Nº</div>
              <div className="pp-num">{proposal.number}</div>
            </div>
          </div>
          <div className="pp-rule" />
          <div className="pp-title">{proposal.title}</div>
        </header>

        {/* Meta strip */}
        <div className="pp-meta">
          {(client?.name || data!.client_name) && (
            <div><div className="pp-meta__k">Para</div><div className="pp-meta__v">{client?.name || data!.client_name}</div></div>
          )}
          {proposal.valid_until && (
            <div><div className="pp-meta__k">Válida até</div><div className="pp-meta__v">{fmt(proposal.valid_until)}</div></div>
          )}
          {pill}
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

          {/* Verification (signature) */}
          <div className="pp-h"><span className="pp-h__bar" /><span className="pp-h__t">Confira seus dados</span></div>
          <div className="pp-note">
            <span aria-hidden>⚠</span>
            <span>Estes dados serão usados na <strong>emissão da nota fiscal</strong>. Se algo estiver incorreto, use <strong>"Solicitar alterações"</strong> e avise antes de aceitar.</span>
          </div>
          <div className="pp-cards">
            <PartyCard title="Emissor" icon="🏢" party={issuer} />
            {client
              ? <PartyCard title="Cliente — confira" icon="👤" party={client} isClient />
              : <div className="pp-party pp-party--client"><div className="pp-party__head"><span aria-hidden>👤</span>Cliente</div>
                  <div className="pp-party__body"><p className="pp-prose--muted" style={{ margin: 0 }}>Dados do cliente não vinculados a esta proposta.</p></div></div>}
          </div>

          {/* Items */}
          <div className="pp-h"><span className="pp-h__bar" /><span className="pp-h__t">Itens</span></div>
          <div className="pp-table-wrap">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="c" style={{ width: 64 }}>Qtd</th>
                  <th className="r" style={{ width: 120 }}>Preço</th>
                  {hasDiscountCol && <th className="r" style={{ width: 70 }}>Desc.</th>}
                  <th className="r" style={{ width: 130 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      <div className="pp-item-name">{it.name}</div>
                      {it.sku && <div className="pp-item-sub">SKU {it.sku}</div>}
                      {it.notes && <div className="pp-prose--muted" style={{ marginTop: 2 }}>{it.notes}</div>}
                    </td>
                    <td className="c pp-num-cell">{Number(it.quantity)}{it.unit && it.unit !== 'UN' ? ` ${it.unit}` : ''}</td>
                    <td className="r pp-num-cell">{BRL.format(Number(it.unit_price))}</td>
                    {hasDiscountCol && <td className="r pp-num-cell" style={{ color: '#6B7280' }}>{it.discount_pct > 0 ? `${it.discount_pct}%` : '—'}</td>}
                    <td className="r pp-num-cell" style={{ fontWeight: 700 }}>{BRL.format(Number(it.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary: conditions + totals */}
          <div className="pp-summary">
            <div className="pp-chips">
              {proposal.delivery_time && (
                <span className="pp-chip"><span className="pp-chip__k">Prazo de entrega</span><span className="pp-chip__v">{proposal.delivery_time}</span></span>
              )}
              {proposal.payment_method && (
                <span className="pp-chip"><span className="pp-chip__k">Pagamento</span><span className="pp-chip__v">{paymentLabel(proposal.payment_method)}</span></span>
              )}
            </div>
            <div className="pp-totals">
              <div className="pp-trow"><span className="pp-trow__k">Subtotal</span><span className="pp-trow__v">{BRL.format(proposal.subtotal)}</span></div>
              {proposal.discount > 0 && <div className="pp-trow"><span className="pp-trow__k">Desconto</span><span className="pp-trow__v" style={{ color: '#DC2626' }}>− {BRL.format(proposal.discount)}</span></div>}
              {proposal.shipping > 0 && <div className="pp-trow"><span className="pp-trow__k">Frete</span><span className="pp-trow__v">+ {BRL.format(proposal.shipping)}</span></div>}
              <div className="pp-total"><span className="pp-total__k">Total</span><span className="pp-total__v">{BRL.format(proposal.total)}</span></div>
            </div>
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
            <div className="pp-actions print-hide" style={{ marginTop: 24 }}>
              <button className="pp-btn pp-btn--accept" onClick={() => { setState('accepting'); setError(''); }}>✓ Aceitar proposta</button>
              <button className="pp-btn pp-btn--ghost" onClick={() => { setState('rejecting'); setError(''); }}>Solicitar alterações</button>
            </div>
          )}

          {state === 'accepting' && (
            <div className="print-hide" style={{ marginTop: 24 }}>
              <div className="pp-h"><span className="pp-h__bar" /><span className="pp-h__t">Confirmar aceite</span></div>
              {error && <div className="pp-banner pp-banner--err" style={{ marginBottom: 12 }}>{error}</div>}
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
            <div className="print-hide" style={{ marginTop: 24 }}>
              <div className="pp-h"><span className="pp-h__bar" /><span className="pp-h__t">Solicitar alterações</span></div>
              {error && <div className="pp-banner pp-banner--err" style={{ marginBottom: 12 }}>{error}</div>}
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
          <div className="pp-foot__k">📍 Emissor</div>
          <div className="pp-foot__v pp-foot__brand">{issuer.company || issuer.name}</div>
          {addressLines(issuer).map((l, i) => <div key={i} className="pp-foot__v">{l}</div>)}
        </div>
        {issuer.document && (
          <div><div className="pp-foot__k">📄 {issuer.document_type || 'CNPJ'}</div><div className="pp-foot__v pp-foot__v--mono">{fmtDoc(issuer.document, issuer.document_type)}</div></div>
        )}
        {(issuer.email || issuer.website) && (
          <div><div className="pp-foot__k">✉ Contato</div>
            {issuer.email && <div className="pp-foot__v">{issuer.email}</div>}
            {issuer.website && <div className="pp-foot__v">{issuer.website}</div>}
          </div>
        )}
        {issuer.phone && (
          <div><div className="pp-foot__k">☎ Telefone</div><div className="pp-foot__v pp-foot__v--mono">{fmtPhone(issuer.phone)}</div></div>
        )}
      </footer>

      {(state === 'view' || state === 'already_accepted' || state === 'already_rejected') && (
        <div className="pp-tools print-hide">
          <button className="pp-btn pp-btn--ghost" style={{ fontSize: 13, padding: '9px 16px' }} onClick={() => window.print()}>🖨 Imprimir / Salvar PDF</button>
        </div>
      )}
      <div className="pp-powered print-hide">Powered by Orquestra ERP</div>
    </div>
  );
}
