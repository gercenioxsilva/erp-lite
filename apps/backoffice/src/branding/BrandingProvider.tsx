import { createContext, useContext, useEffect, ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  SEGMENTS, SegmentPreset, getSegment, DEFAULT_PRIMARY, DEFAULT_ACCENT,
} from './segments';

// Aplica o branding do tenant (segmento + override manual de cor) em runtime:
// injeta a paleta efetiva nas CSS custom properties (--primary etc.) e expõe o
// preset do segmento para o I18nProvider layerar os overrides de label.
//
// Fica ENTRE AuthProvider (de onde vêm segment_key/brand_*) e I18nProvider (que
// consome o preset). Cores padrão são restauradas no logout / quando não há
// tenant. As labels vêm 100% do preset do segmento; a cor pode ser sobrescrita
// pelo cliente (tenants.brand_primary/accent).

interface BrandingCtx {
  segmentKey: string;
  preset:     SegmentPreset;
}

const Ctx = createContext<BrandingCtx | null>(null);

// '#3B5CE4' → '59, 92, 228' (formato de --primary-rgb, usado em rgba()).
function hexToRgbTriplet(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

// Escurece um hex por um fator (0–1) para derivar o hover de --primary-h.
function darken(hex: string, factor = 0.82): string {
  const h = hex.replace('#', '');
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(parseInt(h.slice(0, 2), 16) * factor);
  const g = clamp(parseInt(h.slice(2, 4), 16) * factor);
  const b = clamp(parseInt(h.slice(4, 6), 16) * factor);
  return `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Aplica a paleta às CSS vars do :root (ou restaura o padrão do produto). */
export function applyPalette(primary: string, accent: string): void {
  const root = document.documentElement.style;
  root.setProperty('--primary', primary);
  root.setProperty('--primary-h', darken(primary));
  root.setProperty('--primary-rgb', hexToRgbTriplet(primary));
  root.setProperty('--accent', accent);
  root.setProperty('--sidebar-active', `rgba(${hexToRgbTriplet(primary)}, .22)`);
}

export function resetPalette(): void {
  applyPalette(DEFAULT_PRIMARY, DEFAULT_ACCENT);
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const preset  = getSegment(user?.segment_key);
  const primary = user?.brand_primary || preset.primary;
  const accent  = user?.brand_accent  || preset.accent;

  useEffect(() => {
    if (user) applyPalette(primary, accent);
    else resetPalette();
    // Restaura o padrão ao desmontar (logout desmonta a árvore autenticada).
    return () => resetPalette();
  }, [user, primary, accent]);

  return (
    <Ctx.Provider value={{ segmentKey: preset.key, preset }}>
      {children}
    </Ctx.Provider>
  );
}

export function useBranding(): BrandingCtx {
  const ctx = useContext(Ctx);
  // Fallback seguro: fora do provider (ex.: telas públicas), usa o genérico —
  // nunca quebra o t() do i18n que consome isto.
  return ctx ?? { segmentKey: 'generic', preset: SEGMENTS[0] };
}
