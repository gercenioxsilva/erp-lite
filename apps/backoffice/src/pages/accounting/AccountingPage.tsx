// Contabilidade automática (módulo 'contabil') — relatórios derivados do
// razão de dupla entrada. Rotulagem: "DRE contábil" ≠ "DRE gerencial"
// (relatórios > DRE) por construção. Não substitui ECD/SPED Contábil.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

type Tab = 'balancete' | 'diario' | 'livro-caixa' | 'dre' | 'balanco';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'balancete', label: 'Balancete' },
  { key: 'diario', label: 'Livro Diário' },
  { key: 'livro-caixa', label: 'Livro Caixa' },
  { key: 'dre', label: 'DRE Contábil' },
  { key: 'balanco', label: 'Balanço' },
];

function monthRange(): { from: string; to: string } {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  return { from, to: now.toISOString().slice(0, 10) };
}

export function AccountingPage() {
  const [tab, setTab] = useState<Tab>('balancete');
  const [{ from, to }, setRange] = useState(monthRange());
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const path = tab === 'balanco'
      ? `/v1/accounting/reports/balanco?date=${to}`
      : `/v1/accounting/reports/${tab}?from=${from}&to=${to}`;
    try { setData(await api.get(path)); }
    catch (e: any) { setData(null); setError(e?.message ?? 'erro'); }
  }, [tab, from, to]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Contabilidade</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--muted, #64748b)', fontSize: 13 }}>
            Razão de dupla entrada alimentado automaticamente pelas emissões e pagamentos. Não substitui ECD/SPED.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" value={from} onChange={(e) => setRange({ from: e.target.value, to })}
            style={{ fontSize: 13, padding: '4px 6px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6 }} />
          <span style={{ color: 'var(--muted)' }}>→</span>
          <input type="date" value={to} onChange={(e) => setRange({ from, to: e.target.value })}
            style={{ fontSize: 13, padding: '4px 6px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6 }} />
        </div>
      </header>

      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} className="btn btn-sm" onClick={() => setTab(t.key)}
            style={tab === t.key ? { fontWeight: 700, borderColor: 'var(--primary, #2563eb)' } : {}}>
            {t.label}
          </button>
        ))}
      </nav>

      <section style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
        {error && <p style={{ fontSize: 13, color: '#dc2626' }}>{error}</p>}
        {!error && !data && <p style={{ fontSize: 13, color: 'var(--muted)' }}>Carregando…</p>}

        {data && tab === 'balancete' && (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
              <th style={{ padding: 6 }}>Conta</th><th style={{ padding: 6, textAlign: 'right' }}>Débito</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Crédito</th><th style={{ padding: 6, textAlign: 'right' }}>Saldo</th>
            </tr></thead>
            <tbody>
              {data.lines?.map((l: any) => (
                <tr key={l.accountId} style={{ borderTop: '1px solid var(--border, #eef2f7)' }}>
                  <td style={{ padding: 6 }}>{l.code} {l.name}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{BRL.format(l.debit)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{BRL.format(l.credit)}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontWeight: 600 }}>{BRL.format(l.saldo)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border, #cbd5e1)', fontWeight: 700 }}>
                <td style={{ padding: 6 }}>Totais {data.fecha ? '✓' : '✗ NÃO FECHA'}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{BRL.format(data.totalDebit ?? 0)}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{BRL.format(data.totalCredit ?? 0)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        )}

        {data && tab === 'diario' && (
          <div style={{ display: 'grid', gap: 8 }}>
            {(data.entries ?? []).map((e: any) => (
              <div key={e.id} style={{ borderTop: '1px solid var(--border, #eef2f7)', paddingTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{e.entry_date} — {e.description} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({e.source_type})</span></div>
                <table style={{ fontSize: 12, marginTop: 4 }}>
                  <tbody>
                    {e.lines.map((l: any, i: number) => (
                      <tr key={i}>
                        <td style={{ padding: '2px 12px 2px 16px', width: 40 }}>{l.side === 'debit' ? 'D' : 'C'}</td>
                        <td style={{ padding: '2px 12px' }}>{l.account}</td>
                        <td style={{ padding: '2px 12px', textAlign: 'right' }}>{BRL.format(Number(l.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {(data.entries ?? []).length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>Sem lançamentos no período.</p>}
          </div>
        )}

        {data && tab === 'livro-caixa' && (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
              <th style={{ padding: 6 }}>Data</th><th style={{ padding: 6 }}>Histórico</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Entrada</th><th style={{ padding: 6, textAlign: 'right' }}>Saída</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Saldo</th>
            </tr></thead>
            <tbody>
              {(data.lines ?? []).map((l: any, i: number) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border, #eef2f7)' }}>
                  <td style={{ padding: 6 }}>{l.date}</td>
                  <td style={{ padding: 6 }}>{l.description}</td>
                  <td style={{ padding: 6, textAlign: 'right', color: '#16a34a' }}>{l.entrada ? BRL.format(l.entrada) : ''}</td>
                  <td style={{ padding: 6, textAlign: 'right', color: '#dc2626' }}>{l.saida ? BRL.format(l.saida) : ''}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontWeight: 600 }}>{BRL.format(l.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {data && tab === 'dre' && (
          <div style={{ fontSize: 13 }}>
            <p style={{ color: 'var(--muted)', fontSize: 12 }}>{data.label}</p>
            {[['Receitas', data.receitas, data.totalReceitas], ['Despesas', data.despesas, data.totalDespesas]].map(([title, rows, total]: any) => (
              <div key={title} style={{ marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: '8px 0 4px' }}>{title} — {BRL.format(total)}</h3>
                {rows.map((r: any) => (
                  <div key={r.code} style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border, #eef2f7)', padding: '4px 0' }}>
                    <span>{r.code} {r.name}</span><span>{BRL.format(r.valor)}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ fontWeight: 800, fontSize: 16, borderTop: '2px solid var(--border, #cbd5e1)', paddingTop: 8 }}>
              Resultado: {BRL.format(data.resultado ?? 0)}
            </div>
          </div>
        )}

        {data && tab === 'balanco' && (
          <div style={{ fontSize: 14, display: 'grid', gap: 6, maxWidth: 420 }}>
            {!data.hasOpeningBalance && (
              <p style={{ fontSize: 12, color: '#d97706' }}>⚠ Sem saldo de abertura lançado — o balanço reflete apenas os fatos registrados no sistema.</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Ativo</span><b>{BRL.format(data.ativo ?? 0)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Passivo</span><b>{BRL.format(data.passivo ?? 0)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Patrimônio Líquido</span><b>{BRL.format(data.pl ?? 0)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Resultado do Período</span><b>{BRL.format(data.resultadoPeriodo ?? 0)}</b></div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, fontWeight: 700 }}>
              {data.fecha ? '✓ Ativo = Passivo + PL + Resultado' : '✗ Balanço não fecha (verifique saldos de abertura)'}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
