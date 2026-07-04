import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  fmtBRL, fmtInt, fmtDate, exportXlsx,
  ReportHeader, ReportCard, StatTile, KpiRow, StateBlock, ExportButton,
} from './_shared';

interface OverdueRow {
  id: string; description: string; amount: number; paid_amount: number;
  remaining: number; due_date: string; client_name: string | null; days_overdue: number;
}
interface OverdueData { rows: OverdueRow[]; total_overdue: number; count: number }

export function OverduePage() {
  const [data, setData] = useState<OverdueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<OverdueData>('/v1/reports/overdue')
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar inadimplência.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  function handleExport() {
    if (!data) return;
    exportXlsx('inadimplencia', 'Inadimplência', data.rows.map(r => ({
      Cliente: r.client_name ?? '—', Descrição: r.description,
      Valor: r.amount, Pago: r.paid_amount, Restante: r.remaining,
      Vencimento: fmtDate(r.due_date), 'Dias em atraso': r.days_overdue,
    })));
  }

  return (
    <div>
      <ReportHeader title="Inadimplência" subtitle="Contas a receber vencidas e em aberto."
        actions={<ExportButton onClick={handleExport} disabled={!data || data.count === 0} />} />

      <StateBlock loading={loading} error={error} empty={!!data && data.count === 0} emptyLabel="Nenhuma conta vencida. Parabéns! 🎉">
        {data && (
          <>
            <KpiRow>
              <StatTile label="Clientes inadimplentes" value={fmtInt(data.count)} tone="primary" />
              <StatTile label="Total em atraso" value={fmtBRL(data.total_overdue)} tone="negative" />
            </KpiRow>

            <ReportCard title="Títulos vencidos" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Cliente</th>
                      <th style={{ textAlign: 'left' }}>Descrição</th>
                      <th style={{ textAlign: 'right' }}>Valor</th>
                      <th style={{ textAlign: 'right' }}>Restante</th>
                      <th style={{ textAlign: 'left' }}>Vencimento</th>
                      <th style={{ textAlign: 'right' }}>Atraso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(r => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 500 }}>{r.client_name ?? '—'}</td>
                        <td>{r.description}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)' }}>{fmtBRL(r.amount)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 700 }}>{fmtBRL(r.remaining)}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{fmtDate(r.due_date)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <span style={{ background: r.days_overdue > 30 ? '#fee2e2' : '#fff7ed', color: r.days_overdue > 30 ? '#dc2626' : '#d97706', borderRadius: 4, padding: '2px 8px', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                            {r.days_overdue}d
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ReportCard>
          </>
        )}
      </StateBlock>
    </div>
  );
}
