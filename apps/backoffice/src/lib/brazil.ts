/**
 * Normaliza CNPJ: remove APENAS pontuação (. - / espaços), mantém letras A-Z
 * para CNPJs alfanuméricos (IN RFB nº 2.229/2024). Sempre converte para maiúsculas.
 * DIFERENTE de digits(): nunca remove letras.
 */
export function normalizeCNPJ(v: string): string {
  return v.replace(/[.\-\/\s]/g, '').toUpperCase();
}

/**
 * Aplica máscara XX.XXX.XXX/XXXX-XX.
 * Aceita [A-Z0-9] em todas as posições (não apenas dígitos).
 */
export function maskCNPJ(v: string): string {
  const c = normalizeCNPJ(v).slice(0, 14);
  return c
    .replace(/^([A-Z0-9]{2})([A-Z0-9])/, '$1.$2')
    .replace(/^([A-Z0-9]{2})\.([A-Z0-9]{3})([A-Z0-9])/, '$1.$2.$3')
    .replace(/\.([A-Z0-9]{3})([A-Z0-9])/, '.$1/$2')
    .replace(/([A-Z0-9]{4})([0-9]{1,2})$/, '$1-$2');
}

/** Apply CPF mask: 000.000.000-00 */
export function maskCPF(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

/** Apply CEP mask: 00000-000 */
export function maskCEP(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.replace(/^(\d{5})(\d)/, '$1-$2');
}

/** Apply phone mask: (00) 00000-0000 or (00) 0000-0000 */
export function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10)
    return d.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').replace(/\($/, '(');
  return d.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').replace(/\($/, '(');
}

/**
 * Strip all non-digit characters.
 * Use para CPF, CEP, telefone — NÃO use para CNPJ alfanumérico (use normalizeCNPJ).
 */
export function digits(v: string): string {
  return v.replace(/\D/g, '');
}

/**
 * Valida CNPJ numérico (pré-2026) E alfanumérico (IN RFB nº 2.229/2024).
 * Algoritmo: Módulo 11 com base-36 (A=10…Z=35, 0-9=0-9).
 * Totalmente retrocompatível — CNPJs numéricos existentes continuam válidos.
 */
export function isValidCNPJ(v: string): boolean {
  const c = normalizeCNPJ(v);
  if (c.length !== 14) return false;
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(c)) return false;
  if (/^\d{14}$/.test(c) && /^(\d)\1{13}$/.test(c)) return false; // todos iguais = inválido

  const W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  function calcDV(str: string, weights: number[]): number {
    let sum = 0;
    const len = Math.min(str.length, weights.length);
    for (let i = 0; i < len; i++) {
      const code = str.charCodeAt(i);
      const val  = code >= 65 && code <= 90 ? code - 55 : code - 48;
      sum += val * weights[i];
    }
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  }

  const base = c.substring(0, 12);
  const dv1  = calcDV(base, W1);
  const dv2  = calcDV(base + dv1, W2);
  return dv1 === parseInt(c[12]) && dv2 === parseInt(c[13]);
}

/** Simple CPF check-digit validation */
export function isValidCPF(v: string): boolean {
  const d = digits(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    let s = 0;
    for (let i = 0; i < n - 1; i++) s += Number(d[i]) * (n - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(10) === Number(d[9]) && calc(11) === Number(d[10]);
}

/** Fetch address from ViaCEP API */
export async function fetchAddressByCEP(cep: string) {
  const c = digits(cep);
  if (c.length !== 8) return null;
  try {
    const res  = await fetch(`https://viacep.com.br/ws/${c}/json/`);
    const data = await res.json() as Record<string, string>;
    if (data['erro']) return null;
    return {
      street:       data['logradouro'] ?? '',
      complement:   data['complemento'] ?? '',
      neighborhood: data['bairro'] ?? '',
      city:         data['localidade'] ?? '',
      state:        data['uf'] ?? '',
    };
  } catch {
    return null;
  }
}

export const UF_LIST = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA',
  'MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN',
  'RS','RO','RR','SC','SP','SE','TO',
];
