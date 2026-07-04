import { useEffect, useRef, useState, type RefObject } from 'react';

// ── useReportPeriod ───────────────────────────────────────────────────────────
// Estado de período (from/to) + granularidade + atalhos, reutilizado por todos os
// relatórios com filtro temporal. Extrai o padrão que estava inline no DREPage.

export type Granularity = 'week' | 'month';

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type PeriodShortcut = 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear';

export interface UseReportPeriod {
  from: string;
  to: string;
  granularity: Granularity;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  setGranularity: (g: Granularity) => void;
  applyShortcut: (s: PeriodShortcut) => void;
}

export function useReportPeriod(initial?: Partial<{ from: string; to: string; granularity: Granularity }>): UseReportPeriod {
  const now = new Date();
  const firstDay = iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const lastDay  = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const [from, setFrom] = useState(initial?.from ?? firstDay);
  const [to, setTo]     = useState(initial?.to ?? lastDay);
  const [granularity, setGranularity] = useState<Granularity>(initial?.granularity ?? 'month');

  function applyShortcut(s: PeriodShortcut) {
    const n = new Date();
    const y = n.getFullYear();
    const m = n.getMonth();
    if (s === 'thisMonth')   { setFrom(iso(new Date(y, m, 1)));     setTo(iso(new Date(y, m + 1, 0))); setGranularity('week'); }
    if (s === 'lastMonth')   { setFrom(iso(new Date(y, m - 1, 1))); setTo(iso(new Date(y, m, 0)));     setGranularity('week'); }
    if (s === 'last3Months') { setFrom(iso(new Date(y, m - 2, 1))); setTo(iso(new Date(y, m + 1, 0))); setGranularity('month'); }
    if (s === 'thisYear')    { setFrom(`${y}-01-01`);               setTo(`${y}-12-31`);               setGranularity('month'); }
  }

  return { from, to, granularity, setFrom, setTo, setGranularity, applyShortcut };
}

// ── useElementWidth ───────────────────────────────────────────────────────────
// Mede a largura do container via ResizeObserver para SVGs verdadeiramente
// responsivos (marcas e rótulos recalculam, não apenas esticam).

export function useElementWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}
