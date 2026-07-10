// Segmentos de negócio (perfis) — chaves válidas para tenants.segment_key.
// O backend só precisa VALIDAR a chave; o pacote completo de cada segmento
// (nome amigável, paleta-padrão, overrides de label) vive no catálogo do
// frontend em apps/backoffice/src/branding/segments.ts. Esta lista é a fonte
// da verdade das chaves — mesmo racional de MODULE_KEYS em tenantModuleService.

export const SEGMENT_KEYS = [
  'generic',        // padrão neutro (cores/labels do produto)
  'barbershop',     // barbearia
  'salon',          // salão de beleza
  'driving_school', // autoescola
  'clinic',         // clínica
  'gym',            // academia
  'compressors',    // compressores / assistência técnica industrial
] as const;

export type SegmentKey = typeof SEGMENT_KEYS[number];

export function isValidSegmentKey(value: string): value is SegmentKey {
  return (SEGMENT_KEYS as readonly string[]).includes(value);
}

// Hex '#RRGGBB' — usado para validar brand_primary/brand_accent no PATCH /tenant.
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
