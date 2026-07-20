// SaleImporter (0071): OFX SGML BR gerado em memória, CSV de maquininha com
// template, sniff de tipo/delimitador, dedup keys e captura sem-perda.

import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import { getImporter, detectSourceKind, computeDedupKey, parseAmount, parseDate, ImportDomainError } from '../domain/import';
import { sniffDelimiter } from '../domain/import/tabularImporter';

// Formato real de banco BR: SGML um-tag-por-linha, sem fechamento de campo.
const OFX_SAMPLE = [
  'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE',
  'ENCODING:USASCII', 'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
  '<OFX>', '<BANKMSGSRSV1>', '<STMTTRNRS>', '<TRNUID>1', '<STMTRS>', '<CURDEF>BRL',
  '<BANKACCTFROM>', '<BANKID>0341', '<ACCTID>12345-6', '<ACCTTYPE>CHECKING', '</BANKACCTFROM>',
  '<BANKTRANLIST>', '<DTSTART>20260701', '<DTEND>20260710',
  '<STMTTRN>', '<TRNTYPE>CREDIT', '<DTPOSTED>20260702', '<TRNAMT>150.00', '<FITID>ABC123', '<MEMO>PIX RECEBIDO CLIENTE', '</STMTTRN>',
  '<STMTTRN>', '<TRNTYPE>DEBIT', '<DTPOSTED>20260703', '<TRNAMT>-50.25', '<FITID>ABC124', '<MEMO>TARIFA', '</STMTTRN>',
  '</BANKTRANLIST>', '</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>', '</OFX>',
].join('\r\n');

const CSV_MAQUININHA = [
  'Data da venda;NSU;Autorizacao;Bandeira;Valor bruto;Taxa;Valor liquido;Parcelas;Terminal',
  '02/07/2026;001234;AUT01;VISA;R$ 100,00;R$ 2,50;R$ 97,50;1;T001',
  '03/07/2026;001235;AUT02;MASTERCARD;R$ 250,00;R$ 6,25;R$ 243,75;2;T001',
].join('\n');

const TEMPLATE = {
  column_map: {
    occurred_at: 'Data da venda', nsu: 'NSU', authorization_code: 'Autorizacao',
    card_brand: 'Bandeira', gross_amount: 'Valor bruto', fee_amount: 'Taxa',
    net_amount: 'Valor liquido', installments: 'Parcelas', terminal_serial: 'Terminal',
  },
  delimiter: ';', decimal_separator: ',', date_format: 'DD/MM/YYYY', has_header: true,
};

describe('detectSourceKind / sniff', () => {
  it('detecta OFX pelo header, XLSX por magic ZIP, CSV por extensão', () => {
    expect(detectSourceKind(Buffer.from(OFX_SAMPLE), 'extrato.ofx')).toBe('ofx');
    expect(detectSourceKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), 'vendas.xlsx')).toBe('xlsx');
    expect(detectSourceKind(Buffer.from(CSV_MAQUININHA), 'vendas.csv')).toBe('csv');
    expect(() => detectSourceKind(Buffer.from('%PDF-1.4'), 'doc.pdf')).toThrowError(ImportDomainError);
  });
  it('sniffDelimiter escolhe o dominante', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',');
  });
});

describe('ofxImporter', () => {
  it('parseia extrato BR (SGML) capturando FITID/valor/memo/conta', async () => {
    const { rows, warnings } = await getImporter('ofx').parse(Buffer.from(OFX_SAMPLE, 'latin1'));
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].source).toBe('bank');
    expect(rows[0].amount).toBe(150);
    expect(rows[0].fitid).toBe('ABC123');
    expect(rows[0].memo).toContain('PIX');
    expect(rows[0].bankAccountRef).toBe('0341:12345-6');
    expect(rows[1].amount).toBe(-50.25);
  });

  it('decodifica win1252 (acento no MEMO)', async () => {
    const withAccent = OFX_SAMPLE.replace('PIX RECEBIDO CLIENTE', 'TRANSFERÊNCIA JOSÉ');
    const buf = iconv.encode(withAccent, 'win1252');
    const { rows } = await getImporter('ofx').parse(buf);
    expect(rows[0].memo).toBe('TRANSFERÊNCIA JOSÉ');
  });

  it('dedup por conta+FITID; fallback hash quando FITID ausente', () => {
    const base = { source: 'bank' as const, bankAccountRef: '0341:12345-6', amount: 150, memo: 'x', raw: {} };
    expect(computeDedupKey({ ...base, fitid: 'ABC123' }, 'ofx')).toBe('ofx:0341:12345-6:ABC123');
    const k = computeDedupKey({ ...base, fitid: null, occurredAt: new Date('2026-07-02T12:00:00Z') }, 'ofx');
    expect(k).toMatch(/^ofx:0341:12345-6:h:[0-9a-f]{64}$/);
  });
});

describe('csvImporter (maquininha via template)', () => {
  it('captura os campos sem perda e preserva a linha em raw', async () => {
    const { rows } = await getImporter('csv').parse(Buffer.from(CSV_MAQUININHA), TEMPLATE as any);
    expect(rows).toHaveLength(2);
    const r = rows[0];
    expect(r.source).toBe('acquirer');
    expect(r.nsu).toBe('001234');
    expect(r.authorizationCode).toBe('AUT01');
    expect(r.cardBrand).toBe('VISA');
    expect(r.grossAmount).toBe(100);
    expect(r.feeAmount).toBe(2.5);
    expect(r.netAmount).toBe(97.5);
    expect(r.installments).toBe(1);
    expect(r.terminalSerial).toBe('T001');
    expect(r.occurredAt?.getFullYear()).toBe(2026);
    expect(r.raw['Bandeira']).toBe('VISA'); // nada se perde
  });

  it('exige template (layouts heterogêneos nunca são adivinhados)', async () => {
    try { await getImporter('csv').parse(Buffer.from(CSV_MAQUININHA), null); expect.unreachable(); }
    catch (e: any) { expect(e.code).toBe('template_required'); }
  });

  it('dedup por adquirente+NSU+dia+valor', () => {
    const tx = { source: 'acquirer' as const, nsu: '001234', acquirer: 'Cielo', grossAmount: 100, occurredAt: new Date('2026-07-02T00:00:00Z'), raw: {} };
    expect(computeDedupKey(tx, 'csv')).toBe('acq:cielo:001234:2026-07-02:100');
  });
});

describe('parse helpers', () => {
  it('parseAmount BR e US', () => {
    expect(parseAmount('R$ 1.234,56')).toBe(1234.56);
    expect(parseAmount('-50,00')).toBe(-50);
    expect(parseAmount('1234.56', '.')).toBe(1234.56);
    expect(parseAmount('abc')).toBeNull();
  });
  it('parseDate DD/MM/YYYY e YYYY-MM-DD', () => {
    expect(parseDate('02/07/2026')?.getMonth()).toBe(6);
    expect(parseDate('2026-07-02', 'YYYY-MM-DD')?.getDate()).toBe(2);
    expect(parseDate('junk')).toBeNull();
  });
});
