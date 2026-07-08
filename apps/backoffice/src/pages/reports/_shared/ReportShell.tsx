import type { ReactNode } from 'react';
import type { Granularity, PeriodShortcut, UseReportPeriod } from './hooks';
import { Can } from '../../../rbac';

// Scaffolding compartilhado das páginas de relatório: cabeçalho, barra de filtros
// de período, cartões, KPIs e estados. Tudo com as classes do DS (index.css) e
// responsivo (flex-wrap + overflow controlado).

// ── Cabeçalho ─────────────────────────────────────────────────────────────────

export function ReportHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ margin: 0 }}>{title}</h1>
        {subtitle && <p style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

// ── Toggle segmentado (ex.: granularidade) ────────────────────────────────────

export function SegmentedControl<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div role="tablist" style={{ display: 'inline-flex', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 2 }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} role="tab" aria-selected={active} type="button" onClick={() => onChange(o.value)}
            style={{
              border: 'none', cursor: 'pointer', padding: '5px 12px', borderRadius: 'calc(var(--r-sm) - 2px)',
              fontSize: 'var(--text-sm)', fontWeight: active ? 700 : 500,
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--primary)' : 'var(--muted)',
              boxShadow: active ? 'var(--shadow-xs)' : 'none',
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Barra de filtros de período ───────────────────────────────────────────────

const SHORTCUTS: { key: PeriodShortcut; label: string }[] = [
  { key: 'thisMonth',   label: 'Este mês' },
  { key: 'lastMonth',   label: 'Mês anterior' },
  { key: 'last3Months', label: 'Últimos 3 meses' },
  { key: 'thisYear',    label: 'Este ano' },
];

export function PeriodFilter({ period, showGranularity = false, extra }: {
  period: UseReportPeriod; showGranularity?: boolean; extra?: ReactNode;
}) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ margin: 0 }}>
          <label style={{ fontSize: 'var(--text-sm)' }}>De</label>
          <input type="date" value={period.from} max={period.to} onChange={e => period.setFrom(e.target.value)} style={{ maxWidth: 170 }} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label style={{ fontSize: 'var(--text-sm)' }}>Até</label>
          <input type="date" value={period.to} min={period.from} onChange={e => period.setTo(e.target.value)} style={{ maxWidth: 170 }} />
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SHORTCUTS.map(s => (
            <button key={s.key} type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => period.applyShortcut(s.key)}>
              {s.label}
            </button>
          ))}
        </div>

        {showGranularity && (
          <div style={{ marginLeft: 'auto' }}>
            <SegmentedControl<Granularity>
              value={period.granularity}
              onChange={period.setGranularity}
              options={[{ value: 'week', label: 'Semanal' }, { value: 'month', label: 'Mensal' }]}
            />
          </div>
        )}
        {extra}
      </div>
    </div>
  );
}

// ── Cartão de relatório ───────────────────────────────────────────────────────

export function ReportCard({ title, subtitle, toolbar, children, pad = 20 }: {
  title?: string; subtitle?: string; toolbar?: ReactNode; children: ReactNode; pad?: number;
}) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      {(title || toolbar) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <div>
            {title && <div style={{ fontWeight: 700, fontSize: 'var(--text-md)' }}>{title}</div>}
            {subtitle && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 2 }}>{subtitle}</div>}
          </div>
          {toolbar}
        </div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </div>
  );
}

// ── KPIs ──────────────────────────────────────────────────────────────────────

export type Tone = 'primary' | 'positive' | 'negative' | 'neutral' | 'warning';

const TONE_COLOR: Record<Tone, string> = {
  primary:  'var(--primary)',
  positive: 'var(--success)',
  negative: 'var(--danger)',
  neutral:  'var(--text)',
  warning:  'var(--warning)',
};

export function StatTile({ label, value, tone = 'neutral', hint }: { label: string; value: string; tone?: Tone; hint?: string }) {
  return (
    <div className="bento-card" style={{ padding: '16px 20px', flex: '1 1 180px', minWidth: 160 }}>
      <div className="bento-label">{label}</div>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: TONE_COLOR[tone], lineHeight: 1.15 }}>{value}</div>
      {hint && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>{children}</div>;
}

// ── Estados (loading / erro / vazio) ──────────────────────────────────────────

export function StateBlock({ loading, error, empty, emptyLabel = 'Nenhum dado encontrado no período.', children }: {
  loading?: boolean; error?: string | null; empty?: boolean; emptyLabel?: string; children: ReactNode;
}) {
  if (loading) return <div className="spinner" style={{ margin: '48px auto' }}>Carregando…</div>;
  if (error)   return <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>;
  if (empty)   return <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{emptyLabel}</div>;
  return <>{children}</>;
}

export function ExportButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  // Exportar exige reports:export — some para quem só tem reports:view.
  return (
    <Can permission="reports:export">
      <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={onClick} disabled={disabled}>
        ↓ Exportar XLSX
      </button>
    </Can>
  );
}
