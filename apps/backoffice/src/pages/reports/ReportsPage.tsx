import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { ReportHeader } from './_shared';

// Hub de Relatórios: central que agrupa todos os relatórios por tema. Cada card
// leva à página do relatório. Itens de módulo opcional (PDV) só aparecem quando o
// tenant tem o módulo habilitado. Relatórios ainda não construídos aparecem como
// "Em breve" para comunicar o roadmap.

interface ReportLink {
  to: string; title: string; desc: string; icon: string;
  module?: 'pos' | 'service_orders'; soon?: boolean;
}

interface Section { title: string; accent: string; items: ReportLink[] }

const SECTIONS: Section[] = [
  {
    title: 'Financeiro', accent: 'var(--primary)',
    items: [
      { to: '/reports/cashflow', title: 'Fluxo de Caixa', desc: 'Realizado vs. projetado, com saldo acumulado.', icon: '💵' },
      { to: '/reports/aging',    title: 'Aging de Vencimentos', desc: 'Contas a receber/pagar por faixa de atraso.', icon: '⏳' },
      { to: '/reports/expenses', title: 'Despesas', desc: 'Contas a pagar por categoria e centro de custo.', icon: '🧾' },
      { to: '/dre',              title: 'DRE Gerencial', desc: 'Demonstrativo de resultado do período.', icon: '📑' },
      { to: '/reports/overdue',  title: 'Inadimplência', desc: 'Títulos vencidos e dias em atraso.', icon: '🔴' },
      { to: '/reports/pos-cash', title: 'Fechamento de Caixa PDV', desc: 'Quebra por operador e terminal.', icon: '🏪', module: 'pos' },
    ],
  },
  {
    title: 'Comercial & Vendas', accent: '#0891b2',
    items: [
      { to: '/reports/sales',             title: 'Faturamento', desc: 'Por vendedor, cliente, centro de custo e mês.', icon: '📈' },
      { to: '/reports/top-products',      title: 'Ranking de Produtos', desc: 'Produtos mais faturados no período.', icon: '🏆' },
      { to: '/reports/proposals-funnel',  title: 'Funil de Propostas', desc: 'Conversão enviada → aceita, motivos de recusa.', icon: '🎯' },
      { to: '/reports/commissions',       title: 'Comissões', desc: 'Apuração de comissão por vendedor.', icon: '🤝' },
      { to: '/reports/pos-payments',      title: 'Formas de Pagamento (PDV)', desc: 'Vendas por dinheiro, cartão, PIX e mais.', icon: '💳', module: 'pos' },
    ],
  },
  {
    title: 'Estoque', accent: '#16a34a',
    items: [
      { to: '/reports/stock-position', title: 'Posição & Ruptura', desc: 'Saldo atual vs. estoque mínimo.', icon: '📦' },
      { to: '/reports/abc',            title: 'Curva ABC', desc: 'Classificação de produtos por relevância.', icon: '🔠' },
      { to: '/reports/kardex',         title: 'Kardex / Giro', desc: 'Movimentações e giro de estoque.', icon: '🔄' },
    ],
  },
  {
    title: 'Serviços · Compras · Fiscal', accent: '#7c3aed',
    items: [
      { to: '/reports/technician-productivity', title: 'Produtividade de Técnicos', desc: 'SLA, no-show e tempo de atendimento.', icon: '🔧', module: 'service_orders' },
      { to: '/reports/recurring-revenue',       title: 'Receita Recorrente (MRR)', desc: 'Contratos ativos normalizados por mês.', icon: '🔁' },
      { to: '/reports/supplier-spend',          title: 'Gasto por Fornecedor', desc: 'Compras e pedidos em aberto.', icon: '🚚' },
      { to: '/reports/tax-summary',             title: 'Apuração de Impostos', desc: 'Carga tributária por imposto e UF.', icon: '🏛️' },
    ],
  },
];

export function ReportsPage() {
  const [enabledModules, setEnabledModules] = useState<string[]>([]);

  useEffect(() => {
    api.get<{ enabled: string[] }>('/v1/tenant/modules')
      .then(d => setEnabledModules(d.enabled ?? []))
      .catch(() => {});
  }, []);

  return (
    <div>
      <ReportHeader title="Relatórios" subtitle="Central de análises do seu negócio, organizada por área." />

      {SECTIONS.map(section => {
        const items = section.items.filter(it => !it.module || enabledModules.includes(it.module));
        if (items.length === 0) return null;
        return (
          <section key={section.title} style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 4, height: 16, borderRadius: 2, background: section.accent }} />
              <h2 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700 }}>{section.title}</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {items.map(it => <ReportCardLink key={it.title} item={it} accent={section.accent} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ReportCardLink({ item, accent }: { item: ReportLink; accent: string }) {
  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 22 }}>{item.icon}</span>
        {item.soon
          ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 8px' }}>Em breve</span>
          : <span style={{ color: accent, fontSize: 18, lineHeight: 1 }}>→</span>}
      </div>
      <div style={{ fontWeight: 700, fontSize: 'var(--text-base)', marginTop: 10 }}>{item.title}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>{item.desc}</div>
    </>
  );

  const baseStyle: CSSProperties = {
    display: 'block', padding: 16, borderRadius: 'var(--r)', border: '1px solid var(--border)',
    background: 'var(--surface)', textDecoration: 'none', color: 'var(--text)',
    transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
  };

  if (item.soon) {
    return <div style={{ ...baseStyle, opacity: 0.62, cursor: 'default' }}>{inner}</div>;
  }
  return (
    <Link to={item.to} className="report-hub-card" style={baseStyle}
      onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}>
      {inner}
    </Link>
  );
}
