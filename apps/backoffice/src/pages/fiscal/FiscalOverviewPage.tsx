// Painel executivo do módulo Fiscal: dashboard de visibilidade por empresa,
// rota-índice de /fiscal. Vira o hub operacional (FiscalPage, /fiscal/pipeline)
// filtrado por empresa ao clicar num card.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface CompanyOverview {
  company_id: string;
  company_name: string;
  has_fiscal_config: boolean;
  score: number | null;
  alerts: { critical: number; warning: number; info: number } | null;
  competencia_atual: { competencia: string; status: string } | null;
  das: { competencia: string; valor: number; vencimento: string; dias_restantes: number; status: string } | null;
  error: boolean;
}

function scoreColor(score: number): string {
  return score >= 90 ? '#16a34a' : score >= 70 ? '#d97706' : '#dc2626';
}

// Ordena empresas por urgência: scores mais baixos (piores) primeiro, depois erros, depois sem config.
// Empresas com erros de carregamento (error: true) recebem -1 e ficam menos urgentes que
// empresas com alertas críticos confirmados (ex: 2 críticos = -170), pois um estado confirmado
// é mais acionável que uma falha opaca de sincronização.
function urgencyRank(c: CompanyOverview): number {
  if (c.error) return -1;
  if (!c.has_fiscal_config) return 1000;
  return (c.score ?? 0) - (c.alerts?.critical ?? 0) * 100;
}

export function FiscalOverviewPage() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<CompanyOverview[] | null>(null);

  useEffect(() => {
    api.get<{ data: CompanyOverview[] }>('/v1/fiscal/companies-overview')
      .then((r) => setCompanies(r.data))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (companies && companies.length === 1) {
      navigate('/fiscal/pipeline', { replace: true });
    }
  }, [companies, navigate]);

  if (companies === null) {
    return (
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ height: 140, borderRadius: 12, background: 'var(--surface-2, #f1f5f9)' }} />
        ))}
      </div>
    );
  }

  if (companies.length <= 1) return null; // redirect em andamento

  const sorted = [...companies].sort((a, b) => urgencyRank(a) - urgencyRank(b));

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Painel Fiscal</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--muted, #64748b)', fontSize: 13 }}>
          Visão consolidada das empresas do tenant
        </p>
      </header>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {sorted.map((c) => (
          <button key={c.company_id} type="button" data-testid="fiscal-overview-card"
            onClick={() => navigate(`/fiscal/pipeline?company_id=${c.company_id}`)}
            style={{
              textAlign: 'left', cursor: 'pointer', background: 'var(--surface, #fff)',
              border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 16,
            }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{c.company_name}</div>

            {c.error && <p style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>Não foi possível carregar</p>}

            {!c.error && !c.has_fiscal_config && (
              <>
                <p style={{ fontSize: 13, color: 'var(--muted, #64748b)' }}>Cadastro fiscal pendente</p>
                <span className="btn btn-sm">Configurar</span>
              </>
            )}

            {!c.error && c.has_fiscal_config && c.score !== null && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontWeight: 800, color: '#fff', background: scoreColor(c.score),
                }}>{c.score}</div>
                <div style={{ fontSize: 12 }}>
                  {c.alerts && (c.alerts.critical + c.alerts.warning) > 0 && (
                    <div>{c.alerts.critical} crítico(s) · {c.alerts.warning} aviso(s)</div>
                  )}
                  {c.competencia_atual && <div>Competência {c.competencia_atual.competencia}: {c.competencia_atual.status}</div>}
                  {c.das && (
                    <div style={{ color: c.das.status === 'atrasado' ? '#dc2626' : 'inherit' }}>
                      DAS {BRL.format(c.das.valor)} — {c.das.status === 'atrasado' ? `atrasado ${-c.das.dias_restantes}d` : `${c.das.dias_restantes}d`}
                    </div>
                  )}
                </div>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
