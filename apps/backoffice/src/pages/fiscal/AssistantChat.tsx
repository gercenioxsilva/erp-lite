// Assistente Fiscal IA — chat sobre POST /v1/fiscal/assistant (read-only,
// respostas ancoradas em tool_results do próprio tenant). Renderizado apenas
// quando /v1/fiscal/score devolve assistantEnabled=true (ANTHROPIC_API_KEY set).

import { useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';

interface ChatMessage { role: 'user' | 'assistant'; content: string }
interface AssistantResponse { reply: string; tools_used: string[] }

const SUGGESTIONS = [
  'Quanto vou pagar de DAS este mês?',
  'Por que meu DAS aumentou?',
  'Como está minha saúde fiscal?',
  'Quais alertas estão abertos?',
];

export function AssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
        history: messages.slice(-10),
      });
      setMessages([...nextMessages, { role: 'assistant', content: r.reply }]);
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
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
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
        <div ref={scrollRef} style={{ maxHeight: 320, overflowY: 'auto', display: 'grid', gap: 8 }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              justifySelf: m.role === 'user' ? 'end' : 'start',
              maxWidth: '85%', padding: '8px 12px', borderRadius: 12, fontSize: 13, whiteSpace: 'pre-wrap',
              background: m.role === 'user' ? 'var(--primary, #2563eb)' : 'var(--surface-2, #f1f5f9)',
              color: m.role === 'user' ? '#fff' : 'inherit',
            }}>{m.content}</div>
          ))}
          {busy && <div style={{ fontSize: 13, color: 'var(--muted, #64748b)' }}>Consultando seus dados fiscais…</div>}
        </div>
      )}

      {error && <p style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>{error}</p>}

      <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte sobre DAS, alertas, faturamento…"
          maxLength={2000}
          disabled={busy}
          style={{ flex: 1, fontSize: 13, padding: '8px 10px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 8 }}
        />
        <button type="submit" className="btn" disabled={busy || input.trim() === ''}>Enviar</button>
      </form>
      <p style={{ fontSize: 11, color: 'var(--muted, #94a3b8)', margin: 0 }}>
        Respostas geradas por IA a partir dos seus dados fiscais. Não substitui o contador.
      </p>
    </div>
  );
}
