/** Apply CNPJ mask: 00.000.000/0001-00 */
export function maskCNPJ(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
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

/** Strip all non-digit characters */
export function digits(v: string): string {
  return v.replace(/\D/g, '');
}

/** Simple CNPJ check-digit validation */
export function isValidCNPJ(v: string): boolean {
  const d = digits(v);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    let s = 0, w = n - 7;
    for (let i = 0; i < n - 1; i++) {
      s += Number(d[i]) * (w--);
      if (w < 2) w = 9;
    }
    const r = 11 - (s % 11);
    return r >= 10 ? 0 : r;
  };
  return calc(13) === Number(d[12]) && calc(14) === Number(d[13]);
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
