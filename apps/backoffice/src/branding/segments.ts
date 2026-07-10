import type { TKey } from '../i18n/pt-BR';

// Catálogo de Perfis de Segmento — a FONTE DA VERDADE de branding por vertical.
// Cada segmento traz: nome amigável, paleta-padrão (aplicada às CSS vars pelo
// BrandingProvider) e um conjunto CURADO de overrides de label (terminologia
// central que muda de verdade por vertical, ex.: Cliente→Aluno). A arquitetura
// suporta sobrescrever QUALQUER TKey; começamos por um conjunto pequeno de alta
// visibilidade — expandir depois é só adicionar entradas aqui, sem mudar código.
//
// As CHAVES aqui devem casar com SEGMENT_KEYS do backend
// (services/api-core/src/lib/segments.ts), que valida tenants.segment_key.
// O cliente pode sobrescrever cor manualmente (tenants.brand_primary/accent);
// as labels não são customizáveis por tenant nesta versão — vêm do preset.

export interface SegmentPreset {
  key:            string;
  name:           string;                          // rótulo do select
  primary:        string;                          // hex '#RRGGBB'
  accent:         string;                          // hex '#RRGGBB'
  labelOverrides: Partial<Record<TKey, string>>;   // curado
}

// Cores-padrão do produto (fallback quando não há preset nem override).
export const DEFAULT_PRIMARY = '#3B5CE4';
export const DEFAULT_ACCENT  = '#00B4D8';

// Override de "Cliente → X" reaproveitado por segmentos que renomeiam o cliente.
const clientTerm = (singular: string, plural: string): Partial<Record<TKey, string>> => ({
  'nav.clients': plural,
  'cl.title':    plural,
  'cl.new':      `Novo ${singular.toLowerCase()}`,
  'cl.edit':     `Editar ${singular.toLowerCase()}`,
  'cl.empty':    `Nenhum ${singular.toLowerCase()} cadastrado.`,
});

export const SEGMENTS: SegmentPreset[] = [
  {
    key: 'generic', name: 'Genérico (padrão)',
    primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT,
    labelOverrides: {},
  },
  {
    key: 'barbershop', name: 'Barbearia',
    primary: '#1E3A5F', accent: '#D64545',
    labelOverrides: {},
  },
  {
    key: 'salon', name: 'Salão de beleza',
    primary: '#DB2777', accent: '#F472B6',
    labelOverrides: {},
  },
  {
    key: 'driving_school', name: 'Autoescola',
    primary: '#059669', accent: '#10B981',
    labelOverrides: clientTerm('Aluno', 'Alunos'),
  },
  {
    key: 'clinic', name: 'Clínica',
    primary: '#0891B2', accent: '#06B6D4',
    labelOverrides: clientTerm('Paciente', 'Pacientes'),
  },
  {
    key: 'gym', name: 'Academia',
    primary: '#EA580C', accent: '#F97316',
    labelOverrides: clientTerm('Aluno', 'Alunos'),
  },
  {
    key: 'compressors', name: 'Compressores / Assistência técnica',
    primary: '#1D4ED8', accent: '#0EA5E9',
    labelOverrides: {},
  },
];

const BY_KEY = new Map(SEGMENTS.map(s => [s.key, s]));

/** Preset do segmento; cai no 'generic' para chave nula/desconhecida. */
export function getSegment(key: string | null | undefined): SegmentPreset {
  return (key && BY_KEY.get(key)) || BY_KEY.get('generic')!;
}
