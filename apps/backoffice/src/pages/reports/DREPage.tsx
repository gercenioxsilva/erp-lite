import { useState } from 'react';
import { api }      from '../../lib/api';
import { useAuth }  from '../../contexts/AuthContext';
import { useI18n }  from '../../i18n';

// ── Types (espelham dreDomain.ts) ─────────────────────────────────────────────

interface DRECategory {
  id: string; code: string; name: string; type: string;
  sign: number; sort_order: number; amount: number;
}

interface DREResult {
  period_from: string; period_to: string;
  receita_bruta: number; deducoes: number; receita_liquida: number;
  cmv: number; lucro_bruto: number; margem_bruta_pct: number;
  despesas_opex: number; ebitda: number; ebitda_pct: number;
  despesas_financeiras: number; receitas_financeiras: number; ebt: number;
  impostos_resultado: number; resultado_liquido: number; margem_liquida_pct: number;
  categories: DRECategory[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const PCT = (n: number) => `${n.toFixed(1).replace('.', ',')}%`;

function fmtAmount(n: number) {
  return BRL.format(Math.abs(n));
}

// Paleta semântica
function amountColor(n: number, isRevenue = false): string {
  if (isRevenue) return n >= 0 ? 'var(--primary)'  : 'var(--danger)';
  return n >= 0 ? '#16a34a' : 'var(--muted)';
}

// ── Componentes de linha ──────────────────────────────────────────────────────

function DRELine({ label, amount, bold, indent = 0, positive = false, separator = false }: {
  label: string; amount: number; bold?: boolean; indent?: number;
  positive?: boolean; separator?: boolean;
}) {
  const color = positive ? amountColor(amount, true) : (amount < 0 ? 'var(--danger)' : '#16a34a');
  return (
    <>
      {separator && <tr style={{ height: 1 }}><td colSpan={3} style={{ background: 'var(--border)', padding: 0 }} /></tr>}
      <tr>
        <td style={{ padding: '7px 16px', paddingLeft: 16 + indent * 16, fontSize: bold ? 14 : 13, fontWeight: bold ? 700 : 400, color: bold ? 'inherit' : 'var(--muted)' }}>
          {label}
        </td>
        <td style={{ padding: '7px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: bold ? 700 : 400, color }}>
          {amount !== 0 ? fmtAmount(amount) : '—'}
        </td>
        <td style={{ padding: '7px 16px', textAlign: 'right', fontSize: 12, color: 'var(--muted)', width: 60 }}>
          {/* margem não mostrada nas linhas de detalhe */}
        </td>
      </tr>
    </>
  );
}

function DRETotalLine({ label, amount, pct, color, bg }: {
  label: string; amount: number; pct?: number; color: string; bg?: string;
}) {
  return (
    <tr style={{ background: bg ?? 'transparent' }}>
      <td style={{ padding: '10px 16px', fontWeight: 700, fontSize: 14, color }}>
        {label}
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color }}>
        {BRL.format(amount)}
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, color: 'var(--muted)', width: 60 }}>
        {pct !== undefined ? PCT(pct) : ''}
      </td>
    </tr>
  );
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, pct, color }: { label: string; value: number; pct?: number; color: string }) {
  return (
    <div className="card" style={{ padding: 16, minWidth: 160, flex: 1 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{BRL.format(value)}</div>
      {pct !== undefined && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{PCT(pct)} s/ receita líquida</div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function DREPage() {
  const { tenantId } = useAuth();
  const { t } = useI18n();

  const now     = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [from,     setFrom]    = useState(firstDay);
  const [to,       setTo]      = useState(lastDay);
  const [dre,      setDre]     = useState<DREResult | null>(null);
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState('');

  async function calculate() {
    if (!tenantId || !from || !to) return;
    setLoading(true); setError('');
    try {
      const result = await api.get<DREResult>(`/v1/reports/dre?from=${from}&to=${to}`);
      setDre(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao calcular DRE.');
    } finally {
      setLoading(false);
    }
  }

  // Filtra categorias por tipo para o detalhamento de despesas
  const opexCategories = dre?.categories.filter(c =>
    ['opex', 'other'].includes(c.type) && c.amount !== 0
  ) ?? [];

  const financialCategories = dre?.categories.filter(c =>
    ['financial_expense', 'financial_income'].includes(c.type) && c.amount !== 0
  ) ?? [];

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>{t('dre.title')}</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{t('dre.subtitle')}</p>
        </div>
      </div>

      {/* Period selector */}
      <div className="card" style={{ padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <label style={{ fontSize: 13 }}>{t('dre.from')}</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ maxWidth: 180 }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label style={{ fontSize: 13 }}>{t('dre.to')}</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ maxWidth: 180 }} />
          </div>
          <button className="btn btn-primary" style={{ width: 'auto' }}
            disabled={loading || !from || !to}
            onClick={() => void calculate()}>
            {loading ? t('dre.calculating') : t('dre.calculate')}
          </button>

          {/* Quick period shortcuts */}
          <div style={{ display: 'flex', gap: 6 }}>
            {['Este mês', 'Mês anterior', 'Este ano'].map((label, i) => {
              function quickPeriod() {
                const n = new Date();
                if (i === 0) { setFrom(new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10)); setTo(new Date(n.getFullYear(), n.getMonth() + 1, 0).toISOString().slice(0, 10)); }
                if (i === 1) { setFrom(new Date(n.getFullYear(), n.getMonth() - 1, 1).toISOString().slice(0, 10)); setTo(new Date(n.getFullYear(), n.getMonth(), 0).toISOString().slice(0, 10)); }
                if (i === 2) { setFrom(`${n.getFullYear()}-01-01`); setTo(`${n.getFullYear()}-12-31`); }
              }
              return (
                <button key={label} type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }}
                  onClick={quickPeriod}>{label}</button>
              );
            })}
          </div>
        </div>

        {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {!dre && !loading && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 48, fontSize: 15 }}>
          📊 {t('dre.noPeriod')}
        </div>
      )}

      {dre && (
        <>
          {/* Summary cards */}
          <div className="flex-gap" style={{ marginBottom: 24, flexWrap: 'wrap' }}>
            <SummaryCard label="Receita Líquida" value={dre.receita_liquida} color="var(--primary)" />
            <SummaryCard label="Lucro Bruto"     value={dre.lucro_bruto}    pct={dre.margem_bruta_pct}  color={dre.lucro_bruto >= 0 ? '#16a34a' : 'var(--danger)'} />
            <SummaryCard label="EBITDA"           value={dre.ebitda}         pct={dre.ebitda_pct}        color={dre.ebitda >= 0    ? '#0369a1' : 'var(--danger)'} />
            <SummaryCard label="Resultado Líquido" value={dre.resultado_liquido} pct={dre.margem_liquida_pct}
              color={dre.resultado_liquido >= 0 ? '#16a34a' : 'var(--danger)'} />
          </div>

          {/* DRE Table */}
          <div className="card" style={{ overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                Período: {new Date(dre.period_from + 'T12:00').toLocaleDateString('pt-BR')} a {new Date(dre.period_to + 'T12:00').toLocaleDateString('pt-BR')}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Valores em R$ · DRE Gerencial (não contábil)</span>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <colgroup>
                <col style={{ width: '60%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '15%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: 'var(--surface-2, var(--surface))' }}>
                  <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Descrição</th>
                  <th style={{ padding: '8px 16px', textAlign: 'right', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Valor</th>
                  <th style={{ padding: '8px 16px', textAlign: 'right', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>% Rec. Líq.</th>
                </tr>
              </thead>
              <tbody>
                {/* Receita */}
                <DRELine label="Receita Bruta de Vendas e Serviços"  amount={dre.receita_bruta}  positive />
                {dre.deducoes !== 0 && <DRELine label="(−) Deduções da Receita Bruta" amount={dre.deducoes} indent={1} />}

                <DRETotalLine label="(=) Receita Líquida" amount={dre.receita_liquida}
                  color="var(--primary)" bg="rgba(59,92,228,.04)" />

                {/* CMV */}
                <DRELine label="(−) CMV / Custo dos Serviços Prestados" amount={dre.cmv} indent={1} />

                <DRETotalLine label="(=) Lucro Bruto" amount={dre.lucro_bruto}
                  pct={dre.margem_bruta_pct}
                  color={dre.lucro_bruto >= 0 ? '#16a34a' : 'var(--danger)'}
                  bg={dre.lucro_bruto >= 0 ? 'rgba(22,163,74,.04)' : 'rgba(239,68,68,.04)'} />

                {/* Opex detalhado */}
                {opexCategories.length > 0 && (
                  <>
                    <tr><td colSpan={3} style={{ padding: '8px 16px 4px', fontSize: 12, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', background: 'var(--surface)' }}>Despesas Operacionais</td></tr>
                    {opexCategories.map(cat => (
                      <DRELine key={cat.id} label={cat.name} amount={cat.amount} indent={1} />
                    ))}
                  </>
                )}

                <DRETotalLine label="(=) EBITDA" amount={dre.ebitda}
                  pct={dre.ebitda_pct}
                  color={dre.ebitda >= 0 ? '#0369a1' : 'var(--danger)'}
                  bg="rgba(3,105,161,.04)" />

                {/* Resultado Financeiro */}
                {(dre.despesas_financeiras !== 0 || dre.receitas_financeiras !== 0) && (
                  <>
                    <tr><td colSpan={3} style={{ padding: '8px 16px 4px', fontSize: 12, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', background: 'var(--surface)' }}>Resultado Financeiro</td></tr>
                    {financialCategories.map(cat => (
                      <DRELine key={cat.id} label={cat.name} amount={cat.amount}
                        indent={1} positive={cat.type === 'financial_income'} />
                    ))}
                  </>
                )}

                <DRETotalLine label="(=) Resultado antes dos Impostos" amount={dre.ebt}
                  color={dre.ebt >= 0 ? '#1e40af' : 'var(--danger)'} />

                {/* Impostos */}
                {dre.impostos_resultado !== 0 && (
                  <DRELine label="(−) IRPJ / CSLL" amount={dre.impostos_resultado} indent={1} />
                )}

                <DRETotalLine label="(=) Resultado Líquido do Período" amount={dre.resultado_liquido}
                  pct={dre.margem_liquida_pct}
                  color={dre.resultado_liquido >= 0 ? '#16a34a' : 'var(--danger)'}
                  bg={dre.resultado_liquido >= 0 ? 'rgba(22,163,74,.07)' : 'rgba(239,68,68,.07)'} />
              </tbody>
            </table>

            {/* Footer */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', gap: 24 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                <strong>Margem Bruta:</strong> {PCT(dre.margem_bruta_pct)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                <strong>Margem EBITDA:</strong> {PCT(dre.ebitda_pct)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                <strong>Margem Líquida:</strong> {PCT(dre.margem_liquida_pct)}
              </div>
            </div>
          </div>

          {/* Disclaimer */}
          <div style={{ marginTop: 16, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 12, color: '#b45309' }}>
            ⚠ Este demonstrativo é <strong>gerencial</strong> e baseia-se nas notas fiscais emitidas e contas a pagar cadastradas no sistema. Não substitui o SPED Contábil/ECD nem a escrituração formal. Consulte seu contador para fins legais e fiscais.
          </div>
        </>
      )}
    </div>
  );
}
