// Parsing DEFENSIVO das respostas da SERPRO (número da declaração, PDF do DAS,
// diff da conferência). A forma exata se confirma no trial; aqui garantimos que
// os extratores toleram variações de campo e que o diff só acusa ≥ R$0,01.

import { describe, it, expect } from 'vitest';
import {
  extractNumeroDeclaracao, extractPdfBase64, isPdfBase64, diffTributos, rfbTributosByCodigo,
} from '../domain/pgdasd/responseDomain';

describe('extractNumeroDeclaracao', () => {
  it('aceita numeroDeclaracao / numeroRecibo / numero', () => {
    expect(extractNumeroDeclaracao([{ numeroDeclaracao: '9988' }])).toBe('9988');
    expect(extractNumeroDeclaracao([{ numeroRecibo: 'R-1' }])).toBe('R-1');
    expect(extractNumeroDeclaracao([{ numero: 42 }])).toBe('42');
    expect(extractNumeroDeclaracao([{ outro: 'x' }])).toBeNull();
  });
});

describe('extractPdfBase64 / isPdfBase64', () => {
  it('extrai o pdf e valida o prefixo %PDF-', () => {
    expect(extractPdfBase64([{ pdf: 'JVBERi0xLjQK' }])).toBe('JVBERi0xLjQK');
    expect(isPdfBase64('JVBERi0xLjQK')).toBe(true);
    expect(isPdfBase64('bm90LXBkZg==')).toBe(false); // "not-pdf"
    expect(isPdfBase64(null)).toBe(false);
  });
});

describe('rfbTributosByCodigo', () => {
  it('lê valoresDevidos/detalhamento/tributos por código', () => {
    const m = rfbTributosByCodigo([{ valoresDevidos: [{ codigoTributo: 1001, valor: 6.72 }, { codigo: 1010, valorDevido: 56.28 }] }]);
    expect(m.get(1001)).toBe(6.72);
    expect(m.get(1010)).toBe(56.28);
  });
});

describe('diffTributos', () => {
  const nosso = { irpj: 6.72, csll: 5.88, cofins: 21.54, pis: 4.67, cpp: 72.91, iss: 56.28 };

  it('sem divergência quando a RFB bate ao centavo', () => {
    const itens = [{ valoresDevidos: [
      { codigoTributo: 1001, valor: 6.72 }, { codigoTributo: 1002, valor: 5.88 },
      { codigoTributo: 1004, valor: 21.54 }, { codigoTributo: 1005, valor: 4.67 },
      { codigoTributo: 1006, valor: 72.91 }, { codigoTributo: 1010, valor: 56.28 },
    ] }];
    expect(diffTributos(nosso, itens)).toEqual([]);
  });

  it('acusa divergência ≥ R$0,01', () => {
    const itens = [{ valoresDevidos: [
      { codigoTributo: 1001, valor: 6.72 }, { codigoTributo: 1002, valor: 5.88 },
      { codigoTributo: 1004, valor: 21.54 }, { codigoTributo: 1005, valor: 4.67 },
      { codigoTributo: 1006, valor: 72.91 }, { codigoTributo: 1010, valor: 55.00 }, // ISS difere
    ] }];
    const d = diffTributos(nosso, itens);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ tributo: 'iss', nosso: 56.28, rfb: 55 });
  });

  it('acusa quando temos tributo > 0 e a RFB não devolveu nada para ele', () => {
    const d = diffTributos({ irpj: 6.72 }, [{ valoresDevidos: [] }]);
    expect(d.find((x) => x.tributo === 'irpj')).toMatchObject({ nosso: 6.72, rfb: null });
  });
});
