// Assistente Fiscal IA — chat sobre POST /v1/fiscal/assistant. Respostas
// ancoradas em tool_results do próprio tenant. Renderizado apenas quando
// /v1/fiscal/score devolve assistantEnabled=true (ANTHROPIC_API_KEY set).
// Além do texto, a resposta pode trazer uma AÇÃO estruturada: um rascunho de
// NFS-e que o usuário aceita (POST /v1/nfse) ou um link para a guia de impostos.

import { useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { usePermissions } from '../../rbac';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface NfseDraft {
  client_id: string; client_name: string; company_id: string | null;
  amount: number; service_code: string; iss_rate: number; iss_retido: boolean;
  description: string; competencia: string; idempotency_key: string;
}
type AssistantAction =
  | { type: 'nfse_proposal'; draft: NfseDraft }
  | { type: 'open_guia'; apuracaoId: string; competencia: string; dasTotal: number; vencimento: string };

interface ChatMessage { role: 'user' | 'assistant'; content: string; action?: AssistantAction }
interface AssistantResponse { reply: string; tools_used: string[]; action?: AssistantAction }

const SUGGESTIONS = [
  'Quanto vou pagar de DAS este mês?',
  'Gere uma nota como a última do cliente…',
  'Como está minha saúde fiscal?',
  'Gere a guia dos impostos do mês passado',
];

export function AssistantChat() {
  const { can } = usePermissions();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToEnd() {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    setBusy(true);
    setInput('');
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: message }];
    setMessages(nextMessages);
    try {
      const r = await api.post<AssistantResponse>('/v1/fiscal/assistant', {
        message,
        history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      });
      setMessages([...nextMessages, { role: 'assistant', content: r.reply, action: r.action }]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Limite diário do assistente atingido. Tente novamente amanhã.');
      } else if (err instanceof ApiError && err.status === 503) {
        setError('Assistente desativado neste ambiente.');
      } else {
        setError('Falha ao consultar o assistente. Tente novamente.');
      }
      setMessages(nextMessages);
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {messages.length === 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="btn btn-sm" disabled={busy} onClick={() => void send(s)}>{s}</button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div ref={scrollRef} style={{ maxHeight: 360, overflowY: 'auto', display: 'grid', gap: 8 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'grid', gap: 6, justifyItems: m.role === 'user' ? 'end' : 'start' }}>
              <div style={{
                maxWidth: '85%', padding: '8px 12px', borderRadius: 12, fontSize: 13, whiteSpace: 'pre-wrap',
                background: m.role === 'user' ? 'var(--primary, #2563eb)' : 'var(--surface-2, #f1f5f9)',
                color: m.role === 'user' ? '#fff' : 'inherit',
              }}>{m.content}</div>
              {m.action?.type === 'nfse_proposal' && (
                <NfseProposalCard draft={m.action.draft} canEmit={can('nfse:emit')} />
              )}
              {m.action?.type === 'open_guia' && (
                <GuiaCard action={m.action} />
              )}
            </div>
          ))}
          {busy && <div style={{ fontSize: 13, color: 'var(--muted, #64748b)' }}>Consultando seus dados fiscais…</div>}
        </div>
      )}

      {error && <p style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>{error}</p>}

      <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte sobre DAS, alertas, ou peça uma nota / a guia do mês…"
          maxLength={2000}
          disabled={busy}
          style={{ flex: 1, fontSize: 13, padding: '8px 10px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 8 }}
        />
        <button type="submit" className="btn" disabled={busy || input.trim() === ''}>Enviar</button>
      </form>
      <p style={{ fontSize: 11, color: 'var(--muted, #94a3b8)', margin: 0 }}>
        Respostas geradas por IA a partir dos seus dados fiscais. Nenhuma nota é emitida sem a sua confirmação. Não substitui o contador.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--muted, #64748b)' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function NfseProposalCard({ draft, canEmit }: { draft: NfseDraft; canEmit: boolean }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'cancelled'>('idle');
  const [nfseId, setNfseId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function accept() {
    setState('sending');
    setErr(null);
    try {
      const r = await api.post<{ nfse_id: string }>('/v1/nfse', {
        client_id: draft.client_id, amount: draft.amount, description: draft.description,
        service_code: draft.service_code, iss_rate: draft.iss_rate, iss_retido: draft.iss_retido,
        company_id: draft.company_id, idempotency_key: draft.idempotency_key,
      });
      setNfseId(r.nfse_id);
      setState('done');
    } catch (e) {
      const body = e instanceof ApiError ? e.body : undefined;
      const reasons = Array.isArray((body as any)?.reasons) ? ` (${(body as any).reasons.join(', ')})` : '';
      setErr((e instanceof ApiError ? traduzErro((body as any)?.error) : 'Falha ao emitir') + reasons);
      setState('idle');
    }
  }

  return (
    <div style={{
      maxWidth: '85%', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 12,
      background: 'var(--surface, #fff)', display: 'grid', gap: 8, fontSize: 13,
    }}>
      <div style={{ fontWeight: 700 }}>📄 Rascunho de NFS-e</div>
      <Field label="Cliente" value={draft.client_name} />
      <Field label="Valor" value={BRL.format(draft.amount)} />
      <Field label="Código de serviço" value={draft.service_code || '—'} />
      <Field label="ISS" value={`${draft.iss_rate.toFixed(2)}%${draft.iss_retido ? ' (retido)' : ''}`} />
      <Field label="Descrição" value={draft.description} />
      <Field label="Competência" value={draft.competencia} />

      {state === 'done' ? (
        <div style={{ color: '#16a34a', fontWeight: 600 }}>
          ✓ Nota criada e enviada para emissão. {nfseId && <a href={`/nfse`} style={{ textDecoration: 'underline' }}>ver notas</a>}
        </div>
      ) : state === 'cancelled' ? (
        <div style={{ color: 'var(--muted)' }}>Rascunho descartado.</div>
      ) : (
        <>
          {err && <p style={{ color: '#dc2626', margin: 0 }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" disabled={state === 'sending'} onClick={() => setState('cancelled')}>Cancelar</button>
            {canEmit ? (
              <button className="btn btn-sm" style={{ fontWeight: 700, borderColor: 'var(--primary, #2563eb)' }}
                disabled={state === 'sending'} onClick={() => void accept()}>
                {state === 'sending' ? 'Emitindo…' : 'Aceitar e emitir'}
              </button>
            ) : (
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>Você não tem permissão para emitir NFS-e.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function GuiaCard({ action }: { action: Extract<AssistantAction, { type: 'open_guia' }> }) {
  return (
    <div style={{
      maxWidth: '85%', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 12,
      background: 'var(--surface, #fff)', display: 'grid', gap: 8, fontSize: 13,
    }}>
      <div style={{ fontWeight: 700 }}>🧾 Guia de impostos — {action.competencia}</div>
      <Field label="DAS" value={BRL.format(action.dasTotal)} />
      <Field label="Vencimento" value={action.vencimento} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" style={{ fontWeight: 700, borderColor: 'var(--primary, #2563eb)' }}
          onClick={() => window.open(`/fiscal/apuracao/${action.apuracaoId}/guia`, '_blank', 'noopener,noreferrer')}>
          Abrir guia (imprimir)
        </button>
      </div>
    </div>
  );
}

function traduzErro(code?: string): string {
  switch (code) {
    case 'emission_not_ready': return 'Cadastro fiscal incompleto para emitir';
    case 'competencia_travada': return 'Competência do mês está travada';
    case 'client_not_found': return 'Cliente não encontrado';
    case 'service_code_missing': return 'Sem código de serviço definido';
    case 'invalid_amount': return 'Valor inválido';
    default: return 'Falha ao emitir a nota';
  }
}
