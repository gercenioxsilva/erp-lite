// Parsing das RESPOSTAS da SERPRO — PURO. As formas exatas dos retornos
// (conferência, número da declaração, PDF do DAS) só se confirmam no ambiente
// de trial; por isso os extratores são DEFENSIVOS (tentam campos alternativos)
// e ficam isolados aqui, testáveis sem rede. Se um campo mudar, muda-se um
// lugar só — não a orquestração.

import { CODIGO_TRIBUTO, TributoComparavel } from './atividadesDomain';

/** Número da declaração transmitida (protocolo/recibo). */
export function extractNumeroDeclaracao(itens: any[]): string | null {
  for (const it of itens) {
    const n = it?.numeroDeclaracao ?? it?.numeroRecibo ?? it?.numero;
    if (n) return String(n);
  }
  return null;
}

/** PDF (base64) do GERARDAS12 — dados normalizado para ARRAY [{pdf}]. */
export function extractPdfBase64(itens: any[]): string | null {
  for (const it of itens) {
    if (it?.pdf) return String(it.pdf);
  }
  return null;
}

/** Um PDF de DAS válido começa com JVBERi0 (base64 de '%PDF-'). */
export function isPdfBase64(s: string | null): boolean {
  return typeof s === 'string' && s.startsWith('JVBERi0');
}

export interface Divergencia { tributo: string; nosso: number; rfb: number | null; }

/** Extrai os valores devidos por código de tributo da resposta da RFB. */
export function rfbTributosByCodigo(itens: any[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const it of itens) {
    const arr = it?.valoresDevidos ?? it?.detalhamento ?? it?.tributos ?? [];
    for (const v of Array.isArray(arr) ? arr : []) {
      const cod = Number(v?.codigoTributo ?? v?.codigo);
      const val = Number(v?.valor ?? v?.valorDevido);
      if (cod && !Number.isNaN(val)) out.set(cod, val);
    }
  }
  return out;
}

/** Compara nossos tributos com os da RFB; divergência ≥ R$0,01 aparece. */
export function diffTributos(
  nosso: Partial<Record<TributoComparavel, number>>, itens: any[],
): Divergencia[] {
  const rfb = rfbTributosByCodigo(itens);
  const out: Divergencia[] = [];
  for (const t of Object.keys(CODIGO_TRIBUTO) as TributoComparavel[]) {
    const nossoV = nosso[t] ?? 0;
    const rfbV = rfb.has(CODIGO_TRIBUTO[t]) ? rfb.get(CODIGO_TRIBUTO[t])! : null;
    if (rfbV === null ? nossoV > 0 : Math.abs(rfbV - nossoV) >= 0.01) {
      out.push({ tributo: t, nosso: nossoV, rfb: rfbV });
    }
  }
  return out;
}
