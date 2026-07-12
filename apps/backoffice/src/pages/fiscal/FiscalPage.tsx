// Painel operacional do módulo Fiscal (Simples Nacional): importação →
// conciliação → consolidação → emissão. MVP: visão de fila + ações de ciclo;
// telas dedicadas (upload guiado, cadastro fiscal completo, apuração) evoluem
// sobre estes mesmos endpoints.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { usePermissions } from '../../rbac';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface Batch {
  id: string; source_kind: string; original_filename: string; status: string;
  total_rows: number; inserted_rows: number; duplicate_rows: number; error_rows: number;
  created_at: string;
}
interface Draft {
  id: string; competency_ref: string; strategy_snapshot: string; status: string;
  amount: string; service_code: string | null; simples_effective_rate: string | null;
}
interface PendingTx {
  id: string; source: string; occurred_at: string | null; nsu: string | null;
  gross_amount: string | null; net_amount: string | null; amount: string | null; memo: string | null;
  reconciliation_status: string;
}
interface Apuracao {
  id: string; competencia: string; rbt12: string; das_total: string;
  fator_r: string | null; sublimite_excedido: boolean; status: string;
}
interface DasSummaryRow { competencia: string; estimado: number; pago: number }
interface FiscalAlert {
  id: string; rule_key: string; severity: 'info' | 'warning' | 'critical';
  title: string; periodo: string | null; status: string; last_detected_at: string;
}
interface ScoreData {
  score: number;
  breakdown: Array<{ category: string; points: number; max: number; issues: string[] }>;
  findings: Array<{ rule: string; severity: string; title: string }>;
}
interface Simulacao {
  projecao: { receitaConsiderada: number; rbt12: number; aliquotaEfetiva: number; dasProjetado: number; faixa: number; sublimiteExcedido: boolean };
  distancia: { faixaAtual: number; faltaParaProximaFaixa: number | null; efetivaNaProximaFaixa: number | null };
  anexo: string; fator_r: number | null;
  cenarios_rapidos: Array<{ label: string; das: number; deltaDas: number; mudouFaixa: boolean }>;
}

const money = (v: string | null) => (v ? BRL.format(Number(v)) : '—');

const STATUS_COLOR: Record<string, string> = {
  parsed: '#16a34a', partially_failed: '#d97706', failed: '#dc2626', received: '#64748b', parsing: '#2563eb',
  open: '#2563eb', calculated: '#7c3aed', emitting: '#d97706', emitted: '#16a34a',
  pending: '#64748b', unmatched: '#d97706', matched: '#16a34a', ignored: '#94a3b8',
};

