// Tela administrativa transversal de Integrações (backend 0091).
//
// Um card por par (provider × ambiente) — é assim que a API devolve, e é assim
// que o operador raciocina: "a Focus de homologação está ligada, a de produção
// não". Ligar um ambiente desliga o outro do mesmo provider (regra do backend);
// como toda mutação devolve a lista inteira, a tela só reflete a resposta em vez
// de tentar prever o efeito colateral.

import { useEffect, useMemo, useState } from 'react';
import './integrations.css';
import { api, actionErrorMessage } from '../../lib/api';
import { usePermissions } from '../../rbac';
import { ProviderCard } from './ProviderCard';
import { CredentialsDrawer } from './CredentialsDrawer';
import { IntegrationLogsTable } from './IntegrationLogsTable';
import { cardId, type PingResult, type PublicProviderCard } from './types';

export function IntegrationsPage() {
  const { can } = usePermissions();
  const canManage = can('tenant_modules:manage');

  const [cards, setCards]       = useState<PublicProviderCard[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError]       = useState('');
  const [notice, setNotice]     = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [pinging, setPinging]   = useState<string | null>(null);
  const [editing, setEditing]   = useState<PublicProviderCard | null>(null);
  const [logsRefresh, setLogsRefresh] = useState(0);

  async function load() {
    setLoadError(false);
    try {
      const resp = await api.get<{ data: PublicProviderCard[] }>('/v1/tenant/integrations');
      setCards(resp.data ?? []);
    } catch {
      setLoadError(true);
    }
  }
  useEffect(() => { void load(); }, []);

  // O drawer aberto precisa acompanhar a lista recarregada (o `filled` de cada
  // campo muda depois de salvar) — senão ele mostraria o estado pré-salvamento.
  const editingCard = editing
    ? cards?.find(c => cardId(c) === cardId(editing)) ?? editing
    : null;

  const providerOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const c of cards ?? []) if (!byKey.has(c.key)) byKey.set(c.key, c.label);
    return Array.from(byKey, ([key, label]) => ({ key, label }));
  }, [cards]);

  async function handleToggle(card: PublicProviderCard) {
    setToggling(cardId(card)); setError(''); setNotice('');
    try {
      const resp = await api.patch<{ data: PublicProviderCard[] }>(
        `/v1/tenant/integrations/${card.key}/${card.environment}`, { enabled: !card.enabled });
      setCards(resp.data ?? []);
    } catch (err) {
      // O 400 de "preencha as credenciais obrigatórias" já vem pronto do backend.
      setError(actionErrorMessage(err, 'Falha ao alterar a integração'));
    } finally {
      setToggling(null);
    }
  }

  async function handlePing(card: PublicProviderCard) {
    setPinging(cardId(card)); setError(''); setNotice('');
    try {
      // O ping responde 200 mesmo quando o teste falha — `ok` é o resultado,
      // não o transporte. Só um erro de rede/permissão cai no catch.
      const resp = await api.post<{ data: PingResult }>(
        `/v1/tenant/integrations/${card.key}/${card.environment}/ping`, {});
      const result = resp.data;
      if (result.ok) setNotice(`${card.label}: ${result.message}`);
      else setError(`${card.label}: ${result.message}`);
      await load();                       // atualiza o "último teste" do card
      setLogsRefresh(k => k + 1);         // o ping virou uma linha de log
    } catch (err) {
      setError(actionErrorMessage(err, 'Falha ao testar a conexão'));
    } finally {
      setPinging(null);
    }
  }

  async function handleSaveCredentials(
    card: PublicProviderCard, credentials: Record<string, string | null>, services: string[],
  ) {
    const resp = await api.put<{ data: PublicProviderCard[] }>(
      `/v1/tenant/integrations/${card.key}/${card.environment}`, { credentials, services });
    setCards(resp.data ?? []);
    setEditing(null);
    setError('');
    setNotice(`${card.label}: credenciais salvas.`);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Integrações</h1>
      </div>

      {error  && <div role="alert"  className="alert alert-error">{error}</div>}
      {notice && <div role="status" className="alert alert-success">{notice}</div>}

      <div className="int-page">
        <section>
          <div className="int-section__head">
            <div>
              <h2>Configurações de provedores</h2>
              <p>Provedores de integração com credenciais, ambiente e serviços habilitados.</p>
            </div>
          </div>

          {loadError ? (
            <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
              <p style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>
                Não foi possível carregar as integrações.
              </p>
              <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                onClick={() => void load()}>
                Tentar novamente
              </button>
            </div>
          ) : cards === null ? (
            <div className="int-grid" aria-busy="true">
              {[0, 1, 2].map(i => (
                <div key={i} style={{ height: 210, borderRadius: 'var(--r-lg)', background: 'var(--surface-2)' }} />
              ))}
            </div>
          ) : cards.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Nenhuma integração disponível.</p>
          ) : (
            <div className="int-grid">
              {cards.map(card => (
                <ProviderCard
                  key={cardId(card)}
                  card={card}
                  canManage={canManage}
                  toggling={toggling === cardId(card)}
                  pinging={pinging === cardId(card)}
                  onToggle={() => void handleToggle(card)}
                  onEdit={() => { setEditing(card); setError(''); setNotice(''); }}
                  onPing={() => void handlePing(card)}
                />
              ))}
            </div>
          )}

          <p className="int-note">
            Credenciais são armazenadas em texto puro por ora (apenas administradores
            podem editar). A migração para KMS será feita na fase de observabilidade.
          </p>
        </section>

        {/* Logs exigem tenant_modules:manage no backend — sem a permissão o
            bloco nem monta, para não render um 403 garantido. */}
        {canManage && (
          <IntegrationLogsTable providers={providerOptions} refreshKey={logsRefresh} />
        )}
      </div>

      {editingCard && (
        <CredentialsDrawer
          card={editingCard}
          onClose={() => setEditing(null)}
          onSubmit={(credentials, services) => handleSaveCredentials(editingCard, credentials, services)}
        />
      )}
    </div>
  );
}
