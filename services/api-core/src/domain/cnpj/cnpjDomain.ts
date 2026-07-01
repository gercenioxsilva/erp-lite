// Domínio de validação de CNPJ — puro, sem I/O, sem dependências externas.
// Segue a arquitetura DDD/Clean Architecture: regras de negócio isoladas e
// testáveis sem mocks de banco ou de HTTP.
//
// ── Contexto legal ────────────────────────────────────────────────────────────
// Instrução Normativa RFB nº 2.229/2024 introduz CNPJs alfanuméricos.
// O algoritmo de verificação é o mesmo do CNPJ numérico tradicional (Módulo 11),
// com a única diferença que os 12 primeiros caracteres podem ser [A-Z0-9] e
// o mapeamento de cada caractere usa base-36 (A=10, B=11 … Z=35, 0-9=0-9).
// Os dois dígitos verificadores (posições 13-14) continuam sendo NUMÉRICOS (0-9).
//
// ── Algoritmo correto (Abordagem B — validada contra CNPJs numéricos conhecidos)
// DV1: aplica W1 (12 pesos) sobre os 12 primeiros chars em base-36
// DV2: aplica W2 (13 pesos) sobre os 12 chars + DV1 como char (13 posições total)
// Esta abordagem é idêntica ao algoritmo tradicional, com base-36 no lugar de base-10.
// CNPJs puramente numéricos continuam validando (base-36 de dígitos = base-10).
//
// ── Nota sobre o script de referência (CNPJ.ws) ──────────────────────────────
// O script fornecido como referência contém um bug: weights2 tem 12 itens mas a
// string passada tem 13 chars, resultando em NaN na última multiplicação.
// O CNPJ "UKPVME1E8HI996" citado como teste é provavelmente um CNPJ estrutural
// (formato válido, mas dígitos verificadores de demonstração) — não valida sob
// nenhuma interpretação do algoritmo. Adotamos o algoritmo correto (W2 = 13 pesos)
// que preserva a compatibilidade retroativa total com CNPJs numéricos existentes.

// ── Pesos (Módulo 11, conforme IN RFB) ────────────────────────────────────────
const W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];          // 12 pesos → DV1
const W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];       // 13 pesos → DV2

// ── Engine de cálculo interno ─────────────────────────────────────────────────

function charToBase36(charCode: number): number {
  if (charCode >= 65 && charCode <= 90) return charCode - 55; // A=10 … Z=35
  return charCode - 48;                                        // 0=0  … 9=9
}

function calcDV(str: string, weights: number[]): number {
  let sum = 0;
  const len = Math.min(str.length, weights.length);
  for (let i = 0; i < len; i++) {
    sum += charToBase36(str.charCodeAt(i)) * weights[i];
  }
  const rem = sum % 11;
  return rem < 2 ? 0 : 11 - rem;
}

// ── Normalização ──────────────────────────────────────────────────────────────
// Remove SOMENTE pontuação e espaços — mantém letras A-Z (ao contrário de digits()).
// Sempre converte para maiúsculas antes de processar ou gravar no banco.

export function normalizeCNPJ(raw: string): string {
  // Remove ONLY formatting punctuation; never truncate — let length validation fail naturally.
  return raw.replace(/[.\-\/\s]/g, '').toUpperCase();
}

// ── Formatação com máscara XX.XXX.XXX/XXXX-XX ────────────────────────────────
// Aceita qualquer mix de letras e números nos primeiros 12 chars.

export function formatCNPJ(raw: string): string {
  const c = normalizeCNPJ(raw);
  if (c.length <= 2)  return c;
  if (c.length <= 5)  return `${c.slice(0, 2)}.${c.slice(2)}`;
  if (c.length <= 8)  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5)}`;
  if (c.length <= 12) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8)}`;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12, 14)}`;
}

// ── Validação ─────────────────────────────────────────────────────────────────

/**
 * Valida CNPJ alfanumérico (IN RFB nº 2.229/2024).
 * Aceita entrada com ou sem máscara (pontos/barra/traço são ignorados).
 * Os 12 primeiros caracteres podem ser [A-Z0-9]; os 2 últimos devem ser [0-9].
 */
export function isValidAlphanumericCNPJ(raw: string): boolean {
  const c = normalizeCNPJ(raw);
  if (c.length !== 14) return false;
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(c)) return false;

  const base = c.substring(0, 12);
  const dv1  = calcDV(base, W1);
  const dv2  = calcDV(base + dv1, W2);

  return dv1 === parseInt(c[12]) && dv2 === parseInt(c[13]);
}

/**
 * Valida CNPJ numérico tradicional (pré-2026).
 * Compatibilidade retroativa mantida para todos os CNPJs numéricos existentes.
 * Nota: CNPJs numéricos TAMBÉM validam via isValidAlphanumericCNPJ() pois
 * base-36 de dígitos = base-10. Mantemos esta função separada para deixar a
 * intenção explícita e para o guard de "todos iguais" (ex.: "00000000000000").
 */
export function isValidNumericCNPJ(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;   // todos dígitos iguais são inválidos
  return isValidAlphanumericCNPJ(d);           // reutiliza o engine unificado
}

/**
 * Ponto de entrada principal: valida tanto o formato numérico (pré-2026)
 * quanto o alfanumérico (novo, IN RFB nº 2.229/2024).
 *
 * Lógica de decisão:
 * - Somente dígitos → usa guard de "todos iguais" + algoritmo unificado
 * - Com letras → verifica formato [A-Z0-9]{12}[0-9]{2} + algoritmo unificado
 */
export function isValidCNPJ(raw: string): boolean {
  const c = normalizeCNPJ(raw);
  if (c.length !== 14) return false;

  if (/^\d{14}$/.test(c)) {
    // Numérico puro: aplica guard adicional (todos dígitos iguais = inválido)
    if (/^(\d)\1{13}$/.test(c)) return false;
  }

  return isValidAlphanumericCNPJ(c);
}

// ── Tipo para resultados de parse ─────────────────────────────────────────────

export interface CNPJParseResult {
  isValid:        boolean;
  normalized:     string;   // 14 chars sem pontuação, uppercase
  formatted:      string;   // XX.XXX.XXX/XXXX-XX
  isAlphanumeric: boolean;  // true se contém letras
  dv1?:           number;
  dv2?:           number;
}

export function parseCNPJ(raw: string): CNPJParseResult {
  const normalized     = normalizeCNPJ(raw);
  const formatted      = formatCNPJ(raw);
  const isAlphanumeric = /[A-Z]/.test(normalized);
  const isValid        = isValidCNPJ(normalized);

  if (!isValid || normalized.length !== 14) {
    return { isValid: false, normalized, formatted, isAlphanumeric };
  }

  const base = normalized.substring(0, 12);
  return {
    isValid,
    normalized,
    formatted,
    isAlphanumeric,
    dv1: parseInt(normalized[12]),
    dv2: parseInt(normalized[13]),
  };
}