function Badge({ value }: { value: string }) {
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600,
      color: '#fff', background: STATUS_COLOR[value] ?? '#64748b',
    }}>{value}</span>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function FiscalPage() {
  const { can } = usePermissions();
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [batches, setBatches] = useState<Batch[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [pending, setPending] = useState<PendingTx[]>([]);
  const [apuracoes, setApuracoes] = useState<Apuracao[]>([]);
  const [dasSummary, setDasSummary] = useState<DasSummaryRow[]>([]);
  const [sim, setSim] = useState<Simulacao | null>(null);
  const [score, setScore] = useState<ScoreData | null>(null);
  const [alerts, setAlerts] = useState<FiscalAlert[]>([]);
  const previousMonth = () => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const [competencia, setCompetencia] = useState(previousMonth());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [s, b, d, p, a, ds] = await Promise.all([
      api.get<Record<string, number>>('/v1/fiscal/reconciliation/summary').catch(() => ({})),
      api.get<{ data: Batch[] }>('/v1/fiscal/imports').catch(() => ({ data: [] })),
      api.get<{ data: Draft[] }>('/v1/fiscal/consolidation/drafts').catch(() => ({ data: [] })),
      api.get<{ data: PendingTx[] }>('/v1/fiscal/reconciliation/transactions?status=pending,unmatched').catch(() => ({ data: [] })),
      api.get<{ data: Apuracao[] }>('/v1/fiscal/apuracao').catch(() => ({ data: [] })),
      api.get<{ data: DasSummaryRow[] }>('/v1/fiscal/das-summary').catch(() => ({ data: [] })),
    ]);
    setSummary(s);
    setBatches(b.data.slice(0, 8));
    setDrafts(d.data.slice(0, 8));
    setPending(p.data.slice(0, 8));
    setApuracoes(a.data.slice(0, 8));
    setDasSummary(ds.data);
    // Simulador/score falham com 422 (MEI/sem RBT12) — cards não aparecem.
    api.get<Simulacao>('/v1/fiscal/simulator').then(setSim).catch(() => setSim(null));
    api.get<ScoreData>('/v1/fiscal/score').then(setScore).catch(() => setScore(null));
    api.get<{ data: FiscalAlert[] }>('/v1/fiscal/alerts?status=open,acknowledged&limit=20')
      .then((r) => setAlerts(r.data)).catch(() => setAlerts([]));
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label); setMessage(null);
    try {
      const result = await fn();
      setMessage(`${label}: ${JSON.stringify(result)}`);
      await load();
    } catch (err: any) {
      setMessage(`${label} falhou: ${err?.message ?? err}`);
    } finally { setBusy(null); }
  }

  async function upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    await run('Importação', () => api.postForm('/v1/fiscal/imports', form));
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Gestão Fiscal</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--muted, #64748b)', fontSize: 13 }}>
            Importar vendas → conciliar → consolidar → emitir NFS-e (Simples Nacional)
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {can('fiscal:import') && (
            <>
              <input ref={fileRef} type="file" accept=".ofx,.csv,.xlsx" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
              <button className="btn" disabled={!!busy} onClick={() => fileRef.current?.click()}>
                {busy === 'Importação' ? 'Enviando…' : 'Importar arquivo (OFX/CSV/XLSX)'}
              </button>
            </>
          )}
          {can('fiscal:reconcile') && (
            <button className="btn" disabled={!!busy}
              onClick={() => run('Conciliação', () => api.post('/v1/fiscal/reconciliation/run', {}))}>
              Conciliar
            </button>
          )}
          {can('fiscal:consolidate') && (
            <button className="btn" disabled={!!busy}
              onClick={() => run('Consolidação', () => api.post('/v1/fiscal/consolidation/run', {}))}>
              Consolidar
            </button>
          )}
          {can('fiscal:close') && (
            <button className="btn" disabled={!!busy} style={{ fontWeight: 700 }}
              onClick={() => run('Fechamento', () => api.post('/v1/fiscal/close-competencia', { competencia }))}>
              🔒 Fechar competência
            </button>
          )}
        </div>
      </header>

      {message && (
        <div style={{ padding: 10, borderRadius: 8, background: 'var(--surface-2, #f1f5f9)', fontSize: 12, fontFamily: 'monospace', overflowX: 'auto' }}>
          {message}
        </div>
      )}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {(['pending', 'unmatched', 'matched', 'ignored'] as const).map((k) => (
          <div key={k} style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>Transações {k}</div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{summary[k] ?? 0}</div>
          </div>
        ))}
      </div>

      {alerts.length > 0 && (
        <Card title={`🔔 Alertas fiscais (${alerts.length})`}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} style={{ borderTop: '1px solid var(--border, #eef2f7)' }}>
                  <td style={{ padding: '6px 4px', width: 90 }}><Badge value={a.severity} /></td>
                  <td style={{ padding: '6px 4px' }}>{a.title}{a.periodo ? ` · ${a.periodo}` : ''}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {can('fiscal:acknowledge') && a.status === 'open' && (
                      <button className="btn btn-sm" disabled={!!busy}
                        onClick={() => run('Alerta', () => api.post(`/v1/fiscal/alerts/${a.id}/acknowledge`, {}))}>OK</button>
                    )}
                    {can('fiscal:acknowledge') && (
                      <button className="btn btn-sm" disabled={!!busy} style={{ marginLeft: 4 }}
                        onClick={() => run('Alerta', () => api.post(`/v1/fiscal/alerts/${a.id}/resolve`, {}))}>Resolver</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {score && (
        <Card title="Saúde Fiscal">
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{
              width: 88, height: 88, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, fontWeight: 800, color: '#fff',
              background: score.score >= 90 ? '#16a34a' : score.score >= 70 ? '#d97706' : '#dc2626',
            }}>{score.score}</div>
            <div style={{ flex: 1, minWidth: 240 }}>
              {score.findings.length === 0 && score.breakdown.every((b) => b.points === 0) ? (
                <p style={{ fontSize: 13, color: 'var(--muted, #64748b)', margin: 0 }}>Nenhum problema detectado. 🎉</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {score.findings.slice(0, 5).map((f, i) => (
                    <li key={i} style={{ color: f.severity === 'critical' ? '#dc2626' : 'inherit' }}>{f.title}</li>
                  ))}
                  {score.breakdown.filter((b) => b.category !== 'inconsistencias' && b.points > 0).flatMap((b) => b.issues.slice(0, 2)).map((issue, i) => (
                    <li key={`b${i}`}>{issue}</li>
                  ))}
                  {score.findings.length > 5 && <li style={{ color: 'var(--muted)' }}>+{score.findings.length - 5} outros…</li>}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      {sim && (
        <Card title={`Simulador de DAS — ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · Anexo ${sim.anexo}${sim.fator_r != null ? ` · Fator R ${(sim.fator_r * 100).toFixed(1)}%` : ''}`}>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>DAS projetado do mês</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{BRL.format(sim.projecao.dasProjetado)}</div>
              <div style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>efetiva {sim.projecao.aliquotaEfetiva.toFixed(2)}%</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>Receita considerada</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{BRL.format(sim.projecao.receitaConsiderada)}</div>
              <div style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>ledger + pipeline</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>RBT12 · faixa {sim.projecao.faixa}</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{BRL.format(sim.projecao.rbt12)}</div>
              <div style={{ fontSize: 12, color: sim.distancia.faltaParaProximaFaixa != null ? '#d97706' : 'var(--muted)' }}>
                {sim.distancia.faltaParaProximaFaixa != null
                  ? `faltam ${BRL.format(sim.distancia.faltaParaProximaFaixa)} p/ faixa ${sim.distancia.faixaAtual + 1}${sim.distancia.efetivaNaProximaFaixa != null ? ` (efetiva ${sim.distancia.efetivaNaProximaFaixa.toFixed(2)}%)` : ''}`
                  : 'última faixa'}
              </div>
            </div>
          </div>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <tbody>
              {sim.cenarios_rapidos.map((c) => (
                <tr key={c.label} style={{ borderTop: '1px solid var(--border, #eef2f7)' }}>
                  <td style={{ padding: '6px 4px' }}>Se emitir {c.label} hoje</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600 }}>novo DAS {BRL.format(c.das)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted, #64748b)' }}>+{BRL.format(c.deltaDas)}</td>
                  <td style={{ padding: '6px 4px' }}>{c.mudouFaixa ? <Badge value="muda de faixa" /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sim.projecao.sublimiteExcedido && (
            <p style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>⚠ RBT12 acima do sublimite de R$3,6M — ICMS/ISS fora do DAS.</p>
          )}
        </Card>
      )}

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Card title="Importações recentes">
          {batches.length === 0 ? <p style={{ fontSize: 13, color: 'var(--muted)' }}>Nenhum arquivo importado ainda.</p> : (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} style={{ borderTop: '1px solid var(--border, #eef2f7)' }}>
                    <td style={{ padding: '6px 4px' }}>{b.original_filename}</td>
                    <td style={{ padding: '6px 4px', textTransform: 'uppercase', fontSize: 11 }}>{b.source_kind}</td>
                    <td style={{ padding: '6px 4px' }}><Badge value={b.status} /></td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {b.inserted_rows}✓ {b.duplicate_rows}↺ {b.error_rows}✗
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Pendentes de conciliação">
          {pending.length === 0 ? <p style={{ fontSize: 13, color: 'var(--muted)' }}>Fila vazia — tudo conciliado.</p> : (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {pending.map((t) => (
                  <tr key={t.id} style={{ borderTop: '1px solid var(--border, #eef2f7)' }}>
                    <td style={{ padding: '6px 4px' }}>{t.occurred_at ? new Date(t.occurred_at).toLocaleDateString('pt-BR') : '—'}</td>
                    <td style={{ padding: '6px 4px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.nsu ? `NSU ${t.nsu}` : (t.memo ?? t.source)}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{money(t.gross_amount ?? t.amount ?? t.net_amount)}</td>
                    <td style={{ padding: '6px 4px' }}><Badge value={t.reconciliation_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          title="Apuração Simples Nacional (PGDAS-D)"
          action={can('fiscal:apurar') ? (
            <span style={{ display: 'flex', gap: 6 }}>
              <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                style={{ fontSize: 12, padding: '2px 6px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6 }} />
              <button className="btn btn-sm" disabled={!!busy}
                onClick={() => run('Apuração', () => api.post('/v1/fiscal/apuracao', { competencia }))}>
                Apurar
              </button>
            </span>
          ) : undefined}
        >
          {apuracoes.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              Nenhuma competência apurada. O cálculo gera a memória completa — a transmissão no portal PGDAS-D permanece manual (sem API oficial).
            </p>
          ) : (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {apuracoes.map((a) => {
                  const pago = dasSummary.find((r) => r.competencia === a.competencia)?.pago ?? 0;
                  return (
                    <tr key={a.id} style={{ borderTop: '1px solid var(--border, #eef2f7)' }}>
                      <td style={{ padding: '6px 4px', fontWeight: 600 }}>{a.competencia}</td>
                      <td style={{ padding: '6px 4px', fontSize: 11 }}>
                        RBT12 {money(a.rbt12)}{a.fator_r ? ` · Fator R ${(Number(a.fator_r) * 100).toFixed(1)}%` : ''}
                        {a.sublimite_excedido ? ' · SUBLIMITE' : ''}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700 }}>DAS {money(a.das_total)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', fontSize: 12, color: pago >= Number(a.das_total) ? '#16a34a' : 'var(--muted, #64748b)' }}>
                        pago {BRL.format(pago)}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                        {can('fiscal:apurar') && (
                          <button className="btn btn-sm" disabled={!!busy}
                            onClick={() => run('Export PGDAS-D', () => api.get(`/v1/fiscal/apuracao/${a.id}/export`))}>
                            Roteiro
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Notas consolidadas (drafts)">
          {drafts.length === 0 ? <p style={{ fontSize: 13, color: 'var(--muted)' }}>Nenhum draft — concilie vendas e rode a consolidação.</p> : (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.id} style={{ borderTop: '1px solid var(--border, #eef2f7)' }}>
                    <td style={{ padding: '6px 4px' }}>{d.competency_ref}</td>
                    <td style={{ padding: '6px 4px', fontSize: 11 }}>{d.strategy_snapshot}{d.service_code ? ` · LC116 ${d.service_code}` : ''}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600 }}>{money(d.amount)}</td>
                    <td style={{ padding: '6px 4px' }}><Badge value={d.status} /></td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                      {d.status === 'open' && can('fiscal:consolidate') && (
                        <button className="btn btn-sm" disabled={!!busy}
                          onClick={() => run('Cálculo', () => api.post(`/v1/fiscal/consolidation/drafts/${d.id}/calculate`, {}))}>
                          Calcular
                        </button>
                      )}
                      {d.status === 'calculated' && can('fiscal:emit') && (
                        <button className="btn btn-sm" disabled={!!busy}
                          onClick={() => run('Emissão', () => api.post(`/v1/fiscal/consolidation/drafts/${d.id}/emit`, {}))}>
                          Emitir NFS-e
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
