import { useEffect, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { api }      from '../../lib/api';
import { useI18n }  from '../../i18n';
import type { TKey } from '../../i18n/pt-BR';
import {
  ProposalDocument, ProposalDocumentStyle,
  type ProposalData, type ItemData, type PartyData, type IssuerData,
} from './ProposalDocument';

interface PrintProposal {
  proposal: ProposalData;
  items: ItemData[];
  issuer: IssuerData;
  client: PartyData | null;
  client_name: string | null;
}

const PILL_CLASS: Record<string, string> = {
  accepted: 'pp-pill--accepted',
  expired:  'pp-pill--expired',
};

/**
 * Impressão interna da proposta — mesmo layout visual do link público
 * (/p/:token, enviado por e-mail ao cliente), mas autenticada por tenantId
 * e disponível para qualquer status (inclusive rascunho). Não altera status
 * nem public_viewed_at — ao contrário de abrir o link público.
 */
export function ProposalPrintPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [state, setState] = useState<'loading' | 'not_found' | 'view'>('loading');
  const [data, setData]   = useState<PrintProposal | null>(null);

  useEffect(() => {
    if (!id || !user) return;
    api.get<PrintProposal>(`/v1/proposals/${id}/print`)
      .then(d => { setData(d); setState('view'); })
      .catch(() => setState('not_found'));
  }, [id, user]);

  if (authLoading) return <div className="pp-root"><ProposalDocumentStyle /><div className="pp-card" style={{ padding: 40, textAlign: 'center' }}>{t('c.loading')}</div></div>;
  if (!user) return <Navigate to="/login" replace />;

  if (state === 'loading') {
    return <div className="pp-root"><ProposalDocumentStyle /><div className="pp-card" style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>{t('c.loading')}</div></div>;
  }
  if (state === 'not_found' || !data) {
    return (
      <div className="pp-root"><ProposalDocumentStyle />
        <div className="pp-card" style={{ padding: 40, textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'Archivo', color: '#E0241C', margin: '0 0 8px' }}>{t('prop.printNotFound')}</h2>
          <button className="pp-btn pp-btn--ghost pp-btn--sm print-hide" style={{ marginTop: 16 }} onClick={() => navigate('/proposals')}>
            ← {t('prop.title')}
          </button>
        </div>
      </div>
    );
  }

  const { proposal, items, issuer, client, client_name } = data;
  const pillClass = PILL_CLASS[proposal.status] ?? 'pp-pill--open';
  const pill = <span className={`pp-pill ${pillClass}`}>{t(`prop.${proposal.status}` as TKey)}</span>;

  return (
    <div className="pp-root">
      <ProposalDocumentStyle />

      <div className="pp-tools print-hide">
        <button className="pp-btn pp-btn--ghost pp-btn--sm" onClick={() => navigate(-1)}>← {t('c.close')}</button>
        <button className="pp-btn pp-btn--accept pp-btn--sm" onClick={() => window.print()}>🖨 {t('prop.print')}</button>
      </div>

      <ProposalDocument
        proposal={proposal} items={items} issuer={issuer} client={client}
        clientName={client?.name || client_name} pill={pill}
      />
    </div>
  );
}
