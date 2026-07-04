import { useState, type ReactNode } from 'react';
import { useElementWidth } from './hooks';

// ─────────────────────────────────────────────────────────────────────────────
// Primitivas de gráfico em SVG puro (zero dependência), responsivas via
// ResizeObserver e alinhadas ao DS (tokens de index.css). Seguem as regras da
// skill dataviz: uma escala por eixo, marcas finas com cantos 4px, gap de 2px
// entre segmentos, grade/eixos recessivos, legenda + hover por padrão.
// ─────────────────────────────────────────────────────────────────────────────

const AXIS    = 'var(--muted)';
const GRID    = 'var(--border-soft)';
const INK     = 'var(--text)';
const SURFACE = 'var(--surface)';

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

// ── Tooltip flutuante ─────────────────────────────────────────────────────────

interface TipState { x: number; y: number; content: ReactNode }

function Tooltip({ tip, containerWidth }: { tip: TipState | null; containerWidth: number }) {
  if (!tip) return null;
  const flip = tip.x > containerWidth * 0.6;
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute', left: tip.x, top: tip.y,
        transform: `translate(${flip ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
        background: 'var(--sidebar-bg, #0c1424)', color: '#fff',
        padding: '8px 10px', borderRadius: 'var(--r-sm)', fontSize: 'var(--text-xs)',
        lineHeight: 1.5, boxShadow: 'var(--shadow-md)', pointerEvents: 'none',
        whiteSpace: 'nowrap', zIndex: 5, minWidth: 120,
      }}
    >
      {tip.content}
    </div>
  );
}

export function TipRow({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {color && <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />}
        <span style={{ opacity: 0.85 }}>{label}</span>
      </span>
      <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

// ── Legenda ───────────────────────────────────────────────────────────────────

export interface LegendItem { label: string; color: string; muted?: boolean }

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center' }}>
      {items.map(it => (
        <span key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: AXIS }}>
          <span style={{
            width: 12, height: 12, borderRadius: 3, background: it.color,
            opacity: it.muted ? 0.55 : 1, flexShrink: 0,
          }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ── BarChart (vertical, agrupado e/ou empilhado) ──────────────────────────────

export interface StackLayer { key: string; label: string; color: string }
export interface BarGroup   { key: string; label: string; layers: StackLayer[] }
export interface BarDatum   { label: string; values: Record<string, number> } // chave: `${group.key}.${layer.key}`

interface BarChartProps {
  data:              BarDatum[];
  groups:            BarGroup[];
  height?:           number;
  yFormat?:          (n: number) => string;
  tipFormat?:        (n: number) => string;
  perCategoryColor?: (i: number) => string; // 1 grupo/1 camada: cor por categoria (ex.: Aging)
  emptyLabel?:       string;
}

export function BarChart({
  data, groups, height = 240, yFormat = String, tipFormat = String, perCategoryColor, emptyLabel = 'Sem dados no período.',
}: BarChartProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);

  const M = { top: 16, right: 12, bottom: 28, left: 56 };
  const minCluster = groups.length > 1 ? 56 : 40;
  const innerMinW  = data.length * minCluster;
  const w = Math.max(width || 640, innerMinW + M.left + M.right);
  const h = height;
  const plotW = w - M.left - M.right;
  const plotH = h - M.top - M.bottom;

  const totalOf = (d: BarDatum, g: BarGroup) => g.layers.reduce((s, l) => s + Math.max(0, d.values[`${g.key}.${l.key}`] ?? 0), 0);
  const maxVal  = niceMax(Math.max(1, ...data.flatMap(d => groups.map(g => totalOf(d, g)))));
  const y       = (v: number) => M.top + plotH - (v / maxVal) * plotH;

  const bandW    = plotW / Math.max(1, data.length);
  const clusterW = Math.min(bandW * 0.7, groups.length > 1 ? 72 : 48);
  const barGap   = groups.length > 1 ? 4 : 0;
  const barW     = (clusterW - barGap * (groups.length - 1)) / groups.length;

  const ticks = 4;
  const skipEvery = width && width < 480 && data.length > 6 ? 2 : 1;

  if (data.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: AXIS, fontSize: 'var(--text-sm)' }}>{emptyLabel}</div>;
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
      <svg width={w} height={h} role="img" style={{ display: 'block' }}>
        {/* grade + eixo Y */}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = (maxVal / ticks) * i;
          const yy = y(v);
          return (
            <g key={i}>
              <line x1={M.left} x2={w - M.right} y1={yy} y2={yy} stroke={GRID} strokeWidth={1} />
              <text x={M.left - 8} y={yy + 3} textAnchor="end" fontSize={10} fill={AXIS}>{yFormat(v)}</text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const cx = M.left + bandW * i + bandW / 2;
          const clusterX = cx - clusterW / 2;
          return (
            <g key={d.label}>
              {groups.map((g, gi) => {
                const bx = clusterX + gi * (barW + barGap);
                let acc = 0;
                const total = totalOf(d, g);
                const solidColor = perCategoryColor ? perCategoryColor(i) : undefined;
                return (
                  <g key={g.key}>
                    {g.layers.map((l, li) => {
                      const val = Math.max(0, d.values[`${g.key}.${l.key}`] ?? 0);
                      if (val <= 0) return null;
                      const segBottom = y(acc);
                      acc += val;
                      const segTop = y(acc);
                      const isTop = li === g.layers.length - 1;
                      const rawH = Math.max(0, segBottom - segTop);
                      const gap  = li > 0 ? 2 : 0; // 2px de respiro entre segmentos empilhados
                      const segH = Math.max(1, rawH - gap);
                      const r    = isTop ? 4 : 0;
                      return (
                        <path
                          key={l.key}
                          d={roundedTopRect(bx, segTop + gap, barW, segH, r)}
                          fill={solidColor ?? l.color}
                        />
                      );
                    })}
                    {/* rótulo direto do total (apenas quando cabe) */}
                    {data.length <= 8 && total > 0 && (
                      <text x={bx + barW / 2} y={y(total) - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill={INK}>
                        {yFormat(total)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* área de hover da categoria inteira */}
              <rect
                x={M.left + bandW * i} y={M.top} width={bandW} height={plotH}
                fill="transparent"
                onMouseEnter={() => setTip({
                  x: cx, y: M.top + plotH / 2,
                  content: (
                    <div style={{ display: 'grid', gap: 4 }}>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>{d.label}</div>
                      {groups.flatMap(g => g.layers.map(l => {
                        const v = d.values[`${g.key}.${l.key}`] ?? 0;
                        if (v === 0) return null;
                        const lbl = groups.length > 1 ? `${g.label} · ${l.label}` : l.label;
                        return <TipRow key={`${g.key}.${l.key}`} color={perCategoryColor ? perCategoryColor(i) : l.color} label={lbl} value={tipFormat(v)} />;
                      }))}
                    </div>
                  ),
                })}
                onMouseLeave={() => setTip(null)}
              />

              {/* rótulo do eixo X */}
              {i % skipEvery === 0 && (
                <text x={cx} y={h - 8} textAnchor="middle" fontSize={10} fill={AXIS}>{d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} containerWidth={w} />
    </div>
  );
}

// ── HBarChart (barras horizontais, ranking categórico) ────────────────────────

export interface HBarDatum { label: string; value: number; color?: string; sub?: string }

interface HBarChartProps {
  data:         HBarDatum[];
  valueFormat?: (n: number) => string;
  showShare?:   boolean;
  maxRows?:     number;
  emptyLabel?:  string;
}

export function HBarChart({ data, valueFormat = String, showShare = true, maxRows = 12, emptyLabel = 'Sem dados no período.' }: HBarChartProps) {
  const [tip, setTip] = useState<TipState | null>(null);
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();

  if (data.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: AXIS, fontSize: 'var(--text-sm)' }}>{emptyLabel}</div>;
  }

  const rows  = data.slice(0, maxRows);
  const total = data.reduce((s, d) => s + d.value, 0);
  const max   = Math.max(1, ...rows.map(d => d.value));

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'grid', gap: 10 }}>
      {rows.map((d, i) => {
        const pct = (d.value / max) * 100;
        const share = total > 0 ? (d.value / total) * 100 : 0;
        const color = d.color ?? 'var(--primary)';
        return (
          <div key={d.label + i}
            onMouseEnter={e => setTip({ x: (e.currentTarget as HTMLElement).offsetLeft + 40, y: (e.currentTarget as HTMLElement).offsetTop + 8,
              content: (
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontWeight: 700 }}>{d.label}</div>
                  <TipRow color={color} label="Valor" value={valueFormat(d.value)} />
                  {showShare && <TipRow label="Participação" value={`${share.toFixed(1).replace('.', ',')}%`} />}
                </div>
              ) })}
            onMouseLeave={() => setTip(null)}
            style={{ display: 'grid', gridTemplateColumns: `minmax(84px, ${width && width < 520 ? '30%' : '160px'}) 1fr auto`, alignItems: 'center', gap: 10, cursor: 'default' }}
          >
            <span style={{ fontSize: 'var(--text-sm)', color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.label}>
              {d.label}
            </span>
            <span style={{ position: 'relative', height: 18, background: GRID, borderRadius: 5, overflow: 'hidden' }}>
              <span style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: color, borderRadius: 5, transition: 'width 240ms ease' }} />
            </span>
            <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'monospace', fontWeight: 600, color: INK, textAlign: 'right', minWidth: 88 }}>
              {valueFormat(d.value)}
              {showShare && <span style={{ color: AXIS, fontWeight: 400, marginLeft: 6 }}>{share.toFixed(0)}%</span>}
            </span>
          </div>
        );
      })}
      {data.length > maxRows && (
        <div style={{ fontSize: 'var(--text-xs)', color: AXIS }}>+ {data.length - maxRows} outros não exibidos (veja a tabela / exportação).</div>
      )}
      <Tooltip tip={tip} containerWidth={width || 640} />
    </div>
  );
}

// ── LineChart (linha/área — tendência, saldo acumulado) ───────────────────────

export interface LinePoint { label: string; value: number }

interface LineChartProps {
  data:       LinePoint[];
  height?:    number;
  color?:     string;
  yFormat?:   (n: number) => string;
  tipFormat?: (n: number) => string;
  area?:      boolean;
  emptyLabel?: string;
}

export function LineChart({ data, height = 200, color = 'var(--primary)', yFormat = String, tipFormat = String, area = true, emptyLabel = 'Sem dados no período.' }: LineChartProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: AXIS, fontSize: 'var(--text-sm)' }}>{emptyLabel}</div>;
  }

  const M = { top: 16, right: 14, bottom: 26, left: 56 };
  const w = Math.max(width || 640, data.length * 36 + M.left + M.right);
  const h = height;
  const plotW = w - M.left - M.right;
  const plotH = h - M.top - M.bottom;

  const vals = data.map(d => d.value);
  const rawMax = Math.max(1, ...vals);
  const rawMin = Math.min(0, ...vals);
  const maxV = niceMax(rawMax);
  const minV = rawMin < 0 ? -niceMax(-rawMin) : 0;
  const span = maxV - minV || 1;

  const x = (i: number) => M.left + (data.length === 1 ? plotW / 2 : (plotW * i) / (data.length - 1));
  const y = (v: number) => M.top + plotH - ((v - minV) / span) * plotH;

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`).join(' ');
  const areaPath = `${line} L${x(data.length - 1)},${y(minV)} L${x(0)},${y(minV)} Z`;
  const zeroY = y(0);
  const ticks = 4;
  const skipEvery = width && width < 480 && data.length > 8 ? 2 : 1;

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
      <svg width={w} height={h} role="img" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="lc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = minV + (span / ticks) * i;
          const yy = y(v);
          return (
            <g key={i}>
              <line x1={M.left} x2={w - M.right} y1={yy} y2={yy} stroke={GRID} strokeWidth={1} />
              <text x={M.left - 8} y={yy + 3} textAnchor="end" fontSize={10} fill={AXIS}>{yFormat(v)}</text>
            </g>
          );
        })}
        {minV < 0 && <line x1={M.left} x2={w - M.right} y1={zeroY} y2={zeroY} stroke={AXIS} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />}

        {area && <path d={areaPath} fill="url(#lc-fill)" />}
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {data.map((d, i) => (
          <g key={i}>
            {hover === i && <line x1={x(i)} x2={x(i)} y1={M.top} y2={M.top + plotH} stroke={AXIS} strokeWidth={1} opacity={0.4} />}
            <circle cx={x(i)} cy={y(d.value)} r={hover === i ? 5 : 3.5} fill={SURFACE} stroke={color} strokeWidth={2} />
            <rect x={x(i) - Math.max(12, plotW / data.length / 2)} y={M.top} width={Math.max(24, plotW / data.length)} height={plotH}
              fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            {i % skipEvery === 0 && <text x={x(i)} y={h - 8} textAnchor="middle" fontSize={10} fill={AXIS}>{d.label}</text>}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <Tooltip
          tip={{ x: x(hover), y: y(data[hover].value),
            content: (
              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontWeight: 700 }}>{data[hover].label}</div>
                <TipRow color={color} label="Saldo" value={tipFormat(data[hover].value)} />
              </div>
            ) }}
          containerWidth={w}
        />
      )}
    </div>
  );
}

// ── helpers de path ───────────────────────────────────────────────────────────

/** Retângulo com cantos superiores arredondados (data-end de 4px ancorado na base). */
function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  if (rr <= 0) return `M${x},${y} h${w} v${h} h${-w} Z`;
  return `M${x},${y + rr} a${rr},${rr} 0 0 1 ${rr},${-rr} h${w - 2 * rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - rr} h${-w} Z`;
}
