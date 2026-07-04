import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  useReportPeriod, fmtBRL, fmtInt, categoricalColor, exportXlsx,
  ReportHeader, PeriodFilter, ReportCard, StatTile, KpiRow, StateBlock, ExportButton,
  HBarChart, type HBarDatum,
} from './_shared';

interface PayableRow { supplier_name: string; total: number; count: number }
interface PoRow { supplier_name: string; open_total: number; open_count: number; received_total: number; received_count: number }
interface SupplierSpendData { from: string; to: string; payables_by_supplier: PayableRow[]; purchase_orders_by_supplier: PoRow[]; total_spend: number }

export function SupplierSpendPage() {
  const period = useReportPeriod();
  const [data, setData] = useState<SupplierSpendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get<SupplierSpendData>(`/v1/reports/supplier-spend?from=${period.from}&to=${period.to}`)
      .then(r => { if (alive) setData(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar o gasto por fornecedor.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period.from, period.to]);

  const payables = data?.payables_by_supplier ?? [];
  const pos = data?.purchase_orders_by_supplier ?? [];
  const chartData: HBarDatum[] = payables.map((r, i) => ({ label: r.supplier_name, value: r.total, color: categoricalColor(i) }));
  const openPoTotal = pos.reduce((a, r) => a + r.open_count, 0);

  function handleExport() {
    if (!data) return;
    exportXlsx('gasto-fornecedores-payables', 'Contas a Pagar', payables.map(r => ({ Fornecedor: r.supplier_name, Total: r.total, Lançamentos: r.count })));
    exportXlsx('gasto-fornecedores-po', 'Pedidos de Compra', pos.map(r => ({
      Fornecedor: r.supplier_name, 'Aberto (qtd)': r.open_count, 'Aberto (valor)': r.open_total,
      'Recebido (qtd)': r.received_count, 'Recebido (valor)': r.received_total,
    })));
  }

  const isEmpty = !!data && payables.length === 0 && pos.length === 0;

  return (
    <div>
      <ReportHeader title="Gasto por Fornecedor" subtitle="Contas a pagar e pedidos de compra do período, por fornecedor."
        actions={<ExportButton onClick={handleExport} disabled={isEmpty} />} />

      <PeriodFilter period={period} />

      <StateBlock loading={loading} error={error} empty={isEmpty} emptyLabel="Nenhum gasto ou pedido de compra no período.">
        {data && (
          <>
            <KpiRow>
              <StatTile label="Gasto total" value={fmtBRL(data.total_spend)} tone="negative" />
              <StatTile label="Fornecedores" value={fmtInt(payables.length)} tone="primary" />
              <StatTile label="Pedidos de compra em aberto" value={fmtInt(openPoTotal)} tone="warning" />
            </KpiRow>

            <ReportCard title="Gasto por fornecedor (contas a pagar)">
              <HBarChart data={chartData} valueFormat={fmtBRL} />
            </ReportCard>

            {pos.length > 0 && (
              <ReportCard title="Pedidos de compra por fornecedor" subtitle="Aberto (aprovado, aguardando recebimento) vs. recebido" pad={0}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Fornecedor</th>
                        <th style={{ textAlign: 'right' }}>Aberto (qtd)</th>
                        <th style={{ textAlign: 'right' }}>Aberto (valor)</th>
                        <th style={{ textAlign: 'right' }}>Recebido (qtd)</th>
                        <th style={{ textAlign: 'right' }}>Recebido (valor)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pos.map((r, i) => (
                        <tr key={r.supplier_name + i}>
                          <td style={{ fontWeight: 500 }}>{r.supplier_name}</td>
                          <td style={{ textAlign: 'right', color: r.open_count > 0 ? 'var(--warning)' : 'var(--muted)' }}>{fmtInt(r.open_count)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)' }}>{fmtBRL(r.open_total)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(r.received_count)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)' }}>{fmtBRL(r.received_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ReportCard>
            )}

            <ReportCard title="Contas a pagar por fornecedor" pad={0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={{ textAlign: 'left' }}>Fornecedor</th><th style={{ textAlign: 'right' }}>Lançamentos</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                  <tbody>
                    {payables.map((r, i) => (
                      <tr key={r.supplier_name + i}>
                        <td style={{ fontWeight: 500 }}>
                          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: categoricalColor(i), marginRight: 8 }} />
                          {r.supplier_name}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtInt(r.count)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{fmtBRL(r.total)}</td>
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
