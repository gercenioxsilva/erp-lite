import { useEffect, useState } from 'react';
import { api, actionErrorMessage } from '../../lib/api';
import { usePermissions } from '../../rbac';

// Chaves públicas de Captação de Leads (/v1/public/leads) — autoatendimento
// do tenant. Toda chave nasce "publishable" (pk_live_...): segura pra
// embutir em JS client-side de landing page (só cria lead, nunca lê nada).
// O SEGREDO só existe na resposta da criação: o modal força o usuário a
// copiá-lo na hora (o backend guarda apenas hash + prefixo, irrecuperável).

interface LeadCaptureKey {
  id: string; name: string; key_prefix: string; status: 'active' | 'revoked';
  rate_limit_per_min: number; allowed_origins: string[] | null;
  last_used_at: string | null; created_at: string;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function LeadCaptureKeysCard() {
  const { can } = usePermissions();
  const [keys, setKeys] = useState<LeadCaptureKey[]>([]);
  const [moduleEnabled, setModuleEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newOrigins, setNewOrigins] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true); setError('');
    try {
      const mods = await api.get<{ enabled: string[] }>('/v1/tenant/modules');
      const on = (mods.enabled ?? []).includes('lead_capture');
      setModuleEnabled(on);
      if (!on) return;
      const resp = await api.get<{ data: LeadCaptureKey[] }>('/v1/lead-capture-keys');
      setKeys(resp.data ?? []);
    } catch (err) { setError(actionErrorMessage(err, 'Falha ao carregar as chaves')); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  // ── Gates DEPOIS de todos os hooks (React #300) ─────────────────────────
  // Estes dois `return null` já estiveram ACIMA do useEffect, e serviam tela
  // branca em /company: no 1º render `loading` é true, a 2ª condição é falsa e
  // o useEffect roda (9 hooks); quando load() descobre o módulo desligado e faz
  // setLoading(false), o 2º render sai aqui e o useEffect nunca é alcançado
  // (8 hooks) → "Rendered fewer hooks than expected" derruba a árvore inteira.
  // Regra: nenhum return condicional antes do último hook.

  // Sem a permissão o backend recusaria de qualquer forma (403) — esconder o
  // card é só UX; a autoridade é sempre o requirePermission da rota.
  if (!can('lead_capture:manage')) return null;
  // Módulo 'lead_capture' desabilitado na aba Módulos → card some (padrão ML/Engine).
  if (!loading && !moduleEnabled) return null;

  async function handleCreate() {
    if (!newName.trim()) { setError('Dê um nome à chave (ex.: "Landing Page — Captação")'); return; }
    setCreating(true); setError('');
    try {
      const allowed_origins = newOrigins.split(',').map(s => s.trim()).filter(Boolean);
      const resp = await api.post<{ data: { secret: string } }>('/v1/lead-capture-keys', {
        name: newName.trim(), allowed_origins: allowed_origins.length ? allowed_origins : undefined,
      });
      setCreatedSecret(resp.data.secret);
      setCopied(false);
      setNewName('');
      setNewOrigins('');
      await load();
    } catch (err) { setError(actionErrorMessage(err, 'Falha ao criar a chave')); }
    finally { setCreating(false); }
  }

  async function handleRevoke(id: string, name: string) {
    if (!window.confirm(`Revogar a chave "${name}"? Landing pages usando essa chave param de enviar leads imediatamente. Essa ação não pode ser desfeita.`)) return;
    setError('');
    try {
      await api.delete(`/v1/lead-capture-keys/${id}`);
      await load();
    } catch (err) { setError(actionErrorMessage(err, 'Falha ao revogar a chave')); }
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>Captação de Leads</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
            Chaves públicas para landing pages enviarem leads pro seu cadastro de clientes
            (<code>POST /v1/public/leads</code>). Seguras pra embutir em JS client-side — só criam lead, nunca leem dados.
          </p>
        </div>
      </div>

      {error && <div role="alert" className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}

      {/* Segredo recém-criado — única chance de copiar */}
      {createdSecret && (
        <div className="alert" style={{ marginTop: 12, background: 'var(--surface-2)', border: '1px solid var(--primary)', borderRadius: 8, padding: 12 }}>
          <strong>Copie a chave agora — ela não será mostrada de novo:</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <code style={{ fontSize: 13, wordBreak: 'break-all', userSelect: 'all' }}>{createdSecret}</code>
            <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
              onClick={() => { void navigator.clipboard.writeText(createdSecret); setCopied(true); }}>
              {copied ? 'Copiada ✓' : 'Copiar'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
              onClick={() => setCreatedSecret(null)}>
              Já guardei
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <input value={newName} onChange={e => setNewName(e.target.value)}
          placeholder='Nome da chave (ex.: "Landing Page — Institucional")'
          style={{ flex: '1 1 240px' }} maxLength={120}
          onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }} />
        <input value={newOrigins} onChange={e => setNewOrigins(e.target.value)}
          placeholder='Domínios permitidos, opcional (ex.: https://meusite.com.br)'
          style={{ flex: '1 1 280px' }}
          onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }} />
        <button type="button" className="btn btn-primary" style={{ width: 'auto' }}
          disabled={creating} onClick={() => void handleCreate()}>
          {creating ? 'Criando…' : '+ Nova chave'}
        </button>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12, margin: '6px 0 0' }}>
        Restringir domínios é uma camada extra de proteção, não uma trava de segurança absoluta
        (o cabeçalho de origem pode ser falsificado fora de um navegador real).
      </p>

      {loading ? (
        <p style={{ color: 'var(--muted)', marginTop: 16 }}>Carregando…</p>
      ) : keys.length === 0 ? (
        <p style={{ color: 'var(--muted)', marginTop: 16 }}>Nenhuma chave criada ainda.</p>
      ) : (
        <table style={{ width: '100%', marginTop: 16, fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
              <th>Nome</th><th>Prefixo</th><th>Limite/min</th><th>Domínios</th><th>Último uso</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 0' }}>{k.name}</td>
                <td><code>{k.key_prefix}…</code></td>
                <td>{k.rate_limit_per_min}</td>
                <td>{k.allowed_origins?.length ? k.allowed_origins.join(', ') : <span style={{ color: 'var(--muted)' }}>qualquer</span>}</td>
                <td>{fmtDate(k.last_used_at)}</td>
                <td>{k.status === 'active'
                  ? <span style={{ color: 'var(--success, green)' }}>ativa</span>
                  : <span style={{ color: 'var(--muted)' }}>revogada</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  {k.status === 'active' && (
                    <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                      onClick={() => void handleRevoke(k.id, k.name)}>
                      Revogar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
