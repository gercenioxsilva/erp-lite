// Guia de impostos (E8) — documento imprimível do roteiro PGDAS-D. Mesmo
// padrão de Holerite/Proposta: sem lib de PDF, window.print(). NÃO é a guia
// oficial com código de barras (essa só o portal gera) — é o kit de
// preenchimento com os valores conferidos.

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n';

interface Guia {
  empresa: string | null; cnpj: string | null; competencia: string; vencimento: string;
  aviso: string; passos: string[];
  valores: {
    rbt12: string | null; receita_competencia: string | null; das_total: string | null;
    fator_r: string | null; sublimite_excedido: boolean | null;
    tributos: Record<string, string | null>;
  };
}

const BRL = (v: string | null) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

const TRIBUTO_LABEL: Record<string, string> = {
  irpj: 'IRPJ', csll: 'CSLL', cofins: 'COFINS', pis: 'PIS', cpp: 'CPP',
  icms: 'ICMS', ipi: 'IPI', iss: 'ISS', iss_retido_abatido: 'ISS retido (abatido)',
};

export function GuiaImpostosPrintPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [state, setState] = useState<'loading' | 'not_found' | 'view'>('loading');
  const [data, setData] = useState<Guia | null>(null);

  useEffect(() => {
    if (!id || !user) return;
    api.get<Guia>(`/v1/fiscal/apuracao/${id}/guia`)
      .then((d) => { setData(d); setState('view'); })
      .catch(() => setState('not_found'));
  }, [id, user]);

  if (authLoading) return <div className="spinner">{t('c.loading')}</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (state === 'loading') return <div className="spinner">{t('c.loading')}</div>;
  if (state === 'not_found' || !data) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2>Guia não encontrada</h2>
        <button className="btn btn-secondary btn-sm print-hide" style={{ width: 'auto', marginTop: 16 }} onClick={() => navigate('/fiscal/pipeline')}>← Fiscal</button>
      </div>
    );
  }

  const tributos = Object.entries(data.valores.tributos).filter(([, v]) => v != null && Number(v) !== 0);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <div className="print-hide flex-gap" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
        <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => navigate(-1)}>← {t('c.close')}</button>
        <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => window.print()}>🖨 Imprimir / Salvar PDF</button>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
          Guia de impostos — Simples Nacional (PGDAS-D)
        </div>
        <h1 style={{ fontSize: 20, margin: 0 }}>{data.empresa ?? 'Empresa'}</h1>
        {data.cnpj && <p style={{ fontSize: 13, color: 'var(--muted)', margin: '2px 0 0' }}>CNPJ {data.cnpj}</p>}
        <p style={{ fontSize: 13, margin: '8px 0 0' }}>
          Competência <strong>{data.competencia}</strong> · Vencimento do DAS <strong>{data.vencimento}</strong>
        </p>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <strong style={{ fontSize: 13 }}>DAS a pagar</strong>
          <span style={{ fontSize: 24, fontWeight: 800 }}>{BRL(data.valores.das_total)}</span>
        </div>
        <table>
          <tbody>
            <tr><td>Receita do mês</td><td style={{ textAlign: 'right' }}>{BRL(data.valores.receita_competencia)}</td></tr>
            <tr><td>RBT12</td><td style={{ textAlign: 'right' }}>{BRL(data.valores.rbt12)}</td></tr>
            {data.valores.fator_r != null && (
              <tr><td>Fator R</td><td style={{ textAlign: 'right' }}>{(Number(data.valores.fator_r) * 100).toFixed(1)}%</td></tr>
            )}
            {data.valores.sublimite_excedido && (
              <tr><td colSpan={2} style={{ color: '#d97706' }}>⚠ Sublimite excedido — ICMS/ISS recolhidos por fora do DAS.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>Repartição por tributo</strong>
        <table>
          <tbody>
            {tributos.map(([k, v]) => (
              <tr key={k}><td>{TRIBUTO_LABEL[k] ?? k}</td><td style={{ textAlign: 'right' }}>{BRL(v)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>Como lançar no portal</strong>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: 'grid', gap: 4 }}>
          {data.passos.map((p, i) => <li key={i}>{p.replace(/^\d+\.\s*/, '')}</li>)}
        </ol>
      </div>

      <p style={{ fontSize: 11, color: 'var(--muted)' }}>{data.aviso}</p>
    </div>
  );
}
