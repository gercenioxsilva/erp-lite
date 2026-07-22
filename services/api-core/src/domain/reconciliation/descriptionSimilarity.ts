// Similaridade lexical de descrições de lançamentos — PURA, determinística, sem
// I/O. É o fallback (e o pré-filtro barato) da conciliação semântica: sem IA
// disponível, é ela quem aproxima "PAGTO FULANO LTDA" de "Fulano Ltda — NF 123".
// Estratégia: normaliza (minúsculas, sem acento, sem números, sem ruído de
// banco), tokeniza e combina Jaccard de tokens (robusto a reordenação) com
// cosseno de trigramas de caractere (robusto a variação/typo). Devolve 0..1.

// Ruído recorrente em memo bancário/descrição de título — não carrega sentido
// de contraparte, então não deve pontuar. Tokens com < 3 letras (nf, me, sa…)
// já caem pelo corte de tamanho.
const BANK_NOISE = new Set([
  'pix', 'ted', 'doc', 'tef', 'pagto', 'pagamento', 'pgto', 'recebimento',
  'receb', 'transf', 'transferencia', 'deposito', 'dep', 'debito', 'credito',
  'compra', 'cartao', 'boleto', 'tarifa', 'cobranca', 'liquidacao', 'ref',
  'para', 'com', 'ltda', 'epp', 'eireli',
]);

const MIN_TOKEN_LENGTH = 3;

/** Piso de similaridade a partir do qual a chave 'description_semantic' é
 *  marcada e o par é considerado "próximo". Compartilhado com o domínio. */
export const SEMANTIC_KEY_FLOOR = 0.6;

/** minúsculas, sem acento, sem dígitos (datas/docs/NSU são ruído aqui), só letras. */
export function normalizeDescription(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[0-9]/g, ' ')       // números não identificam contraparte
    .replace(/[^a-z\s]/g, ' ')    // pontuação/símbolos → espaço
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens com sentido: >= 3 letras e fora da lista de ruído bancário. */
export function tokenize(normalized: string): string[] {
  return normalized
    .split(' ')
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !BANK_NOISE.has(t));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function charTrigrams(s: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i <= s.length - 3; i++) {
    const tri = s.slice(i, i + 3);
    map.set(tri, (map.get(tri) ?? 0) + 1);
  }
  return map;
}

function trigramCosine(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) return a === b ? 1 : 0;
  const ma = charTrigrams(a);
  const mb = charTrigrams(b);
  let dot = 0;
  for (const [k, va] of ma) {
    const vb = mb.get(k);
    if (vb) dot += va * vb;
  }
  let na = 0; for (const v of ma.values()) na += v * v;
  let nb = 0; for (const v of mb.values()) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Similaridade lexical de duas descrições, 0..1. Simétrica. */
export function lexicalSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = tokenize(normalizeDescription(a));
  const tb = tokenize(normalizeDescription(b));
  if (ta.length === 0 || tb.length === 0) return 0;
  const jac = jaccard(new Set(ta), new Set(tb));
  const tri = trigramCosine(ta.join(' '), tb.join(' '));
  return Math.round((0.5 * jac + 0.5 * tri) * 10000) / 10000;
}
